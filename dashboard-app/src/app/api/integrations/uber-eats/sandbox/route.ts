// Uber Eats Sandbox — internal test utilities.
// POST /api/integrations/uber-eats/sandbox
//
// Requires Authorization: Bearer <INTEGRATION_ADMIN_SECRET>
// UBER_ENV must be 'sandbox'.
//
// Actions (Day 1):
//   test_webhook          — HMAC-signed Eats order → our webhook handler
//   test_invalid_sig      — bad signature → expect 401
//   test_store_status     — store.status event → store_open updated
//   test_dlq              — unmapped store → quarantineUnmappedStore + DLQ
//
// Actions (Day 3 — Delivery V1 signal generation):
//   delivery_store_all    — runs all 5 Delivery Store API calls in sequence
//   delivery_store_list   — GET  /v1/delivery/stores
//   delivery_store_get    — GET  /v1/delivery/store/{id}
//   delivery_store_status — GET  /v1/delivery/store/{id}/status
//   delivery_store_pause  — POST /v1/delivery/store/{id}/update-store-status (PAUSE)
//   delivery_store_activate— POST /v1/delivery/store/{id}/update-store-status (ACTIVATE)
//   test_delivery_webhook — sends signed webhook with channel=delivery → DeliveryV1Adapter
//   delivery_order_get    — GET  /v1/delivery/order/{id}   (requires order_id)
//   delivery_order_accept — POST /v1/delivery/order/{id}/accept
//   delivery_order_deny   — POST /v1/delivery/order/{id}/deny
//   delivery_order_cancel — POST /v1/delivery/order/{id}/cancel
//   delivery_order_ready  — POST /v1/delivery/order/{id}/ready
//   scope_probe           — diagnostic: tries each endpoint and reports status codes
//   reauth_url            — returns USL authorize URL with expanded scopes

import { type NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual, createHmac } from 'crypto'
import {
  listDeliveryStores,
  getDeliveryStore,
  getDeliveryStoreStatus,
  updateDeliveryStoreStatus,
} from '@/lib/integrations/uber-eats/delivery-store'
import {
  getDeliveryOrderDetails,
  acceptDeliveryOrder,
  denyDeliveryOrder,
  cancelDeliveryOrder,
  markDeliveryOrderReady,
} from '@/lib/integrations/uber-eats/delivery-adapter'
import { buildUberAuthUrl, USL_SCOPES } from '@/lib/integrations/uber-eats/oauth'

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

