import { beforeEach, describe, expect, it, vi } from 'vitest'

const adapter = vi.hoisted(() => ({
  getOrderDetails: vi.fn(async () => ({
    ok: true,
    order: {
      id: 'order-new-1',
      cart: { items: [] },
      eater: { first_name: 'Ana', last_name: 'Test' },
      payment: { charges: { total: { amount: 10000 } } },
    },
  })),
  acceptOrder: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/integrations/uber-eats/adapter-factory', () => ({
  getOrderAdapterForPayload: vi.fn(() => ({ ...adapter, channel: 'eats' })),
  getOrderAdapter: vi.fn(() => ({ ...adapter, channel: 'eats' })),
}))

describe('persistencia de órdenes nuevas de Uber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
    process.env.SUPABASE_SERVICE_KEY = 'service-test'
  })

  it('acepta una orden cuando PostgREST confirma el insert con 201 y cuerpo vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/integration_store_mappings')) {
        return new Response(JSON.stringify([{ client_id: 'tenant-a' }]), { status: 200 })
      }
      if (url.includes('/integration_webhook_events') && init?.method === 'POST') {
        return new Response(JSON.stringify([{
          id: 'event-1', status: 'received', correlation_id: 'corr-1', attempts: 0,
        }]), { status: 201 })
      }
      if (url.includes('/delivery_orders') && init?.method === 'POST') {
        return new Response(null, { status: 201 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }))

    const { processVerifiedUberPayload } = await import('@/lib/integrations/uber-eats/webhook-handler')
    const result = await processVerifiedUberPayload({
      event_type: 'orders.notification',
      event_id: 'provider-event-1',
      meta: {
        resource_id: 'order-new-1',
        resource: { store: { store_id: 'store-1' } },
      },
    })

    expect(result).toEqual({ ok: true })
    expect(adapter.acceptOrder).toHaveBeenCalledWith('order-new-1', 'corr-1', 'store-1')
  })
})
