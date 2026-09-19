/** El Offline Shell comparte la misma frontera service-role que /api/pos/db. */
import { NextRequest, NextResponse } from 'next/server'
import { runPOSDBProxy } from '@/lib/pos-db-proxy'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const { path } = await context.params
  const resource = (path || []).join('/')
  if (resource.startsWith('rest/v1/rpc/')) {
    console.warn('[pos-db-proxy] RPC rechazado', { rpc: resource.slice('rest/v1/rpc/'.length), tenant: auth.clientId, rol: auth.role, metodo: request.method })
  }
  if (!/^rest\/v1\/pos_[a-z0-9_]+$/.test(resource)) return NextResponse.json({ error: 'Sólo tablas POS; usa la API de dominio para RPC' }, { status: 403 })
  return runPOSDBProxy(request, resource + request.nextUrl.search, request.method, auth)
}
export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
