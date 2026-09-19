'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { FinancialDomain } = require('../core/financial-domain')
const { permissionsFor } = require('../core/actor-authority')
const prepareCatalog = require('./fixtures/financial-service-catalog.cjs')

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-manual-money-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let number = 0
  const actor = { id: 'cashier-fixture', name: 'Cajero de prueba', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
  const start = async () => {
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
    await store.load()
    const catalog = await prepareCatalog(path.join(dir, 'catalog'), 'manual-fixture')
    const state = new RestaurantState({ localAuthorityEnabled: true })
    for (const event of await store.readAfter(0)) state.apply(event)
    const handler = new CommandHandler({ eventStore: store, state, restaurantId: 'manual-fixture', localAuthorityEnabled: true,
      catalogStore: catalog, wsHub: { async broadcast() {} } })
    const send = (type, body = {}, employee = actor) => handler.handle({ restaurant_id: 'manual-fixture',
      payload: { command_type: type, command_id: `manual-test-${++number}`, ...body } }, 'POS-test', { actor: employee })
    const order = (id = 'mother') => state.getOrder(id)
    const finance = (id = 'mother') => state.getFinancialOrder(id)
    const save = (quantity, id = 'mother', extras = {}) => send('ORDER_SAVE', { order_id: id, turno_id: 't1',
      expected_revision: order(id)?.order_revision ?? 0, catalog_revision: catalog.read().revision,
      mesa: id === 'mother' ? 1 : 2, items: [{ line_id: `line:${id}`, product_id: 'soup', quantity }], ...extras })
    const sendKitchen = (id = 'mother') => send('ORDER_SEND', { order_id: id, turno_id: 't1', expected_revision: order(id).order_revision })
    const open = async (id = 'mother') => {
      assert.ok((await save(1, id)).event); assert.ok((await sendKitchen(id)).event)
      const result = await send('FINANCIAL_OPEN', { order_id: id, turno_id: 't1', expected_revision: 0,
        expected_order_revision: order(id).order_revision, total_cents: order(id).total_cents, currency: 'MXN' })
      assert.ok(result.event, JSON.stringify(result)); return result
    }
    const reserve = (payment, amount, method = 'cash', tip = 0, id = 'mother', account) => send('FINANCIAL_PAYMENT_START', {
      order_id: id, expected_revision: finance(id).revision, account_id: account ?? finance(id).accounts[0].account_id,
      payment_id: payment, amount_cents: amount, method, tip_cents: tip, ...(method === 'manual' ? { tender: 'card' } : {}) })
    const resolve = (payment, status, evidence, id = 'mother', extra = {}, employee) => send('FINANCIAL_PAYMENT_RESULT', {
      order_id: id, expected_revision: finance(id).revision, payment_id: payment, status, evidence, ...extra }, employee)
    return { dir, store, state, actor, send, order, finance, save, sendKitchen, open, reserve, resolve, restart: start }
  }
  const stack = await start()
  assert.ok((await stack.send('TURN_OPEN', { turno_id: 't1', opening_cash_cents: 50000 })).event)
  return stack
}
const manual = (amount, reference = 'ref-lab-1', person = 'cashier-fixture') => ({ kind: 'manual_received', received_by: person,
  source: 'TPV de laboratorio', reference, tender: 'card', currency: 'MXN', amount_cents: amount })
const received = cents => ({ kind: 'cash_received', received_by: 'cashier-fixture', received_cents: cents })

test('manual card plus cash tips survives restart and exact retry; counted cash excludes the bank amount', async t => {
  let s = await setup(t); await s.open()
  assert.ok((await s.reserve('card', 6000, 'manual', 600)).event)
  assert.equal(s.finance().paid_cents, 0); assert.equal(s.finance().reserved_tip_cents, 600)
  assert.equal((await s.resolve('card', 'accepted', manual(6000))).code, 'PAYMENT_EVIDENCE_MISMATCH')
  const result = await s.resolve('card', 'accepted', manual(6600), 'mother', { command_id: 'stable-card-receipt' })
  assert.ok(result.event, JSON.stringify(result))
  const first = s.finance()
  assert.equal(first.paid_cents, 6000); assert.equal(first.tip_cents, 600)
  assert.ok(Number.isFinite(Date.parse(first.payments[0].accepted_at)))
  s = await s.restart()
  const retry = await s.send('FINANCIAL_PAYMENT_RESULT', result.event.payload)
  assert.equal(retry.duplicate, true); assert.deepEqual(retry.result, result.result)
  assert.ok((await s.reserve('cash', 4000, 'cash', 400)).event)
  assert.equal((await s.resolve('cash', 'accepted', received(4000))).code, 'INSUFFICIENT_TENDER')
  assert.ok((await s.resolve('cash', 'accepted', received(5000))).event)
  assert.equal(s.finance().payments[1].change_cents, 600)
  assert.equal(s.finance().paid_cents, 10000); assert.equal(s.finance().tip_cents, 1000)
  assert.equal(s.state.toSnapshot().salon_orders.length, 0)
  assert.equal(s.state.toSnapshot().kds_orders.length, 1)
  assert.ok((await s.send('KITCHEN_SET', { order_id: 'mother', turno_id: 't1', expected_kitchen_revision: s.order().kitchen_revision,
    item_ids: s.order().kitchen_items.map(i => i.id), status: 'entregada' })).event)
  const close = await s.send('TURN_CLOSE', { turno_id: 't1', counted_cash_cents: 54400 })
  assert.equal(close.result.closed_turno.cash_sales_cents, 4000)
  assert.equal(close.result.closed_turno.cash_tip_cents, 400)
  assert.equal(close.result.closed_turno.expected_cash_cents, 54400)
  assert.equal(close.result.closed_turno.difference_cents, 0)
  s = await s.restart()
  assert.equal(s.state.toSnapshot().salon_orders.length, 0)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  assert.equal(s.state.toSnapshot().turn_summaries[0].tip_cents, 1000)
})

