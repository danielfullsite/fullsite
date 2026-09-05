'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const prepareCatalog = require('./fixtures/financial-service-catalog.cjs')
const actor = { id: 'cashier', name: 'Test cashier', permissions: ['pos.accounts.manage', 'pos.payments.collect', 'pos.payments.reconcile',
  'pos.orders.write', 'pos.orders.send', 'pos.turns.open', 'pos.turns.close', 'abrir_cuentas_restaurante', 'actualizar_estatus_orden'], expires_at: Date.now() + 3600000 }
let dir; let counter
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-money-')); counter = 0 })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
async function restart(enabled = true) {
  const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
  await store.load()
  const catalog = await prepareCatalog(path.join(dir, 'catalog'), 'test')
  const state = new RestaurantState({ localAuthorityEnabled: enabled })
  for (const event of await store.readAfter(0)) state.apply(event)
  const broadcasts = []
  const handler = new CommandHandler({ eventStore: store, state, wsHub: { async broadcast(event) { broadcasts.push(event) } }, restaurantId: 'test', localAuthorityEnabled: enabled, catalogStore: catalog })
  const send = (type, fields = {}, clientId = 'POS-A') => handler.handle({ restaurant_id: 'test', payload: { command_type: type, command_id: `cmd-${++counter}`, ...fields } }, clientId, { actor })
  return { store, state, handler, send, broadcasts, catalog }
}
async function service() {
  const stack = await restart()
  assert.ok((await stack.send('TURN_OPEN', { turno_id: 't1', opening_cash_cents: 0 })).event)
  const saved = await stack.send('ORDER_SAVE', { order_id: 'mother', turno_id: 't1', expected_revision: 0,
    catalog_revision: stack.catalog.read().revision, mesa: 7, items: [{ line_id: 'soup-line', product_id: 'soup', quantity: 1 }] })
  assert.equal(saved.result?.operational_order.created_by, actor.id)
  const sent = await stack.send('ORDER_SEND', { order_id: 'mother', turno_id: 't1', expected_revision: 1 })
  assert.equal(sent.result?.operational_order.authority, 'caja')
  assert.equal(JSON.parse(sent.result.operational_order.items)[0].sent_quantity, 1)
  const open = await stack.send('FINANCIAL_OPEN', { order_id: 'mother', turno_id: 't1', expected_revision: 0, expected_order_revision: 2, currency: 'MXN', total_cents: 10000 })
  assert.ok(open.event, JSON.stringify(open))
  return stack
}
const received = amount => ({ kind: 'cash_received', received_by: 'cashier', received_cents: amount })
async function collect(stack, accountId, paymentId, amount, terminal) {
  const start = await stack.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: stack.state.getFinancialOrder('mother').revision, account_id: accountId, payment_id: paymentId, amount_cents: amount, method: 'cash' }, terminal)
  assert.ok(start.event, JSON.stringify(start))
  const resultCommand = { order_id: 'mother', command_id: `result:${paymentId}`, expected_revision: stack.state.getFinancialOrder('mother').revision, payment_id: paymentId, status: 'accepted', evidence: received(amount) }
  const result = await stack.send('FINANCIAL_PAYMENT_RESULT', resultCommand, terminal)
  assert.ok(result.event, JSON.stringify(result))
  return { result, resultCommand }
}

