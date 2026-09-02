// ┌─────────────────────────────────────────────────────────────────────────────┐
// │  Day 2 — Delivery Adapter / Adapter Factory (Categoría A)                  │
// │  Integration Framework v1 — Uber Eats                                      │
// │                                                                             │
// │  Cubre: detectChannel, getOrderAdapter routing, DeliveryV1 URL paths,      │
// │  minutesToReady passthrough, interface compliance, DELIVERY_ADAPTER_VERSION │
// │  DAY2-021..024: grant type validation — provisioning vs M2M token routing  │
// │                                                                             │
// │  Todos los tests pasan sin credenciales de Uber ni DB real.                │
// └─────────────────────────────────────────────────────────────────────────────┘

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  detectChannel,
  getOrderAdapter,
  getOrderAdapterForPayload,
} from '@/lib/integrations/uber-eats/adapter-factory'
import { DELIVERY_ADAPTER_VERSION } from '@/lib/integrations/uber-eats/delivery-adapter'
import { listDeliveryStores } from '@/lib/integrations/uber-eats/delivery-store'
import { uploadMenu } from '@/lib/integrations/uber-eats/menu'
import { clearTokenCache } from '@/lib/integrations/uber-eats/oauth'

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SB_URL = 'https://test.supabase.co'
const TEST_SB_KEY = 'test-service-key-day2'

/**
 * Fetch mock that handles all three token paths:
 *   sandbox-login.uber.com → M2M token (marketplace or delivery)
 *   supabase.co/integration_providers → USL provisioning token row
 *   supabase.co (other) → audit log, etc.
 *   test-api.uber.com → Uber API calls (returns {})
 */
function makeFetchSpy() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = input.toString()
    if (url.includes('sandbox-login.uber.com') || url.includes('auth.uber.com')) {
      return Promise.resolve(new Response(
        JSON.stringify({ access_token: 'tok-day2-m2m', expires_in: 3600, scope: 'eats.store eats.store.status.write eats.order eats.store.orders.read eats.deliveries' }),
        { status: 200 }
      ))
    }
    // Provisioning token lookup (getStoredTokenForStore)
    if (url.includes('supabase.co') && url.includes('integration_providers')) {
      return Promise.resolve(new Response(
        JSON.stringify([{
          client_id: 'test-client',
          access_token_enc: 'tok-day2-usl',
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          refresh_token_enc: null,
        }]),
        { status: 200 }
      ))
    }
    // Other Supabase calls (audit log etc.)
    if (url.includes('supabase.co')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    // Uber API calls (test-api.uber.com)
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  })
}

/**
 * Fetch spy that also captures RequestInit so tests can inspect token request bodies.
 * Returns { spy, calls } — calls accumulates { url, init } for every fetch invocation.
 */
function makeFetchSpyWithInit() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ url, init })
    if (url.includes('sandbox-login.uber.com') || url.includes('auth.uber.com')) {
      return Promise.resolve(new Response(
        JSON.stringify({ access_token: 'tok-day2-m2m', expires_in: 3600, scope: 'eats.store eats.store.status.write eats.order eats.deliveries' }),
        { status: 200 }
      ))
    }
    if (url.includes('supabase.co') && url.includes('integration_providers')) {
      return Promise.resolve(new Response(
        JSON.stringify([{
          client_id: 'test-client',
          access_token_enc: 'tok-day2-usl',
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          refresh_token_enc: null,
        }]),
        { status: 200 }
      ))
    }
    if (url.includes('supabase.co')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  })
  return { spy, calls }
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SB_URL
  process.env.SUPABASE_SERVICE_KEY = TEST_SB_KEY
  process.env.UBER_CLIENT_ID = 'test-client-id'
  process.env.UBER_CLIENT_SECRET = 'test-client-secret'
  process.env.UBER_ENV = 'sandbox'
})

afterEach(() => {
  vi.restoreAllMocks()
  clearTokenCache() // prevent cached M2M tokens from leaking between tests
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_KEY
  delete process.env.UBER_CLIENT_ID
  delete process.env.UBER_CLIENT_SECRET
  delete process.env.UBER_ENV
})

// ─── DAY2-001..005: detectChannel ────────────────────────────────────────────

