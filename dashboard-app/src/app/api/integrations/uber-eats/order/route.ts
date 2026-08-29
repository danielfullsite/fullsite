// Uber Eats — Order lifecycle API (accept / deny / cancel / ready).
// POST /api/integrations/uber-eats/order
//   body: { order_id, action: 'accept'|'deny'|'cancel'|'ready', reason?, minutes_to_ready? }
//
// Routes to EatsLegacyAdapter or DeliveryV1Adapter based on the channel stored
// in delivery_orders.raw_payload. Defaults to 'eats' when no record is found
// so that existing POS integrations continue to work unchanged.

import { type NextRequest, NextResponse } from 'next/server'
import { getOrderAdapter, type UberChannel } from '@/lib/integrations/uber-eats/adapter-factory'
import type { UberDenyReason, UberCancelReason } from '@/lib/integrations/uber-eats/reasons'
import { UBER_DENY_REASONS, UBER_CANCEL_REASONS } from '@/lib/integrations/uber-eats/reasons'
import { checkAdminAuth } from '@/lib/integrations/admin-auth'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function resolveOrderContext(platformOrderId: string): Promise<{ storeId?: string; channel: UberChannel }> {
  const r = await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?platform=eq.ubereats&platform_order_id=eq.${encodeURIComponent(platformOrderId)}&select=raw_payload&limit=1`,
    { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } }
  ).catch(() => null)
  if (!r?.ok) return { channel: 'eats' }
  const rows = (await r.json()) as Array<{ raw_payload?: Record<string, unknown> }>
  const raw = rows[0]?.raw_payload
  if (!raw) return { channel: 'eats' }
  const storeId = (raw.store as { store_id?: string } | undefined)?.store_id
  const channelRaw = ((raw.channel ?? '') as string).toLowerCase()
  const channel: UberChannel = channelRaw === 'delivery' ? 'delivery' : 'eats'
  return { storeId, channel }
}

export async function POST(request: NextRequest) {
  const correlationId = crypto.randomUUID()
  const auth = checkAdminAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error, correlation_id: correlationId }, { status: auth.status })
  try {
    const { order_id, action, reason, minutes_to_ready } = await request.json() as {
      order_id: string
      action: 'accept' | 'deny' | 'cancel' | 'ready'
      reason?: string
      minutes_to_ready?: number
    }
    if (!order_id || !action) {
      return NextResponse.json({ error: 'order_id and action required' }, { status: 400 })
    }

    const { storeId, channel } = await resolveOrderContext(order_id)
    const adapter = getOrderAdapter(channel)

    switch (action) {
      case 'accept': {
        const result = await adapter.acceptOrder(order_id, correlationId, storeId, minutes_to_ready)
        return NextResponse.json({ ...result, correlation_id: correlationId, channel }, { status: result.ok ? 200 : 422 })
      }
      case 'deny': {
        if (!reason || !(reason in UBER_DENY_REASONS)) {
          return NextResponse.json({ error: 'Valid deny reason required', valid_reasons: Object.keys(UBER_DENY_REASONS) }, { status: 400 })
        }
        const result = await adapter.denyOrder(order_id, reason as UberDenyReason, correlationId, storeId)
        return NextResponse.json({ ...result, correlation_id: correlationId, channel }, { status: result.ok ? 200 : 422 })
      }
      case 'cancel': {
        if (!reason || !(reason in UBER_CANCEL_REASONS)) {
          return NextResponse.json({ error: 'Valid cancel reason required', valid_reasons: Object.keys(UBER_CANCEL_REASONS) }, { status: 400 })
        }
        const result = await adapter.cancelOrder(order_id, reason as UberCancelReason, correlationId, storeId)
        return NextResponse.json({ ...result, correlation_id: correlationId, channel }, { status: result.ok ? 200 : 422 })
      }
      case 'ready': {
        const result = await adapter.markOrderReady(order_id, correlationId, storeId)
        return NextResponse.json({ ...result, correlation_id: correlationId, channel }, { status: result.ok ? 200 : 422 })
      }
      default:
        return NextResponse.json({ error: 'action must be accept, deny, cancel, or ready' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), correlation_id: correlationId }, { status: 500 })
  }
}
