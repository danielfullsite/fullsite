'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { RestaurantState } = require('../core/state')
const { CommandHandler } = require('../core/command-handler')
const { FinancialDomain } = require('../core/financial-domain')
const { permissionsFor } = require('../core/actor-authority')
const queue = require('../adapters/print-queue')
const manager = { id: 'owner', name: 'Operador', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-controlled-print-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let counter = 0, configured = true, failEnqueue = false
  const printer = {
    prepareJobs(station, data, type, opts) {
      if (!configured) throw Object.assign(new Error('fixture printer missing'), { code: 'PRINTER_NOT_CONFIGURED' })
      return [{ job_id: crypto.createHash('sha256').update(opts.commandId).digest('hex'), command_id: opts.commandId, station_id: station,
        printer_id: 'fixture-caja', printer_name: 'Fixture Caja', connection: { type: 'tcp', host: '127.0.0.1', port: 1 },
        document_type: type, data_b64: data.toString('base64'), copies: 3, reprint: opts.reprint === true }]
    },
    enqueuePreparedJobs(jobs) { if (failEnqueue) throw new Error('fixture ACK lost before queue'); return queue.enqueueMany(jobs) },
  }
  async function restart() {
    queue.init({ filePath: path.join(dir, 'queue.json') })
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') })); await store.load()
    const state = new RestaurantState({ localAuthorityEnabled: true })
    for (const event of await store.readAfter(0)) state.apply(event)
    const handler = new CommandHandler({ eventStore: store, state, wsHub: { broadcast: async () => {} }, printer, restaurantId: 'fixture', localAuthorityEnabled: true })
    const send = (type, fields = {}, actor = manager) => handler.handle({ payload: { command_id: `print-${++counter}`, command_type: type, ...fields } }, 'POS2', { actor })
    return { store, state, handler, send, restart, printer, dir, configured: value => { configured = value }, failEnqueue: value => { failEnqueue = value } }
  }
  const s = await restart()
  const order = { id: 'order', order_id: 'order', turno_id: 'turn', authority: 'caja', order_revision: 1, created_by: 'owner', mesero: 'Ana\x1bp', mesa: 1,
    total_cents: 11600, subtotal_cents: 10000, iva_cents: 1600, status: 'preparando',
    items: JSON.stringify([{ nombre: 'Sopa\x1b\x70', cantidad: 2, total_cents: 10000, modificadores: [], sent_quantity: 2 }]) }
  for (const [type, result] of [['TURN_OPEN', { turno: { id: 'turn', opening_cash_cents: 50000 } }], ['ORDER_SAVE', { operational_order: order }]]) {
    const { event } = await s.store.processCommand({ command_id: `seed-${type}`, type, restaurant_id: 'fixture', client_id: 'fixture', payload: { command_id: `seed-${type}` } }, { eventType: type, buildResult: () => result })
    s.state.apply(event)
  }
  return s
}
const fields = (extra = {}) => ({ order_id: 'order', expected_order_revision: 1, expected_financial_revision: 0, ...extra })
async function acceptPartial(s) {
  const domain = new FinancialDomain(), context = { order: s.state.getOrder('order'), turno: s.state.getTurno(), actor: manager }
  let order
  for (const payload of [
    { command_type: 'FINANCIAL_OPEN', expected_revision: 0, expected_order_revision: 1, turno_id: 'turn', total_cents: 11600, currency: 'MXN' },
    { command_type: 'FINANCIAL_PAYMENT_START', expected_revision: 1, account_id: 'order:full', payment_id: 'card', amount_cents: 5000, tip_cents: 700, method: 'manual', tender: 'card' },
    { command_type: 'FINANCIAL_PAYMENT_RESULT', expected_revision: 2, payment_id: 'card', status: 'accepted', evidence: { kind: 'manual_received', tender: 'card', received_by: 'owner', source: 'fixture-terminal', reference: 'fixture-folio', currency: 'MXN', amount_cents: 5700 } },
  ]) { order = domain.prepare({ order_id: 'order', ...payload }, context).financial_order; domain.apply(order) }
  const { event } = await s.store.processCommand({ command_id: 'seed-paid', type: 'FINANCIAL_PAYMENT_RESULT', payload: { command_id: 'seed-paid' } }, { eventType: 'FINANCIAL_PAYMENT_RESULT', buildResult: () => ({ financial_order: order }) })
  s.state.apply(event)
}
const bytes = result => Buffer.from(result.event.effects.print_jobs[0].data_b64, 'base64')