describe('DAY2-001..005: detectChannel', () => {
  it('DAY2-001: channel="eats" field → eats', () => {
    expect(detectChannel({ channel: 'eats' })).toBe('eats')
  })

  it('DAY2-002: channel="delivery" field → delivery', () => {
    expect(detectChannel({ channel: 'delivery' })).toBe('delivery')
  })

  it('DAY2-003: channel="DELIVERY" (uppercase) → delivery', () => {
    expect(detectChannel({ channel: 'DELIVERY' })).toBe('delivery')
  })

  it('DAY2-004: no channel field → eats (default)', () => {
    expect(detectChannel({})).toBe('eats')
  })

  it('DAY2-005: event_type="delivery.order.created" → delivery via prefix', () => {
    expect(detectChannel({ event_type: 'delivery.order.created' })).toBe('delivery')
  })
})

// ─── DAY2-006..010: getOrderAdapter + getOrderAdapterForPayload ──────────────

describe('DAY2-006..010: getOrderAdapter + getOrderAdapterForPayload', () => {
  it('DAY2-006: getOrderAdapter("eats").channel === "eats"', () => {
    expect(getOrderAdapter('eats').channel).toBe('eats')
  })

  it('DAY2-007: getOrderAdapter("delivery").channel === "delivery"', () => {
    expect(getOrderAdapter('delivery').channel).toBe('delivery')
  })

  it('DAY2-008: getOrderAdapterForPayload({channel:"delivery"}).channel === "delivery"', () => {
    expect(getOrderAdapterForPayload({ channel: 'delivery' }).channel).toBe('delivery')
  })

  it('DAY2-009: getOrderAdapterForPayload({}).channel === "eats" (default)', () => {
    expect(getOrderAdapterForPayload({}).channel).toBe('eats')
  })

  it('DAY2-010: getOrderAdapterForPayload({event_type:"delivery.order.accept"}).channel === "delivery"', () => {
    expect(getOrderAdapterForPayload({ event_type: 'delivery.order.accept' }).channel).toBe('delivery')
  })
})

// ─── DAY2-011..015: Delivery adapter — URL paths ─────────────────────────────

describe('DAY2-011..015: DeliveryV1Adapter URL paths', () => {
  it('DAY2-011: acceptDeliveryOrder → POST /v1/delivery/order/{id}/accept', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.acceptOrder('order-d2-011', 'corr-d2-011')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    expect(apiCalls.some(u => u.includes('/v1/delivery/order/order-d2-011/accept'))).toBe(true)
  })

  it('DAY2-012: denyDeliveryOrder → POST /v1/delivery/order/{id}/deny', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.denyOrder('order-d2-012', 'ITEM_UNAVAILABLE', 'corr-d2-012')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    expect(apiCalls.some(u => u.includes('/v1/delivery/order/order-d2-012/deny'))).toBe(true)
  })

  it('DAY2-013: cancelDeliveryOrder → POST /v1/delivery/order/{id}/cancel', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.cancelOrder('order-d2-013', 'RESTAURANT_TOO_BUSY', 'corr-d2-013')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    expect(apiCalls.some(u => u.includes('/v1/delivery/order/order-d2-013/cancel'))).toBe(true)
  })

  it('DAY2-014: markDeliveryOrderReady → POST /v1/delivery/order/{id}/ready', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.markOrderReady('order-d2-014', 'corr-d2-014')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    expect(apiCalls.some(u => u.includes('/v1/delivery/order/order-d2-014/ready'))).toBe(true)
  })

  it('DAY2-015: getDeliveryOrderDetails → GET /v1/delivery/order/{id}', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.getOrderDetails('order-d2-015', 'corr-d2-015')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    // GET /v1/delivery/order/{id} — no trailing action
    expect(apiCalls.some(u => /\/v1\/delivery\/order\/order-d2-015$/.test(u))).toBe(true)
  })
})

// ─── DAY2-016..018: EatsAdapter — URL path + minutesToReady ──────────────────
// acceptOrder uses tokenType:'provisioning' — requires storeId for USL token lookup.

