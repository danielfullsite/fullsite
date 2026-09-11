'use strict'
const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const { RestaurantState } = require('../core/state')
const { handleAuthenticatedCommand } = require('../core/command-authority')
const { permissionsFor } = require('../core/actor-authority')
const queue = require('../adapters/print-queue')
const actor = { id: 'operator', permissions: permissionsFor('admin'), expires_at: Date.now() + 3600000 }
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-print-runtime-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let failQueue = false, route = 'original-printer'
  const printer = {
    prepareJobs(station, bytes, type, options) { return [{ job_id: options.commandId, command_id: options.commandId,
      station_id: station, printer_id: route, printer_name: route, connection: { type: 'tcp', host: '127.0.0.1', port: 9100 },
      data_b64: bytes.toString('base64'), document_type: type, copies: 1 }] },
    enqueuePreparedJobs(jobs) { if (failQueue) throw new Error('queue disk full'); return queue.enqueueMany(jobs) },
    getJob: queue.getJob,
    applyPreparedResolution(effect) { if (failQueue) throw new Error('queue disk full'); return queue.applyPreparedResolution(effect) },
  }
  let counter = 0
  async function restart() {
    queue.init({ filePath: path.join(dir, 'queue.json') })
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson') })); await store.load()
    const state = new RestaurantState({ localAuthorityEnabled: true })
    for (const event of await store.readAfter(0)) state.apply(event)
    const handler = new CommandHandler({ eventStore: store, state, wsHub: { async broadcast() {} }, printer,
      restaurantId: 'lab', localAuthorityEnabled: true, catalogStore: { read: () => ({ catalog: { config: { display_name: 'Lab' } } }) } })
    const send = (type, fields = {}, verifiedActor = actor) => handler.handle({ restaurant_id: 'lab', payload: {
      command_id: `print-${++counter}`, command_type: type, ...fields,
    } }, 'terminal', { actor: verifiedActor })
    return { store, state, handler, send, restart, setFailure: value => { failQueue = value }, changeRoute: value => { route = value } }
  }
  const s = await restart()
  // Seed a committed canonical account with an accepted partial payment and an
  // unresolved reservation. Printing must leave both aggregates byte-identical.
  const order = { id: 'order', order_id: 'order', authority: 'caja', turno_id: 'turn', created_by: actor.id,
    order_revision: 2, mesa: 1, status: 'enviada', payment_status: 'pendiente', subtotal_cents: 10000,
    iva_cents: 1600, total_cents: 11600, total: 116, saldo: 86, items: JSON.stringify([
      { id: 'line', nombre: 'Café', cantidad: 2, sent_quantity: 2, total_cents: 10000, modificadores: ['Caliente'] },
    ]) }
  const finance = { order_id: 'order', turno_id: 'turn', currency: 'MXN', revision: 4, order_revision: 2,
    total_cents: 11600, paid_cents: 3000, reserved_cents: 1000, balance_cents: 8600, status: 'open',
    accounts: [{ account_id: 'full', total_cents: 11600, paid_cents: 3000, reserved_cents: 1000, balance_cents: 8600 }],
    payments: [{ payment_id: 'accepted', account_id: 'full', status: 'accepted', method: 'cash', amount_cents: 3000,
      evidence: { kind: 'cash_received', received_by: actor.id, received_cents: 5000 }, change_cents: 2000 },
    { payment_id: 'unknown', account_id: 'full', status: 'unknown', method: 'external', amount_cents: 1000 }] }
  const seeded = await s.store.processCommand({ command_id: 'seed', type: 'ORDER_SAVE', restaurant_id: 'lab', payload: { command_id: 'seed' } },
    { eventType: 'ORDER_SAVE', buildResult: () => ({ operational_order: order, financial_order: finance }) })
  s.state.apply(seeded.event)
  return s
}
const fields = { order_id: 'order', expected_revision: 2, expected_financial_revision: 4 }
test('durable partial receipt preserves money, survives restart, and deliberate copies have distinct marked documents', async t => {
  let s = await setup(t)
  const before = { order: s.state.getOrder('order'), finance: s.state.getFinancialOrder('order') }
  const command = { ...fields, payment_id: 'accepted', command_id: 'original' }
  const result = await s.send('PAYMENT_RECEIPT_PRINT', command)
  assert.ok(result.event, JSON.stringify(result)); assert.equal(queue.getAllJobs().length, 1)
  assert.equal(result.result.print_document.content.payment.change_cents, 2000)
  assert.deepEqual(s.state.getOrder('order'), before.order); assert.deepEqual(s.state.getFinancialOrder('order'), before.finance)
  s = await s.restart(); await s.handler.recoverPendingEffects()
  assert.equal((await s.send('PAYMENT_RECEIPT_PRINT', command)).duplicate, true)
  assert.equal((await s.send('PAYMENT_RECEIPT_PRINT', { ...fields, payment_id: 'accepted' })).code, 'PRINT_COPY_REQUIRED')
  const copy = await s.send('PAYMENT_RECEIPT_PRINT', { ...fields, payment_id: 'accepted', original_document_id: 'original', reason: 'Copia solicitada' })
  assert.ok(copy.event, JSON.stringify(copy)); assert.equal(queue.getAllJobs().length, 2)
  assert.deepEqual(copy.result.print_document.content, result.result.print_document.content)
  assert.match(Buffer.from(copy.event.effects.print_jobs[0].data_b64, 'base64').toString(), /COPIA/)
  const mirror = new RestaurantState(); mirror.hidratarDesdeSnapshot(s.state.toSnapshot())
  assert.deepEqual(mirror.getPrintDocuments(), s.state.getPrintDocuments())
  assert.deepEqual(mirror.getCanonicalPrintJob('original'), s.state.getCanonicalPrintJob('original'))
  assert.deepEqual(s.state.getFinancialOrder('order'), before.finance)
})
test('queue failure after document commit recovers original bytes and route after restart without another document', async t => {
  let s = await setup(t); s.setFailure(true)
  const command = { ...fields, command_id: 'precheck' }
  await assert.rejects(s.send('ORDER_PRECHECK_PRINT', command), /disk full/)
  assert.equal(s.state.getPrintDocuments().length, 1); assert.equal(queue.getAllJobs().length, 0)
  s.setFailure(false); s.changeRoute('replacement-printer'); s = await s.restart()
  await s.handler.recoverPendingEffects()
  assert.equal(queue.getAllJobs()[0].printer_id, 'original-printer')
  assert.equal((await s.send('ORDER_PRECHECK_PRINT', command)).duplicate, true)
  assert.equal(s.state.getPrintDocuments().length, 1); assert.equal(queue.getAllJobs().length, 1)
})
test('committed uncertain resolution recovers after queue failure and old replay never resolves a newer episode', async t => {
  let s = await setup(t)
  await s.send('ORDER_PRECHECK_PRINT', { ...fields, command_id: 'job' })
  queue.markUncertain('job', 'lost during send')
  const originalEpisode = queue.getJob('job').uncertain_episode_id
  const command = { command_id: 'resolution', job_id: 'job', uncertain_episode_id: originalEpisode, resolution: 'reprint', reason: 'Falta papel' }
  s.setFailure(true); await assert.rejects(s.send('PRINT_UNCERTAIN_RESOLVE', command), /disk full/)
  assert.equal(queue.getJob('job').status, 'uncertain')
  const committedSequence = await s.store.getLastSequence()
  assert.equal((await s.send('PRINT_UNCERTAIN_RESOLVE', { ...command, command_id: 'different-resolution', resolution: 'printed' })).code, 'PRINT_EPISODE_ALREADY_RESOLVED')
  assert.equal(await s.store.getLastSequence(), committedSequence)
  const mirror = new RestaurantState(); mirror.hidratarDesdeSnapshot(s.state.toSnapshot())
  assert.equal(mirror.getPrintResolution('job', originalEpisode).command_id, 'resolution')
  s.setFailure(false); s = await s.restart(); await s.handler.recoverPendingEffects()
  assert.equal(queue.getJob('job').status, 'pending')
  queue.markUncertain('job', 'second interrupted send')
  const nextEpisode = queue.getJob('job').uncertain_episode_id
  s = await s.restart(); await s.handler.recoverPendingEffects()
  assert.equal((await s.send('PRINT_UNCERTAIN_RESOLVE', command)).duplicate, true)
  assert.equal(queue.getJob('job').uncertain_episode_id, nextEpisode); assert.equal(queue.getJob('job').status, 'uncertain')
})
test('transport requires a verified actor for new print commands and rechecks permission for duplicate receipts', async t => {
  const s = await setup(t), payload = { command_type: 'ORDER_PRECHECK_PRINT', command_id: 'authorized', ...fields }
  const auth = token => { assert.equal(token, 'signed'); return actor }
  const denied = await handleAuthenticatedCommand({ cmdHandler: s.handler, msg: { payload }, clientId: 't' })
  assert.equal(denied.code, 'ACTOR_REQUIRED')
  assert.ok((await handleAuthenticatedCommand({ cmdHandler: s.handler, msg: { payload }, clientId: 't', actorToken: 'signed', actorAuthority: { verify: auth } })).event)
  assert.equal((await s.send('ORDER_PRECHECK_PRINT', payload, { ...actor, permissions: [] })).code, 'PERMISSION_DENIED')
  assert.equal(queue.getAllJobs().length, 1)
})
test('legacy print job cannot create a resolution that cloud cannot reconcile', async t => {
  const s = await setup(t)
  queue.enqueue({ job_id: 'legacy', command_id: 'old-raw-print', station_id: 'caja', printer_id: 'p',
    connection: { type: 'tcp', host: '127.0.0.1', port: 9100 }, data_b64: Buffer.from('legacy').toString('base64'), copies: 1 })
  queue.markUncertain('legacy', 'old printer send')
  const sequence = await s.store.getLastSequence()
  const rejected = await s.send('PRINT_UNCERTAIN_RESOLVE', { job_id: 'legacy', uncertain_episode_id: queue.getJob('legacy').uncertain_episode_id,
    resolution: 'printed', reason: 'Verificación de archivo antiguo' })
  assert.equal(rejected.code, 'PRINT_LEGACY_RECONCILIATION_REQUIRED')
  assert.equal(await s.store.getLastSequence(), sequence)
  assert.equal(queue.getJob('legacy').status, 'uncertain')
})
