import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { verifyShiftToken } from '@/lib/shift-token'

/** Both accounts and the replay receipt commit in one database transaction.
 * No fallback to separate PATCHes: a missing migration is an unavailable
 * transfer, never permission to remove a row without its destination. */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  let body
  try { body = await request.json() } catch { return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 }) }
  const { source_order_id, item_id, target_mesa, operation_id, approval_token } = body || {}
  if (![source_order_id, item_id, operation_id].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)
    || !Number.isSafeInteger(target_mesa) || target_mesa < 1) {
    return Response.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 })
  }
  const approval = typeof approval_token === 'string' ? await verifyShiftToken(approval_token) : null
  if (!approval || approval.cid !== auth.clientId || !['capitan', 'gerente', 'admin', 'dueño'].includes(approval.rol)) {
    return Response.json({ ok: false, error: 'SUPERVISOR_APPROVAL_REQUIRED' }, { status: 403 })
  }
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ ok: false, error: 'TRANSFER_UNAVAILABLE' }, { status: 503 })
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/r1_transfer_item_atomic`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: auth.clientId, p_operation_id: operation_id,
        p_source_order_id: source_order_id, p_item_id: item_id, p_target_mesa: target_mesa,
        p_actor: approval.nam || approval.sub }),
    })
    const result = await res.json()
    if (!res.ok) {
      const known = ['SOURCE_NOT_FOUND', 'SAME_TABLE', 'SOURCE_NOT_OPEN', 'TARGET_NOT_OPEN', 'TARGET_AMBIGUOUS',
        'ITEM_NOT_IN_SOURCE', 'INVALID_ITEM', 'INVALID_ITEMS', 'INVALID_AMOUNTS', 'INVALID_DISCOUNT', 'OPERATION_ID_REUSED']
      const error = result.code === '23505' && String(result.message).includes('pos_orders_una_cuenta_activa_por_mesa')
        ? 'TARGET_OCCUPIED' : known.find(e => result.message === e)
      return Response.json({ ok: false, error: error || 'TRANSFER_UNAVAILABLE',
        message: error ? 'No se movió el platillo. Actualiza la cuenta y revisa el destino.'
          : 'No se confirmó el resultado. Reintenta la misma transferencia para recuperar su recibo.' }, { status: error ? 409 : 503 })
    }
    if (!result.ok || !result.source_order?.id || !result.target_order?.id) throw new Error('INVALID_RECEIPT')
    return Response.json(result)
  } catch {
    return Response.json({ ok: false, error: 'TRANSFER_UNCONFIRMED',
      message: 'No se confirmó el resultado. Reintenta la misma transferencia para recuperar su recibo.' }, { status: 503 })
  }
}
