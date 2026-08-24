'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deliveryStation, deliveryOrderCommand, buildDeliveryTicket } = require('../index')
const { RestaurantState } = require('../core/state')
const { EVENT } = require('../protocol')

const row = {
  id: 'rappi-R-100', platform: 'rappi', platform_order_id: 'R-100', status: 'nueva',
  customer_name: 'Daniel', total: 350,
  items: [
    { sku: 'food-1', name: 'Chilaquiles', qty: 2, notes: 'sin cebolla' },
    { sku: 'drink-1', name: 'Latte', qty: 1, modifiers: ['leche deslactosada'] },
  ],
}

describe('Rappi → Local Server → Electron KDS', () => {
  test('normaliza una orden Rappi al protocolo ORDER_SENT', () => {
    const cmd = deliveryOrderCommand(row, 'amalay')
    assert.equal(cmd.command_type, 'ORDER_SENT')
    assert.equal(cmd.command_id, 'delivery-ingest:rappi:R-100')
    assert.equal(cmd.mesero, '🟠 Rappi')
    assert.deepEqual(cmd.items.map(i => i.station), ['cocina', 'barra'])
  })

  test('command_id es estable para deduplicar polls y reinicios', () => {
    assert.equal(deliveryOrderCommand(row, 'amalay').command_id, deliveryOrderCommand({ ...row }, 'amalay').command_id)
  })

  test('la proyección del servidor expone la orden al KDS Electron', () => {
    const cmd = deliveryOrderCommand(row, 'amalay')
    const state = new RestaurantState()
    state.apply({ type: EVENT.ORDER_SENT, payload: cmd })
    const [order] = state.toSnapshot().kds_orders
    assert.equal(order.id, row.id)
    assert.equal(order.mesero, '🟠 Rappi')
    assert.equal(JSON.parse(order.items).length, 2)
  })

  test('genera comandas separadas por estación sin mezclar productos', () => {
    const cmd = deliveryOrderCommand(row, 'amalay')
    const cocina = buildDeliveryTicket(cmd, 'cocina').toString('binary')
    const barra = buildDeliveryTicket(cmd, 'barra').toString('binary')
    assert.match(cocina, /Chilaquiles/)
    assert.doesNotMatch(cocina, /Latte/)
    assert.match(barra, /Latte/)
    assert.doesNotMatch(barra, /Chilaquiles/)
    assert.equal(buildDeliveryTicket(cmd, 'caja'), null)
  })

  test('respeta estación explícita y usa fallback seguro', () => {
    assert.equal(deliveryStation('Café molido', 'caja'), 'caja')
    assert.equal(deliveryStation('Producto desconocido'), 'cocina')
  })
})
