'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { CatalogStore } = require('../core/catalog-store')
const { permissionsFor } = require('../core/actor-authority')
const actor = { id: 'operator', name: 'Operator', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
const lines = quantity => [{ line_id: 'line-a', product_id: 'product-a', quantity, modifier_ids: [] }]
async function setup(t, paper = false, pricing = { price: 100, iva: 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-additions-review-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const prepared = [], queued = new Map()
  const printer = { prepareJobs(station, bytes, documentType, { commandId }) {
    prepared.push(commandId)
    return [{ job_id: commandId, station_id: station, data_b64: bytes.toString('base64'), document_type: documentType,
      connection: { type: 'tcp', host: '127.0.0.1', port: 12345 }, copies: 1 }]
  }, enqueuePreparedJobs(jobs) { jobs.forEach(job => queued.set(job.job_id, job)) } }
  const catalog = new CatalogStore({ directory: path.join(dir, 'catalog'), restaurantId: 'lab', fetchImpl: async () => Response.json({
    schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: 'lab', refreshed_at: '2026-09-10T00:00:00Z',
    categories: [{ id: 'food', name: 'Food', items: [{ id: 'product-a', name: 'Food A', price: pricing.price }] }],
    config: { id: 'lab', display_name: 'Lab', timezone: 'America/Monterrey', mesas: 10, iva_rate: pricing.iva },
    settings: { 'pos.station_routing': { cocina: ['food'], barra: [], caja: [] }, 'pos.no_print_stations': paper ? ['barra', 'caja'] : ['cocina', 'barra', 'caja'] },
    modifiers: { groups: [], mods: [], item_links: [], category_links: [] }, payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash', commission_pct: 0 }],
  }) })
  await catalog.refresh('synthetic')
  let counter = 0
  async function restart() {
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') }))
    await store.load()
    const state = new RestaurantState({ localAuthorityEnabled: true })
    for (const event of await store.readAfter(0)) state.apply(event)
    const handler = new CommandHandler({ eventStore: store, state, wsHub: { async broadcast() {} }, restaurantId: 'lab', catalogStore: catalog, localAuthorityEnabled: true, printer })
    const send = (type, fields = {}) => handler.handle({ restaurant_id: 'lab', payload: { command_type: type, command_id: `review-${++counter}`, ...fields } }, 'terminal', { actor })
    const operational = (patch = {}) => ({ order_id: 'order', turno_id: 'turn', expected_revision: state.getOrder('order')?.order_revision || 0, expected_financial_revision: state.getFinancialOrder('order')?.revision, ...patch })
    const save = (quantity, patch = {}) => send('ORDER_SAVE', operational({ catalog_revision: catalog.read().revision, mesa: 1, items: lines(quantity), ...patch }))
    const money = (type, patch = {}) => send(type, { order_id: 'order', expected_revision: state.getFinancialOrder('order')?.revision || 0, ...patch })
    return { store, state, send, operational, save, money, restart, queued, prepared }
  }
  const s = await restart()
  assert.ok((await s.send('TURN_OPEN', { turno_id: 'turn', opening_cash_cents: 0 })).event)
  assert.ok((await s.save(2)).event)
  assert.ok((await s.send('ORDER_SEND', s.operational())).event)
  assert.ok((await s.money('FINANCIAL_OPEN', { turno_id: 'turn', expected_order_revision: 2, total_cents: s.state.getOrder('order').total_cents, currency: 'MXN' })).event)
  return s
}
async function partialAndReserved(s, account_id = 'order:full') {
  assert.ok((await s.money('FINANCIAL_PAYMENT_START', { account_id, payment_id: 'accepted', amount_cents: 5000, method: 'cash' })).event)
  assert.ok((await s.money('FINANCIAL_PAYMENT_RESULT', { payment_id: 'accepted', status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 5000 } })).event)
  assert.ok((await s.money('FINANCIAL_PAYMENT_START', { account_id, payment_id: 'reserved', amount_cents: 3000, method: 'cash' })).event)
}
test('additive save preserves partial payment and reservation and allocates only to the chosen split account', async t => {
  const s = await setup(t)
  assert.ok((await s.money('FINANCIAL_SPLIT', { accounts: [{ account_id: 'a', total_cents: 10000 }, { account_id: 'b', total_cents: 10000 }] })).event)
  await partialAndReserved(s, 'a')
  const before = s.state.getFinancialOrder('order')
  const result = await s.save(3, { account_id: 'b' })
  assert.ok(result.event, JSON.stringify(result))
  const after = s.state.getFinancialOrder('order')
  assert.deepEqual(after.payments, before.payments)
  assert.deepEqual(after.accounts.find(a => a.account_id === 'a'), before.accounts.find(a => a.account_id === 'a'))
  assert.equal(after.accounts.find(a => a.account_id === 'b').total_cents, 20000)
  assert.equal(after.total_cents, 30000)
  assert.equal(after.paid_cents, 5000)
  assert.equal(after.reserved_cents, 3000)
  assert.equal(after.balance_cents, 25000)
  assert.equal(s.state.getOrder('order').saldo, 250)
  assert.deepEqual(result.result.financial_allocation, { account_id: 'b', amount_cents: 10000, recorded_by: actor.id, lines: [{ line_id: 'line-a', quantity: 1 }] })
  assert.equal(JSON.parse(s.state.toSnapshot().kds_orders[0].items).reduce((sum, i) => sum + i.cantidad, 0), 2)
})
test('unsent addition blocks new PAYMENT_START, permits existing RESULT, then allows collection after SEND', async t => {
  const s = await setup(t)
  await partialAndReserved(s)
  assert.ok((await s.save(3, { account_id: 'order:full' })).event)
  const before = await s.store.getLastSequence()
  assert.equal((await s.money('FINANCIAL_PAYMENT_START', { account_id: 'order:full', payment_id: 'new', amount_cents: 1000, method: 'cash' })).code, 'ORDER_SEND_REQUIRED')
  assert.equal(await s.store.getLastSequence(), before)
  assert.ok((await s.money('FINANCIAL_PAYMENT_RESULT', { payment_id: 'reserved', status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 3000 } })).event)
  assert.equal(s.state.getFinancialOrder('order').paid_cents, 8000)
  assert.ok((await s.send('ORDER_SEND', s.operational())).event)
  assert.ok((await s.money('FINANCIAL_PAYMENT_START', { account_id: 'order:full', payment_id: 'new', amount_cents: 1000, method: 'cash' })).event)
})
test('stale operational/financial revisions and invalid destination do not commit either projection', async t => {
  const s = await setup(t)
  const snapshot = s.state.toSnapshot(), sequence = await s.store.getLastSequence()
  for (const patch of [{ expected_revision: 1, account_id: 'order:full' }, { expected_financial_revision: 0, account_id: 'order:full' }, { account_id: 'other-order:full' }]) {
    assert.ok((await s.save(3, patch)).error)
    assert.equal(await s.store.getLastSequence(), sequence)
    assert.deepEqual(s.state.toSnapshot(), snapshot)
  }
})
test('saved unsent quantities cannot be reduced or removed after financial allocation', async t => {
  const s = await setup(t)
  assert.ok((await s.save(3, { account_id: 'order:full' })).event)
  const sequence = await s.store.getLastSequence(), snapshot = s.state.toSnapshot()
  assert.equal((await s.save(2, { account_id: 'order:full' })).code, 'FINANCIAL_ADDITION_ONLY')
  assert.ok((await s.save(3, { account_id: 'order:full', items: [{ line_id: 'replacement', product_id: 'product-a', quantity: 3, modifier_ids: [] }] })).error)
  assert.equal(await s.store.getLastSequence(), sequence)
  assert.deepEqual(s.state.toSnapshot(), snapshot)
})
test('dual results survive restart and repeated save/send return original receipts without new print intents', async t => {
  let s = await setup(t, true)
  await partialAndReserved(s)
  const saveCommand = { ...s.operational(), command_id: 'stable-addition', account_id: 'order:full' }
  const added = await s.save(3, saveCommand)
  assert.ok(added.event)
  const sendCommand = { ...s.operational(), command_id: 'stable-send' }
  const sent = await s.send('ORDER_SEND', sendCommand)
  assert.ok(sent.event, JSON.stringify(sent))
  const financial = s.state.getFinancialOrder('order'), operational = s.state.getOrder('order')
  const preparations = s.prepared.length, jobs = s.queued.size
  assert.equal(jobs, 2)
  s = await s.restart()
  assert.deepEqual(s.state.getFinancialOrder('order'), financial)
  assert.deepEqual(s.state.getOrder('order'), operational)
  const duplicateSave = await s.save(3, saveCommand)
  const duplicateSend = await s.send('ORDER_SEND', sendCommand)
  assert.equal(duplicateSave.duplicate, true)
  assert.deepEqual(duplicateSave.result, added.result)
  assert.equal(duplicateSend.duplicate, true)
  assert.deepEqual(duplicateSend.result, sent.result)
  assert.equal(s.prepared.length, preparations)
  assert.equal(s.queued.size, jobs)
  assert.equal(s.state.getFinancialOrder('order').total_cents, 30000)
})


