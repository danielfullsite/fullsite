'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { RestaurantState } = require('../core/state')
const { EVENT } = require('../protocol')
const order = () => ({ order_id: 'order-A', id: 'order-A', mesa: 7, customer_name: null,
  mesero: 'Ana', personas: 3, subtotal: 100, iva: 16, total: 116, descuento: 0,
  order_revision: 4, turno_id: 'shift-A', status: 'enviada', notas: 'Sin sal',
  items: [{ id: 'dish-A', nombre: 'Sopa', cantidad: 1, subtotal: 100 }] })
const apply = (state, type, payload) => state.apply({ type, payload })

test('delivered unpaid order retains all fields and leaves kitchen in both projections', () => {
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, order())
  apply(state, EVENT.ORDER_UPSERTED, { order_id: 'order-A', mesa: 7, status: 'entregada' })
  const snapshot = state.toSnapshot()
  assert.equal(snapshot.salon_orders.length, 1)
  assert.equal(snapshot.salon_orders[0].total, 116)
  assert.equal(snapshot.salon_orders[0].saldo, 116)
  assert.equal(snapshot.salon_orders[0].personas, 3)
  assert.equal(snapshot.salon_orders[0].order_revision, 4)
  assert.equal(snapshot.kds_orders.length, 0)
  assert.equal(snapshot.kds_queue.length, 0)
  const secondary = new RestaurantState()
  assert.equal(secondary.hidratarDesdeSnapshot(snapshot), true)
  assert.deepEqual(secondary.toSnapshot().salon_orders, snapshot.salon_orders)
})

test('paid-before-cooking survives settlement, snapshot hydration and replay; delivery does not resurrect debt', () => {
  const events = [
    { type: EVENT.ORDER_SENT, payload: order() },
    { type: EVENT.ORDER_CLOSED, payload: { order_id: 'order-A', mesa: 7, pagos: [{ monto: 116 }], order_revision: 5 } },
  ]
  const state = new RestaurantState()
  for (const event of events) state.apply(event)
  const paidSnapshot = state.toSnapshot()
  for (const target of [state, new RestaurantState()]) {
    if (target !== state) target.hidratarDesdeSnapshot(paidSnapshot)
    assert.equal(target.toSnapshot().salon_orders.length, 0)
    assert.equal(target.toSnapshot().kds_orders[0].payment_status, 'pagada')
    assert.equal(target.toSnapshot().kds_orders[0].status, 'enviada')
    apply(target, EVENT.ORDER_UPSERTED, { order_id: 'order-A', status: 'entregada' })
    assert.equal(target.toSnapshot().salon_orders.length, 0)
    assert.equal(target.toSnapshot().kds_orders.length, 0)
  }
  const replayed = new RestaurantState()
  events.forEach(event => replayed.apply(event))
  assert.equal(replayed.toSnapshot().kds_orders.length, 1)
})

test('named accounts, partial balance and revisions survive extra rounds without losing metadata', () => {
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, { ...order(), mesa: 0, customer_name: 'SR RAUL', pagos: [{ monto: 16 }] })
  apply(state, EVENT.ORDER_SENT, { ...order(), mesa: 0, customer_name: 'SR RAUL', total: 216, personas: 4,
    order_revision: 5, items: [...order().items, { id: 'dish-B', nombre: 'Taco' }] })
  const actual = state.toSnapshot().salon_orders[0]
  assert.equal(actual.customer_name, 'SR RAUL')
  assert.equal(actual.personas, 4)
  assert.equal(actual.total, 216)
  assert.equal(actual.saldo, 200)
  assert.equal(actual.order_revision, 5)
  assert.equal(JSON.parse(actual.items).length, 2)
})

test('bootstrap includes full delivered order; legacy occupancy alone is explicitly incomplete', () => {
  const state = new RestaurantState()
  assert.equal(state.toSnapshot().order_snapshot_complete, false)
  const mesa = { mesa: 7, status: 'ocupada', order_id: 'order-A' }
  apply(state, EVENT.STATE_SYNC, { mesas: [mesa], kds_queue: [], turno: { id: 'shift-A' } })
  assert.equal(state.toSnapshot().order_snapshot_complete, false)
  apply(state, EVENT.STATE_SYNC, { mesas: [mesa], orders: [{ ...order(), status: 'entregada' }], order_snapshot_complete: true, kds_queue: [] })
  assert.equal(state.toSnapshot().order_snapshot_complete, true)
  assert.equal(state.toSnapshot().salon_orders[0].total, 116)
  assert.equal(state.toSnapshot().kds_orders.length, 0)
})

