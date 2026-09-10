'use strict'
const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { once } = require('events')
const { NdjsonEventStore } = require('../adapters/storage/ndjson')
const { CoreEventStore } = require('../core/event-store')
const { CommandHandler } = require('../core/command-handler')
const queue = require('../adapters/print-queue')

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-durable-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
const command = (id = 'order-1') => ({ command_id: id, type: 'ORDER_SENT', client_id: 'POS-A', restaurant_id: 'test', payload: { order_id: 'order', items: [{ id: 'item', name: 'Sopa' }] } })
const opts = { eventType: 'ORDER_SENT' }
const storage = () => new NdjsonEventStore({ eventLogPath: path.join(dir, 'events.ndjson'), processedCommandsPath: path.join(dir, 'commands.ndjson') })
const printJob = (overrides = {}) => ({ job_id: 'job', command_id: 'print-1', station_id: 'cocina', printer_id: 'p1', printer_name: 'Test', connection: { type: 'tcp', host: '127.0.0.1', port: 1 }, data_b64: 'dGVzdA==', copies: 1, ...overrides })

// Failure injection targets actual fs writes, retaining the real store, files and
// process boundaries. These tests do not contact cloud services or physical devices.
test('concurrent retries all reject ENOSPC; no false duplicate ACK or sequence advance', async t => {
  const raw = storage(); const core = new CoreEventStore(raw); await core.load()
  const original = fs.writeSync
  const mock = t.mock.method(fs, 'writeSync', () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) })
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => core.processCommand(command(), opts)))
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.code === 'ENOSPC'))
  assert.equal(await core.getLastSequence(), 0)
  assert.equal(await core.unsyncedCount(), 0)
  mock.mock.restore()
  assert.equal(fs.writeSync, original)
  const success = await core.processCommand(command(), opts)
  assert.equal(success.event.sequence, 1)
  assert.equal((await core.readAfter(0)).length, 1)
})

test('receipt is derived from committed event even when legacy command index is absent or lying', async () => {
  let raw = storage(); await raw.load()
  const cmd = command()
  await raw.append([{ id: cmd.command_id, type: 'ORDER_SENT', client_id: cmd.client_id, restaurant_id: cmd.restaurant_id, ts: 123, payload: cmd.payload }])
  fs.writeFileSync(path.join(dir, 'commands.ndjson'), JSON.stringify({ key: 'never-committed', eventId: 'x', sequence: 900 }) + '\n')
  raw = storage(); const core = new CoreEventStore(raw); await core.load()
  const result = await core.processCommand(cmd, opts)
  assert.equal(result.duplicate, true)
  assert.equal(result.event.ts, 123)
  assert.equal(await raw.hasProcessedCommand('never-committed'), false)
  assert.equal((await core.readAfter(0)).length, 1)
})

test('same ID with changed business content rejects both concurrent and post-restart reuse', async () => {
  let core = new CoreEventStore(storage()); await core.load()
  const original = core.processCommand(command(), opts)
  await assert.rejects(core.processCommand({ ...command(), payload: { amount: 900 } }, opts), /IDEMPOTENCY_KEY_REUSED/)
  await original
  core = new CoreEventStore(storage()); await core.load()
  await assert.rejects(core.processCommand({ ...command(), restaurant_id: 'another' }, opts), /IDEMPOTENCY_KEY_REUSED/)
  assert.equal((await core.readAfter(0)).length, 1)
})

test('failed fsync rolls back the whole multi-event transaction without consuming sequence', async t => {
  const raw = storage(); await raw.load()
  const realSync = fs.fsyncSync; let calls = 0
  const mock = t.mock.method(fs, 'fsyncSync', fd => { if (++calls === 1) throw new Error('injected fsync failure'); return realSync(fd) })
  await assert.rejects(raw.append([{ id: 'a' }, { id: 'b' }]), /injected/)
  mock.mock.restore()
  assert.equal(await raw.getLastSequence(), 0)
  const rebooted = storage(); await rebooted.load()
  assert.deepEqual(await rebooted.readAfter(0), [])
  assert.deepEqual((await rebooted.append([{ id: 'a' }, { id: 'b' }])).sequences, [1, 2])
})

