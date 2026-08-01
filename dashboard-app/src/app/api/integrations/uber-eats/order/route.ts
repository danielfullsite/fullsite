// Uber Eats — Order lifecycle API (accept / deny / cancel / ready).
// POST /api/integrations/uber-eats/order
//   body: { order_id, action: 'accept'|'deny'|'cancel'|'ready', reason?, minutes_to_ready? }

import { type NextRequest, NextResponse } from 'next/server'
import { acceptOrder, denyOrder, cancelOrder, markOrderReady } from '@/lib/integrations/uber-eats/adapter'
import type { UberDenyReason, UberCancelReason } from '@/lib/integrations/uber-eats/reasons'
import { UBER_DENY_REASONS, UBER_CANCEL_REASONS } from '@/lib/integrations/uber-eats/reasons'

export async function POST(request: NextRequest) {
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

    switch (action) {
      case 'accept': {
        const result = await acceptOrder(order_id, correlationId, minutes_to_ready ?? 20)
        return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
      }
      case 'deny': {
        if (!reason || !(reason in UBER_DENY_REASONS)) {
          return NextResponse.json({ error: 'Valid deny reason required', valid_reasons: Object.keys(UBER_DENY_REASONS) }, { status: 400 })
        }
        const result = await denyOrder(order_id, reason as UberDenyReason, correlationId)
        return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
      }
      case 'cancel': {
        if (!reason || !(reason in UBER_CANCEL_REASONS)) {
          return NextResponse.json({ error: 'Valid cancel reason required', valid_reasons: Object.keys(UBER_CANCEL_REASONS) }, { status: 400 })
        }
        const result = await cancelOrder(order_id, reason as UberCancelReason, correlationId)
        return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
      }
      case 'ready': {
        const result = await markOrderReady(order_id, correlationId)
        return NextResponse.json({ ...result, correlation_id: correlationId }, { status: result.ok ? 200 : 422 })
      }
      default:
        return NextResponse.json({ error: 'action must be accept, deny, cancel, or ready' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), correlation_id: correlationId }, { status: 500 })
  }
}
