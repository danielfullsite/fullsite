// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  Uber Validation Readiness — Cat A suite for the audit-gap implementation  │
// │                                                                             │
// │  Covers: test/prod client separation, wrong-environment fail-closed,       │
// │  M2M vs USL token selection per operation, refresh persistence,            │
// │  Update Item (suspension), Get Integration Details, resolve fulfillment,   │
// │  scheduled-order webhook, orders.failure webhook, fulfillment-resolved     │
// │  webhook, malformed/bad-signature/duplicate webhooks, token vault,         │
// │  and no-secret-logging.                                                     │
// │                                                                             │
// │  All tests run without Uber credentials or a real DB (Cat A). A fixture    │
// │  here is NOT Uber validation evidence — see VALIDATION-READINESS.md.       │
// └─────────────────────────────────────────────────────────────────────────────┘

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'

const TEST_SECRET = 'test-webhook-secret-gaps'
const TEST_SB_URL = 'https://test.supabase.co'
const TEST_SB_KEY = 'test-service-key-gaps'
const TEST_CLIENT_ID = 'test-client-id-AAA'
const TEST_CLIENT_SECRET = 'test-client-secret-AAA'
const PROD_CLIENT_ID = 'prod-client-id-BBB'
const PROD_CLIENT_SECRET = 'prod-client-secret-BBB'
const FULL_MARKETPLACE_SCOPE = 'eats.store eats.store.status.write eats.order eats.store.orders.read'

function hmac(body: string, secret = TEST_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

function webhookRequest(
  body: Record<string, unknown> | string,
  opts: { secret?: string | null } = {}
): NextRequest {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const sig = opts.secret === null ? undefined : hmac(raw, opts.secret ?? TEST_SECRET)
  return new NextRequest('https://app.fullsite.mx/api/integrations/uber-eats/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'x-uber-signature': sig } : {}),
    },
    body: raw,
  })
}

interface RecordedCall { url: string; init?: RequestInit }

/** Recording fetch mock — method-aware for supabase REST verbs. */
function recordingMock(overrides: Record<string, unknown> = {}) {
  const calls: RecordedCall[] = []
  const routes: Record<string, unknown> = {
    integration_store_mappings: [{ client_id: 'sandbox-client' }],
    integration_webhook_events: [{ id: 'evt-gap-001', status: 'received', correlation_id: 'corr-gap-001' }],
    integration_providers: [],
    delivery_orders: [],
    integration_audit_log: [],
    integration_webhook_dlq: [],
    'login.uber.com': { access_token: 'tok-m2m-secret-value', expires_in: 3600, scope: FULL_MARKETPLACE_SCOPE },
    '/v2/eats/order/': {
      id: 'order-gap-001',
      cart: { items: [{ title: 'Torta', quantity: 2, price: { unit_price: { amount: 9000 } }, total_price: { amount: 18000 }, selected_modifier_groups: [] }] },
      eater: { first_name: 'Sched', last_name: 'Uled' },
      payment: { charges: { total: { amount: 18000 } } },
      estimated_ready_for_pickup_at: '2026-08-08T18:30:00Z',
    },
    ...overrides,
  }
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ url, init })
    // Default token endpoint echoes the requested scope (mirrors a full grant)
    // unless the test overrides 'login.uber.com' to simulate a narrowed grant.
    if (url.includes('login.uber.com') && !('login.uber.com' in overrides)) {
      const requestedScope = new URLSearchParams((init?.body as string) ?? '').get('scope') ?? ''
      return Promise.resolve(new Response(
        JSON.stringify({ access_token: 'tok-m2m-secret-value', expires_in: 3600, scope: requestedScope }),
        { status: 200 }
      ))
    }
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        // Supabase PATCH/mutations reply minimal
        if (init?.method === 'PATCH' && url.includes('supabase.co')) {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
    }
    return Promise.resolve(new Response('', { status: 200 }))
  })
  return { spy: spy as unknown as typeof fetch, calls }
}

