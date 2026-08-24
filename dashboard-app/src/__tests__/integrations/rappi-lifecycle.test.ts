import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRappiAuthHeaders,
  clearRappiTokenCacheForTests,
  getRappiAccessToken,
  rappiBaseUrl,
  rappiLegacyBaseUrl,
} from '@/lib/integrations/rappi/auth'
import { normalizeRappiOrder, rappiProviderOrderId, rappiProviderStoreId } from '@/lib/integrations/rappi/normalizer'
import { isRappiCancelType, toRappiCancelType } from '@/lib/integrations/rappi/reasons'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  clearRappiTokenCacheForTests()
  for (const key of [
    'RAPPI_ENV', 'RAPPI_API_BASE_URL', 'RAPPI_LEGACY_API_BASE_URL',
    'RAPPI_CLIENT_ID', 'RAPPI_CLIENT_SECRET',
  ]) delete process.env[key]
  vi.restoreAllMocks()
})

describe('Rappi OAuth and environment contract', () => {
  it('uses the documented DEV and Mexico production hosts', () => {
    process.env.RAPPI_ENV = 'dev'
    expect(rappiBaseUrl()).toBe('https://api.dev.rappi.com')
    expect(rappiLegacyBaseUrl()).toBe('https://microservices.dev.rappi.com')

    process.env.RAPPI_ENV = 'prod'
    expect(rappiBaseUrl()).toBe('https://services.mxgrability.rappi.com')
    expect(rappiLegacyBaseUrl()).toBe('https://services.mxgrability.rappi.com')
  })

  it('authenticates once, caches the token and emits x-authorization', async () => {
    process.env.RAPPI_CLIENT_ID = 'client-test'
    process.env.RAPPI_CLIENT_SECRET = 'secret-test'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'token-test', expires_in: 86400 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    global.fetch = fetchMock

    await expect(getRappiAccessToken()).resolves.toBe('token-test')
    await expect(buildRappiAuthHeaders()).resolves.toEqual({ 'x-authorization': 'Bearer token-test' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dev.rappi.com/restaurants/auth/v1/token/login/integrations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: 'client-test', client_secret: 'secret-test' }),
      }),
    )
  })
})

describe('Rappi order normalization contract', () => {
  const rawOrder = {
    order_id: 'RAPPI-DEV-1001',
    store: { internal_id: 'MX1930030014' },
    customer: { name: 'Cliente Prueba', phone: '8112345678' },
    delivery_information: { address: { street: 'Calzada', number: '10', city: 'Monterrey' } },
    totals: {
      products_subtotal: 15500,
      charges: 2500,
      tips: 1000,
      discounts: [{ value: 500 }],
      total: 18500,
    },
    items: [{
      id: 'SKU-1', name: 'Chilaquiles', quantity: 2, price: 7000, comments: 'Sin cebolla',
      subitems: [{ category: 'Proteína', name: 'Pollo', price: 500 }],
    }],
  }

  it('extracts stable provider identifiers', () => {
    expect(rappiProviderOrderId(rawOrder)).toBe('RAPPI-DEV-1001')
    expect(rappiProviderStoreId(rawOrder)).toBe('MX1930030014')
  })

  it('converts cent amounts and preserves items, modifiers and customer data', () => {
    const order = normalizeRappiOrder(rawOrder, { clientId: 'amalay', correlationId: 'corr-1' })
    expect(order).toMatchObject({
      provider: 'rappi',
      provider_order_id: 'RAPPI-DEV-1001',
      provider_store_id: 'MX1930030014',
      client_id: 'amalay',
      customer_name: 'Cliente Prueba',
      customer_phone: '8112345678',
      subtotal: 155,
      delivery_fee: 25,
      tip: 10,
      total: 185,
      idempotency_key: 'rappi-order-RAPPI-DEV-1001',
    })
    expect(order.delivery_address).toBe('Calzada, 10, Monterrey')
    expect(order.items[0]).toMatchObject({
      sku: 'SKU-1', name: 'Chilaquiles', quantity: 2, unit_price: 70,
      total_price: 150, notes: 'Sin cebolla',
    })
    expect(order.items[0].modifiers).toEqual([{ group_name: 'Proteína', name: 'Pollo', price: 5 }])
  })

  it('rejects payloads without order or store identifiers', () => {
    expect(() => normalizeRappiOrder({}, { clientId: 'amalay', correlationId: 'corr-2' })).toThrow('RAPPI_ORDER_ID_MISSING')
    expect(() => normalizeRappiOrder({ order_id: '1' }, { clientId: 'amalay', correlationId: 'corr-3' })).toThrow('RAPPI_STORE_ID_MISSING')
  })
})

describe('Rappi cancellation contract', () => {
  it('accepts official reasons and maps common POS reasons safely', () => {
    expect(isRappiCancelType('ITEM_STOCKOUT')).toBe(true)
    expect(isRappiCancelType('MADE_UP_REASON')).toBe(false)
    expect(toRappiCancelType('OUT_OF_ITEM')).toBe('ITEM_STOCKOUT')
    expect(toRappiCancelType('OTHER')).toBe('INTEGRATOR_ERROR')
    expect(toRappiCancelType(undefined)).toBe('INTEGRATOR_ERROR')
  })
})