test('real service: 100 split 50+50, collect 25, restart, another POS settles without removing kitchen', async () => {
  let stack = await service()
  const split = await stack.send('FINANCIAL_SPLIT', { order_id: 'mother', expected_revision: 1, accounts: [{ account_id: 'A', total_cents: 5000 }, { account_id: 'B', total_cents: 5000 }] })
  assert.equal(split.result.financial_order.accounts.length, 2)
  const first = await collect(stack, 'A', 'partial', 2500, 'POS-A')
  assert.equal(stack.state.toSnapshot().salon_orders[0].saldo, 75)
  stack = await restart()
  const otherTerminal = new RestaurantState()
  otherTerminal.hidratarDesdeSnapshot(stack.state.toSnapshot())
  assert.equal(otherTerminal.getFinancialOrder('mother').accounts[0].balance_cents, 2500)
  assert.equal(otherTerminal.getFinancialOrder('mother').accounts[1].balance_cents, 5000)
  await collect(stack, 'A', 'finish-A', 2500, 'POS-B')
  await collect(stack, 'B', 'finish-B', 5000, 'POS-C')
  assert.equal(stack.state.getFinancialOrder('mother').status, 'settled')
  assert.equal(stack.state.getFinancialOrder('mother').paid_cents, 10000)
  assert.equal(stack.state.getFinancialOrder('mother').order_id, 'mother')
  assert.equal(stack.state.toSnapshot().salon_orders.length, 0)
  assert.equal(stack.state.toSnapshot().kds_orders.length, 1, 'paid food remains pending in kitchen')
  assert.equal(stack.state.toSnapshot().mesas['7'].status, 'libre')
  const retry = await stack.send('FINANCIAL_PAYMENT_RESULT', first.resultCommand, 'POS-B')
  assert.equal(retry.duplicate, true)
  assert.deepEqual(retry.result, first.result.result, 'receipt returns original partial result, not final current balance')
  assert.equal((await stack.store.readAfter(0)).filter(e => e.type === 'ORDER_CLOSED').length, 0)
})

test('two terminals cannot reserve or collect the same available balance concurrently', async () => {
  const stack = await service()
  const responses = await Promise.all(['A', 'B'].map(client => stack.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: `pay-${client}`, amount_cents: 8000, method: 'cash' }, client)))
  assert.equal(responses.filter(r => r.event).length, 1)
  assert.equal(responses.filter(r => r.code === 'FINANCIAL_REVISION_CONFLICT').length, 1)
  const finance = stack.state.getFinancialOrder('mother')
  assert.equal(finance.reserved_cents, 8000)
  const excess = await stack.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: finance.revision, account_id: 'mother:full', payment_id: 'excess', amount_cents: 3000, method: 'cash' })
  assert.equal(excess.code, 'OVERPAYMENT')
  assert.equal(stack.state.getFinancialOrder('mother').payments.length, 1)
})

test('legacy close/status/edit/cancel/shift changes cannot bypass durable outstanding accounts', async () => {
  const stack = await service()
  const before = await stack.store.getLastSequence()
  for (const [type, fields, code] of [
    ['ORDER_CLOSED', { order_id: 'mother', mesa: 7 }, 'FINANCIAL_CLOSE_REQUIRED'],
    ['ORDER_CLOSED', { order_id: 'invented', mesa: 7 }, 'FINANCIAL_CLOSE_REQUIRED'],
    ['ORDER_UPSERTED', { order_id: 'mother', status: 'pagada' }, 'KITCHEN_COMMAND_REQUIRED'],
    ['ORDER_UPSERTED', { order_id: 'mother', items: [], total: 0 }, 'KITCHEN_COMMAND_REQUIRED'],
    ['ORDER_CANCELLED', { order_id: 'mother', mesa: 7 }, 'AUTHORITATIVE_COMMAND_REQUIRED'],
    ['TURNO_CLOSED', { turno_id: 't1' }, 'AUTHORITATIVE_COMMAND_REQUIRED'],
    ['TURNO_OPENED', { turno_id: 'other' }, 'AUTHORITATIVE_COMMAND_REQUIRED'],
    ['TURN_CLOSE', { turno_id: 't1', counted_cash_cents: 0 }, 'UNSETTLED_FINANCIAL_ACCOUNTS'],
  ]) assert.equal((await stack.send(type, fields)).code, code)
  assert.equal(await stack.store.getLastSequence(), before)
  assert.equal(stack.state.getFinancialOrder('mother').balance_cents, 10000)
  assert.equal(stack.state.toSnapshot().kds_orders.length, 1)
  const preparation = await stack.send('KITCHEN_SET', { order_id: 'mother', turno_id: 't1', expected_kitchen_revision: 1,
    item_ids: stack.state.getOrder('mother').kitchen_items.map(item => item.id), status: 'lista' })
  assert.ok(preparation.event)
  assert.equal(stack.state.toSnapshot().salon_orders.length, 1)
})

