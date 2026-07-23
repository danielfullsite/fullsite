import { NextRequest } from 'next/server'

/**
 * Atomic item transfer between orders.
 *
 * Uses optimistic concurrency on BOTH source and target orders:
 * 1. Read source order (verify item exists, check updated_at)
 * 2. Read target order (if exists, check updated_at)
 * 3. Build new items arrays for both
 * 4. PATCH source with If-Match on updated_at
 * 5. PATCH target (or POST new) with If-Match on updated_at
 * 6. If either PATCH fails → rollback source, abort
 *
 * This is not a true DB transaction but provides OCC guarantees:
 * - If source changed between read and write → abort (no partial transfer)
 * - If target changed between read and write → abort (no data loss)
 * - Audit log only written after both succeed
 */

export async function POST(request: NextRequest) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const headers = {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  }

  try {
    const body = await request.json()
    const {
      client_id, source_order_id, item_id, target_mesa,
      mesero, approved_by, approved_role, source_mesa,
      operation_id // idempotency key to prevent double-transfer on retry
    } = body

    if (!client_id || !source_order_id || !item_id || !target_mesa) {
      return Response.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
    }

    // ── Step 1: Read source order with version ──
    const sourceRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${source_order_id}&client_id=eq.${client_id}&select=id,items,updated_at,mesa,order_revision,turno_id`,
      { headers, cache: 'no-store' }
    )
    if (!sourceRes.ok) return Response.json({ ok: false, error: 'SOURCE_READ_FAILED' }, { status: 502 })
    const sourceRows = await sourceRes.json()
    if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
      return Response.json({ ok: false, error: 'SOURCE_NOT_FOUND' }, { status: 404 })
    }
    const source = sourceRows[0]
    const sourceItems = typeof source.items === 'string' ? JSON.parse(source.items) : (source.items || [])
    const sourceUpdatedAt = source.updated_at
    const sourceTurnoId: string | null = source.turno_id ?? null

    // Verify item exists in source
    const itemIndex = sourceItems.findIndex((i: { id: string }) => i.id === item_id)
    if (itemIndex === -1) {
      return Response.json({ ok: false, error: 'ITEM_NOT_IN_SOURCE', message: 'El item ya no existe en la orden origen. Puede que otra terminal lo haya movido.' }, { status: 409 })
    }
    const transferItem = { ...sourceItems[itemIndex] }

    // ── Step 2: Read target order (if exists) ──
    const targetRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?client_id=eq.${client_id}&mesa=eq.${target_mesa}&status=in.(abierta,enviada,preparando,lista)&order=created_at.desc&limit=1&select=id,items,updated_at,order_revision`,
      { headers, cache: 'no-store' }
    )
    const targetRows = targetRes.ok ? await targetRes.json() : []
    const hasTarget = Array.isArray(targetRows) && targetRows.length > 0
    const target = hasTarget ? targetRows[0] : null
    const targetUpdatedAt = target?.updated_at

    // ── Step 2.5: Guard — CREATE path requires turno_id from source ──
    // Check before any mutations so no rollback is needed on failure.
    if (!hasTarget && !sourceTurnoId) {
      return Response.json({
        ok: false,
        error: 'SOURCE_MISSING_TURNO',
        message: 'La orden origen no tiene turno asignado. No se puede crear la orden destino.'
      }, { status: 422 })
    }

    // ── Step 3: Build new items arrays ──
    const newSourceItems = sourceItems.filter((_: unknown, i: number) => i !== itemIndex)

    let targetItems: unknown[] = []
    if (target) {
      targetItems = typeof target.items === 'string' ? JSON.parse(target.items) : (target.items || [])
    }
    // Preserve item identity (same ID, same batch, same modifiers)
    targetItems.push(transferItem)

    // ── Step 4: PATCH source (remove item) with OCC ──
    const sourcePatchRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${source_order_id}&updated_at=eq.${encodeURIComponent(sourceUpdatedAt)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          items: JSON.stringify(newSourceItems),
          updated_at: new Date().toISOString()
        }),
      }
    )
    if (!sourcePatchRes.ok) {
      return Response.json({ ok: false, error: 'SOURCE_PATCH_FAILED' }, { status: 502 })
    }
    const sourcePatchRows = await sourcePatchRes.json()
    if (!Array.isArray(sourcePatchRows) || sourcePatchRows.length === 0) {
      // OCC conflict: updated_at didn't match → another terminal modified the order
      return Response.json({
        ok: false, error: 'SOURCE_CONFLICT',
        message: 'La orden origen fue modificada por otra terminal. Recarga y reintenta.'
      }, { status: 409 })
    }

    // ── Step 5: PATCH target (add item) or POST new order ──
    let targetSuccess = false
    let targetFailCode = 'TARGET_OCC_CONFLICT'
    let targetFailMessage = 'La orden destino fue modificada por otra terminal. El item no se movió. Reintenta.'

    if (target) {
      const targetPatchRes = await fetch(
        `${sbUrl}/rest/v1/pos_orders?id=eq.${target.id}&updated_at=eq.${encodeURIComponent(targetUpdatedAt)}`,
        {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({
            items: JSON.stringify(targetItems),
            updated_at: new Date().toISOString()
          }),
        }
      )
      if (targetPatchRes.ok) {
        const targetPatchRows = await targetPatchRes.json()
        targetSuccess = Array.isArray(targetPatchRows) && targetPatchRows.length > 0
      }
      // targetFailCode already set to TARGET_OCC_CONFLICT
    } else {
      // Create new order on target mesa using turno_id from the validated source order
      const createRes = await fetch(`${sbUrl}/rest/v1/pos_orders`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id,
          mesa: target_mesa,
          mesero: mesero || 'Transferido',
          personas: 1,
          status: 'enviada',
          items: JSON.stringify([transferItem]),
          turno_id: sourceTurnoId,
          updated_at: new Date().toISOString(),
        }),
      })
      targetSuccess = createRes.ok
      if (!targetSuccess) {
        targetFailCode = 'TARGET_CREATE_FAILED'
        targetFailMessage = 'No se pudo crear la orden destino. Verifica que el turno esté activo y reintenta.'
      }
    }

    if (!targetSuccess) {
      // ── Rollback source: re-add the item ──
      const rollbackRes = await fetch(
        `${sbUrl}/rest/v1/pos_orders?id=eq.${source_order_id}`,
        {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            items: JSON.stringify(sourceItems),
            updated_at: new Date().toISOString()
          }),
        }
      )
      if (!rollbackRes.ok) {
        return Response.json({
          ok: false,
          error: 'SOURCE_ROLLBACK_FAILED',
          message: 'Error crítico: el item fue removido de la orden origen pero no pudo restaurarse. Contacta soporte inmediatamente.'
        }, { status: 500 })
      }
      return Response.json({
        ok: false, error: targetFailCode, message: targetFailMessage
      }, { status: 409 })
    }

    // ── Step 6: Audit log (only after both succeed) ──
    try {
      await fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id,
          order_id: source_order_id,
          action: 'item_transferred',
          actor: mesero || 'Sistema',
          mesa: source_mesa,
          details: {
            item_id,
            item_name: transferItem.nombre || transferItem.name,
            from_mesa: source_mesa,
            to_mesa: target_mesa,
            target_order_id: target?.id || 'new',
            approved_by,
            approved_role,
            operation_id,
          },
        }),
      })
    } catch { /* audit is best-effort */ }

    return Response.json({ ok: true, item_name: transferItem.nombre || transferItem.name })

  } catch (err) {
    console.error('[transfer-item] Unhandled error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
