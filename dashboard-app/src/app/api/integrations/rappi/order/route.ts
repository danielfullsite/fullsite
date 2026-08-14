import { type NextRequest, NextResponse } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { syncRappiOrderAction } from '@/lib/integrations/rappi/order-sync'
import { isRappiCancelType } from '@/lib/integrations/rappi/reasons'

export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()

  const body = await request.json().catch(() => ({})) as {
    order_id?: string
    action?: 'accept' | 'ready' | 'reject' | 'cancel'
    reason?: string
    minutes_to_ready?: number
  }

  if (!body.order_id || !body.action || !['accept', 'ready', 'reject', 'cancel'].includes(body.action)) {
    return NextResponse.json({ ok: false, error: 'INVALID_RAPPI_ACTION' }, { status: 400 })
  }

  if ((body.action === 'reject' || body.action === 'cancel') && body.reason && !isRappiCancelType(body.reason)) {
    return NextResponse.json({ ok: false, error: 'INVALID_RAPPI_CANCEL_TYPE' }, { status: 400 })
  }

  const result = await syncRappiOrderAction({
    clientId: auth.clientId,
    platformOrderId: body.order_id,
    action: body.action,
    reason: body.reason,
    minutesToReady: body.minutes_to_ready,
    updateLocalStatus: true,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