test('editing after account preparation commits revised consumption and balance together; unsent additions cannot be collected', async t => {
  let s = await setup(t); await s.open()
  const changed = await s.save(2, 'mother', { command_id: 'save-after-open' })
  assert.ok(changed.event, JSON.stringify(changed))
  assert.equal(changed.result.operational_order.total_cents, 20000)
  assert.equal(changed.result.financial_order.balance_cents, 20000)
  assert.equal(s.state.toSnapshot().salon_orders[0].saldo, 200)
  assert.equal((await s.reserve('too-early', 20000)).code, 'ORDER_SEND_REQUIRED')
  assert.ok((await s.sendKitchen()).event)
  const split = await s.send('FINANCIAL_SPLIT', { order_id: 'mother', expected_revision: s.finance().revision,
    accounts: [{ account_id: 'A', total_cents: 10000 }, { account_id: 'B', total_cents: 10000 }] })
  assert.ok(split.event)
  assert.ok((await s.reserve('part', 10000, 'cash', 0, 'mother', 'A')).event)
  assert.ok((await s.resolve('part', 'accepted', received(10000))).event)
  const payment = s.finance().payments[0]
  assert.ok((await s.save(3)).event)
  assert.equal(s.finance().total_cents, 30000); assert.equal(s.finance().paid_cents, 10000)
  assert.deepEqual(s.finance().payments[0], payment)
  assert.equal(s.finance().accounts[2].label, 'Consumo adicional')
  assert.equal(s.finance().accounts[2].balance_cents, 10000)
  assert.ok((await s.sendKitchen()).event)
  const before = s.state.toSnapshot()
  s = await s.restart()
  assert.deepEqual(s.state.toSnapshot().financial_orders, before.financial_orders)
  const retry = await s.send('ORDER_SAVE', changed.event.payload)
  assert.equal(retry.result.financial_order.total_cents, 20000, 'receipt retains its original result')
  assert.equal(s.finance().total_cents, 30000, 'old receipt cannot replace current state')
})

test('unknown manual outcome reserves consumption and tips, blocks edits and requires manager reconciliation', async t => {
  const s = await setup(t); await s.open()
  assert.ok((await s.reserve('uncertain', 10000, 'manual', 1000)).event)
  assert.ok((await s.resolve('uncertain', 'unknown', { kind: 'operator_record', recorded_by: s.actor.id, reason: 'No hay comprobante legible' })).event)
  assert.equal(s.finance().paid_cents, 0); assert.equal(s.finance().tip_cents, 0)
  assert.equal(s.finance().reserved_tip_cents, 1000)
  assert.equal((await s.save(2)).code, 'PAYMENTS_IN_PROGRESS')
  assert.equal((await s.reserve('duplicate', 10000)).code, 'OVERPAYMENT')
  const cashier = { ...s.actor, permissions: permissionsFor('cajero') }
  assert.equal((await s.resolve('uncertain', 'accepted', manual(11000), 'mother', {}, cashier)).code, 'PERMISSION_DENIED')
  assert.ok((await s.resolve('uncertain', 'accepted', manual(11000))).event)
  assert.equal(s.finance().status, 'settled')
})

test('manual results require authenticated attribution and cannot reuse another order bank reference', async t => {
  const s = await setup(t); await s.open(); await s.open('second')
  assert.ok((await s.reserve('first-card', 10000, 'manual')).event)
  assert.equal((await s.resolve('first-card', 'accepted', manual(10000, 'reference', 'someone-else'))).code, 'ACTOR_MISMATCH')
  assert.ok((await s.resolve('first-card', 'accepted', manual(10000, 'reference'))).event)
  assert.ok((await s.reserve('second-card', 10000, 'manual', 0, 'second')).event)
  const reused = await s.resolve('second-card', 'accepted', manual(10000, ' REFERENCE '), 'second')
  assert.equal(reused.code, 'MANUAL_REFERENCE_REUSED')
  assert.equal(s.finance('second').paid_cents, 0)
  const state = new FinancialDomain(); state.hydrate(s.state.getFinancialOrders())
  assert.equal(state.getOrder('mother').paid_cents, 10000)
})

test('rejected attempts keep their history when adding consumption; tips are part of immutable attempt identity', async t => {
  const s = await setup(t); await s.open()
  const reserve = await s.reserve('aborted', 10000, 'manual', 1000)
  assert.ok(reserve.event)
  assert.equal((await s.send('FINANCIAL_PAYMENT_START', { ...reserve.event.payload, command_id: 'different', tip_cents: 2000 })).code, 'PAYMENT_ID_REUSED')
  assert.ok((await s.resolve('aborted', 'rejected', { kind: 'operator_record', recorded_by: s.actor.id, reason: 'Terminal confirma cancelación' })).event)
  const history = s.finance().payments
  assert.ok((await s.save(2)).event)
  assert.deepEqual(s.finance().payments, history)
  assert.equal(s.finance().balance_cents, 20000)
  assert.equal(s.finance().tip_cents, 0)
})
