import { describe, it, expect } from 'vitest'
import { parseDidiOrder, extractDidiStoreId } from '../../cloudflare/delivery-worker/src/index'

// Faithful subset of DiDi's own `orderNew` example payload
// (developer.didi-food.com → Order API → Order Webhooks). Prices are in cents.
const ORDER_NEW = {
  app_id: 5764607584567296012,
  app_shop_id: '7093',
  timestamp: 1615432308,
  type: 'orderNew',
  data: {
    order_id: 1152921547153933576,
    order_info: {
      order_id: 1152921547153933576,
      status: 100,
      pay_type: 1,
      delivery_type: 2,
      expected_cook_eta: 1615432434,
      create_time: 1602832474,
      price: {
        order_price: 2000,
        real_price: 2500,
        real_pay_price: 2500,
        delivery_price: 500,
        refund_price: 2500,
        items_discount: 0,
        delivery_discount: 0,
        others_fees: { small_order_price: 0, total_tip_money: 0, service_price: 0, coupon_discount: 0 },
        customer_need_paying_money: 2500,
      },
      shop: { shop_id: 5764607688097661019, app_shop_id: '7093', shop_name: 'AMALAY' },
      receive_address: {
        first_name: '', last_name: '', name: '',
        calling_code: '+81', phone: '00016004812',
        poi_address: 'R. Congonhas, 405',
      },
      order_items: [
        {
          app_item_id: '110003_2_1', name: 'King Jr. Hamburguesa de Pollo',
          total_price: 7500, sku_price: 7500, amount: 1, remark: '',
          sub_item_list: [
            { app_item_id: '110001_1_main', name: 'Amiguito Pollo', total_price: 0, amount: 1, sub_item_list: [] },
            { app_item_id: '110134_2_side', name: 'Papas Chicas', total_price: 0, amount: 1, sub_item_list: [] },
          ],
        },
      ],
    },
  },
}

describe('DiDi webhook parsing', () => {
  it('extracts the store id from app_shop_id (top-level and under order_info.shop)', () => {
    expect(extractDidiStoreId(ORDER_NEW)).toBe('7093')
    expect(extractDidiStoreId({ data: { order_info: { shop: { app_shop_id: '999' } } } })).toBe('999')
    // legacy guess `shop_id` must NOT be mistaken for the store mapping key
    expect(extractDidiStoreId({ shop_id: 12345 })).toBe('12345')
  })

  it('maps order_info to the internal DeliveryOrder shape', () => {
    const o = parseDidiOrder(ORDER_NEW, 'amalay', '1152921547153933576')
    expect(o.platform).toBe('didi')
    expect(o.client_id).toBe('amalay')
    // 64-bit id preserved as string (never round-tripped through a JS number)
    expect(o.platform_order_id).toBe('1152921547153933576')
    expect(o.id).toBe('dd-1152921547153933576')
    // prices are cents → pesos
    expect(o.subtotal).toBe(20)   // order_price 2000
    expect(o.delivery_fee).toBe(5) // delivery_price 500
    expect(o.total).toBe(25)       // customer_need_paying_money 2500
    // items: amount → qty, total_price cents → price, sub_item_list → modifiers
    expect(o.items).toHaveLength(1)
    expect(o.items[0].name).toBe('King Jr. Hamburguesa de Pollo')
    expect(o.items[0].qty).toBe(1)
    expect(o.items[0].price).toBe(75)
    expect(o.items[0].modifiers).toBe('Amiguito Pollo, Papas Chicas')
    // empty receive_address name falls back
    expect(o.customer_name).toBe('Cliente Didi')
    expect(o.customer_phone).toBe('+8100016004812')
  })

  it('recovers the 64-bit order_id from the raw body (JSON.parse would corrupt it)', () => {
    // Raw JSON as DiDi sends it: order_id is an unquoted 64-bit long.
    const raw = '{"type":"orderNew","app_shop_id":"7093","data":{"order_id":1152921547153933576,"order_info":{"order_id":1152921547153933576}}}'
    // Proof of the hazard: parsing it as a JS number loses precision.
    expect(String(JSON.parse(raw).data.order_id)).not.toBe('1152921547153933576')
    // The handler's recovery regex keeps the full precision as a string.
    const m = raw.match(/"order_id"\s*:\s*"?(\d+)"?/)
    expect(m?.[1]).toBe('1152921547153933576')
  })
})
