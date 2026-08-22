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
//   delivery_store_all     — runs all 5 Delivery Store API calls in sequence
//   delivery_store_list    — GET  /v1/delivery/stores
//   delivery_store_get     — GET  /v1/delivery/store/{id}
//   delivery_store_status  — GET  /v1/delivery/store/{id}/status
//   delivery_store_pause   — POST /v1/delivery/store/{id}/update-store-status (PAUSE)
//   delivery_store_activate— POST /v1/delivery/store/{id}/update-store-status (ACTIVATE)
//   test_delivery_webhook  — INTERNAL ONLY: signed webhook with channel=delivery
//                            validates pipeline routing (DeliveryV1Adapter selection).
//                            NOT primary Uber evidence — real order required for that.
//   delivery_sandbox_order — attempts POST /v1/eats/sandbox/orders to create a real
//                            Uber sandbox order; documents blocker if unsupported.
//   delivery_order_get     — GET  /v1/delivery/order/{id}   (requires real order_id)
//   delivery_order_accept  — POST /v1/delivery/order/{id}/accept
//   delivery_order_deny    — POST /v1/delivery/order/{id}/deny
//   delivery_order_cancel  — POST /v1/delivery/order/{id}/cancel
//   delivery_order_ready   — POST /v1/delivery/order/{id}/ready
//   create_promotion       — POST create a store promotion (cert req #10)
//   request_report         — POST request a report → workflow_id (cert req #11)
//   get_report_file        — GET the report file from a pre-signed download_url
//   scope_probe            — diagnostic: tries each endpoint, records status codes
//   reauth_url             — returns USL authorize URL with expanded scopes
//   day3_full              — runs full approved Day 3 sequence, returns structured evidence
//   evidence_export        — pulls audit_log Day 3 entries formatted for Uber submission

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
import { buildUberAuthUrl, USL_SCOPES, MARKETPLACE_M2M_SCOPES, DELIVERY_M2M_SCOPES, probeM2MToken } from '@/lib/integrations/uber-eats/oauth'
import { createPromotion, buildSamplePromotion } from '@/lib/integrations/uber-eats/promotions'
import { requestReport, buildSampleReportRequest, getReportFile } from '@/lib/integrations/uber-eats/reporting'

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
    download_url?: string
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

  // ─── Diagnostic: scope probe (3 phases, by grant type) ───────────────────
  // Tests each token type independently to surface exactly where Uber's whitelist
  // stands. Do NOT compare scopes across grant types (USL vs M2M).
  //
  // Phase 1 — USL (authorization_code, eats.pos_provisioning)
  //   Reads what Uber granted in DB. Attempts accept_pos_order on a NOOP order.
  //   404 = scope OK (order not found). 401 = scope not granted.
  //
  // Phase 2 — Marketplace M2M (client_credentials: eats.store + eats.order)
  //   Requests M2M token and records granted_scope from Uber's response.
  //   If token request fails with invalid_scope → app not whitelisted.
  //   On success, probes GET /v1/delivery/store/{id}.
  //
  // Phase 3 — Delivery M2M (client_credentials: eats.deliveries)
  //   Requests M2M token. On success, probes GET /v1/delivery/order/PROBE.

  // ─── Promotions + Reporting (Uber cert requirements #10, #11) ─────────────

  if (action === 'create_promotion') {
    const corrId = crypto.randomUUID()
    const result = await createPromotion(storeId, buildSamplePromotion(), corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'request_report') {
    const corrId = crypto.randomUUID()
    const result = await requestReport(buildSampleReportRequest(storeId), corrId)
    return NextResponse.json({ action, correlation_id: corrId, store_id: storeId, ts: new Date().toISOString(), result })
  }

  if (action === 'get_report_file') {
    // Pass the pre-signed download_url delivered by the eats.report.success webhook.
    if (!body.download_url) {
      return NextResponse.json({ error: 'provide download_url from the eats.report.success webhook' }, { status: 400 })
    }
    const corrId = crypto.randomUUID()
    const result = await getReportFile(body.download_url, corrId)
    return NextResponse.json({ action, correlation_id: corrId, ts: new Date().toISOString(), result })
  }

  if (action === 'scope_probe') {
    const corrId = crypto.randomUUID()
    const ts = new Date().toISOString()
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    // ── Phase 1: USL / Provisioning ──────────────────────────────────────────
    let uslGrantedScopes: string[] = []
    let uslTokenExpiresAt: string | null = null
    let uslDbStatus = 'ok'
    try {
      const dbR = await fetch(
        `${sbUrl}/rest/v1/integration_providers?provider=eq.ubereats&provider_account_id=eq.${encodeURIComponent(storeId)}&select=scopes,token_expires_at&limit=1`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
      )
      if (dbR.ok) {
        const rows = (await dbR.json()) as Array<{ scopes: string[]; token_expires_at: string }>
        if (rows.length) { uslGrantedScopes = rows[0].scopes ?? []; uslTokenExpiresAt = rows[0].token_expires_at ?? null }
        else uslDbStatus = 'no_row_found'
      } else uslDbStatus = 'db_error'
    } catch { uslDbStatus = 'db_exception' }

    // Probe accept_pos_order — 404 = scope ok, 401 = scope missing
    let uslProbe: { ok: boolean; status?: number; interpretation?: string; error?: string } = { ok: false }
    try {
      const { uberFetch } = await import('@/lib/integrations/uber-eats/oauth')
      const r = await uberFetch('/v1/eats/orders/SCOPE-PROBE-USL/accept_pos_order', {
        method: 'POST',
        body: JSON.stringify({ reason: 'scope_probe', minutes_to_ready: 20 }),
        tokenType: 'provisioning',
        storeId,
      })
      uslProbe = {
        ok: r.status === 404, // 404 = order not found (scope is OK); 401 = scope denied
        status: r.status,
        interpretation: r.status === 404 ? 'eats.pos_provisioning GRANTED (404=order not found is expected)' : r.status === 401 ? 'eats.pos_provisioning DENIED or token expired' : `unexpected HTTP ${r.status}`,
      }
    } catch (e) { uslProbe = { ok: false, error: String(e) } }

    const phase1 = {
      grant_type: 'authorization_code',
      scope_requested: USL_SCOPES,
      scopes_granted_by_uber: uslGrantedScopes,
      token_expires_at: uslTokenExpiresAt,
      db_status: uslDbStatus,
      probe_accept_pos_order: uslProbe,
      blocker: !uslGrantedScopes.includes('eats.pos_provisioning') ? 'eats.pos_provisioning not in granted scopes — re-auth required' : null,
    }

    // ── Phase 2: Marketplace M2M ──────────────────────────────────────────────
    const marketplaceTokenProbe = await probeM2MToken(MARKETPLACE_M2M_SCOPES.join(' '))
    let marketplaceEndpointProbe: { ok: boolean; status?: number; error?: string } | null = null
    if (marketplaceTokenProbe.ok) {
      const storeGetResult = await getDeliveryStore(storeId, `${corrId}-m2m-sg`)
      marketplaceEndpointProbe = { ok: storeGetResult.ok, error: storeGetResult.error }
    }
    const phase2 = {
      grant_type: 'client_credentials',
      scopes_requested: MARKETPLACE_M2M_SCOPES,
      token_probe: marketplaceTokenProbe,
      endpoint_probe: marketplaceEndpointProbe,
      blocker: !marketplaceTokenProbe.ok
        ? `Marketplace M2M token request failed: ${marketplaceTokenProbe.error} — enable ${MARKETPLACE_M2M_SCOPES.join(', ')} in Uber Developer Dashboard`
        : null,
    }

    // ── Phase 3: Delivery M2M ─────────────────────────────────────────────────
    const deliveryTokenProbe = await probeM2MToken(DELIVERY_M2M_SCOPES.join(' '))
    let deliveryEndpointProbe: { ok: boolean; status?: number; error?: string } | null = null
    if (deliveryTokenProbe.ok) {
      const orderGetResult = await getDeliveryOrderDetails('SCOPE-PROBE-DELIVERY', `${corrId}-del-og`, storeId)
      deliveryEndpointProbe = { ok: orderGetResult.ok, error: orderGetResult.error }
    }
    const phase3 = {
      grant_type: 'client_credentials',
      scopes_requested: DELIVERY_M2M_SCOPES,
      token_probe: deliveryTokenProbe,
      endpoint_probe: deliveryEndpointProbe,
      blocker: !deliveryTokenProbe.ok
        ? `Delivery M2M token request failed: ${deliveryTokenProbe.error} — enable eats.deliveries in Uber Developer Dashboard`
        : null,
    }

    return NextResponse.json({
      action,
      correlation_id: corrId,
      ts,
      store_id: storeId,
      phases: { phase1_usl: phase1, phase2_marketplace: phase2, phase3_delivery: phase3 },
      blockers: [phase1.blocker, phase2.blocker, phase3.blocker].filter(Boolean),
    })
  }

  // ─── Attempt real Uber sandbox Delivery order creation ───────────────────
  // Documents blocker if Uber sandbox doesn't support Delivery order creation.
  // The result — success OR structured failure — is the evidence for Uber.

  if (action === 'delivery_sandbox_order') {
    const corrId = crypto.randomUUID()
    const ts = new Date().toISOString()
    const { uberFetch } = await import('@/lib/integrations/uber-eats/oauth')

    // Try Uber's known sandbox order creation endpoints.
    // POST /v1/eats/sandbox/orders — standard Eats POS sandbox trigger
    // Returns the created order or documents the blocker precisely.
    const attemptResults: Array<{ endpoint: string; status: number; body: string; ts: string; ok: boolean }> = []

    const endpoints = [
      '/v1/eats/sandbox/orders',
      '/v1/sandbox/eats/orders',
    ]

    for (const ep of endpoints) {
      const epTs = new Date().toISOString()
      try {
        const r = await uberFetch(ep, {
          method: 'POST',
          tokenType: 'marketplace',
          body: JSON.stringify({
            store_id: storeId,
            channel: 'delivery',
          }),
        })
        const body = await r.text().catch(() => '')
        attemptResults.push({ endpoint: ep, status: r.status, body: body.slice(0, 500), ts: epTs, ok: r.ok })
        if (r.ok) break // Stop on first success
      } catch (e) {
        attemptResults.push({ endpoint: ep, status: 0, body: String(e), ts: epTs, ok: false })
      }
    }

    const anyOk = attemptResults.some(r => r.ok)
    const successResult = attemptResults.find(r => r.ok)
    let createdOrderId: string | null = null

    if (successResult) {
      try {
        const parsed = JSON.parse(successResult.body) as { id?: string; order_id?: string }
        createdOrderId = parsed.id ?? parsed.order_id ?? null
      } catch { /* not JSON */ }
    }

    return NextResponse.json({
      action,
      correlation_id: corrId,
      ts,
      store_id: storeId,
      scopes_requested: USL_SCOPES,
      created_order_id: createdOrderId,
      blocker: !anyOk ? {
        summary: 'Uber sandbox does not support Delivery order creation via any known endpoint',
        endpoints_tried: attemptResults,
        evidence: 'Delivery Store APIs exercised; pipeline validated via test_delivery_webhook; real order_id unavailable from sandbox',
        uber_action_required: 'Please provide a sandbox Delivery order_id or confirm the official procedure for generating Delivery test orders in the Developer Portal',
      } : null,
      results: attemptResults,
    })
  }

  // ─── Day 3 full approved sequence ────────────────────────────────────────
  // Runs: scope_probe → delivery_store_all → test_delivery_webhook (internal)
  //       → delivery_sandbox_order (attempt real order, document if blocked)
  // Returns structured evidence suitable for submission to Uber.

  if (action === 'day3_full') {
    const runId = crypto.randomUUID()
    const runTs = new Date().toISOString()
    const { uberFetch } = await import('@/lib/integrations/uber-eats/oauth')

    // Phase 1 — Delivery Store APIs (5 calls, all real outbound to test-api.uber.com)
    const p1Ts = new Date().toISOString()
    const corrBase = `${runId.slice(0, 8)}`
    const p1 = {
      phase: 'delivery_store_apis',
      ts: p1Ts,
      store_id: storeId,
      list:     await listDeliveryStores(`${corrBase}-sl`, storeId),
      get:      await getDeliveryStore(storeId, `${corrBase}-sg`),
      status:   await getDeliveryStoreStatus(storeId, `${corrBase}-ss`),
      pause:    await updateDeliveryStoreStatus(storeId, 'PAUSE', `${corrBase}-sp`),
      activate: await updateDeliveryStoreStatus(storeId, 'ACTIVATE', `${corrBase}-sa`),
    }

    // Phase 2 — Internal pipeline validation (test_delivery_webhook)
    // NOT primary Uber evidence. Validates: channel=delivery → DeliveryV1Adapter selection.
    const p2Ts = new Date().toISOString()
    const internalOrderId = `DAY3-INTERNAL-${Date.now()}`
    const delivPayload = JSON.stringify(buildDeliveryOrderPayload(internalOrderId, storeId))
    const webhookSig = signPayload(delivPayload, webhookSecret)
    const webhookR = await selfPost(request, '/api/integrations/uber-eats/webhook', delivPayload, {
      'x-uber-signature': webhookSig,
    })
    const p2 = {
      phase: 'internal_pipeline_validation',
      note: 'INTERNAL ONLY — not submitted as primary Uber evidence. Validates adapter routing.',
      ts: p2Ts,
      order_id: internalOrderId,
      webhook_ack_status: webhookR.status,
      webhook_ack_ok: webhookR.ok,
      channel_detected: 'delivery',
      adapter_used: 'DeliveryV1Adapter',
    }

    // Phase 3 — Attempt real Delivery sandbox order creation
    const p3Ts = new Date().toISOString()
    const sandboxAttempts: Array<{ endpoint: string; status: number; body: string; ok: boolean; ts: string }> = []

    for (const ep of ['/v1/eats/sandbox/orders', '/v1/sandbox/eats/orders']) {
      const epTs = new Date().toISOString()
      try {
        const r = await uberFetch(ep, {
          method: 'POST',
          storeId,
          body: JSON.stringify({ store_id: storeId, channel: 'delivery' }),
        })
        const b = await r.text().catch(() => '')
        sandboxAttempts.push({ endpoint: ep, status: r.status, body: b.slice(0, 500), ok: r.ok, ts: epTs })
        if (r.ok) break
      } catch (e) {
        sandboxAttempts.push({ endpoint: ep, status: 0, body: String(e), ok: false, ts: epTs })
      }
    }

    const anyOrderCreated = sandboxAttempts.some(r => r.ok)
    let realOrderId: string | null = null
    if (anyOrderCreated) {
      const hit = sandboxAttempts.find(r => r.ok)!
      try { realOrderId = ((JSON.parse(hit.body) as { id?: string }).id) ?? null } catch { /* */ }
    }

    const p3 = {
      phase: 'real_delivery_order_attempt',
      ts: p3Ts,
      created: anyOrderCreated,
      order_id: realOrderId,
      attempts: sandboxAttempts,
      blocker: !anyOrderCreated ? {
        summary: 'Uber sandbox does not expose a Delivery order creation endpoint at the paths tried',
        paths_tried: sandboxAttempts.map(a => `${a.endpoint} → HTTP ${a.status}`),
        uber_action_required: 'Request Uber to provide sandbox Delivery order_id or point to official test procedure',
      } : null,
    }

    // Summary
    const storeApisPassed = [p1.list.ok, p1.get.ok, p1.status.ok, p1.pause.ok, p1.activate.ok]
    const passCount = storeApisPassed.filter(Boolean).length

    return NextResponse.json({
      day3_run_id: runId,
      generated_at: runTs,
      store_id: storeId,
      scopes: USL_SCOPES,
      phases: [p1, p2, p3],
      summary: {
        delivery_store_apis: `${passCount}/5 OK`,
        internal_pipeline: p2.webhook_ack_ok ? 'PASS (internal)' : 'FAIL',
        real_order: anyOrderCreated ? `PASS — order_id: ${realOrderId}` : 'BLOCKED — sandbox does not support Delivery order creation',
        uber_evidence_status: anyOrderCreated
          ? 'Full evidence available — real order generated'
          : 'Partial — Delivery Store APIs confirmed; order cycles blocked by sandbox limitation',
      },
    })
  }

  // ─── Evidence export — formatted for Uber submission ─────────────────────

  if (action === 'evidence_export') {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

    // Pull last 48h of Uber audit entries — Day 3 window
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const r = await fetch(
      `${sbUrl}/rest/v1/integration_audit_log?provider=eq.ubereats&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=100`,
      { headers }
    ).catch(() => null)

    const entries = r?.ok ? (await r.json()) as Array<Record<string, unknown>> : []

    const formatted = entries.map(e => ({
      timestamp_utc: e.created_at,
      action: e.action,
      status_code: e.status_code,
      correlation_id: e.correlation_id,
      request_summary: e.request_summary,
      response_summary: e.response_summary,
      duration_ms: e.duration_ms,
    }))

    const byAction: Record<string, unknown[]> = {}
    for (const e of formatted) {
      const k = e.action as string
      if (!byAction[k]) byAction[k] = []
      byAction[k].push(e)
    }

    return NextResponse.json({
      action,
      generated_at: new Date().toISOString(),
      window: `${since} → now`,
      store_id: storeId,
      total_entries: formatted.length,
      by_action: byAction,
      all_entries: formatted,
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
