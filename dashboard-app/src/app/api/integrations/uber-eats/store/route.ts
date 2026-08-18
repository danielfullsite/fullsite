// Uber Eats — Store status API.
// GET  /api/integrations/uber-eats/store?store_id=xxx → get status
// POST /api/integrations/uber-eats/store → pause or activate
//
// BLINDAJE B1 (P0-3): antes SIN auth → cualquiera cerraba/reactivaba la tienda Uber
// de cualquier restaurante. Ahora exige sesión y verifica que el store_id pertenezca
// al tenant del caller (integration_store_mappings).

import { type NextRequest, NextResponse } from 'next/server'
import { pauseStore, activateStore, getStoreStatus } from '@/lib/integrations/uber-eats/store'
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import { storeBelongsToClient } from '@/lib/integrations/uber-eats/ownership'

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const correlationId = crypto.randomUUID()
  const storeId = request.nextUrl.searchParams.get('store_id') ?? ''
  if (!storeId) return NextResponse.json({ error: 'store_id required' }, { status: 400 })
  if (!(await storeBelongsToClient(storeId, auth.clientId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const result = await getStoreStatus(storeId, correlationId)
  return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
}

export async function POST(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const correlationId = crypto.randomUUID()
  try {
    const { store_id, action, duration_minutes } = await request.json() as {
      store_id: string
      action: 'pause' | 'activate'
      duration_minutes?: number
    }
    if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 })
    if (!(await storeBelongsToClient(store_id, auth.clientId))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (action === 'pause') {
      const result = await pauseStore(store_id, correlationId, duration_minutes)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    if (action === 'activate') {
      const result = await activateStore(store_id, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    return NextResponse.json({ error: 'action must be pause or activate' }, { status: 400 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Error interno', correlation_id: correlationId }, { status: 500 })
  }
}