beforeEach(() => {
  process.env.UBER_ENV = 'sandbox'
  process.env.UBER_TEST_CLIENT_ID = TEST_CLIENT_ID
  process.env.UBER_TEST_CLIENT_SECRET = TEST_CLIENT_SECRET
  process.env.UBER_WEBHOOK_SECRET = TEST_SECRET
  process.env.SUPABASE_SERVICE_KEY = TEST_SB_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SB_URL
  // Placeholder — real scope pending Uber confirmation (A2); tests validate the mechanism.
  process.env.UBER_ORDER_FULFILLMENT_SCOPE = 'scope.test.order-fulfillment'
  delete process.env.UBER_PROD_CLIENT_ID
  delete process.env.UBER_PROD_CLIENT_SECRET
  delete process.env.UBER_CLIENT_ID
  delete process.env.UBER_CLIENT_SECRET
  delete process.env.INTEGRATION_TOKEN_KEY
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { clearTokenCache } = await import('@/lib/integrations/uber-eats/oauth')
  clearTokenCache()
  for (const k of [
    'UBER_ENV', 'UBER_TEST_CLIENT_ID', 'UBER_TEST_CLIENT_SECRET',
    'UBER_PROD_CLIENT_ID', 'UBER_PROD_CLIENT_SECRET',
    'UBER_CLIENT_ID', 'UBER_CLIENT_SECRET', 'UBER_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'INTEGRATION_TOKEN_KEY',
    'UBER_ORDER_FULFILLMENT_SCOPE',
  ]) delete process.env[k]
})

// ─── GAP-ENV: Test/Prod client identity separation ───────────────────────────

