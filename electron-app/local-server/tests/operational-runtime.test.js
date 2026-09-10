'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { CatalogStore } = require('../core/catalog-store')
const { permissionsFor } = require('../core/actor-authority')
const { buildHttpRouter } = require('../index')
const cred = require('../core/credencial-lan')
const actor = { id: 'one', name: 'Operador', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
function fixture() {
  return { schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: 'lab', refreshed_at: '2026-09-05T01:00:00Z',
    categories: [{ id: 'drinks', name: 'Bebidas', items: [{ id: 'coffee', name: 'Café', price: 50 }] }, { id: 'food', name: 'Comida', items: [{ id: 'soup', name: 'Sopa', price: 40 }] }],
    config: { id: 'lab', display_name: 'Laboratorio', timezone: 'America/Monterrey', mesas: 10, iva_rate: 0.16 },
    settings: { 'pos.station_routing': { cocina: ['food'], barra: ['drinks'], caja: [] }, 'pos.no_print_stations': ['cocina', 'barra', 'caja'] },
    modifiers: { groups: [{ id: 'milk', name: 'Leche', level: 1, required: true, min_selections: 1, max_selections: 1 }],
      mods: [{ id: 'oat', group_id: 'milk', name: 'Avena', price: 15 }, { id: 'whole', group_id: 'milk', name: 'Entera', price: 0 }], item_links: [{ item_id: 'coffee', group_id: 'milk' }], category_links: [] },
    payment_methods: [{ id: 'cash', name: 'Efectivo', type: 'cash', commission_pct: 0 }] }
}
async function setup(t, enabled = true, printer, catalogFixture = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-operational-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const catalog = new CatalogStore({ directory: path.join(dir, 'catalog'), restaurantId: 'lab', fetchImpl: async () => Response.json(catalogFixture) })
  await catalog.refresh('synthetic')
  let counter = 0
  async function restart() {
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') })); await store.load()
    const state = new RestaurantState({ localAuthorityEnabled: enabled })
    for (const event of await store.readAfter(0)) state.apply(event)
    const broadcasts = []
    const handler = new CommandHandler({ eventStore: store, state, wsHub: { async broadcast(e) { broadcasts.push(e) } }, restaurantId: 'lab', catalogStore: catalog, localAuthorityEnabled: enabled, printer })
    const send = (type, fields = {}, opts = {}) => handler.handle({ restaurant_id: 'lab', payload: { command_type: type, command_id: `cmd-${++counter}`, ...fields } }, opts.client || 'POS-A', { actor: opts.actor || actor })
    return { store, state, handler, send, broadcasts, catalog, restart, dir }
  }
  const stack = await restart()
  if (enabled) assert.ok((await stack.send('TURN_OPEN', { turno_id: 't1', opening_cash_cents: 10000 })).result?.turno)
  return stack
}
const items = (quantity = 1) => [{ line_id: 'line-coffee', product_id: 'coffee', quantity, modifier_ids: ['oat'] }]
const saveFields = (stack, patch = {}) => ({ order_id: 'mother', turno_id: 't1', expected_revision: 0, catalog_revision: stack.catalog.read().revision, mesa: 7, personas: 2, items: items(), ...patch })
const orderFields = (revision, patch = {}) => ({ order_id: 'mother', turno_id: 't1', expected_revision: revision, ...patch })

test('save uses Caja prices, options and cents; kitchen only receives sends and incremental rounds', async t => {
  const s = await setup(t)
  const saved = await s.send('ORDER_SAVE', saveFields(s))
  assert.equal(saved.result.operational_order.total_cents, 7540)
  assert.equal(saved.result.operational_order.iva_cents, 1040)
  assert.equal(saved.result.operational_order.order_revision, 1)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  const first = await s.send('ORDER_SEND', orderFields(1))
  assert.equal(JSON.parse(first.result.operational_order.items)[0].sent_quantity, 1)
  assert.equal(JSON.parse(s.state.toSnapshot().kds_orders[0].items)[0].cantidad, 1)
  await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: items(3) }))
  assert.equal(JSON.parse(s.state.toSnapshot().salon_orders[0].items)[0].cantidad, 3)
  assert.equal(JSON.parse(s.state.toSnapshot().kds_orders[0].items)[0].cantidad, 1, 'draft quantities are not kitchen work')
  await s.send('ORDER_SEND', orderFields(3))
  const kitchen = JSON.parse(s.state.toSnapshot().kds_orders[0].items)
  assert.deepEqual(kitchen.map(i => i.cantidad), [1, 2])
  assert.equal(new Set(kitchen.map(i => i.id)).size, 2)
  assert.equal((await s.send('ORDER_SEND', orderFields(4))).code, 'NOTHING_TO_SEND')
  const remote = new RestaurantState(); remote.hidratarDesdeSnapshot(s.state.toSnapshot())
  assert.equal(remote.toSnapshot().write_authority, 'caja')
  assert.deepEqual(remote.toSnapshot().salon_orders, s.state.toSnapshot().salon_orders)
  assert.deepEqual(remote.toSnapshot().kds_orders, s.state.toSnapshot().kds_orders)
})
test('client cannot replace prices, omit required choices, pick unrelated or duplicate modifiers', async t => {
  const s = await setup(t), before = await s.store.getLastSequence()
  for (const patch of [{ total: 1 }, { mesero: 'forged' }, { descuento: 100 }, { catalog_revision: 'old' },
    { items: [{ ...items()[0], price: 1 }] }, { items: [{ ...items()[0], modifier_ids: [] }] },
    { items: [{ ...items()[0], modifier_ids: ['oat', 'oat'] }] }, { items: [{ ...items()[0], modifier_ids: ['oat', 'whole'] }] },
    { items: [{ ...items()[0], product_id: 'soup' }] }, { items: [{ ...items()[0], quantity: 1.5 }] }]) {
    const result = await s.send('ORDER_SAVE', saveFields(s, patch)); assert.ok(result.error, JSON.stringify(patch))
  }
  assert.equal(await s.store.getLastSequence(), before)
})
test('concurrent terminals cannot overwrite revisions or open two orders on the same table', async t => {
  const s = await setup(t)
  const creating = await Promise.all(['A', 'B'].map(order_id => s.send('ORDER_SAVE', saveFields(s, { order_id }), { client: order_id })))
  assert.equal(creating.filter(r => r.result).length, 1)
  assert.equal(creating.filter(r => r.code === 'TABLE_OCCUPIED').length, 1)
  const order = creating.find(r => r.result).result.operational_order
  const editing = await Promise.all([2, 3].map(quantity => s.send('ORDER_SAVE', saveFields(s, { order_id: order.order_id, expected_revision: 1, items: items(quantity) }))))
  assert.equal(editing.filter(r => r.result).length, 1)
  assert.equal(editing.filter(r => r.code === 'ORDER_REVISION_CONFLICT').length, 1)
})
test('save and send survive restart; duplicate returns original receipt after subsequent edits', async t => {
  let s = await setup(t)
  const payload = saveFields(s, { command_id: 'save-stable' })
  const original = await s.send('ORDER_SAVE', payload)
  await s.send('ORDER_SEND', orderFields(1, { command_id: 'send-stable' }))
  await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: items(2) }))
  s = await s.restart()
  const duplicate = await s.send('ORDER_SAVE', payload, { client: 'POS-B' })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.receipt.event_id, original.event.id)
  assert.equal(duplicate.receipt.command_id, 'save-stable')
  assert.equal(duplicate.result.operational_order.order_revision, 1)
  assert.equal(s.state.getOrder('mother').order_revision, 3)
  assert.equal(s.state.toSnapshot().kds_orders.length, 1)
  const repeatSend = await s.send('ORDER_SEND', orderFields(1, { command_id: 'send-stable' }))
  assert.equal(repeatSend.duplicate, true)
  assert.equal(JSON.parse(s.state.toSnapshot().kds_orders[0].items).length, 1)
})
test('storage failure cannot acknowledge a saved or sent order or consume its revision', async t => {
  const s = await setup(t)
  const write = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC') })
  await assert.rejects(s.send('ORDER_SAVE', saveFields(s, { command_id: 'save-retry' })), /ENOSPC/)
  write.mock.restore()
  assert.equal(s.state.getOrder('mother'), null)
  assert.ok((await s.send('ORDER_SAVE', saveFields(s, { command_id: 'save-retry' }))).event)
  const secondWrite = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC') })
  await assert.rejects(s.send('ORDER_SEND', orderFields(1, { command_id: 'send-retry' })), /ENOSPC/)
  secondWrite.mock.restore()
  assert.equal(s.state.getOrder('mother').order_revision, 1)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  assert.ok((await s.send('ORDER_SEND', orderFields(1, { command_id: 'send-retry' }))).event)
})
test('authenticated employee authority, turn and activation are required; legacy cannot bypass Caja', async t => {
  const s = await setup(t)
  const msg = { payload: { command_type: 'ORDER_SAVE', command_id: 'forged', ...saveFields(s), actor } }
  assert.equal((await s.handler.handle(msg, 'POS-A')).code, 'ACTOR_REQUIRED')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s), { actor: { ...actor, expires_at: 0 } })).code, 'ACTOR_REQUIRED')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s), { actor: { ...actor, permissions: [] } })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { turno_id: 'other' }))).code, 'TURNO_MISMATCH')
  for (const type of ['ORDER_UPSERTED', 'ORDER_SENT', 'ORDER_CANCELLED', 'ORDER_CLOSED', 'TURNO_OPENED', 'TURNO_CLOSED']) {
    assert.equal((await s.send(type, { order_id: 'mother', total: 1 })).code, 'AUTHORITATIVE_COMMAND_REQUIRED', type)
  }
  const legacy = await setup(t, false)
  assert.equal(legacy.state.toSnapshot().write_authority, 'legacy')
  assert.equal((await legacy.send('TURN_OPEN', { turno_id: 't1' })).code, 'LOCAL_AUTHORITY_DISABLED')
  assert.ok((await legacy.send('TURNO_OPENED', { turno_id: 'legacy' })).event)
})
test('sent items cannot be deleted or changed; another waiter needs permission; catalog revisions protect consent', async t => {
  const s = await setup(t)
  await s.send('ORDER_SAVE', saveFields(s)); await s.send('ORDER_SEND', orderFields(1))
  for (const changes of [{ modifier_ids: ['whole'] }, { notes: 'changed' }, { seat: 2 }, { quantity: 0 }]) {
    assert.ok((await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: [{ ...items()[0], ...changes }] }))).error)
  }
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: [{ line_id: 'other', product_id: 'soup', quantity: 1 }] }))).code, 'SENT_ITEM_LOCKED')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2 }), { actor: { ...actor, id: 'other', permissions: permissionsFor('mesero') } })).code, 'PERMISSION_DENIED')
  const before = s.catalog.read().revision
  const changed = fixture(); changed.categories[0].items[0].price = 60
  s.catalog.fetch = async () => Response.json(changed); await s.catalog.refresh('synthetic')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, catalog_revision: before }))).code, 'CATALOG_REVISION_CONFLICT')
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: items(2) }))).code, 'SENT_PRICE_CHANGED')
})
test('opening accounts requires financial revision for additions and preserves preparation independently from payment', async t => {
  const s = await setup(t)
  await s.send('ORDER_SAVE', saveFields(s)); await s.send('ORDER_SEND', orderFields(1))
  assert.ok((await s.send('FINANCIAL_OPEN', { order_id: 'mother', turno_id: 't1', expected_revision: 0, expected_order_revision: 2, total_cents: 7540, currency: 'MXN' })).event)
  for (const type of ['ORDER_MOVE', 'ORDER_VOID']) {
    assert.equal((await s.send(type, saveFields(s, { expected_revision: 2 }))).code, 'FINANCIAL_ORDER_LOCKED')
  }
  for (const type of ['ORDER_SAVE', 'ORDER_SEND']) {
    assert.equal((await s.send(type, saveFields(s, { expected_revision: 2 }))).code, 'FINANCIAL_REVISION_CONFLICT')
  }
  assert.equal((await s.send('TURN_CLOSE', { turno_id: 't1' })).code, 'UNSETTLED_FINANCIAL_ACCOUNTS')
  assert.equal((await s.send('ORDER_UPSERTED', { order_id: 'mother', status: 'entregada' })).code, 'KITCHEN_COMMAND_REQUIRED')
  assert.ok((await s.send('KITCHEN_SET', { order_id: 'mother', turno_id: 't1', expected_kitchen_revision: 1,
    item_ids: s.state.getOrder('mother').kitchen_items.map(i => i.id), status: 'entregada' })).event)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  assert.equal(s.state.toSnapshot().salon_orders[0].saldo, 75.4)
})

