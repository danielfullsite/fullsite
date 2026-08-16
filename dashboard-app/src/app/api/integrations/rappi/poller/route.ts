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

function upstreamErrorSummary(payload: unknown): Record<string, unknown> | string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload.slice(0, 300)
  if (typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  return {
    code: typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined,
    code_message: typeof obj.code_message === 'string' ? obj.code_message : undefined,
    message: typeof obj.message === 'string' ? obj.message.slice(0, 300) : undefined,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
  }
}

async function fetchOrders(path: string) {
  const res = await rappiFetch(path, { method: 'GET' })
  const text = await res.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  return { path, res, payload }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as { dry_run?: boolean; store_id?: string }
  const dryRun = body.dry_run !== false
  const storeIdFallback = body.store_id || rappiStoreId()

  const candidates = [`${rappiOrdersBasePath()}/orders`]
  if (storeIdFallback) candidates.push(`${rappiOrdersBasePath()}/stores/${encodeURIComponent(storeIdFallback)}/orders`)

  const attempts = []
  let payload: unknown = null
  for (const path of candidates) {
    const attempt = await fetchOrders(path)
    payload = attempt.payload
    attempts.push({
      path: attempt.path,
      status_code: attempt.res.status,
      upstream_error: attempt.res.ok ? undefined : upstreamErrorSummary(attempt.payload),
    })
    if (attempt.res.ok) break
  }

  const successfulAttempt = attempts.find(attempt => attempt.status_code >= 200 && attempt.status_code < 300)
  if (!successfulAttempt) {
    return NextResponse.json({
      ok: false,
      error: 'RAPPI_POLLER_FAILED',
      status_code: attempts.at(-1)?.status_code ?? 502,
      attempts,
    }, { status: 502 })
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