function buildDeliveryOrderPayload(orderId: string, storeId: string): object {
  return {
    event_type: 'orders.notification',
    channel: 'delivery',
    event_time: Math.floor(Date.now() / 1000),
    event_id: `delivery-${orderId}`,
    meta: {
      status: 'created',
      resource_id: orderId,
      resource_href: `https://test-api.uber.com/v1/delivery/order/${orderId}`,
      resource: {
        id: orderId,
        current_state: 'CREATED',
        type: 'DELIVERY',
        channel: 'delivery',
        store: { store_id: storeId, name: 'AMALAY Coffee & Market' },
        eater: { first_name: 'Test', last_name: 'Delivery Cert' },
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

  // ─── Day 3: Delivery Store APIs ───────────────────────────────────────────

  if (action === 'delivery_store_all') {
    const corrBase = crypto.randomUUID()
    const ts = new Date().toISOString()
    const results = {
      ts,
      store_id: storeId,
      list:     await listDeliveryStores(`${corrBase}-list`, storeId),
      get:      await getDeliveryStore(storeId, `${corrBase}-get`),
      status:   await getDeliveryStoreStatus(storeId, `${corrBase}-status`),
      pause:    await updateDeliveryStoreStatus(storeId, 'PAUSE', `${corrBase}-pause`),
      activate: await updateDeliveryStoreStatus(storeId, 'ACTIVATE', `${corrBase}-activate`),
    }
    return NextResponse.json({ action, correlation_base: corrBase, ...results })
  }

  if (action === 'delivery_store_list') {
    const corrId = crypto.randomUUID()
    const result = await listDeliveryStores(corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_store_get') {
    const corrId = crypto.randomUUID()
    const result = await getDeliveryStore(storeId, corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_store_status') {
    const corrId = crypto.randomUUID()
    const result = await getDeliveryStoreStatus(storeId, corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_store_pause') {
    const corrId = crypto.randomUUID()
    const result = await updateDeliveryStoreStatus(storeId, 'PAUSE', corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_store_activate') {
    const corrId = crypto.randomUUID()
    const result = await updateDeliveryStoreStatus(storeId, 'ACTIVATE', corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  // ─── Day 3: Delivery order via self-injected webhook ──────────────────────

  if (action === 'test_delivery_webhook') {
    // Sends a webhook with channel=delivery to our own handler.
    // Handler detects channel=delivery → DeliveryV1Adapter → GET /v1/delivery/order/{id}
    // This generates real Uber-visible API traffic even if the order doesn't exist.
    const deliveryOrderId = orderId
    const delivPayload = JSON.stringify(buildDeliveryOrderPayload(deliveryOrderId, storeId))
    const sig = signPayload(delivPayload, webhookSecret)
    const r = await selfPost(request, '/api/integrations/uber-eats/webhook', delivPayload, {
      'x-uber-signature': sig,
    })
    const responseBody = await r.text().catch(() => '')
    return NextResponse.json({
      action,
      ok: r.ok,
      webhook_status: r.status,
      body: responseBody,
      order_id: deliveryOrderId,
      store_id: storeId,
      channel: 'delivery',
      ts: new Date().toISOString(),
    }, { status: r.ok ? 200 : 422 })
  }

  // ─── Day 3: Delivery order direct API calls ───────────────────────────────

  if (action === 'delivery_order_get') {
    if (!orderId || orderId.startsWith('CERT-')) {
      return NextResponse.json({ error: 'provide a real order_id from Uber sandbox panel' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await getDeliveryOrderDetails(orderId, corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, order_id: orderId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_order_accept') {
    if (!orderId || orderId.startsWith('CERT-')) {
      return NextResponse.json({ error: 'provide a real order_id from Uber sandbox panel' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await acceptDeliveryOrder(orderId, corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, order_id: orderId, ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_order_deny') {
    if (!orderId || orderId.startsWith('CERT-')) {
      return NextResponse.json({ error: 'provide a real order_id from Uber sandbox panel' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await denyDeliveryOrder(orderId, 'ITEM_UNAVAILABLE', corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, order_id: orderId, reason: 'ITEM_UNAVAILABLE', ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_order_cancel') {
    if (!orderId || orderId.startsWith('CERT-')) {
      return NextResponse.json({ error: 'provide a real order_id from Uber sandbox panel' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await cancelDeliveryOrder(orderId, 'RESTAURANT_TOO_BUSY', corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, order_id: orderId, reason: 'RESTAURANT_TOO_BUSY', ts: new Date().toISOString(), result })
  }

  if (action === 'delivery_order_ready') {
    if (!orderId || orderId.startsWith('CERT-')) {
      return NextResponse.json({ error: 'provide a real order_id from Uber sandbox panel' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await markDeliveryOrderReady(orderId, corrId, storeId)
    return NextResponse.json({ action, correlation_id: corrId, order_id: orderId, ts: new Date().toISOString(), result })
  }

  // ─── Diagnostic: scope probe ──────────────────────────────────────────────

  if (action === 'scope_probe') {
    // Probes each scope-gated endpoint with the current USL token.
    // Reports status codes so we know exactly what's covered by eats.pos_provisioning.
    const corrId = crypto.randomUUID()
    const probeOrderId = 'SCOPE-PROBE-NOOP'
    const [storeList, storeGet, storeStatus, orderGet, delivStoreList, delivStoreGet] = await Promise.allSettled([
      listDeliveryStores(`${corrId}-ds-list`, storeId),
      getDeliveryStore(storeId, `${corrId}-ds-get`),
      getDeliveryStoreStatus(storeId, `${corrId}-ds-status`),
      getDeliveryOrderDetails(probeOrderId, `${corrId}-do-get`, storeId),
      listDeliveryStores(`${corrId}-dl-list`, storeId),
      getDeliveryStore(storeId, `${corrId}-dl-get`),
    ])
    const settle = (r: PromiseSettledResult<unknown>) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }
    return NextResponse.json({
      action,
      correlation_id: corrId,
      ts: new Date().toISOString(),
      scopes_requested: USL_SCOPES,
      probe: {
        delivery_store_list:   settle(storeList),
        delivery_store_get:    settle(storeGet),
        delivery_store_status: settle(storeStatus),
        delivery_order_get:    settle(orderGet),
        delivery_store_list2:  settle(delivStoreList),
        delivery_store_get2:   settle(delivStoreGet),
      },
    })
  }

  // ─── Re-auth URL ──────────────────────────────────────────────────────────

  if (action === 'reauth_url') {
    const state = crypto.randomUUID()
    const redirectUri = process.env.UBER_REDIRECT_URI || 'https://app.fullsite.mx/api/integrations/uber-eats/auth/callback'
    const url = buildUberAuthUrl(state, redirectUri)
    return NextResponse.json({
      action,
      ts: new Date().toISOString(),
      scopes: USL_SCOPES,
      auth_url: url,
      instructions: 'Visit auth_url as the store owner to re-authorize with expanded scopes (eats.order + eats.deliveries). State is one-time — generate fresh if unused for > 10 min.',
    })
  }

  // Default: test_webhook — sign and send real Eats payload
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
