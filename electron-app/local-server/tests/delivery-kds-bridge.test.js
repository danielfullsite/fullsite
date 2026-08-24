'use strict'
const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { deliveryStation, deliveryOrderCommand, buildDeliveryTicket, injectDeliveryTest, clearDeliveryTest } = require('../index')
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

  test('modo prueba usa el flujo real, queda marcado y no entra al outbox', async () => {
    const calls = []
    const synced = []
    const cmdHandler = {
      async handle(msg) {
        calls.push(msg.payload)
        return { event: { sequence: calls.length } }
      },
    }
    const evidence = await injectDeliveryTest({
      platform: 'rappi', testId: 'field-1', restaurantId: 'amalay', cmdHandler,
      eventStore: { async markSynced(seq) { synced.push(seq) } }, print: true,
    })
    assert.equal(evidence.order_id, 'delivery-test-rappi-field-1')
    assert.equal(evidence.command.test_mode, true)
    assert.match(evidence.command.notas, /NO ES VENTA REAL/)
    assert.deepEqual(evidence.printed_stations, ['cocina', 'barra'])
    assert.deepEqual(calls.map(c => c.command_type), ['ORDER_SENT', 'PRINT_COMMAND', 'PRINT_COMMAND'])
    assert.deepEqual(synced, [1, 2, 3])
  })

  test('modo prueba rechaza plataformas desconocidas', async () => {
    await assert.rejects(
      injectDeliveryTest({ platform: 'fake', restaurantId: 'amalay', cmdHandler: {}, eventStore: {} }),
      /platform must be rappi or ubereats/
    )
  })

  test('limpieza cancela solo pedidos simulados y no entra al outbox', async () => {
    const calls = []
    const synced = []
    const evidence = await clearDeliveryTest({
      orderId: 'delivery-test-rappi-field-1', restaurantId: 'amalay',
      cmdHandler: { async handle(msg) { calls.push(msg.payload); return { event: { sequence: 9 } } } },
      eventStore: { async markSynced(seq) { synced.push(seq) } },
    })
    assert.equal(evidence.cleared, true)
    assert.equal(calls[0].command_type, 'ORDER_CANCELLED')
    assert.equal(calls[0].test_mode, true)
    assert.deepEqual(synced, [9])
  })

  test('limpieza nunca acepta una orden real', async () => {
    await assert.rejects(
      clearDeliveryTest({ orderId: 'real-order-123', restaurantId: 'amalay', cmdHandler: {}, eventStore: {} }),
      /only delivery test orders can be cleared/
    )
  })
})