describe('GAP-ENV: test/prod client separation (fail closed)', () => {
  it('GAP-ENV-001: sandbox resolves the Test Client with sandbox domains', async () => {
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    const id = resolveUberIdentity()
    expect(id.clientAlias).toBe('test-client')
    expect(id.clientId).toBe(TEST_CLIENT_ID)
    expect(id.apiBase).toBe('https://test-api.uber.com')
    expect(id.loginUrl).toContain('sandbox-login.uber.com')
  })

  it('GAP-ENV-002: production resolves the Production Client with production domains', async () => {
    process.env.UBER_ENV = 'production'
    process.env.UBER_PROD_CLIENT_ID = PROD_CLIENT_ID
    process.env.UBER_PROD_CLIENT_SECRET = PROD_CLIENT_SECRET
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    const id = resolveUberIdentity()
    expect(id.clientAlias).toBe('prod-client')
    expect(id.clientId).toBe(PROD_CLIENT_ID)
    expect(id.apiBase).toBe('https://api.uber.com')
    expect(id.loginUrl).toContain('auth.uber.com')
  })

  it('GAP-ENV-003: production NEVER falls back to test/legacy credentials', async () => {
    process.env.UBER_ENV = 'production'
    // test + legacy present, prod pair absent → must throw
    process.env.UBER_CLIENT_ID = 'legacy-id'
    process.env.UBER_CLIENT_SECRET = 'legacy-secret'
    const { resolveUberIdentity, UberConfigError } = await import('@/lib/integrations/uber-eats/env')
    expect(() => resolveUberIdentity()).toThrow(UberConfigError)
    expect(() => resolveUberIdentity()).toThrow(/UBER_PROD_CLIENT_ID/)
  })

  it('GAP-ENV-004: sandbox never uses the Production Client (prod pair alone → throw)', async () => {
    delete process.env.UBER_TEST_CLIENT_ID
    delete process.env.UBER_TEST_CLIENT_SECRET
    process.env.UBER_PROD_CLIENT_ID = PROD_CLIENT_ID
    process.env.UBER_PROD_CLIENT_SECRET = PROD_CLIENT_SECRET
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    expect(() => resolveUberIdentity()).toThrow(/UBER_TEST_CLIENT_ID/)
  })

  it('GAP-ENV-005: missing or invalid UBER_ENV fails closed', async () => {
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    delete process.env.UBER_ENV
    expect(() => resolveUberIdentity()).toThrow(/UBER_ENV/)
    process.env.UBER_ENV = 'staging'
    expect(() => resolveUberIdentity()).toThrow(/UBER_ENV/)
  })

  it('GAP-ENV-006: identical test and prod client IDs are rejected', async () => {
    process.env.UBER_PROD_CLIENT_ID = TEST_CLIENT_ID
    process.env.UBER_PROD_CLIENT_SECRET = PROD_CLIENT_SECRET
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    expect(() => resolveUberIdentity()).toThrow(/identical/)
  })

  it('GAP-ENV-007: legacy UBER_CLIENT_ID only works in sandbox, flagged as legacy-as-test', async () => {
    delete process.env.UBER_TEST_CLIENT_ID
    delete process.env.UBER_TEST_CLIENT_SECRET
    process.env.UBER_CLIENT_ID = 'legacy-id'
    process.env.UBER_CLIENT_SECRET = 'legacy-secret'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    const id = resolveUberIdentity()
    expect(id.clientAlias).toBe('legacy-as-test')
    expect(warn).toHaveBeenCalled()
  })

  it('GAP-ENV-008: half-configured credential pair fails closed', async () => {
    delete process.env.UBER_TEST_CLIENT_SECRET
    const { resolveUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    expect(() => resolveUberIdentity()).toThrow(/set together/)
  })

  it('GAP-ENV-009: describeUberIdentity and config errors never leak IDs or secrets', async () => {
    const { resolveUberIdentity, describeUberIdentity } = await import('@/lib/integrations/uber-eats/env')
    const desc = describeUberIdentity(resolveUberIdentity())
    expect(desc).toBe('env=sandbox client=test-client')
    expect(desc).not.toContain(TEST_CLIENT_ID)
    expect(desc).not.toContain(TEST_CLIENT_SECRET)

    process.env.UBER_ENV = 'production'
    try {
      resolveUberIdentity()
      expect.unreachable('should have thrown')
    } catch (e) {
      const msg = String(e)
      expect(msg).not.toContain(TEST_CLIENT_ID)
      expect(msg).not.toContain(TEST_CLIENT_SECRET)
    }
  })
})

// ─── GAP-TOKEN: token selection per operation ────────────────────────────────

describe('GAP-TOKEN: M2M vs USL token selection', () => {
  it('GAP-TOKEN-001: USL_SCOPES requests offline_access (refresh token)', async () => {
    const { USL_SCOPES } = await import('@/lib/integrations/uber-eats/oauth')
    expect(USL_SCOPES).toContain('eats.pos_provisioning')
    expect(USL_SCOPES).toContain('offline_access')
  })

  it('GAP-TOKEN-002: getOrderDetails uses the current v2 endpoint with M2M token', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { getOrderDetails } = await import('@/lib/integrations/uber-eats/adapter')
    const r = await getOrderDetails('order-gap-001', 'corr-gap-t2')
    expect(r.ok).toBe(true)
    expect(calls.some(c => c.url.includes('/v2/eats/order/order-gap-001'))).toBe(true)
    expect(calls.some(c => c.url.includes('/v1/eats/orders/order-gap-001') && !c.url.includes('accept'))).toBe(false)
    expect(calls.some(c => c.url.includes('integration_providers'))).toBe(false)
  })

  it('GAP-TOKEN-003: acceptOrder requests exactly eats.order via client_credentials', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-a', expires_in: 3600, scope: 'eats.order' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { acceptOrder } = await import('@/lib/integrations/uber-eats/adapter')
    await acceptOrder('order-gap-002', 'corr-gap-t3')
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(tokenCall).toBeDefined()
    expect(new URLSearchParams(tokenCall!.init?.body as string).get('scope')).toBe('eats.order')
    expect(calls.some(c => c.url.includes('/accept_pos_order'))).toBe(true)
    expect(calls.some(c => c.url.includes('integration_providers'))).toBe(false)
  })

  it('GAP-TOKEN-004: scope narrower than requested → UberScopeError (fail closed)', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-b', expires_in: 3600, scope: 'eats.pos_provisioning' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { getUberAccessToken, UberScopeError } = await import('@/lib/integrations/uber-eats/oauth')
    await expect(getUberAccessToken('eats.order')).rejects.toThrow(UberScopeError)
    // and the API call was never attempted with the bad token
    expect(calls.some(c => c.url.includes('test-api.uber.com'))).toBe(false)
  })

  it('GAP-TOKEN-005: expired USL token + refresh_token → refresh grant + persisted rotation', async () => {
    const { calls, spy } = recordingMock()
    const providerRow = [{
      client_id: 'amalay',
      access_token_enc: 'old-usl-token',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_enc: 'old-refresh-token',
    }]
    const spy2 = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      calls.push({ url, init })
      if (url.includes('integration_providers') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(providerRow), { status: 200 }))
      }
      if (url.includes('integration_providers') && init?.method === 'PATCH') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('sandbox-login.uber.com')) {
        return Promise.resolve(new Response(JSON.stringify({
          access_token: 'fresh-usl-token', refresh_token: 'fresh-refresh-token',
          expires_in: 2592000, scope: 'eats.pos_provisioning offline_access', token_type: 'Bearer',
        }), { status: 200 }))
      }
      return (spy as unknown as (i: RequestInfo | URL, x?: RequestInit) => Promise<Response>)(input, init)
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy2 as unknown as typeof fetch)

    const { getStoredTokenForStore } = await import('@/lib/integrations/uber-eats/oauth')
    const token = await getStoredTokenForStore('store-gap-005')
    expect(token).toBe('fresh-usl-token')

    const refreshCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(new URLSearchParams(refreshCall!.init?.body as string).get('grant_type')).toBe('refresh_token')

    const patchCall = calls.find(c => c.url.includes('integration_providers') && c.init?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    const patched = JSON.parse(patchCall!.init?.body as string)
    expect(patched.access_token_enc).toBe('fresh-usl-token')
    expect(patched.refresh_token_enc).toBe('fresh-refresh-token')
  })

  it('GAP-TOKEN-006: uberFetch honors the explicit scope override (audit bug fix)', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-c', expires_in: 3600, scope: 'eats.store' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { uberFetch } = await import('@/lib/integrations/uber-eats/oauth')
    await uberFetch('/v1/eats/stores', { method: 'GET', scope: 'eats.store' })
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(new URLSearchParams(tokenCall!.init?.body as string).get('scope')).toBe('eats.store')
  })
})