test('failed rollback makes the store unavailable instead of accepting later commands', async t => {
  const raw = storage(); await raw.load()
  const mock = t.mock.method(fs, 'fsyncSync', () => { throw new Error('disk offline') })
  await assert.rejects(raw.append([{ id: 'a' }]), /disk offline/)
  mock.mock.restore()
  await assert.rejects(raw.append([{ id: 'b' }]), /EVENT_STORE_UNAVAILABLE/)
  await assert.rejects(raw.readAfter(0), /EVENT_STORE_UNAVAILABLE/)
})

test('a torn tail is quarantined while committed corruption refuses all replay', async () => {
  const raw = storage(); await raw.load(); await raw.append([{ id: 'a' }])
  fs.appendFileSync(path.join(dir, 'events.ndjson'), '{"transaction_version":1,"events":[')
  const restarted = storage(); await restarted.load()
  assert.equal(await restarted.getLastSequence(), 1)
  assert.ok(fs.existsSync(path.join(dir, 'events.ndjson.torn-tail')))
  await restarted.append([{ id: 'b' }])
  const data = fs.readFileSync(path.join(dir, 'events.ndjson'), 'utf8').replace('"id":"a"', '"id":"z"')
  fs.writeFileSync(path.join(dir, 'events.ndjson'), data)
  await assert.rejects(storage().load(), /EVENT_LOG_CORRUPT/)
})

test('failed synced rewrite does not acknowledge unsynced data or truncate committed log', async t => {
  const raw = storage(); await raw.load(); await raw.append([{ id: 'a' }])
  const mock = t.mock.method(fs, 'renameSync', () => { throw new Error('rename denied') })
  await assert.rejects(raw.markSynced([1]), /rename denied/)
  mock.mock.restore()
  const rebooted = storage(); await rebooted.load()
  assert.equal(await rebooted.unsyncedCount(), 1)
  await rebooted.markSynced([1])
  const after = storage(); await after.load()
  assert.equal(await after.unsyncedCount(), 0)
  assert.equal(await after.hasProcessedCommand('a'), true)
})

test('SIGKILL after commit, before caller ACK: restart returns original receipt once', { timeout: 10000 }, async () => {
  const script = `
    const { CoreEventStore } = require(${JSON.stringify(require.resolve('../core/event-store'))});
    const { NdjsonEventStore } = require(${JSON.stringify(require.resolve('../adapters/storage/ndjson'))});
    (async () => {
      const core = new CoreEventStore(new NdjsonEventStore({ eventLogPath: process.argv[1] }));
      await core.load(); const result = await core.processCommand(${JSON.stringify(command())}, ${JSON.stringify(opts)});
      process.stdout.write(JSON.stringify(result) + '\\n'); setInterval(() => {}, 1000);
    })().catch(e => { process.stderr.write(e.stack); process.exit(1) });`
  const child = spawn(process.execPath, ['-e', script, path.join(dir, 'events.ndjson')], { stdio: ['ignore', 'pipe', 'pipe'] })
  const first = await Promise.race([
    once(child.stdout, 'data').then(([bytes]) => JSON.parse(bytes.toString())),
    once(child, 'exit').then(([code]) => { throw new Error(`child exited early ${code}`) }),
  ])
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
  const core = new CoreEventStore(storage()); await core.load()
  const retry = await core.processCommand(command(), opts)
  assert.equal(retry.duplicate, true)
  assert.deepEqual(retry.event, first.event)
  assert.equal((await core.readAfter(0)).length, 1)
})

test('print enqueue disk full throws and neither memory nor disk claims a job', t => {
  const filePath = path.join(dir, 'queue.json'); queue.init({ filePath })
  const mock = t.mock.method(fs, 'writeSync', () => { throw new Error('ENOSPC') })
  assert.throws(() => queue.enqueue(printJob()), /ENOSPC/)
  assert.deepEqual(queue.getAllJobs(), [])
  mock.mock.restore()
  queue.init({ filePath })
  assert.deepEqual(queue.getAllJobs(), [])
  queue.enqueue(printJob())
  assert.equal(queue.getPendingJobs().length, 1)
})