test('a failed durable append consumes neither financial allocation nor operational revision; retry applies once', async t => {
  const s = await setup(t)
  await partialAndReserved(s)
  const previous = s.state.toSnapshot(), before = await s.store.getLastSequence()
  const fields = { ...s.operational(), command_id: 'failed-addition-retry', account_id: 'order:full' }
  const write = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC addition') })
  await assert.rejects(s.save(3, fields), /ENOSPC addition/)
  write.mock.restore()
  assert.deepEqual(s.state.toSnapshot(), previous)
  assert.equal(await s.store.getLastSequence(), before)
  const retry = await s.save(3, fields)
  assert.ok(retry.event)
  assert.equal(s.state.getFinancialOrder('order').total_cents, 30000)
  assert.equal(s.state.getFinancialOrder('order').paid_cents, 5000)
  assert.equal(s.state.getFinancialOrder('order').reserved_cents, 3000)
  assert.equal((await s.save(3, fields)).duplicate, true)
})
test('simultaneous additions with the same observed revisions allocate only the winning consumption', async t => {
  const s = await setup(t)
  const observed = { ...s.operational(), account_id: 'order:full' }
  const results = await Promise.all([s.save(3, observed), s.save(4, observed)])
  assert.equal(results.filter(r => r.event).length, 1)
  assert.equal(results.filter(r => r.error).length, 1)
  assert.equal(s.state.getOrder('order').total_cents, s.state.getFinancialOrder('order').total_cents)
  assert.equal(s.state.getFinancialOrder('order').revision, 2)
  const additions = (await s.store.readAfter(0)).filter(e => e.result?.financial_allocation)
  assert.equal(additions.length, 1)
})

test('successive fractional-cent tax rounds preserve cumulative rounding and existing payments', async t => {
  const s = await setup(t, false, { price: 0.03, iva: 0.16 })
  assert.equal(s.state.getOrder('order').total_cents, 7)
  assert.ok((await s.save(3, { account_id: 'order:full' })).event)
  assert.equal(s.state.getOrder('order').total_cents, 10)
  assert.ok((await s.save(4, { account_id: 'order:full' })).event)
  assert.equal(s.state.getOrder('order').subtotal_cents, 12)
  assert.equal(s.state.getOrder('order').iva_cents, 2)
  assert.equal(s.state.getFinancialOrder('order').total_cents, 14)
  const allocation = (await s.store.readAfter(0)).filter(e => e.result?.financial_allocation)
  assert.deepEqual(allocation.map(e => e.result.financial_allocation.amount_cents), [3, 4])
})
