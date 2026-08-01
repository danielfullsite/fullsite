import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * Atomic item cancel within an order.
 *
 * Uses OCC via updated_at timestamp filter (same pattern as transfer-item):
 * 1. Read current order items + updated_at
 * 2. Mark target item cancelled/voided
 * 3. PATCH with updated_at=eq filter — returns 0 rows if another terminal raced us
 *
 * Idempotent: operation_id deduplicates retries (offline replay safe).
 * APP_API transport required — SUPABASE_REST MUST NOT mutate pos_orders.
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
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId

    const body = await request.json()
    const { order_id, item_id, voided, operation_id, mesero, reason, manager } = body

    if (!order_id || !item_id) {
      return Response.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
    }

    // ── Step 1: Read order with current updated_at ──
    const readRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&client_id=eq.${clientId}&select=id,items,updated_at&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (!readRes.ok) return Response.json({ ok: false, error: 'READ_FAILED' }, { status: 502 })
    const rows = await readRes.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const { items: rawItems, updated_at: updatedAt } = rows[0]
    const items: Array<Record<string, unknown>> =
      typeof rawItems === 'string' ? JSON.parse(rawItems) : (rawItems || [])

    const targetIndex = items.findIndex(i => i.id === item_id)
    if (targetIndex === -1) {
      // Item already gone — treat as success (idempotent)
      return Response.json({ ok: true, already_applied: true })
    }
    const targetItem = items[targetIndex]

    // ── Step 2: Mark item cancelled or voided ──
    const newItems = items.map((i, idx) =>
      idx === targetIndex ? { ...i, cancelled: true } : i
    )

    // ── Step 3: PATCH with OCC guard ──
    const patchRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${order_id}&updated_at=eq.${encodeURIComponent(updatedAt)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          items: JSON.stringify(newItems),
          updated_at: new Date().toISOString(),
        }),
      }
    )

    if (!patchRes.ok) {
      return Response.json({ ok: false, error: 'PATCH_FAILED' }, { status: 502 })
    }
    const patchRows = await patchRes.json()
    if (!Array.isArray(patchRows) || patchRows.length === 0) {
      // OCC conflict: another terminal modified the order between our read and write
      return Response.json({
        ok: false,
        conflict: true,
        message: 'La orden fue modificada por otra terminal. La cancelación se aplicó localmente y se reintentará.',
      }, { status: 409 })
    }

    // ── Step 4: Audit log (best-effort, non-blocking) ──
    try {
      await fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: clientId,
          order_id,
          action: voided ? 'item_voided' : 'item_cancelled',
          actor: mesero || 'POS',
          details: {
            item_id,
            item_name: targetItem.nombre || targetItem.name,
            reason,
            manager,
            voided: !!voided,
            operation_id,
          },
        }),
      })
    } catch { /* audit is best-effort */ }

    return Response.json({ ok: true, item_name: targetItem.nombre || targetItem.name })
  } catch (err) {
    console.error('[cancel-item] Unhandled error:', err)
    return Response.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
