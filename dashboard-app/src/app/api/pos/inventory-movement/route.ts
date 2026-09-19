import { NextRequest } from 'next/server'
import { withPOSAuth } from '@/lib/api-auth'
import { inventoryRequestError, isExactInventoryReceipt, isInventoryReceiptAbsent } from '@/lib/inventory-movement-contract'
import type { MovementRequest } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

/** Only this server boundary may supply the service-role actor to the manual
 * inventory RPC. Browser labels, tenant headers and role fields are not actors. */
export async function POST(request: NextRequest) {
  const reject = (error: string, status: number) => Response.json({ error, outcome: 'not_executed' }, { status })
  const auth = await withPOSAuth(request)
  if (!auth) return reject('INVENTORY_AUTH_REQUIRED', 401)
  // Reject stale/mixed browser sessions before mutation. The hint never grants
  // authority; it must match the identity that withPOSAuth actually verified.
  const expectedActor = request.headers.get('x-fullsite-inventory-actor')
  if (expectedActor && expectedActor !== auth.staffId) return reject('INVENTORY_ACTOR_MISMATCH', 403)
  if (!['gerente', 'admin', 'dueño'].includes(auth.role)) return reject('INVENTORY_MANAGER_REQUIRED', 403)
  const raw = await request.text()
  if (raw.length > 256_000) return reject('INVENTORY_REQUEST_TOO_LARGE', 413)
  let body: MovementRequest
  try { body = JSON.parse(raw) } catch { return reject('INVENTORY_INVALID_REQUEST', 400) }
  const invalid = inventoryRequestError(body)
  if (invalid) return reject(invalid, 400)
  if (body.client_id !== auth.clientId) return reject('INVENTORY_TENANT_MISMATCH', 403)
  const command = { ...body, client_id: auth.clientId }
  const actor = { client_id: auth.clientId, id: auth.staffId, name: auth.staffName,
    role: auth.role, auth_type: auth.authType }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return reject('INVENTORY_SERVER_CONFIG_REQUIRED', 503)
  const receiptOnly = request.nextUrl.searchParams.get('receipt_only') === 'true'
  try {
    const rpc = receiptOnly ? 'get_inventory_movement_receipt' : 'record_inventory_movement_atomic'
    const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_request: command, p_actor: actor }),
    })
    const receipt: unknown = await response.json()
    if (!response.ok) {
      // Never forward SQL details, credential errors or service configuration.
      const message = receipt && typeof receipt === 'object' && 'message' in receipt ? String(receipt.message) : ''
      const code = /^INVENTORY_[A-Z_]+$/.test(message) ? message : 'INVENTORY_RPC_UNAVAILABLE'
      return Response.json({ error: code, ...(code === 'INVENTORY_RPC_UNAVAILABLE' || receiptOnly ? {} : { outcome: 'rejected' }) }, { status: code === 'INVENTORY_RPC_UNAVAILABLE' ? 503 : 409 })
    }
    if (receiptOnly && isInventoryReceiptAbsent(receipt, command) && receipt.actor.id === auth.staffId && receipt.actor.auth_type === auth.authType) return Response.json(receipt, { headers: { 'Cache-Control': 'no-store' } })
    if (!isExactInventoryReceipt(receipt, command) || receipt.actor.id !== auth.staffId || receipt.actor.auth_type !== auth.authType) {
      return Response.json({ error: 'INVENTORY_RECEIPT_MISMATCH' }, { status: 502 })
    }
    return Response.json(receipt, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'INVENTORY_RESULT_UNKNOWN_RETRY_SAME_KEY' }, { status: 503 })
  }
}
