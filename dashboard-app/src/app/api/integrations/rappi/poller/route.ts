import { type NextRequest, NextResponse } from 'next/server'
import { processRappiOrder } from '@/lib/integrations/rappi/ingest'
import { rappiFetch, rappiOrdersBasePath, rappiStoreId } from '@/lib/integrations/rappi/auth'

function requireAdmin(request: NextRequest): Response | null {
  const expected = process.env.INTEGRATION_ADMIN_SECRET || ''
  if (!expected) return NextResponse.json({ ok: false, error: 'INTEGRATION_ADMIN_SECRET_REQUIRED' }, { status: 503 })
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = request.headers.get('x-integration-admin-secret')
  if (bearer !== expected && header !== expected) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  return null
}

function orderList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>
  if (Array.isArray(obj.orders)) return obj.orders
  if (Array.isArray(obj.data)) return obj.data
  return []
}

function redactedSummary(order: unknown) {
  const obj = order && typeof order === 'object' ? order as Record<string, unknown> : {}
  const items = Array.isArray(obj.items) ? obj.items : []
  const totals = obj.totals && typeof obj.totals === 'object' ? obj.totals as Record<string, unknown> : {}
  return {
    order_id: obj.order_id ?? obj.id ?? null,
    store_id: obj.store && typeof obj.store === 'object'
      ? ((obj.store as Record<string, unknown>).internal_id ?? (obj.store as Record<string, unknown>).external_id ?? null)
      : null,
    item_count: items.length,
    total_present: totals.total != null || obj.total != null,
  }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as { dry_run?: boolean; store_id?: string }
  const dryRun = body.dry_run !== false
  const storeIdFallback = body.store_id || rappiStoreId()

  const res = await rappiFetch(`${rappiOrdersBasePath()}/orders`, { method: 'GET' })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'RAPPI_POLLER_FAILED', status_code: res.status }, { status: 502 })
  }

  const orders = orderList(payload)
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      provider: 'rappi',
      dry_run: true,
      checked: orders.length,
      orders: orders.map(order => ({
        ...redactedSummary(order),
        store_id_fallback_configured: Boolean(storeIdFallback),
      })),
    })
  }

  const results = []
  for (const order of orders) {
    results.push(await processRappiOrder(order, 'poller'))
  }

  return NextResponse.json({ ok: true, provider: 'rappi', dry_run: false, checked: orders.length, results })
}
