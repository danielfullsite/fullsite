// Uber Eats Sandbox — internal test utilities.
// POST /api/integrations/uber-eats/sandbox
//
// Requires Authorization: Bearer <INTEGRATION_ADMIN_SECRET>
// UBER_ENV must be 'sandbox'.
//
// Actions:
//   action: "test_webhook"  — signs a fake Uber order payload and POSTs
//                             it to our own webhook handler, then returns
//                             the handler's response. Tests UBER-009..016.
//   action: "test_invalid_sig" — sends unsigned webhook to verify 401.

import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHmac } from 'crypto'

function checkAuth(request: NextRequest): boolean {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return false
  const raw = request.headers.get('authorization') ?? ''
  const provided = raw.replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
  } catch { return false }
}

function buildOrderPayload(orderId: string, storeId: string): object {
  return {
    event_type: 'orders.notification',
    event_time: Math.floor(Date.now() / 1000),
    meta: {
      status: 'created',
      resource_id: orderId,
      resource_href: `https://test-api.uber.com/v2/eats/orders/${orderId}`,
      resource: {
        id: orderId,
        current_state: 'CREATED',
        type: 'PICK_UP',
        store: { store_id: storeId, name: 'AMALAY Coffee & Market' },
        eater: { first_name: 'Test', last_name: 'Certification' },
        cart: {
          items: [{
            id: 'item-chilaquiles-verdes',
            title: 'Chilaquiles Verdes',
            quantity: 1,
            price: { unit_price: { amount: 13500 } },
            selected_modifier_groups: [],
          }],
        },
        payment: { charges: { total: { amount: 13500 } } },
      },
    },
  }
}

function signPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

async function selfPost(request: NextRequest, path: string, body: string, headers: Record<string, string>) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'app.fullsite.mx'
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return fetch(`${proto}://${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

export async function POST(request: NextRequest) {
  if (process.env.UBER_ENV !== 'sandbox') {
    return NextResponse.json({ error: 'sandbox_only' }, { status: 403 })
  }
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    store_id?: string
    order_id?: string
  }

  const storeId = body.store_id || '633b57d4-237a-5a32-b249-7ceb795f1d35'
  const orderId = body.order_id || `CERT-${Date.now()}`
  const action = body.action || 'test_webhook'

  const webhookSecret = process.env.UBER_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'UBER_WEBHOOK_SECRET not configured' }, { status: 503 })
  }

  const payload = JSON.stringify(buildOrderPayload(orderId, storeId))

  if (action === 'test_invalid_sig') {
    // UBER-017: send with wrong signature → expect 401
    const r = await selfPost(request, '/api/integrations/uber-eats/webhook', payload, {
      'x-uber-signature': 'sha256=badbadbad',
    })
    return NextResponse.json({ ok: r.status === 401, status: r.status, order_id: orderId })
  }

  if (action === 'test_store_status') {
    // UBER-007: send a store.status event → integration_store_mappings.store_open updated
    const is_open = (body as Record<string, unknown>).is_open !== false
    const storeStatusPayload = JSON.stringify({
      event_type: 'store.status',
      event_time: Math.floor(Date.now() / 1000),
      event_id: `store-status-cert-${Date.now()}`,
      store_id: storeId,
      store_status: is_open ? 'ACTIVE' : 'PAUSED',
      is_open,
      meta: { resource: { store: { store_id: storeId } } },
    })
    const sig = signPayload(storeStatusPayload, webhookSecret)
    const r = await selfPost(request, '/api/integrations/uber-eats/webhook', storeStatusPayload, {
      'x-uber-signature': sig,
    })
    return NextResponse.json({ ok: r.ok, status: r.status, store_id: storeId, is_open })
  }

  if (action === 'test_dlq') {
    // UBER-019: send signed webhook from unmapped store → quarantineUnmappedStore → DLQ row
    const unmappedStoreId = '00000000-0000-0000-0000-000000000000'
    const dlqPayload = JSON.stringify(buildOrderPayload(`DLQ-${Date.now()}`, unmappedStoreId))
    const sig = signPayload(dlqPayload, webhookSecret)
    const r = await selfPost(request, '/api/integrations/uber-eats/webhook', dlqPayload, {
      'x-uber-signature': sig,
    })
    return NextResponse.json({ ok: r.ok, status: r.status, unmapped_store_id: unmappedStoreId })
  }

  // Default: test_webhook — sign and send real payload (UBER-009..016)
  const sig = signPayload(payload, webhookSecret)
  const r = await selfPost(request, '/api/integrations/uber-eats/webhook', payload, {
    'x-uber-signature': sig,
  })
  const responseBody = await r.text().catch(() => '')

  return NextResponse.json({
    ok: r.ok,
    status: r.status,
    body: responseBody,
    order_id: orderId,
    store_id: storeId,
  }, { status: r.ok ? 200 : 422 })
}