test('kitchen item and round progress is shared, durable and monotonic after order settlement', async t => {
  let s = await setup(t)
  await s.send('ORDER_SAVE', saveFields(s)); await s.send('ORDER_SEND', orderFields(1))
  await s.send('ORDER_SAVE', saveFields(s, { expected_revision: 2, items: items(3) })); await s.send('ORDER_SEND', orderFields(3))
  const original = s.state.getOrder('mother'), [first, second] = original.kitchen_items
  const kitchen = (revision, ids, status, extra = {}) => ({ order_id: 'mother', turno_id: 't1', expected_kitchen_revision: revision, item_ids: ids, status, ...extra })
  await s.send('KITCHEN_SET', kitchen(2, [first.id], 'lista'))
  assert.equal(s.state.getOrder('mother').kitchen_items[1].preparation_status, undefined)
  assert.equal(s.state.getOrder('mother').order_revision, 4, 'preparation does not invalidate financial/order OCC')
  await s.send('FINANCIAL_OPEN', { order_id: 'mother', turno_id: 't1', expected_revision: 0, expected_order_revision: 4, total_cents: 22620, currency: 'MXN' })
  await s.send('FINANCIAL_PAYMENT_START', { order_id: 'mother', expected_revision: 1, account_id: 'mother:full', payment_id: 'paid', amount_cents: 22620, method: 'cash' })
  await s.send('FINANCIAL_PAYMENT_RESULT', { order_id: 'mother', expected_revision: 2, payment_id: 'paid', status: 'accepted', evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 22620 } })
  assert.equal(s.state.toSnapshot().salon_orders.length, 0)
  assert.equal((await s.send('TURN_CLOSE', { turno_id: 't1' })).code, 'PENDING_KITCHEN_WORK')
  assert.equal((await s.send('KITCHEN_SET', kitchen(3, [first.id], 'preparando'))).code, 'PREPARATION_REGRESSION')
  const command = kitchen(3, [first.id], 'entregada', { command_id: 'deliver-stable' })
  assert.ok((await s.send('KITCHEN_SET', command)).event)
  s = await s.restart()
  assert.equal((await s.send('KITCHEN_SET', command)).duplicate, true)
  assert.equal(s.state.getOrder('mother').kitchen_items[0].preparation_status, 'entregada')
  assert.equal(s.state.getFinancialOrder('mother').paid_cents, 22620)
  assert.ok((await s.send('KITCHEN_SET', kitchen(4, [second.id], 'entregada'))).event)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  assert.equal(s.state.getFinancialOrder('mother').paid_cents, 22620)
  const close = await s.send('TURN_CLOSE', { turno_id: 't1', counted_cash_cents: 32600, notes: 'Faltan veinte centavos' })
  assert.equal(close.result.closed_turno.cash_sales_cents, 22620)
  assert.equal(close.result.closed_turno.expected_cash_cents, 32620)
  assert.equal(close.result.closed_turno.total_paid_cents, 22620)
  assert.equal(close.result.closed_turno.difference_cents, -20)
  const closed = await s.restart()
  assert.deepEqual(closed.state.toSnapshot().turn_summaries[0], close.result.closed_turno)
  const secondary = new RestaurantState(); secondary.hidratarDesdeSnapshot(closed.state.toSnapshot())
  assert.deepEqual(secondary.toSnapshot().turn_summaries, closed.state.toSnapshot().turn_summaries)
})
test('two kitchen devices cannot overwrite progress, forge sent identities or bypass employee permissions', async t => {
  const s = await setup(t)
  await s.send('ORDER_SAVE', saveFields(s)); await s.send('ORDER_SEND', orderFields(1))
  const cmd = { order_id: 'mother', turno_id: 't1', expected_kitchen_revision: 1, item_ids: s.state.getOrder('mother').kitchen_items.map(i => i.id), status: 'lista' }
  assert.equal((await s.send('KITCHEN_SET', cmd, { actor: { ...actor, permissions: permissionsFor('mesero') } })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('KITCHEN_SET', { ...cmd, item_ids: ['browser-item'] })).code, 'INVALID_KITCHEN_ITEMS')
  const simultaneous = await Promise.all(['A', 'B'].map(client => s.send('KITCHEN_SET', cmd, { client })))
  assert.equal(simultaneous.filter(r => r.event).length, 1)
  assert.equal(simultaneous.filter(r => r.code === 'KITCHEN_REVISION_CONFLICT').length, 1)
})
test('authorized move releases old table; cancellation is durable and cannot be resurrected by cloud polling', async t => {
  let s = await setup(t)
  await s.send('ORDER_SAVE', saveFields(s)); await s.send('ORDER_SEND', orderFields(1))
  assert.ok((await s.send('ORDER_MOVE', orderFields(2, { mesa: 8 }))).event)
  assert.equal(s.state.getMesa(7).status, 'libre')
  assert.equal(s.state.getMesa(8).order_id, 'mother')
  assert.equal((await s.send('ORDER_VOID', orderFields(3, { reason: 'Cliente se retira' }), { actor: { ...actor, permissions: permissionsFor('gerente') } })).code, 'PERMISSION_DENIED')
  assert.ok((await s.send('ORDER_VOID', orderFields(3, { reason: 'Cliente se retira' }))).event)
  assert.equal(s.state.toSnapshot().salon_orders.length, 0)
  assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  s = await s.restart()
  s.state.apply({ type: 'STATE_SYNC', payload: { turno: { id: 'wrong' }, orders: [{ id: 'mother', items: '[]', status: 'enviada', mesa: 8 }] } })
  assert.equal(s.state.getTurno().id, 't1')
  assert.equal(s.state.getOrder('mother').cancellation_reason, 'Cliente se retira')
  assert.equal((await s.send('TURN_CLOSE', { turno_id: 't1' })).code, 'INVALID_OPERATIONAL_VALUE')
  assert.ok((await s.send('TURN_CLOSE', { turno_id: 't1', counted_cash_cents: 10000 })).result.closed_turno)
  const restored = await s.restart()
  assert.equal(restored.state.getTurno(), null)
  assert.equal((await restored.send('TURN_OPEN', { turno_id: 't1' })).code, 'TURN_ID_REUSED')
})
test('named accounts and new shift identities remain unique across terminals and restart', async t => {
  const s = await setup(t)
  assert.ok((await s.send('ORDER_SAVE', saveFields(s, { mesa: null, customer_name: 'Recoger Ana' }))).event)
  assert.equal((await s.send('ORDER_SAVE', saveFields(s, { order_id: 'second', mesa: null, customer_name: '  recoger ana  ' }))).code, 'CUSTOMER_ACCOUNT_EXISTS')
  assert.equal(s.state.toSnapshot().salon_orders.length, 1)
})
test('HTTP secondary forwards employee identity; unauthorized writes fail before durable mutation', async t => {
  const s = await setup(t), secret = cred.generarSecreto()
  const headers = { ...cred.cabecerasDeCredencial({ secreto: secret, restaurantId: 'lab', terminalId: 'POS-B' }), 'Content-Type': 'application/json' }
  const authority = { verify(token, terminal) { if (token !== 'synthetic-session' || terminal !== 'POS-B') throw new Error('actor required'); return actor } }
  async function server(config, extras = {}) {
    const server = http.createServer(buildHttpRouter({ restaurantId: 'lab', config: { lanSecret: secret, ...config }, ...extras }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
    return server
  }
  const caja = await server({}, { state: s.state, eventStore: s.store, cmdHandler: s.handler, actorAuthority: authority, catalogStore: s.catalog })
  const secondary = await server({ posServerIp: '127.0.0.1', posServerPort: caja.address().port })
  const url = `http://127.0.0.1:${secondary.address().port}/events`
  const body = JSON.stringify({ command_type: 'ORDER_SAVE', command_id: 'http-save', ...saveFields(s) })
  const rejected = await (await fetch(url, { method: 'POST', headers, body })).json()
  assert.ok(rejected.results[0].error)
  assert.equal(s.state.getOrder('mother'), null)
  const accepted = await (await fetch(url, { method: 'POST', headers: { ...headers, 'x-fullsite-actor': 'synthetic-session' }, body })).json()
  assert.equal(accepted.results[0].result.operational_order.total_cents, 7540)
  const read = await (await fetch(`http://127.0.0.1:${secondary.address().port}/state`, { headers })).json()
  assert.equal(read.write_authority, 'caja')
  assert.equal(read.salon_orders[0].total_cents, 7540)
  assert.ok(!fs.readFileSync(path.join(s.dir, 'events.ndjson'), 'utf8').includes('synthetic-session'))
})

test('a kitchen send requires explicit routing and paper policy before committing work', async t => {
  for (const mutate of [
    c => { delete c.settings['pos.station_routing'] },
    c => { c.settings['pos.station_routing'].cocina.push('drinks') },
    c => { delete c.settings['pos.no_print_stations'] },
    c => { c.settings['pos.no_print_stations'] = [] },
  ]) {
    const catalog = fixture(); mutate(catalog)
    const s = await setup(t, true, undefined, catalog)
    const before = await s.store.getLastSequence()
    const saved = await s.send('ORDER_SAVE', saveFields(s))
    if (saved.error) {
      assert.equal(await s.store.getLastSequence(), before)
      assert.equal(s.state.getOrder('mother'), null)
      continue
    }
    const savedSequence = await s.store.getLastSequence()
    assert.ok((await s.send('ORDER_SEND', orderFields(1))).error)
    assert.equal(await s.store.getLastSequence(), savedSequence)
    assert.equal(s.state.getOrder('mother').order_revision, 1)
    assert.equal(s.state.toSnapshot().kds_orders.length, 0)
  }
})

test('money requires explicit cutover and a Caja-owned order; arbitrary print bytes cannot bypass it', async t => {
  const legacy = await setup(t, false)
  for (const type of ['FINANCIAL_OPEN', 'FINANCIAL_SPLIT', 'FINANCIAL_PAYMENT_START', 'FINANCIAL_PAYMENT_RESULT']) {
    assert.equal((await legacy.send(type, { order_id: 'legacy' })).code, 'LOCAL_AUTHORITY_DISABLED')
  }
  const s = await setup(t)
  s.state.apply({ type: 'ORDER_SENT', payload: { order_id: 'old', mesa: 2, total: 100, order_revision: 1, turno_id: 't1', items: [] } })
  assert.equal((await s.send('FINANCIAL_OPEN', { order_id: 'old' })).code, 'LEGACY_ORDER_REQUIRES_CUTOVER')
  const sequence = await s.store.getLastSequence()
  assert.equal((await s.send('PRINT_COMMAND', { station: 'caja', data_b64: Buffer.from([0x1b, 0x70]).toString('base64') })).code, 'CONTROLLED_PRINT_REQUIRED')
  assert.equal(await s.store.getLastSequence(), sequence)
})

test('failure writing the print queue after commit preserves the sent round and recovers its original intent', async t => {
  const catalog = fixture(); catalog.settings['pos.no_print_stations'] = ['cocina', 'caja']
  let fail = true, preparations = 0
  const queue = new Map()
  const printer = {
    prepareJobs(station, data, documentType, { commandId }) {
      preparations++
      return [{ job_id: commandId, station_id: station, data_b64: data.toString('base64'), document_type: documentType,
        connection: { type: 'tcp', host: '127.0.0.1', port: 12345 }, copies: 1 }]
    },
    enqueuePreparedJobs(jobs) {
      if (fail) throw new Error('ENOSPC queue')
      jobs.forEach(job => queue.set(job.job_id, job))
    },
  }
  let s = await setup(t, true, printer, catalog)
  await s.send('ORDER_SAVE', saveFields(s))
  const command = orderFields(1, { command_id: 'durable-round' })
  await assert.rejects(s.send('ORDER_SEND', command), /ENOSPC queue/)
  assert.equal(s.state.getOrder('mother').order_revision, 2)
  assert.equal(s.state.toSnapshot().kds_orders.length, 1)
  const committed = (await s.store.readAfter(0)).at(-1)
  assert.equal(committed.effects.print_jobs.length, 1)
  fail = false
  printer.prepareJobs = () => { throw new Error('The new configuration has no printer') }
  s = await s.restart()
  await s.handler.recoverPendingEffects()
  const retry = await s.send('ORDER_SEND', command)
  assert.equal(retry.duplicate, true)
  assert.equal(preparations, 1)
  assert.equal(queue.size, 1)
  assert.deepEqual([...queue.values()], committed.effects.print_jobs)
  assert.equal(s.state.getOrder('mother').kitchen_items.length, 1)
})

test('two stations on one TCP printer send distinct durable tickets once across retry and restart', { timeout: 10000 }, async t => {
  const net = require('node:net'), printer = require('../adapters/printer'), queue = require('../adapters/print-queue')
  const received = []
  const server = net.createServer(socket => {
    const chunks = []
    socket.on('data', bytes => chunks.push(bytes))
    socket.on('end', () => { received.push(Buffer.concat(chunks)); socket.end() })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const catalog = fixture(); catalog.settings['pos.no_print_stations'] = ['caja']
  let s = await setup(t, true, printer, catalog)
  const queuePath = path.join(s.dir, 'print-queue.json')
  printer.init({ printersConfig: { schema_version: 2, printers: [{ printer_id: 'shared', name: 'Loopback', enabled: true,
    connection: { type: 'tcp', host: '127.0.0.1', port: server.address().port }, station_ids: ['cocina', 'barra'],
    document_types: ['kitchen_ticket', 'bar_ticket'], copies: 1, encoding: 'cp850' }] }, queueFilePath: queuePath })
  await s.send('ORDER_SAVE', saveFields(s, { items: [...items(), { line_id: 'line-soup', product_id: 'soup', quantity: 2, notes: 'Sin sal\u001bp\u0000' }] }))
  const command = orderFields(1, { command_id: 'two-stations' })
  const sent = await s.send('ORDER_SEND', command)
  assert.equal(sent.result.preparation_delivery.length, 2)
  assert.equal(new Set(sent.event.effects.print_jobs.map(j => j.job_id)).size, 2)
  const deadline = Date.now() + 3000
  while (received.length < 2 || queue.getAllJobs().some(j => j.status !== 'printed')) {
    assert.ok(Date.now() < deadline, 'TCP delivery did not finish')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(received.find(b => b.includes(Buffer.from('BARRA')))?.includes(Buffer.from('1 x Cafe')))
  assert.ok(received.find(b => b.includes(Buffer.from('COCINA')))?.includes(Buffer.from('2 x Sopa')))
  for (const bytes of received) assert.equal(bytes.includes(Buffer.from([0x1b, 0x70])), false, 'kitchen text cannot inject a drawer command')
  printer.init({ printersConfig: null, queueFilePath: queuePath })
  s = await s.restart(); await s.handler.recoverPendingEffects()
  assert.equal((await s.send('ORDER_SEND', command)).duplicate, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queue.getAllJobs().length, 2)
  assert.equal(received.length, 2)
})

test('cash movements are authorized, durable and included once in X and Z after restart', async t => {
  const { turnReport } = require('../core/turn-report')
  let s = await setup(t)
  const fields = { turno_id:'t1', movement_id:'withdrawal-1', type:'retiro', amount_cents:2000, reason:'Fondo a resguardo' }
  const denied = await s.send('CASH_MOVEMENT',fields,{actor:{...actor,permissions:permissionsFor('mesero')}})
  assert.equal(denied.code,'PERMISSION_DENIED')
  assert.equal(s.state.getCashMovements().length,0)
  assert.equal((await s.send('CASH_MOVEMENT',fields)).result.cash_movement.amount_cents,2000)
  await s.send('CASH_MOVEMENT',fields)
  assert.equal(s.state.getCashMovements().length,1)
  const conflict=await s.send('CASH_MOVEMENT',{...fields,amount_cents:1000})
  assert.equal(conflict.code,'MOVEMENT_ID_REUSED')
  s = await s.restart()
  await s.send('CASH_MOVEMENT',{...fields,movement_id:'deposit-1',type:'deposito',amount_cents:500})
  const report=turnReport(s.state.getTurno(),s.state.getFinancialOrders(),[],s.state.getCashMovements())
  assert.equal(report.expected_cash_cents,8500)
  assert.equal((await s.send('CASH_MOVEMENT',{...fields,movement_id:'too-much',amount_cents:8501})).code,'INSUFFICIENT_CASH')
  const closed=await s.send('TURN_CLOSE',{turno_id:'t1',counted_cash_cents:8500,notes:'Comprobado'})
  assert.equal(closed.result.closed_turno.expected_cash_cents,8500)
  assert.equal(closed.result.closed_turno.difference_cents,0)
  assert.equal(closed.result.closed_turno.withdrawals_cents,2000)
  assert.equal(closed.result.closed_turno.deposits_cents,500)
  assert.equal((await s.send('CASH_MOVEMENT',{...fields,movement_id:'after-close'})).code,'TURNO_MISMATCH')
})
