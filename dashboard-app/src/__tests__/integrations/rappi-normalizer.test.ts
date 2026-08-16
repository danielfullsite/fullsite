import { describe, expect, it } from 'vitest'
import { normalizeRappiOrder } from '@/lib/integrations/rappi/normalizer'
import { toRappiCancelType } from '@/lib/integrations/rappi/reasons'

describe('Rappi normalizer', () => {
  it('maps Rappi centavos payloads into Fullsite delivery_orders values', () => {
    const order = normalizeRappiOrder({
      order_id: '900-test-1',
      delivery_operation_type: 'turbo',
      store: { internal_id: '900173586', external_id: 'store-external' },
      customer: { name: 'Cliente Demo', contact: '5555555555' },
      delivery_information: {
        address: { street: 'Río Amazonas', street_number: '100', neighborhood: 'SPGG', city: 'San Pedro' },
      },
      totals: {
        products_subtotal: 11000,
        charges: 2500,
        tips: 1500,
        discounts: [{ value: 1000 }],
      },
      items: [
        {
          sku: 'LATTE',
          name: 'Latte',
          price: 5500,
          quantity: 2,
          subitems: [{ group_name: 'Leche', name: 'Avena', price: 1000 }],
        },
      ],
    }, { clientId: 'amalay', correlationId: 'corr-1' })

    expect(order.provider_order_id).toBe('900-test-1')
    expect(order.provider_store_id).toBe('900173586')
    expect(order.customer_name).toBe('Cliente Demo')
    expect(order.subtotal).toBe(110)
    expect(order.delivery_fee).toBe(25)
    expect(order.tip).toBe(15)
    expect(order.total).toBe(140)
    expect(order.items[0]).toMatchObject({
      sku: 'LATTE',
      name: 'Latte',
      quantity: 2,
      unit_price: 55,
      total_price: 130,
      modifiers: [{ group_name: 'Leche', name: 'Avena', price: 10 }],
    })
  })

  it('fails closed if the Rappi payload has no stable order id', () => {
    expect(() => normalizeRappiOrder({ store: { internal_id: '900173586' } }, { clientId: 'amalay', correlationId: 'corr' }))
      .toThrow('RAPPI_ORDER_ID_MISSING')
  })

  it('maps existing POS cancel reasons into valid Rappi cancel types', () => {
    expect(toRappiCancelType('OUT_OF_ITEM')).toBe('ITEM_STOCKOUT')
    expect(toRappiCancelType('STORE_CLOSED')).toBe('STORE_CLOSED')
    expect(toRappiCancelType('unexpected')).toBe('INTEGRATOR_ERROR')
  })
})