// ─── GAP-MENU: Update Item / OOS via suspension ──────────────────────────────

describe('GAP-MENU: Update Item (current endpoint)', () => {
  it('GAP-MENU-001: updateItem POSTs to /v2/eats/stores/{id}/menus/items/{item} with eats.store', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-m', expires_in: 3600, scope: 'eats.store' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { updateItem } = await import('@/lib/integrations/uber-eats/menu')
    const r = await updateItem('store-1', 'item-9', { price_info: { price: 12500 } }, 'corr-menu-1')
    expect(r.ok).toBe(true)
    const call = calls.find(c => c.url.includes('/v2/eats/stores/store-1/menus/items/item-9'))
    expect(call).toBeDefined()
    expect(call!.init?.method).toBe('POST')
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(new URLSearchParams(tokenCall!.init?.body as string).get('scope')).toBe('eats.store')
  })

  it('GAP-MENU-002: markItemsOOS suspends via suspension_info (no deactivations endpoint)', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-m', expires_in: 3600, scope: 'eats.store' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { markItemsOOS } = await import('@/lib/integrations/uber-eats/menu')
    const r = await markItemsOOS('store-1', [{ item_id: 'item-9', suspend_until: '2026-08-08T00:00:00Z' }], 'corr-menu-2')
    expect(r.ok).toBe(true)
    expect(calls.some(c => c.url.includes('/items/deactivations'))).toBe(false)
    const call = calls.find(c => c.url.includes('/menus/items/item-9'))
    const body = JSON.parse(call!.init?.body as string)
    expect(body.suspension_info.suspension.suspend_until).toBe(Math.floor(new Date('2026-08-08T00:00:00Z').getTime() / 1000))
  })

  it('GAP-MENU-003: restoreItems clears the suspension (no activations endpoint)', async () => {
    const { calls, spy } = recordingMock({ 'login.uber.com': { access_token: 'tok-m', expires_in: 3600, scope: 'eats.store' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { restoreItems } = await import('@/lib/integrations/uber-eats/menu')
    const r = await restoreItems('store-1', ['item-9'], 'corr-menu-3')
    expect(r.ok).toBe(true)
    expect(calls.some(c => c.url.includes('/items/activations'))).toBe(false)
    const call = calls.find(c => c.url.includes('/menus/items/item-9'))
    const body = JSON.parse(call!.init?.body as string)
    expect(body.suspension_info.suspension).toBeNull()
  })
})

// ─── GAP-POSDATA: Get Integration Details ────────────────────────────────────

describe('GAP-POSDATA: Get Integration Details', () => {
  it('GAP-POSDATA-001: getPosData GETs pos_data with eats.store M2M (no USL lookup)', async () => {
    const { calls, spy } = recordingMock({
      'login.uber.com': { access_token: 'tok-p', expires_in: 3600, scope: 'eats.store' },
      '/pos_data': { integration_enabled: true, is_order_manager: true },
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { getPosData } = await import('@/lib/integrations/uber-eats/provisioning')
    const r = await getPosData('633b57d4-237a-5a32-b249-7ceb795f1d35', 'corr-pos-1')
    expect(r.ok).toBe(true)
    expect(calls.some(c => c.url.includes('/v1/eats/stores/633b57d4-237a-5a32-b249-7ceb795f1d35/pos_data'))).toBe(true)
    expect(calls.some(c => c.url.includes('integration_providers'))).toBe(false)
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(new URLSearchParams(tokenCall!.init?.body as string).get('scope')).toBe('eats.store')
  })
})

// ─── GAP-FULFILL: resolve fulfillment issues (RESTAURANT contract) ──────────

const RESTAURANT_ISSUE = {
  issue_type: 'OUT_OF_STOCK',
  action_type: 'REMOVE_ITEM',
  item: { id: 'item-77', name: 'Chilaquiles Verdes' },
  suspend_until: '2026-08-08T15:00:00Z',
  store_response: 'Agotado hasta las 3pm',
}

describe('GAP-FULFILL: Resolve Fulfillment Issues (restaurant canonical)', () => {
  it('GAP-FULFILL-001: POSTs the current /v1/delivery/order/{id}/resolve-fulfillment-issues with the restaurant schema', async () => {
    const { calls, spy } = recordingMock({ 'resolve-fulfillment-issues': { should_wait_for_customer_response: true } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { resolveFulfillmentIssues } = await import('@/lib/integrations/uber-eats/fulfillment')
    const r = await resolveFulfillmentIssues('order-77', [RESTAURANT_ISSUE], 'corr-ff-1')
    expect(r.ok).toBe(true)
    const call = calls.find(c => c.url.includes('/v1/delivery/order/order-77/resolve-fulfillment-issues'))
    expect(call).toBeDefined()
    expect(call!.init?.method).toBe('POST')
    const body = JSON.parse(call!.init?.body as string)
    expect(body.fulfillment_issues).toHaveLength(1)
    expect(body.fulfillment_issues[0].issue_type).toBe('OUT_OF_STOCK')
    expect(body.fulfillment_issues[0].action_type).toBe('REMOVE_ITEM')
    expect(body.fulfillment_issues[0].item.id).toBe('item-77')
  })

  it('GAP-FULFILL-002: surfaces should_wait_for_customer_response from the documented 200 body', async () => {
    const { spy } = recordingMock({ 'resolve-fulfillment-issues': { should_wait_for_customer_response: true } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { resolveFulfillmentIssues } = await import('@/lib/integrations/uber-eats/fulfillment')
    const r = await resolveFulfillmentIssues('order-78', [RESTAURANT_ISSUE], 'corr-ff-2')
    expect(r.ok).toBe(true)
    expect(r.should_wait_for_customer_response).toBe(true)
  })

  it('GAP-FULFILL-003: no grocery schema and no cart PATCH on the restaurant path', async () => {
    const { calls, spy } = recordingMock({ 'resolve-fulfillment-issues': { should_wait_for_customer_response: false } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { resolveFulfillmentIssues } = await import('@/lib/integrations/uber-eats/fulfillment')
    await resolveFulfillmentIssues('order-79', [RESTAURANT_ISSUE], 'corr-ff-3')
    expect(calls.some(c => c.url.includes('/cart'))).toBe(false)
    const call = calls.find(c => c.url.includes('resolve-fulfillment-issues'))
    const raw = call!.init?.body as string
    expect(raw).not.toContain('fulfillment_issue_type')
    expect(raw).not.toContain('root_item')
    expect(raw).not.toContain('item_availability_info')
  })

  it('GAP-FULFILL-004: fails closed when the order-fulfillment scope is not configured (A2) — no Uber call attempted', async () => {
    delete process.env.UBER_ORDER_FULFILLMENT_SCOPE
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { resolveFulfillmentIssues } = await import('@/lib/integrations/uber-eats/fulfillment')
    const r = await resolveFulfillmentIssues('order-80', [RESTAURANT_ISSUE], 'corr-ff-4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('A2')
    expect(calls.some(c => c.url.includes('test-api.uber.com'))).toBe(false)
    expect(calls.some(c => c.url.includes('login.uber.com'))).toBe(false)
  })
})

// ─── GAP-READY: mark ready (current endpoint, restaurant default) ────────────

describe('GAP-READY: Mark Order Ready', () => {
  it('GAP-READY-001: restaurant (eats) default routes to POST /v1/delivery/order/{id}/ready with body {}', async () => {
    const { calls, spy } = recordingMock({ '/ready': { status: 'ok' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { getOrderAdapter } = await import('@/lib/integrations/uber-eats/adapter-factory')
    const r = await getOrderAdapter('eats').markOrderReady('order-r1', 'corr-r1')
    expect(r.ok).toBe(true)
    const call = calls.find(c => c.url.includes('/v1/delivery/order/order-r1/ready'))
    expect(call).toBeDefined()
    expect(call!.init?.method).toBe('POST')
    expect(call!.init?.body).toBe('{}')
    // the extinct legacy endpoint is never touched by default routing
    expect(calls.some(c => c.url.includes('ready_for_pickup'))).toBe(false)
  })

  it('GAP-READY-002: legacy ready_for_pickup is reachable ONLY via the explicit Legacy export', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { markOrderReadyLegacy } = await import('@/lib/integrations/uber-eats/adapter')
    await markOrderReadyLegacy('order-r2', 'corr-r2')
    expect(calls.some(c => c.url.includes('/v1/eats/orders/order-r2/ready_for_pickup'))).toBe(true)
  })

  it('GAP-READY-003: mark ready fails closed without the order-fulfillment scope (A2)', async () => {
    delete process.env.UBER_ORDER_FULFILLMENT_SCOPE
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { markDeliveryOrderReady } = await import('@/lib/integrations/uber-eats/delivery-adapter')
    const r = await markDeliveryOrderReady('order-r3', 'corr-r3')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('A2')
    expect(calls.some(c => c.url.includes('test-api.uber.com'))).toBe(false)
  })
})

// ─── GAP-WH: webhook events (scheduled / failure / fulfillment resolved) ─────

const SCHEDULED_EVENT = {
  event_type: 'orders.scheduled.notification',
  event_id: 'sched-evt-1',
  meta: { resource_id: 'order-sched-1', resource: { store: { store_id: 'store-gap' } } },
}

describe('GAP-WH: new webhook events', () => {
  it('GAP-WH-001: scheduled order → 200, persisted as programada, NO auto-accept', async () => {
    const { calls, spy } = recordingMock({
      '/v2/eats/order/': {
        id: 'order-sched-1',
        cart: { items: [{ title: 'Torta', quantity: 1, price: { unit_price: { amount: 9000 } }, total_price: { amount: 9000 }, selected_modifier_groups: [] }] },
        eater: { first_name: 'Sched', last_name: 'Uled' },
        payment: { charges: { total: { amount: 9000 } } },
        estimated_ready_for_pickup_at: '2026-08-08T18:30:00Z',
      },
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest(SCHEDULED_EVENT))
    expect(res.status).toBe(200)

    const persist = calls.find(c => c.url.includes('delivery_orders') && c.init?.method === 'POST')
    expect(persist).toBeDefined()
    const row = JSON.parse(persist!.init?.body as string)
    expect(row.status).toBe('programada')
    expect(row.platform_order_id).toBe('order-sched-1')
    // scheduled orders are NOT auto-accepted (lifecycle pending Uber Q4)
    expect(calls.some(c => c.url.includes('accept_pos_order'))).toBe(false)
    // details GET attempted against the current v2 endpoint
    expect(calls.some(c => c.url.includes('/v2/eats/order/order-sched-1'))).toBe(true)
  })

  it('GAP-WH-002: duplicate scheduled webhook → 200 without reprocessing', async () => {
    const { calls, spy } = recordingMock({ integration_webhook_events: [] }) // insert ignored → duplicate
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest(SCHEDULED_EVENT))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.url.includes('delivery_orders') && c.init?.method === 'POST')).toBe(false)
  })

  it('GAP-WH-003: orders.failure cancels the local order (v1.0.0 store alias of orders.cancel)', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest({
      event_type: 'orders.failure',
      event_id: 'fail-evt-1',
      meta: { resource_id: 'order-fail-1', resource: { store: { store_id: 'store-gap' } } },
    }))
    expect(res.status).toBe(200)
    const patch = calls.find(c => c.url.includes('delivery_orders') && c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(patch!.init?.body as string).status).toBe('cancelada')
  })

  it('GAP-WH-004: order.fulfillment_issues.resolved → refetch details + refresh local order', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest({
      event_type: 'order.fulfillment_issues.resolved',
      event_id: 'ffr-evt-1',
      meta: { resource_id: 'order-gap-001', resource: { store: { store_id: 'store-gap' } } },
    }))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.url.includes('/v2/eats/order/order-gap-001'))).toBe(true)
    const patch = calls.find(c => c.url.includes('delivery_orders') && c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(patch!.init?.body as string).total).toBe(180)
  })

  it('GAP-WH-005: plural spelling orders.fulfillment_issues.resolved also handled', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest({
      event_type: 'orders.fulfillment_issues.resolved',
      event_id: 'ffr-evt-2',
      meta: { resource_id: 'order-gap-001', resource: { store: { store_id: 'store-gap' } } },
    }))
    expect(res.status).toBe(200)
    expect(calls.some(c => c.url.includes('/v2/eats/order/order-gap-001'))).toBe(true)
  })

  it('GAP-WH-006: malformed JSON with valid signature → 400', async () => {
    const { spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest('{not-json'))
    expect(res.status).toBe(400)
  })

  it('GAP-WH-007: bad signature on scheduled webhook → 401, nothing persisted', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest(SCHEDULED_EVENT, { secret: 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect(calls.some(c => c.url.includes('delivery_orders'))).toBe(false)
  })

  it('GAP-WH-009: order.failed (resolve-fulfillment lifecycle outcome) cancels the local order', async () => {
    const { calls, spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await POST(webhookRequest({
      event_type: 'order.failed',
      event_id: 'failed-evt-1',
      meta: { resource_id: 'order-failed-1', resource: { store: { store_id: 'store-gap' } } },
    }))
    expect(res.status).toBe(200)
    const patch = calls.find(c => c.url.includes('delivery_orders') && c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(patch!.init?.body as string).status).toBe('cancelada')
  })

  it('GAP-WH-008: webhook processing never logs secrets or tokens', async () => {
    const logged: string[] = []
    for (const m of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }
    const { spy } = recordingMock()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy)
    const { POST } = await import('@/app/api/integrations/uber-eats/webhook/route')
    await POST(webhookRequest(SCHEDULED_EVENT))
    const all = logged.join('\n')
    expect(all).not.toContain(TEST_SECRET)
    expect(all).not.toContain(TEST_SB_KEY)
    expect(all).not.toContain(TEST_CLIENT_SECRET)
    expect(all).not.toContain('tok-m2m-secret-value')
  })
})

// ─── GAP-VAULT: token storage ────────────────────────────────────────────────

describe('GAP-VAULT: token vault (SEC-UBER-01)', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64')

  it('GAP-VAULT-001: seal/open roundtrip with key; envelope hides plaintext', async () => {
    process.env.INTEGRATION_TOKEN_KEY = KEY
    const { sealToken, openToken, isEncryptedToken } = await import('@/lib/integrations/token-vault')
    const sealed = sealToken('super-secret-access-token')
    expect(isEncryptedToken(sealed)).toBe(true)
    expect(sealed).not.toContain('super-secret-access-token')
    expect(openToken(sealed)).toBe('super-secret-access-token')
  })

  it('GAP-VAULT-002: without key seals to plaintext with a single warning (documented blocker)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sealToken, _resetVaultWarning } = await import('@/lib/integrations/token-vault')
    _resetVaultWarning()
    expect(sealToken('abc')).toBe('abc')
    expect(sealToken('def')).toBe('def')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SEC-UBER-01')
  })

  it('GAP-VAULT-003: legacy plaintext rows pass through openToken unchanged', async () => {
    const { openToken } = await import('@/lib/integrations/token-vault')
    expect(openToken('legacy-plaintext-token')).toBe('legacy-plaintext-token')
  })

  it('GAP-VAULT-004: encrypted value without key fails closed', async () => {
    process.env.INTEGRATION_TOKEN_KEY = KEY
    const { sealToken } = await import('@/lib/integrations/token-vault')
    const sealed = sealToken('x')
    delete process.env.INTEGRATION_TOKEN_KEY
    const { openToken, TokenVaultError } = await import('@/lib/integrations/token-vault')
    expect(() => openToken(sealed)).toThrow(TokenVaultError)
  })

  it('GAP-VAULT-005: malformed envelope and wrong key are rejected', async () => {
    process.env.INTEGRATION_TOKEN_KEY = KEY
    const { openToken, sealToken, TokenVaultError } = await import('@/lib/integrations/token-vault')
    expect(() => openToken('enc:v1:only-two:parts')).toThrow(TokenVaultError)
    const sealed = sealToken('y')
    process.env.INTEGRATION_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64')
    expect(() => openToken(sealed)).toThrow(TokenVaultError)
  })

  it('GAP-VAULT-006: invalid key length fails closed', async () => {
    process.env.INTEGRATION_TOKEN_KEY = Buffer.alloc(16, 1).toString('base64')
    const { sealToken, TokenVaultError } = await import('@/lib/integrations/token-vault')
    expect(() => sealToken('z')).toThrow(TokenVaultError)
  })
})