test('confirmed empty bootstrap differs from missing orders and accepts an actual empty items account', () => {
  const state = new RestaurantState()
  apply(state, EVENT.STATE_SYNC, { mesas: [], orders: [], order_snapshot_complete: true, kds_queue: [] })
  assert.equal(state.toSnapshot().order_snapshot_complete, true)
  apply(state, EVENT.ORDER_UPSERTED, { ...order(), items: [], status: 'abierta' })
  assert.equal(state.toSnapshot().salon_orders[0].items, '[]')
  assert.equal(state.toSnapshot().kds_orders.length, 0)
})

test('local order and paid kitchen work survive empty cloud snapshot beyond previous grace period', () => {
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, { ...order(), updated_at: '2000-01-01T00:00:00Z' })
  apply(state, EVENT.ORDER_CLOSED, { order_id: 'order-A', mesa: 7 })
  apply(state, EVENT.STATE_SYNC, { mesas: [], orders: [], order_snapshot_complete: true, kds_queue: [] })
  assert.equal(state.toSnapshot().kds_orders.length, 1)
  assert.equal(state.toSnapshot().salon_orders.length, 0)
})

test('late close of old order cannot release a newer account on the same mesa', () => {
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, order())
  apply(state, EVENT.ORDER_SENT, { ...order(), order_id: 'new-order', id: 'new-order' })
  apply(state, EVENT.ORDER_CLOSED, { order_id: 'order-A', mesa: 7 })
  assert.equal(state.toSnapshot().mesas['7'].order_id, 'new-order')
  assert.deepEqual(state.toSnapshot().salon_orders.map(o => o.id), ['new-order'])
})

test('financial result changes debt with its own revision, survives hydration and preserves preparation', () => {
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, order())
  const partial = { order_id: 'order-A', status: 'open', revision: 2, balance_cents: 5600,
    accounts: [{ id: 'account-A', total_cents: 11600 }], payments: [{ id: 'p-A', amount_cents: 6000 }] }
  state.apply({ type: 'FINANCIAL_PAYMENT_RESULT', payload: {}, result: { financial_order: partial } })
  assert.equal(state.toSnapshot().salon_orders[0].saldo, 56)
  assert.equal(state.getOrder('order-A').order_revision, 4)
  assert.equal(state.getFinancialOrder('order-A').revision, 2)
  const secondary = new RestaurantState()
  secondary.hidratarDesdeSnapshot(state.toSnapshot())
  assert.deepEqual(secondary.getFinancialOrder('order-A'), partial)
  const settled = { ...partial, status: 'settled', revision: 3, balance_cents: 0 }
  secondary.apply({ type: 'FINANCIAL_PAYMENT_RESULT', payload: {}, result: { financial_order: settled } })
  assert.equal(secondary.toSnapshot().salon_orders.length, 0)
  assert.equal(secondary.toSnapshot().kds_orders.length, 1)
})


test('partial order arrays, a single comanda, and malformed bootstrap cannot prove an empty salon', () => {
  for (const payload of [
    { orders: [] },
    { orders: [], order_snapshot_complete: false },
    { orders: [{ ...order(), items: 'invalid' }], order_snapshot_complete: true },
    { orders: [{ ...order(), items: null }], order_snapshot_complete: true },
  ]) {
    const state = new RestaurantState()
    apply(state, EVENT.STATE_SYNC, payload)
    assert.equal(state.toSnapshot().order_snapshot_complete, false)
  }
  const state = new RestaurantState()
  apply(state, EVENT.ORDER_SENT, order())
  assert.equal(state.toSnapshot().order_snapshot_complete, false)
  apply(state, EVENT.TURNO_OPENED, { turno_id: 'shift-A' })
  assert.equal(state.toSnapshot().order_snapshot_complete, true)
})

test('editing a bootstrapped cloud account makes the accepted local revision win subsequent polls', () => {
  const state = new RestaurantState()
  const cloud = { ...order(), updated_at: '2000-01-01T00:00:00Z' }
  apply(state, EVENT.STATE_SYNC, { orders: [cloud], order_snapshot_complete: true })
  apply(state, EVENT.ORDER_SENT, { ...cloud, total: 216, order_revision: 5 })
  apply(state, EVENT.STATE_SYNC, { orders: [cloud], order_snapshot_complete: true, mesas: [], kds_queue: [] })
  assert.equal(state.getOrder('order-A').total, 216)
  assert.equal(state.getOrder('order-A').order_revision, 5)
})