test('printing across restart becomes uncertain, survives GC and never auto-retries', () => {
  const filePath = path.join(dir, 'queue.json'); queue.init({ filePath })
  queue.enqueue(printJob()); queue.markPrinting('job')
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  persisted[0].created_at = '2000-01-01T00:00:00.000Z'; fs.writeFileSync(filePath, JSON.stringify(persisted))
  queue.init({ filePath })
  assert.equal(queue.getUncertainJobs().length, 1)
  assert.equal(queue.getPendingJobs().length, 0)
  assert.equal(queue.canRetry('job'), false)
  assert.deepEqual(queue.retryRecoverableJobs(), [])
  assert.equal(queue.resolveUncertain('job', 'reprint'), true)
  assert.equal(queue.getJob('job').reprint, true)
  assert.equal(queue.getPendingJobs().length, 1)
})

test('stable job identity survives restart, printer reconfiguration and completed receipt GC', () => {
  const filePath = path.join(dir, 'queue.json'); queue.init({ filePath })
  queue.enqueue(printJob()); queue.markPrinting('job'); queue.markPrinted('job')
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  persisted[0].created_at = '2000-01-01T00:00:00.000Z'; fs.writeFileSync(filePath, JSON.stringify(persisted))
  queue.init({ filePath })
  assert.equal(queue.enqueue(printJob({ connection: { type: 'tcp', host: 'new-printer' } })), 'job')
  assert.equal(queue.getJob('job').connection.host, '127.0.0.1')
  assert.equal(queue.getJob('job').status, 'printed')
  assert.equal(queue.getAllJobs().length, 1)
})

