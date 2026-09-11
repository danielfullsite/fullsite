'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { once } = require('node:events')
const { CoreEventStore } = require('../core/event-store')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CommandHandler } = require('../core/command-handler')
const printer = require('../adapters/printer')
const queue = require('../adapters/print-queue')

for (const drawer of [false, true]) test(`lost ${drawer ? 'drawer' : 'paper'} receipt: replay holds a new episode; old decisions cannot resend`, { timeout: 10000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-restore-print-'))
  const received = []
  const server = net.createServer(socket => {
    socket.on('data', bytes => received.push(bytes))
    socket.on('end', () => socket.end())
    socket.on('error', () => {})
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const filePath = path.join(dir, 'queue.json')
  const connection = { type: 'tcp', host: '127.0.0.1', port: server.address().port }
  const config = { schema_version: 2, printers: [{ printer_id: 'p', name: 'TCP lab', enabled: true, connection,
    station_ids: ['caja'], document_types: ['receipt'], copies: 1, encoding: 'cp850' }] }
  const createStore = async () => {
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson'), processedCommandsPath: path.join(dir, 'commands.ndjson') }))
    await store.load(); return store
  }
  const handler = store => new CommandHandler({ eventStore: store, state: { apply() {} }, wsHub: { async broadcast() {} }, printer, restaurantId: 'test' })
  const commit = (store, id, effects) => store.processCommand({ command_id: id, type: 'PRINT_COMMAND', client_id: 'POS-A', restaurant_id: 'test', payload: { command_id: id } }, { eventType: 'PRINT_QUEUED', buildEffects: () => effects })
  let barrierId = 0
  const barrier = async () => {
    await printer.printToStation('caja', Buffer.from('BARRIER'), 'receipt', { commandId: `barrier-${++barrierId}` })
    const deadline = Date.now() + 2000
    while (Buffer.concat(received).toString().split('BARRIER').length - 1 < barrierId) {
      assert.ok(Date.now() < deadline, 'TCP receiver must observe the drain barrier')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  const byteCount = () => Buffer.concat(received).length
  try {
    printer.init({ printersConfig: config, queueFilePath: filePath })
    let store = await createStore()
    const job = { job_id: 'original', command_id: 'original-command', station_id: 'caja', printer_id: 'p', printer_name: 'TCP lab', connection,
      document_type: drawer ? 'drawer_pulse' : 'receipt', data_b64: (drawer ? Buffer.from([0x1b,0x70,0,0x19,0xfa]) : Buffer.from('ORIGINAL')).toString('base64'), copies: 1 }
    await commit(store, 'original-command', { print_jobs: [job] })
    printer.enqueuePreparedJobs([job]); await barrier()
    assert.equal(queue.getJob(job.job_id).status, 'printed')
    queue.markUncertain(job.job_id, 'simulate lost final acknowledgement')
    const oldDecision = { job_id: job.job_id, command_id: 'old-decision', uncertain_episode_id: queue.getJob(job.job_id).uncertain_episode_id,
      resolution: drawer ? 'retry_pulse' : 'reprint', reason: 'verified by operator', recorded_by: 'manager' }
    const effectKey = drawer ? 'drawer_resolutions' : 'print_resolutions'
    const oldEvent = await commit(store, oldDecision.command_id, { [effectKey]: [oldDecision] })
    const apply = drawer ? printer.applyPreparedDrawerResolution : printer.applyPreparedResolution
    apply(oldDecision, { eventSequence: oldEvent.event.sequence }); await barrier()
    assert.equal(queue.getJob(job.job_id).status, 'printed')
    const beforeRestore = byteCount()

    // Restore only the committed log. It cannot say whether paper/pulse happened.
    fs.unlinkSync(filePath); queue.init({ filePath })
    store = await createStore()
    await handler(store).recoverPendingEffects(); await barrier()
    const restored = queue.getJob(job.job_id)
    assert.equal(restored.status, 'uncertain')
    assert.notEqual(restored.uncertain_episode_id, oldDecision.uncertain_episode_id)
    assert.equal(restored.recovered_before_sequence, oldEvent.event.sequence)
    assert.deepEqual(restored.connection, connection)
    assert.equal(byteCount(), beforeRestore + Buffer.byteLength('BARRIER'))

    // The cutoff and episode survive another restart, and old retry decisions
    // cannot authorize a send in the newly reconstructed queue.
    queue.init({ filePath }); await handler(store).recoverPendingEffects(); await barrier()
    assert.equal(queue.getJob(job.job_id).uncertain_episode_id, restored.uncertain_episode_id)
    assert.equal(byteCount(), beforeRestore + 2 * Buffer.byteLength('BARRIER'))

    const newDecision = { ...oldDecision, command_id: 'new-decision', uncertain_episode_id: restored.uncertain_episode_id }
    await commit(store, newDecision.command_id, { [effectKey]: [newDecision] })
    // Crash after the new authorized commit, before its queue transition.
    await handler(store).recoverPendingEffects(); await barrier()
    assert.equal(queue.getJob(job.job_id).status, 'printed')
    const afterAuthorizedRetry = byteCount()
    assert.ok(afterAuthorizedRetry > beforeRestore + 3 * Buffer.byteLength('BARRIER'))
    queue.init({ filePath }); await handler(store).recoverPendingEffects(); await barrier()
    assert.equal(byteCount(), afterAuthorizedRetry + Buffer.byteLength('BARRIER'))
    assert.equal(queue.getJob(job.job_id).resolution_receipts.length, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('missing receipt on duplicate command is held, while a fresh accepted job remains pending', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-retry-print-'))
  try {
    const filePath = path.join(dir, 'queue.json'); queue.init({ filePath })
    const store = new CoreEventStore(new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson'), processedCommandsPath: path.join(dir, 'commands.ndjson') }))
    await store.load()
    const job = { job_id: 'job', command_id: 'command', station_id: 'caja', printer_id: 'p', connection: { type: 'tcp', host: '127.0.0.1', port: 1 }, data_b64: 'dGVzdA==', copies: 1 }
    const adapter = { prepareJobs: () => [job], enqueuePreparedJobs: (jobs, options) => queue.enqueueMany(jobs, options) }
    const handler = new CommandHandler({ eventStore: store, state: { apply() {} }, wsHub: { async broadcast() {} }, printer: adapter, restaurantId: 'test' })
    const message = { payload: { command_type: 'PRINT_COMMAND', command_id: 'command', station: 'caja', data_b64: 'dGVzdA==' } }
    await handler.handle(message, 'POS-A')
    assert.equal(queue.getJob('job').status, 'pending')
    queue.markPrinted('job'); fs.unlinkSync(filePath); queue.init({ filePath })
    const retry = await handler.handle(message, 'POS-A')
    assert.equal(retry.duplicate, true)
    assert.equal(queue.getJob('job').status, 'uncertain')
    assert.equal(queue.getPendingJobs().length, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
