// Uber Eats — Reconciliation job.
// POST /api/integrations/uber-eats/reconcile
//   Compares Fullsite delivery_orders (status=nueva) against Uber API.
//   Orders stuck in 'nueva' for > threshold minutes are flagged and moved to DLQ.

import { type NextRequest, NextResponse } from 'next/server'
import { getOrderDetails } from '@/lib/integrations/uber-eats/adapter'
import { auditLog } from '@/lib/integrations/audit-logger'
import { withPOSAuth } from '@/lib/api-auth'
import { timingSafeEqual } from 'crypto'

// BLINDAJE B1 (P0-3): antes SIN auth → POST {} reconciliaba TODOS los tenants
// (quema cuota Uber = DoS). Ahora: bearer INTEGRATION_ADMIN_SECRET para el job
// programado (puede reconciliar todos/uno), o sesión de tenant que SOLO reconcilia
// su propio client_id (jamás todos).
function isIntegrationAdmin(request: NextRequest): boolean {
  const secret = process.env.INTEGRATION_ADMIN_SECRET
  if (!secret) return false
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const a = Buffer.from(provided), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function sbHeaders() {
  return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, 'Content-Type': 'application/json' }
}

const STUCK_THRESHOLD_MINUTES = 30

export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_KEY not configured' }, { status: 503 })
  }

  const correlationId = crypto.randomUUID()
  const bodyIn = await request.json().catch(() => ({})) as { client_id?: string; threshold_minutes?: number }
  const threshold_minutes = bodyIn.threshold_minutes

  // Resolver el scope de client_id de forma segura.
  let client_id: string | undefined
  if (isIntegrationAdmin(request)) {
    client_id = bodyIn.client_id // admin/job: puede reconciliar uno o todos
  } else {
    const auth = await withPOSAuth(request)
    if (!auth) return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 })
    client_id = auth.clientId // tenant: SOLO su propio client_id, nunca todos
  }

  const effectiveThreshold = (process.env.UBER_ENV === 'sandbox' && threshold_minutes != null)
    ? threshold_minutes
    : STUCK_THRESHOLD_MINUTES
  const thresholdTime = new Date(Date.now() - effectiveThreshold * 60_000).toISOString()
  const filter = client_id
    ? `client_id=eq.${client_id}&platform=eq.ubereats&status=eq.nueva&created_at=lt.${thresholdTime}`
    : `platform=eq.ubereats&status=eq.nueva&created_at=lt.${thresholdTime}`

  const r = await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?${filter}&select=id,platform_order_id,client_id,created_at&limit=50`,
    { headers: sbHeaders() }
  )
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: 'Failed to query delivery_orders' }, { status: 500 })
  }

  const stuckOrders = (await r.json()) as Array<{ id: string; platform_order_id: string; client_id: string; created_at: string }>
  const results: Array<{ order_id: string; uber_status?: string; action: string }> = []

  for (const order of stuckOrders) {
    if (!order.platform_order_id) continue
    const details = await getOrderDetails(order.platform_order_id, correlationId)
    const uberOrder = details.order as { current_state?: string; status?: string } | undefined
    const uberStatus = uberOrder?.current_state ?? uberOrder?.status ?? 'unknown'

    if (uberStatus === 'CANCELLED' || uberStatus === 'cancelled') {
      await fetch(
        `${SB_URL()}/rest/v1/delivery_orders?id=eq.${order.id}`,
        { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelada', updated_at: new Date().toISOString() }) }
      )
      results.push({ order_id: order.platform_order_id, uber_status: uberStatus, action: 'cancelled' })
    } else if (uberStatus === 'DELIVERED' || uberStatus === 'delivered') {
      await fetch(
        `${SB_URL()}/rest/v1/delivery_orders?id=eq.${order.id}`,
        { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'entregada', updated_at: new Date().toISOString() }) }
      )
      results.push({ order_id: order.platform_order_id, uber_status: uberStatus, action: 'delivered' })
    } else {
      results.push({ order_id: order.platform_order_id, uber_status: uberStatus, action: 'still_open' })
    }
  }

  await auditLog({
    provider: 'ubereats',
    client_id: client_id ?? null,
    correlation_id: correlationId,
    action: 'reconciliation.run',
    request: { stuck_threshold_minutes: effectiveThreshold },
    response: { checked: stuckOrders.length, results },
  })

  return NextResponse.json({ ok: true, correlation_id: correlationId, checked: stuckOrders.length, results })
}
