import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyShiftToken } from '@/lib/shift-token'
import { prepararCancelacionItem } from '@/lib/cancelacion-item'
import { reconciliarInventarioConfirmado } from '@/lib/inventory-reconcile-server'

const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, 'dueño': 6 }

/**
 * Atomic item cancel within an order.
 *
 * The database commits the OCC update, audit row and operation receipt in one
 * transaction. A retry reads its receipt before looking at mutable order state.
 * APP_API transport required — SUPABASE_REST MUST NOT mutate pos_orders.
 */

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()
    const clientId = auth.clientId

    const body = await request.json()
    const { order_id, item_id, prepared, voided, operation_id, reason, approval_token } = body

    if (typeof order_id !== 'string' || !order_id || order_id.length > 200 ||
        typeof item_id !== 'string' || !item_id || item_id.length > 200 ||
        (reason != null && (typeof reason !== 'string' || reason.length > 500))) {
      return Response.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
    }

    // ── Enforcement de aprobación de gerente (anti-fraude, PERM-07) ──
    // Antes: la ruta confiaba en el string `manager` → un mesero podía cancelar por POST
    // directo. Ahora:
    //   • Online: exige el token FIRMADO del gerente (rol gerente+, mismo tenant) que emite
    //     /api/pos/pin → infalsificable desde el cliente.
    //   • Sin token separado: sólo una sesión firmada que ya sea gerente+.
    let approvalMode = ''
    let approvedBy = auth.staffName || auth.staffId
    if (typeof approval_token === 'string' && approval_token) {
      const p = await verifyShiftToken(approval_token)
      if (p && p.cid === clientId && (ROLE_LVL[p.rol] || 0) >= 4) {
        approvalMode = 'online:' + p.rol
        approvedBy = p.nam || p.sub
      }
    }
    if (!approvalMode) {
      const requesterLevel = ROLE_LVL[auth.role] || 0
      // `offline_approved` era un booleano controlado por el navegador. Sólo una
      // sesión firmada de gerente puede autorizar sin un segundo token. En AMALAY,
      // las operaciones sin WAN pasan por Caja y su actor_token local; el camino
      // cloud no inventa una aprobación que no puede verificar.
      if (requesterLevel >= 4) approvalMode = `session_role:${auth.role}`
      else return Response.json({ ok: false, error: 'MANAGER_APPROVAL_REQUIRED' }, { status: 403 })
    }
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY
    if (!sbKey) return Response.json({ ok: false, error: 'CANCEL_UNAVAILABLE' }, { status: 503 })
    if (!approvedBy) return Response.json({ ok: false, error: 'APPROVER_ID_REQUIRED' }, { status: 403 })
    if (typeof operation_id !== 'string' || !operation_id || operation_id.length > 200) {
      return Response.json({ ok: false, error: 'OPERATION_ID_REQUIRED' }, { status: 400 })
    }
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' }
    const intent = {
      order_id, item_id, prepared: prepared !== false, voided: voided === true,
      reason: typeof reason === 'string' ? reason : null,
    }

    // A state-based retry stops working once another legitimate write removes or
    // reshapes the item. The durable receipt is therefore checked first.
    const receiptRes = await fetch(
      `${sbUrl}/rest/v1/pos_cancel_item_operations?client_id=eq.${encodeURIComponent(clientId)}` +
      `&operation_id=eq.${encodeURIComponent(operation_id)}&select=intent,result&limit=1`,
      { headers, cache: 'no-store' },
    )
    if (!receiptRes.ok) return Response.json({ ok: false, error: 'CANCEL_UNCONFIRMED' }, { status: 503 })
    const receipts = await receiptRes.json().catch(() => [])
    if (!Array.isArray(receipts)) return Response.json({ ok: false, error: 'CANCEL_UNCONFIRMED' }, { status: 503 })
    if (receipts.length > 0) {
      const prior = receipts[0]
      const sameIntent = prior?.intent?.order_id === intent.order_id && prior.intent.item_id === intent.item_id &&
        prior.intent.prepared === intent.prepared && prior.intent.voided === intent.voided && prior.intent.reason === intent.reason
      if (!sameIntent) return Response.json({ ok: false, error: 'OPERATION_ID_REUSED' }, { status: 409 })
      if (prior?.result?.ok !== true || prior.result?.order?.id !== order_id || !Number.isSafeInteger(prior.result.revision)) {
        return Response.json({ ok: false, error: 'CANCEL_UNCONFIRMED' }, { status: 503 })
      }
      const inventory = await reconciliarInventarioConfirmado(clientId, order_id)
      return Response.json({ ...prior.result, already_applied: true, ...inventory }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // ── Step 1: Read order with current updated_at ──
    const readRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(order_id)}&client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (!readRes.ok) return Response.json({ ok: false, error: 'READ_FAILED' }, { status: 502 })
    const rows = await readRes.json()
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 })
    }

    const order = rows[0]
    const { updated_at: updatedAt, order_revision: revisionActual } = order
    let cancellation
    try { cancellation = prepararCancelacionItem(order, item_id, { prepared, voided, reason }) }
    catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : 'INVALID_ORDER' }, { status: 409 }) }
    if (cancellation.alreadyApplied) {
      const inventory = await reconciliarInventarioConfirmado(clientId, order_id)
      return Response.json({ ok: true, already_applied: true, revision: order.order_revision, order, ...inventory })
    }
    const targetItem = cancellation.item!

    const details = { item_id, item_name: targetItem.nombre || targetItem.name, reason: intent.reason,
      monto: Number(targetItem.subtotal) || 0, cantidad: Number(targetItem.cantidad) || 0,
      ya_enviado_a_cocina: Number(targetItem.sent_quantity) > 0, approval_mode: approvalMode,
      solicitante_rol: auth.role, voided: intent.voided, prepared: intent.prepared, operation_id }
    const commitRes = await fetch(`${sbUrl}/rest/v1/rpc/r1_cancel_item_atomic`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_client_id: clientId, p_order_id: order_id, p_operation_id: operation_id,
        p_expected_updated_at: updatedAt, p_expected_revision: Number(revisionActual) || 0,
        p_intent: intent, p_patch: { ...cancellation.patch, order_revision: (Number(revisionActual) || 0) + 1 },
        p_actor: approvedBy, p_action: intent.voided ? 'item_voided' : 'item_cancelled', p_details: details }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const committed = await commitRes.json().catch(() => ({}))
    if (!commitRes.ok) {
      const known = ['ORDER_NOT_FOUND','ORDER_CONFLICT','OPERATION_ID_REUSED','INVALID_CANCEL']
      const error = known.includes(committed.message) ? committed.message : 'CANCEL_UNCONFIRMED'
      return Response.json({ ok: false, error, conflict: error === 'ORDER_CONFLICT' },
        { status: error === 'CANCEL_UNCONFIRMED' ? 503 : 409 })
    }
    if (committed?.ok !== true || committed?.order?.id !== order_id || !Number.isSafeInteger(committed.revision)) {
      return Response.json({ ok: false, error: 'CANCEL_UNCONFIRMED' }, { status: 503 })
    }

    // La revision nueva viaja de vuelta para que quien cancelo actualice su copia y
    // su PROXIMO guardado no choque contra el avance que acaba de provocar.
    const inventory = await reconciliarInventarioConfirmado(clientId, order_id)
    return Response.json({
      ok: true,
      ...committed,
      ...inventory,
    })
  } catch (err) {
    console.error('[cancel-item] Unhandled error:', err)
    return Response.json({ ok: false, error: 'CANCEL_UNCONFIRMED' }, { status: 503 })
  }
}
