import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { reconciliarInventarioConfirmado } from '@/lib/inventory-reconcile-server'

/** Repeating a sale reconciliation cannot change its committed intent. */
export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  let body
  try { body = await request.json() } catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }) }
  if (!body || typeof body.order_id !== 'string' || !body.order_id || body.order_id.length > 200 ||
    Object.keys(body).some(key => key !== 'order_id')) return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  const result = await reconciliarInventarioConfirmado(auth.clientId, body.order_id)
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
