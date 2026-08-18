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
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'

// BLINDAJE B1 (P0-3): antes SIN auth → con un order_id adivinable se podía
// denegar/cancelar la orden en curso de OTRO tenant. Ahora sesión + la orden debe
// pertenecer al client_id del caller (delivery_orders.client_id).

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function resolveOrderContext(platformOrderId: string): Promise<{ storeId?: string; channel: UberChannel; clientId?: string; found: boolean }> {
  const r = await fetch(
    `${SB_URL()}/rest/v1/delivery_orders?platform=eq.ubereats&platform_order_id=eq.${encodeURIComponent(platformOrderId)}&select=raw_payload,client_id&limit=1`,
    { headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}` } }
  ).catch(() => null)
  if (!r?.ok) return { channel: 'eats', found: false }
  const rows = (await r.json()) as Array<{ raw_payload?: Record<string, unknown>; client_id?: string }>
  const row = rows[0]
  if (!row) return { channel: 'eats', found: false }
  const raw = row.raw_payload
  const storeId = (raw?.store as { store_id?: string } | undefined)?.store_id
  const channelRaw = ((raw?.channel ?? '') as string).toLowerCase()
  const channel: UberChannel = channelRaw === 'delivery' ? 'delivery' : 'eats'
  return { storeId, channel, clientId: row.client_id, found: true }
}

export async function POST(request: NextRequest) {
  const originBlock = sameOriginOnly(request); if (originBlock) return originBlock
  const auth = await withPOSAuth(request)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const correlationId = crypto.randomUUID()
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

    const { storeId, channel, clientId, found } = await resolveOrderContext(order_id)
    // La orden debe existir y pertenecer al tenant del caller (sin IDOR cross-tenant).
    if (!found || clientId !== auth.clientId) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    }
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
  } catch {
    return NextResponse.json({ ok: false, error: 'Error interno', correlation_id: correlationId }, { status: 500 })
  }
}