test('precheck uses saved cents, strips controls, prints only to caja and never includes a drawer opcode', async t => {
  const s = await setup(t)
  const result = await s.send('PRINT_PRECHECK', fields())
  assert.ok(result.event)
  assert.match(bytes(result).toString(), /PRECUENTA - NO ES COMPROBANTE DE PAGO/)
  assert.match(bytes(result).toString(), /Consumo total \$116.00/)
  assert.match(bytes(result).toString(), /IVA \$16.00/)
  assert.equal(bytes(result).includes(Buffer.from([0x1b, 0x70])), false)
  assert.equal(result.event.effects.print_jobs[0].station_id, 'caja')
  assert.equal(queue.getAllJobs().length, 1)
})
test('receipt requires accepted payments and separates partial consumption, tip, debt and manual bank evidence', async t => {
  const s = await setup(t)
  assert.equal((await s.send('PRINT_RECEIPT', fields())).code, 'PRINT_NO_ACCEPTED_PAYMENTS')
  await acceptPartial(s)
  const result = await s.send('PRINT_RECEIPT', fields({ expected_financial_revision: 3 }))
  const output = bytes(result).toString()
  assert.match(output, /Tarjeta independiente \(registro manual\)/)
  for (const expected of ['Consumo pagado $50.00', 'Propina recibida $7.00', 'Saldo pendiente $66.00', 'Referencia fixture-folio']) assert.ok(output.includes(expected), expected)
  assert.ok(output.includes('no es autorizacion bancaria'))
  assert.equal(bytes(result).includes(Buffer.from([0x1b, 0x70])), false)
})
test('missing printer, stale revisions, forged bytes and missing/foreign employee permissions fail before commit', async t => {
  const s = await setup(t), before = await s.store.getLastSequence()
  s.configured(false)
  assert.equal((await s.send('PRINT_PRECHECK', fields())).code, 'PRINTER_NOT_CONFIGURED')
  s.configured(true)
  assert.equal((await s.send('PRINT_PRECHECK', fields({ expected_order_revision: 2 }))).code, 'PRINT_REVISION_CONFLICT')
  assert.equal((await s.send('PRINT_PRECHECK', fields({ data_b64: 'forged' }))).code, 'UNTRUSTED_PRINT_FIELDS')
  assert.equal((await s.send('PRINT_PRECHECK', fields(), { ...manager, permissions: [] })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('PRINT_PRECHECK', fields(), { ...manager, id: 'other', permissions: ['imprimir_cuentas'] })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('PRINT_RECEIPT', fields(), { ...manager, expires_at: 0 })).code, 'ACTOR_REQUIRED')
  assert.equal(await s.store.getLastSequence(), before)
  assert.deepEqual(queue.getAllJobs(), [])
})
test('NDJSON failure cannot enqueue a print, and a retry after queue/ACK loss recovers one original job across restart', async t => {
  let s = await setup(t)
  const failed = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC fixture') })
  await assert.rejects(s.send('PRINT_PRECHECK', fields({ command_id: 'stable' })), /ENOSPC/)
  failed.mock.restore()
  assert.equal(queue.getAllJobs().length, 0)
  s.failEnqueue(true)
  await assert.rejects(s.send('PRINT_PRECHECK', fields({ command_id: 'stable' })), /ACK lost/)
  const committed = (await s.store.readAfter(0)).at(-1)
  assert.equal(committed.type, 'PRINT_PRECHECK')
  assert.ok(committed.effects.print_jobs.length)
  s.failEnqueue(false); s = await s.restart()
  await s.handler.recoverPendingEffects()
  const result = await s.send('PRINT_PRECHECK', fields({ command_id: 'stable' }))
  assert.equal(result.duplicate, true)
  assert.equal(result.receipt.sequence, committed.sequence)
  assert.equal(queue.getAllJobs().length, 1)
  assert.deepEqual(queue.getAllJobs().map(j => j.job_id), committed.effects.print_jobs.map(j => j.job_id))
  assert.equal((await s.send('PRINT_PRECHECK', fields({ command_id: 'stable' }), { ...manager, id: 'other', permissions: ['imprimir_cuentas'] })).code, 'PERMISSION_DENIED')
})
test('another terminal requesting the same original recovers the original jobs; uncertain paper is not automatically repeated', async t => {
  let s = await setup(t)
  const original = await s.send('PRINT_PRECHECK', fields()), job = original.event.effects.print_jobs[0]
  queue.markPrinting(job.job_id)
  s = await s.restart()
  assert.equal(queue.getJob(job.job_id).status, 'uncertain')
  const again = await s.send('PRINT_PRECHECK', fields())
  assert.equal(again.result.existing_document, true)
  assert.equal(again.result.print_document.source_command_id, original.event.payload.command_id)
  assert.equal(queue.getAllJobs().length, 1)
  assert.equal(queue.getJob(job.job_id).status, 'uncertain')
})
test('COPY requires manager plus reason, preserves the original financial text and carries a new job identity without drawer bytes', async t => {
  const s = await setup(t)
  await acceptPartial(s)
  const original = await s.send('PRINT_RECEIPT', fields({ expected_financial_revision: 3 }))
  const payload = { source_command_id: original.event.payload.command_id, reason: 'Cliente solicita copia' }
  assert.equal((await s.send('PRINT_COPY', payload, { ...manager, permissions: permissionsFor('cajero') })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('PRINT_COPY', { ...payload, reason: '' })).code, 'PRINT_REASON_REQUIRED')
  const copy = await s.send('PRINT_COPY', payload)
  assert.match(bytes(copy).toString(), /\*\*\* COPIA \*\*\*/)
  assert.match(bytes(copy).toString(), /Cliente solicita copia/)
  assert.match(bytes(copy).toString(), /Consumo pagado \$50.00/)
  assert.notEqual(copy.event.effects.print_jobs[0].job_id, original.event.effects.print_jobs[0].job_id)
  assert.equal(copy.result.print_document.original_command_id, payload.source_command_id)
  assert.equal(bytes(copy).includes(Buffer.from([0x1b, 0x70])), false)
  assert.equal(copy.result.print_request.requested_by, manager.id)
})
test('drawer needs cashier permission, turn and reason; its durable effect pulses one copy and cannot become COPY', async t => {
  const s = await setup(t)
  assert.equal((await s.send('DRAWER_OPEN', { turno_id: 'turn', reason: 'Cambio' }, { ...manager, permissions: permissionsFor('capitan') })).code, 'PERMISSION_DENIED')
  assert.equal((await s.send('DRAWER_OPEN', { turno_id: 'other', reason: 'Cambio' })).code, 'TURNO_MISMATCH')
  assert.equal((await s.send('DRAWER_OPEN', { turno_id: 'turn' })).code, 'PRINT_REASON_REQUIRED')
  const result = await s.send('DRAWER_OPEN', { command_id: 'drawer-stable', turno_id: 'turn', reason: 'Cambio verificado' })
  assert.deepEqual(bytes(result), Buffer.from([0x1b, 0x70, 0, 0x19, 0xfa]))
  assert.equal(result.event.effects.print_jobs[0].copies, 1)
  assert.equal(result.event.effects.print_jobs[0].station_id, 'caja')
  assert.equal((await s.send('PRINT_COPY', { source_command_id: 'drawer-stable', reason: 'No' })).code, 'PRINT_COPY_SOURCE_INVALID')
  assert.equal((await s.send('DRAWER_OPEN', { command_id: 'drawer-stable', turno_id: 'turn', reason: 'Cambio verificado' })).duplicate, true)
  assert.equal(queue.getAllJobs().length, 1)
})