describe('DAY2-016..018: EatsLegacyAdapter URL + minutesToReady', () => {
  it('DAY2-016: eats acceptOrder → /v1/eats/orders/ path (not /v1/delivery/)', async () => {
    const spy = makeFetchSpy()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('eats')
    await adapter.acceptOrder('order-d2-016', 'corr-d2-016', 'store-d2-016')
    const apiCalls = spy.mock.calls.map(([u]) => (u as string | URL).toString()).filter(u => u.includes('uber.com/v1'))
    expect(apiCalls.some(u => u.includes('/v1/eats/orders/'))).toBe(true)
    expect(apiCalls.every(u => !u.includes('/v1/delivery/'))).toBe(true)
  })

  it('DAY2-017: minutesToReady=45 override → body includes an absolute pickup_time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const calls: Array<{ url: string; body: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input.toString()
      calls.push({ url, body: (init?.body as string) ?? '' })
      if (url.includes('login.uber.com')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }))
      }
      if (url.includes('supabase.co') && url.includes('integration_providers')) {
        return Promise.resolve(new Response(JSON.stringify([{
          client_id: 'test-client', access_token_enc: 'tok-usl',
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), refresh_token_enc: null,
        }]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })
    const adapter = getOrderAdapter('eats')
    await adapter.acceptOrder('order-d2-017', 'corr-d2-017', 'store-d2-017', 45)
    const apiCall = calls.find(c => c.url.includes('/v1/eats/orders/'))
    expect(apiCall).toBeDefined()
    const parsed = JSON.parse(apiCall!.body)
    expect(parsed).toEqual({
      reason: 'Accepted by Fullsite POS',
      pickup_time: 1_700_002_700,
    })
  })

  it('DAY2-018: minutesToReady not set → pickup_time defaults to 20 minutes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const calls: Array<{ url: string; body: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input.toString()
      calls.push({ url, body: (init?.body as string) ?? '' })
      if (url.includes('login.uber.com')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }))
      }
      if (url.includes('supabase.co') && url.includes('integration_providers')) {
        return Promise.resolve(new Response(JSON.stringify([{
          client_id: 'test-client', access_token_enc: 'tok-usl',
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), refresh_token_enc: null,
        }]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })
    const adapter = getOrderAdapter('eats')
    await adapter.acceptOrder('order-d2-018', 'corr-d2-018', 'store-d2-018')
    const apiCall = calls.find(c => c.url.includes('/v1/eats/orders/'))
    expect(apiCall).toBeDefined()
    const parsed = JSON.parse(apiCall!.body)
    expect(parsed).toEqual({
      reason: 'Accepted by Fullsite POS',
      pickup_time: 1_700_001_200,
    })
  })
})

describe('Uber request payload contracts', () => {
  it('serializes legacy deny and cancel reasons using Uber enums', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('eats')

    await adapter.denyOrder('order-contract-deny', 'ITEM_UNAVAILABLE', 'corr-contract-deny')
    await adapter.cancelOrder('order-contract-cancel', 'DUPLICATE_ORDER', 'corr-contract-cancel')

    const denyCall = calls.find(c => c.url.includes('/deny_pos_order'))
    const cancelCall = calls.find(c => c.url.includes('/cancel'))
    expect(JSON.parse(denyCall!.init!.body as string)).toEqual({
      reason: {
        code: 'ITEM_AVAILABILITY',
        explanation: 'Artículo no disponible',
      },
    })
    expect(JSON.parse(cancelCall!.init!.body as string)).toEqual({
      reason: 'OTHER',
      details: 'Orden duplicada',
    })
  })

  it('wraps Delivery deny and cancel reasons in the required objects', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')

    await adapter.denyOrder('order-contract-deny', 'ITEM_UNAVAILABLE', 'corr-contract-deny')
    await adapter.cancelOrder('order-contract-cancel', 'RESTAURANT_TOO_BUSY', 'corr-contract-cancel')

    const denyCall = calls.find(c => c.url.includes('/deny'))
    const cancelCall = calls.find(c => c.url.includes('/cancel'))
    expect(JSON.parse(denyCall!.init!.body as string)).toEqual({
      deny_reason: {
        type: 'ITEM_ISSUE',
        info: 'Artículo no disponible',
      },
    })
    expect(JSON.parse(cancelCall!.init!.body as string)).toEqual({
      cancellation_reason: {
        type: 'ITEM_ISSUE',
        info: 'Restaurante muy ocupado',
      },
    })
  })

  it('normalizes stored legacy menu availability to Menu API v2', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)

    await uploadMenu('store-contract', {
      menus: [{
        id: 'menu-1',
        title: { es: 'Menú' },
        service_availability: [{
          day_of_week: ['monday', 'tuesday'],
          time_period: [{ start_time: '09:00', end_time: '18:00' }],
        }],
        category_ids: ['category-1'],
      }],
      categories: [{ id: 'category-1', title: { es: 'Comida' }, entities: [] }],
      items: [],
    }, 'corr-menu-contract')

    const menuCall = calls.find(c => c.url.includes('/v2/eats/stores/store-contract/menus'))
    const payload = JSON.parse(menuCall!.init!.body as string)
    expect(payload.menus[0].service_availability).toEqual([
      { day_of_week: 'monday', time_periods: [{ start_time: '09:00', end_time: '18:00' }] },
      { day_of_week: 'tuesday', time_periods: [{ start_time: '09:00', end_time: '18:00' }] },
    ])
  })
})

