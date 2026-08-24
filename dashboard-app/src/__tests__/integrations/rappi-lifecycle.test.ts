import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/integrations/audit-logger', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }))

import {
  buildRappiAuthHeaders,
  clearRappiTokenCacheForTests,
  getRappiAccessToken,
  rappiBaseUrl,
  rappiLegacyBaseUrl,
} from '@/lib/integrations/rappi/auth'
import { acceptRappiOrder, markRappiOrderReady, rejectRappiOrder } from '@/lib/integrations/rappi/adapter'
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

describe('Rappi order action endpoints', () => {
  it('uses the official take, reject and ready-for-pickup REST paths', async () => {
    process.env.RAPPI_CLIENT_ID = 'client-test'
    process.env.RAPPI_CLIENT_SECRET = 'secret-test'
    const ok = () => new Response('', { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-test', expires_in: 86400 }), { status: 200 }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
    global.fetch = fetchMock

    await acceptRappiOrder({ storeId: 'STORE-1', orderId: 'ORDER-1', cookingMinutes: 25, correlationId: 'accept-1' })
    await rejectRappiOrder({ storeId: 'STORE-1', orderId: 'ORDER-1', reason: 'ITEM_STOCKOUT', correlationId: 'reject-1' })
    await markRappiOrderReady({ storeId: 'STORE-1', orderId: 'ORDER-1', correlationId: 'ready-1' })

    expect(fetchMock.mock.calls[1][0]).toBe('https://api.dev.rappi.com/restaurants/orders/v1/stores/STORE-1/orders/ORDER-1/cooking_time/25/take')
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PUT' }))
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.dev.rappi.com/restaurants/orders/v1/stores/STORE-1/orders/ORDER-1/cancel_type/ITEM_STOCKOUT/reject')
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: 'PUT' }))
    expect(fetchMock.mock.calls[3][0]).toBe('https://api.dev.rappi.com/restaurants/orders/v1/stores/STORE-1/orders/ORDER-1/ready-for-pickup')
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'POST' }))

    for (const call of fetchMock.mock.calls.slice(1)) {
      const headers = new Headers(call[1]?.headers)
      expect(headers.get('x-authorization')).toBe('Bearer token-test')
    }
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

  it('normalizes the official restaurants/orders/v1 order_detail envelope', () => {
    const officialPayload = {
      order_detail: {
        order_id: '392625',
        cooking_time: 10,
        delivery_method: 'delivery',
        billing_information: { name: 'John Doe', phone: '43333222' },
        delivery_information: {
          complete_address: 'Nombre de la calle 5050, Barrio, CDMX',
          city: 'Ciudad de México',
          street_name: 'Nombre de la calle',
          street_number: '5050',
        },
        totals: {
          total_products: 204000,
          total_order: 204180,
          charges: { shipping: 50, service_fee: 100 },
          other_totals: { tip: 30 },
        },
        items: [{ sku: '1234', name: 'Chicken Salad', price: 28900, quantity: 3, subitems: [] }],
      },
      customer: { first_name: 'John', last_name: 'Doe', phone_number: '3163535' },
      store: { internal_id: '30000011', external_id: '123445', name: 'Store 1' },
    }

    const order = normalizeRappiOrder(officialPayload, { clientId: 'amalay', correlationId: 'official-1' })
    expect(order).toMatchObject({
      provider_order_id: '392625',
      provider_store_id: '30000011',
      customer_name: 'John Doe',
      customer_phone: '3163535',
      subtotal: 2040,
      delivery_fee: 0.5,
      tip: 0.3,
      total: 2041.8,
      estimated_pickup_at: undefined,
    })
    expect(order.delivery_address).toContain('Nombre de la calle 5050')
    expect(order.items[0]).toMatchObject({ sku: '1234', quantity: 3, unit_price: 289, total_price: 867 })
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
