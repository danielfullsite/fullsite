// Uber Eats — Store status API.
// GET  /api/integrations/uber-eats/store?store_id=xxx → get status
// POST /api/integrations/uber-eats/store → pause or activate

import { type NextRequest, NextResponse } from 'next/server'
import { pauseStore, activateStore, getStoreStatus } from '@/lib/integrations/uber-eats/store'

export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  const storeId = request.nextUrl.searchParams.get('store_id') ?? ''
  if (!storeId) return NextResponse.json({ error: 'store_id required' }, { status: 400 })
  const result = await getStoreStatus(storeId, correlationId)
  return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
}

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  try {
    const { store_id, action, duration_minutes } = await request.json() as {
      store_id: string
      action: 'pause' | 'activate'
      duration_minutes?: number
    }
    if (!store_id) return NextResponse.json({ error: 'store_id required' }, { status: 400 })
    if (action === 'pause') {
      const result = await pauseStore(store_id, correlationId, duration_minutes)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    if (action === 'activate') {
      const result = await activateStore(store_id, correlationId)
      return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
    }
    return NextResponse.json({ error: 'action must be pause or activate' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), correlation_id: correlationId }, { status: 500 })
  }
}