test('disk-full during reservation neither changes projected balance nor returns a successful duplicate', async t => {
  const stack = await service()
  const payload = { command_id: 'durable-payment', order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'payment-id', amount_cents: 10000, method: 'cash' }
  const mock = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC') })
  const attempts = await Promise.allSettled([stack.send('FINANCIAL_PAYMENT_START', payload), stack.send('FINANCIAL_PAYMENT_START', payload)])
  assert.ok(attempts.every(result => result.status === 'rejected'))
  mock.mock.restore()
  assert.equal(stack.state.getFinancialOrder('mother').revision, 1)
  assert.equal(stack.state.getFinancialOrder('mother').reserved_cents, 0)
  const retry = await stack.send('FINANCIAL_PAYMENT_START', payload)
  assert.ok(retry.event)
  assert.equal(stack.state.getFinancialOrder('mother').payments.length, 1)
})

test('duplicate result survives lost broadcast ACK and returns its original durable financial receipt', async () => {
  const stack = await service()
  const start = { command_id: 'start-p1', order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'p1', amount_cents: 10000, method: 'cash' }
  await stack.send('FINANCIAL_PAYMENT_START', start)
  const msg = { restaurant_id: 'test', payload: { command_type: 'FINANCIAL_PAYMENT_RESULT', command_id: 'cash-result', order_id: 'mother', expected_revision: 2, payment_id: 'p1', status: 'accepted', evidence: received(10000) } }
  const lostAck = new CommandHandler({ eventStore: stack.store, state: stack.state, wsHub: { async broadcast() { throw new Error('socket lost') } }, restaurantId: 'test', localAuthorityEnabled: true, catalogStore: stack.catalog })
  await assert.rejects(lostAck.handle(msg, 'POS-A', { actor }), /socket lost/)
  const recovered = await restart()
  const result = await recovered.handler.handle(msg, 'POS-B', { actor })
  assert.equal(result.duplicate, true)
  assert.equal(result.result.financial_order.paid_cents, 10000)
  assert.equal(recovered.state.getFinancialOrder('mother').payments.length, 1)
})

test('money requires a server authenticated actor; client supplied roles and expired sessions cannot authorize', async () => {
  const stack = await service()
  const before = await stack.store.getLastSequence()
  const msg = { restaurant_id: 'test', actor, payload: { command_type: 'FINANCIAL_PAYMENT_START', command_id: 'untrusted', order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'p1', amount_cents: 10000, method: 'cash', actor } }
  for (const context of [{}, { actor: { ...actor, expires_at: 0 } }]) {
    assert.equal((await stack.handler.handle(msg, 'POS-A', context)).code, 'ACTOR_REQUIRED')
  }
  assert.equal((await stack.handler.handle(msg, 'POS-A', { actor: { ...actor, permissions: ['pos.accounts.manage'] } })).code, 'PERMISSION_DENIED')
  assert.equal(await stack.store.getLastSequence(), before)
})

test('activating Caja cannot adopt legacy money implicitly and disabling it rejects even a durable payment retry', async () => {
  let stack = await restart(false)
  assert.ok((await stack.send('TURNO_OPENED', { turno_id: 'legacy-turn', opened_by: actor.id })).event)
  assert.ok((await stack.send('ORDER_SENT', { order_id: 'legacy-order', turno_id: 'legacy-turn', mesa: 1, total: 100,
    order_revision: 1, items: [{ id: 'legacy-soup', name: 'Sopa', cantidad: 1, precio: 100 }] })).event)
  const open = { command_id: 'legacy-open', order_id: 'legacy-order', turno_id: 'legacy-turn',
    expected_revision: 0, expected_order_revision: 1, total_cents: 10000, currency: 'MXN' }
  const before = await stack.store.getLastSequence()
  assert.equal((await stack.send('FINANCIAL_OPEN', open)).code, 'LOCAL_AUTHORITY_DISABLED')
  stack = await restart(true)
  assert.equal((await stack.send('FINANCIAL_OPEN', open)).code, 'LEGACY_ORDER_REQUIRES_CUTOVER')
  assert.equal(await stack.store.getLastSequence(), before)
  assert.equal(stack.state.getFinancialOrder('legacy-order'), null)

  // A separate, correctly activated installation already has a real receipt.
  const legacyDirectory = dir
  try {
    dir = path.join(legacyDirectory, 'modern')
    const modern = await service()
    const payment = await collect(modern, 'mother:full', 'paid', 10000, 'POS-A')
    const disabled = await restart(false)
    const committed = await disabled.store.getLastSequence()
    assert.equal((await disabled.send('FINANCIAL_PAYMENT_RESULT', payment.resultCommand)).code, 'LOCAL_AUTHORITY_DISABLED')
    assert.equal(await disabled.store.getLastSequence(), committed)
    assert.equal(disabled.state.getFinancialOrder('mother').paid_cents, 10000)
  } finally { dir = legacyDirectory }
})