// ─── DAY2-019..020: Delivery adapter contract ────────────────────────────────

describe('DAY2-019..020: Delivery adapter contract', () => {
  it('DAY2-019: DELIVERY_ADAPTER_VERSION is a semver string', () => {
    expect(typeof DELIVERY_ADAPTER_VERSION).toBe('string')
    expect(/^\d+\.\d+\.\d+$/.test(DELIVERY_ADAPTER_VERSION)).toBe(true)
  })

  it('DAY2-020: OrderAdapter interface has all 5 required methods', () => {
    const adapter = getOrderAdapter('delivery')
    expect(typeof adapter.getOrderDetails).toBe('function')
    expect(typeof adapter.acceptOrder).toBe('function')
    expect(typeof adapter.denyOrder).toBe('function')
    expect(typeof adapter.cancelOrder).toBe('function')
    expect(typeof adapter.markOrderReady).toBe('function')
    expect(adapter.channel).toBe('delivery')
  })
})

// ─── DAY2-021..024: Grant type validation ────────────────────────────────────
// Verifies that each operation uses the correct token grant type.
// provisioning (USL) → supabase integration_providers lookup (not sandbox-login)
// marketplace  (M2M) → sandbox-login token req with eats.store/eats.order scopes
//   (delivery order lifecycle /v1/delivery/order/* is authorized by eats.order)

describe('DAY2-021..024: Token grant type routing', () => {
  it('DAY2-021: listDeliveryStores uses marketplace M2M — no integration_providers lookup', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    await listDeliveryStores('corr-d2-021')
    const hasProvisioningLookup = calls.some(c => c.url.includes('integration_providers'))
    const hasM2MTokenCall = calls.some(c => c.url.includes('sandbox-login.uber.com'))
    expect(hasProvisioningLookup).toBe(false)
    expect(hasM2MTokenCall).toBe(true)
    // Scope should be marketplace (eats.store), not delivery
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    const body = new URLSearchParams(tokenCall!.init?.body as string)
    expect(body.get('scope')).toContain('eats.store')
    expect(body.get('scope')).not.toContain('eats.deliveries')
  })

  it('DAY2-022: delivery acceptOrder uses marketplace M2M — eats.order scope, not eats.deliveries', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('delivery')
    await adapter.acceptOrder('order-d2-022', 'corr-d2-022')
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(tokenCall).toBeDefined()
    const body = new URLSearchParams(tokenCall!.init?.body as string)
    // Uber GTS (case #58972404, 2026-08-09): /v1/delivery/order/* is authorized by
    // eats.order, NOT eats.deliveries (an Uber Direct scope Uber does not whitelist
    // for this app → 400 invalid_scope on every order-lifecycle call).
    expect(body.get('scope')).toContain('eats.order')
    expect(body.get('scope')).not.toContain('eats.deliveries')
    // No provisioning lookup — delivery is M2M only
    expect(calls.some(c => c.url.includes('integration_providers'))).toBe(false)
  })

  it('DAY2-023: eats acceptOrder uses provisioning token — supabase integration_providers lookup, no M2M token request', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('eats')
    await adapter.acceptOrder('order-d2-023', 'corr-d2-023', 'store-d2-023')
    const hasProvisioningLookup = calls.some(c =>
      c.url.includes('supabase.co') && c.url.includes('integration_providers')
    )
    const hasM2MTokenCall = calls.some(c => c.url.includes('sandbox-login.uber.com'))
    expect(hasProvisioningLookup).toBe(true)
    expect(hasM2MTokenCall).toBe(false)
  })

  it('DAY2-024: eats denyOrder uses marketplace M2M — sandbox-login with eats.order, no integration_providers', async () => {
    const { spy, calls } = makeFetchSpyWithInit()
    vi.spyOn(globalThis, 'fetch').mockImplementation(spy as unknown as typeof fetch)
    const adapter = getOrderAdapter('eats')
    await adapter.denyOrder('order-d2-024', 'ITEM_UNAVAILABLE', 'corr-d2-024')
    const tokenCall = calls.find(c => c.url.includes('sandbox-login.uber.com'))
    expect(tokenCall).toBeDefined()
    const body = new URLSearchParams(tokenCall!.init?.body as string)
    expect(body.get('scope')).toContain('eats.order')
    expect(calls.some(c => c.url.includes('integration_providers'))).toBe(false)
  })
})