test('corrupt print queue fails closed instead of silently losing pending jobs', () => {
  const filePath = path.join(dir, 'queue.json'); fs.writeFileSync(filePath, '{ broken')
  assert.throws(() => queue.init({ filePath }), SyntaxError)
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{ broken')
})

test('event commit before queue failure: restart restores original prepared job before ACK', async () => {
  const filePath = path.join(dir, 'queue.json'); queue.init({ filePath })
  let fail = true
  const printer = {
    prepareJobs: () => [printJob()],
    enqueuePreparedJobs: (jobs, options) => { if (fail) throw new Error('queue ENOSPC'); return queue.enqueueMany(jobs, options) },
  }
  let core = new CoreEventStore(storage()); await core.load()
  const makeHandler = () => new CommandHandler({ eventStore: core, state: { apply() {} }, wsHub: { async broadcast() {} }, printer, restaurantId: 'test' })
  const payload = { command_type: 'PRINT_COMMAND', command_id: 'print-1', station: 'cocina', data_b64: 'dGVzdA==' }
  await assert.rejects(makeHandler().handle({ payload }, 'POS-A'), /queue ENOSPC/)
  assert.equal((await core.readAfter(0)).length, 1)
  assert.equal(queue.getAllJobs().length, 0)
  core = new CoreEventStore(storage()); await core.load(); fail = false
  // The route changes after restart; recover must use the event's old snapshot.
  printer.prepareJobs = () => { throw new Error('new config unavailable') }
  const handler = makeHandler(); await handler.recoverPendingEffects()
  const retry = await handler.handle({ payload }, 'POS-A')
  assert.equal(retry.duplicate, true)
  assert.equal(queue.getAllJobs().length, 1)
  assert.equal(queue.getJob('job').connection.host, '127.0.0.1')
  assert.equal(queue.getJob('job').status, 'uncertain')
  assert.equal(queue.getPendingJobs().length, 0)
})

test('real TCP adapter sends configured copies once despite retry and config change', { timeout: 10000 }, async () => {
  const net = require('net')
  const printer = require('../adapters/printer')
  const received = []
  let receiveAll
  const receivedAll = new Promise(resolve => { receiveAll = resolve })
  const server = net.createServer(socket => { socket.on('data', bytes => { received.push(bytes.toString()); if (received.join('').length >= 8) receiveAll() }); socket.on('end', () => socket.end()) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const filePath = path.join(dir, 'queue.json')
  const config = { schema_version: 2, printers: [{ printer_id: 'p1', name: 'Loopback', enabled: true, connection: { type: 'tcp', host: '127.0.0.1', port: server.address().port }, station_ids: ['cocina'], document_types: ['receipt'], copies: 2, encoding: 'cp850' }] }
  try {
    printer.init({ printersConfig: config, queueFilePath: filePath })
    const prepared = printer.prepareJobs('cocina', Buffer.from('TEST'), 'receipt', { commandId: 'tcp-command' })
    await printer.printToStation('cocina', Buffer.from('TEST'), 'receipt', { commandId: 'tcp-command' })
    await printer.printToStation('cocina', Buffer.from('TEST'), 'receipt', { commandId: 'tcp-command' })
    assert.equal(queue.getJob(prepared[0].job_id).copies_printed, 2)
    await receivedAll
    assert.equal(received.join(''), 'TESTTEST')
    printer.init({ printersConfig: null, queueFilePath: filePath })
    printer.enqueuePreparedJobs(prepared)
    assert.equal(queue.getAllJobs().length, 1)
    assert.equal(queue.getAllJobs()[0].status, 'printed')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('SIGKILL after real TCP send leaves an uncertain job, never an automatic second send', { timeout: 10000 }, async () => {
  const net = require('net')
  const received = []
  const server = net.createServer(socket => {
    socket.on('data', b => received.push(b.toString()))
    socket.on('end', () => socket.end())
    // La impresora de mentira tiene que sobrevivir a que el cliente muera de golpe,
    // que es EXACTAMENTE lo que esta prueba provoca. En Windows un proceso muerto
    // cierra el socket con RST y aqui llega ECONNRESET; sin este manejador, la
    // excepcion escapa y tumba la prueba. En Unix el cierre es limpio y no se vio.
    //
    // Comprobado en CI el 2026-09-09 (run 34318404023): era el ULTIMO de los cinco
    // fallos de Windows, y el unico que resulto ser de la prueba y no del POS.
    socket.on('error', () => {})
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const queuePath = path.join(dir, 'queue.json')
  const config = { schema_version: 2, printers: [{ printer_id: 'p1', name: 'Loopback', enabled: true, connection: { type: 'tcp', host: '127.0.0.1', port: server.address().port }, station_ids: ['cocina'], document_types: ['receipt'], copies: 1, encoding: 'cp850' }] }
  const script = `
    const printer = require(${JSON.stringify(require.resolve('../adapters/printer'))});
    const queue = require(${JSON.stringify(require.resolve('../adapters/print-queue'))});
    printer.init({ printersConfig: ${JSON.stringify(config)}, queueFilePath: process.argv[1] });
    queue.markCopyPrinted = () => process.kill(process.pid, 'SIGKILL');
    printer.printToStation('cocina', Buffer.from('ONCE'), 'receipt', {commandId:'crash-print'}).catch(e => { process.stderr.write(e.stack); process.exit(1) });`
  try {
    const child = spawn(process.execPath, ['-e', script, queuePath], { stdio: ['ignore', 'pipe', 'pipe'] })
    const [code, signal] = await once(child, 'exit')
    // "Murio de golpe" se ve distinto segun el sistema, y lo que esta prueba defiende no
    // es el mecanismo sino la consecuencia. En Unix llega signal='SIGKILL' y code=null;
    // en Windows NO hay señales POSIX, asi que `process.kill(pid,'SIGKILL')` termina el
    // proceso con TerminateProcess y llega signal=null con un code distinto de 0.
    //
    // Lo que NO se afloja: el proceso tiene que haber muerto sin salir limpio. Un exit 0
    // significaria que el hijo alcanzo a terminar por su cuenta, y entonces la prueba no
    // estaria probando nada -- de ahi el rechazo explicito.
    assert.ok(signal === 'SIGKILL' || signal === null, `salida inesperada: signal=${signal}`)
    assert.notEqual(code, 0, 'el hijo no debio salir limpio: la prueba simula una muerte abrupta')
    const printer = require('../adapters/printer')
    printer.init({ printersConfig: config, queueFilePath: queuePath })
    assert.equal(printer.getUncertainJobs().length, 1)
    assert.equal(printer.getPendingJobs().length, 0)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(received.join(''), 'ONCE')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
