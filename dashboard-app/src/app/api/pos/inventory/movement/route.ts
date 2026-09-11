import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { isManager } from '@/lib/pos-db-policy'

/** Manual inventory adjustments require verified tenant membership and manager
 * authority. The browser's actor/client fields never authorize the transaction. */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if (!isManager(auth.role) || !auth.staffId) return Response.json({ error: 'MANAGER_REQUIRED' }, { status: 403 })
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    body.client_id !== auth.clientId || typeof body.idempotency_key !== 'string' ||
    !body.idempotency_key.trim() || body.idempotency_key.length > 1000 ||
    !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 1000) {
    return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  }
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) return Response.json({ error: 'INVENTORY_UNAVAILABLE' }, { status: 503 })
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/pos_record_inventory_movement`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: auth.clientId, p_actor: auth.staffId, p_movement_type: body.movement_type,
        p_lines: body.lines, p_idempotency_key: body.idempotency_key, p_metadata: body.metadata ?? {} }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    const result = await response.json()
    if (!response.ok) {
      const known = ['INVALID_MOVEMENT_IDENTITY','INVALID_MOVEMENT_TYPE','INVALID_LINES','INVALID_LINE',
        'INVALID_QUANTITY_OR_COST','DUPLICATE_INGREDIENT','MOVEMENT_KEY_REUSED','INGREDIENT_SCOPE_CONFLICT',
        'LEGACY_MOVEMENT_REQUIRES_RECONCILIATION','INVENTORY_ROW_REQUIRED','AMBIGUOUS_INVENTORY','SUBRECIPE_HAS_NO_STOCK','INVALID_CURRENT_STOCK_OR_COST','INSUFFICIENT_STOCK']
      const error = known.includes(result.message) ? result.message : 'INVENTORY_UNCONFIRMED'
      return Response.json({ error }, { status: error === 'INVENTORY_UNCONFIRMED' ? 503 : 409 })
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'INVENTORY_UNCONFIRMED' }, { status: 503 }) }
}