test('cash attribution and external results cannot be forged with a cashier session', async () => {
  const stack = await service()
  await stack.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'cash', amount_cents: 5000, method: 'cash' })
  const forged = await stack.send('FINANCIAL_PAYMENT_RESULT', { order_id: 'mother', expected_revision: 2, payment_id: 'cash', status: 'accepted', evidence: { ...received(5000), received_by: 'manager' } })
  assert.equal(forged.code, 'ACTOR_MISMATCH')
  await stack.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: 2, account_id: 'mother:full', payment_id: 'card', amount_cents: 5000, method: 'external', provider: 'bank' })
  const card = await stack.send('FINANCIAL_PAYMENT_RESULT', { order_id: 'mother', expected_revision: 3, payment_id: 'card', status: 'accepted', evidence: { kind: 'provider_result', provider: 'bank', status: 'accepted', reference: 'invented', amount_cents: 5000, currency: 'MXN' } })
  assert.equal(card.code, 'PERMISSION_DENIED')
  assert.equal(stack.state.getFinancialOrder('mother').paid_cents, 0)
})

test('legacy edits cannot change discounts, attribution, revisions or shift under defined accounts', async () => {
  const stack = await service()
  const before = await stack.store.getLastSequence()
  for (const fields of [{ descuento: 100 }, { subtotal: 0 }, { iva: 0 }, { turno_id: 'other' }, { order_revision: 99 }, { mesero: 'manager' }, { status: 'abierta' }]) {
    const response = await stack.send('ORDER_UPSERTED', { order_id: 'mother', ...fields })
    assert.equal(response.code, 'KITCHEN_COMMAND_REQUIRED', JSON.stringify(fields))
  }
  assert.equal(await stack.store.getLastSequence(), before)
})

test('only the kitchen command advances preparation after defining accounts; legacy status cannot move tables', async () => {
  const stack = await service()
  assert.equal((await stack.send('ORDER_UPSERTED', { order_id: 'mother', mesa: 7, status: 'lista', client_id: 'test' })).code, 'KITCHEN_COMMAND_REQUIRED')
  const ready = await stack.send('KITCHEN_SET', { order_id: 'mother', turno_id: 't1', expected_kitchen_revision: 1,
    item_ids: stack.state.getOrder('mother').kitchen_items.map(item => item.id), status: 'lista' })
  assert.ok(ready.event, JSON.stringify(ready))
  assert.equal(stack.state.toSnapshot().kds_orders[0].status, 'lista')
  assert.equal(stack.state.getFinancialOrder('mother').balance_cents, 10000)
  const move = await stack.send('ORDER_UPSERTED', { order_id: 'mother', mesa: 8, status: 'lista', client_id: 'test' })
  assert.equal(move.code, 'KITCHEN_COMMAND_REQUIRED')
  assert.equal(stack.state.getOrder('mother').mesa, 7)
  assert.equal(stack.state.getOrder('mother').order_revision, 2)
})

test('a stale cloud shift observation cannot strand a durable unpaid account in another shift', async () => {
  const stack = await service()
  stack.state.apply({ type: 'STATE_SYNC', payload: { turno: null, mesas: [], kds_queue: [], orders: [], order_snapshot_complete: true } })
  assert.equal(stack.state.getTurno()?.id, 't1')
  stack.state.apply({ type: 'STATE_SYNC', payload: { turno: { id: 'other' }, mesas: [], kds_queue: [], orders: [], order_snapshot_complete: true } })
  assert.equal(stack.state.getTurno()?.id, 't1')
  await collect(stack, 'mother:full', 'p1', 10000, 'POS-B')
  assert.equal(stack.state.getFinancialOrder('mother').balance_cents, 0)
})
