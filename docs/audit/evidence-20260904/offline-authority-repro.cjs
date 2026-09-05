'use strict'
// Read-only candidate audit. Only synthetic data, temporary files and loopback HTTP/WS.
// These checks confirm observed defects; a passing assertion is NOT a product pass.
// Run: node /Users/danielrg/fullsite/.codex/worktrees/architecture-closure-20260904/docs/audit/evidence-20260904/offline-authority-repro.cjs
const candidate = '/Users/danielrg/fullsite/.codex/worktrees/architecture-source-de904d71'
if (require('node:child_process').execFileSync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== 'de904d71ed0288375bd3a752579d2e2929df61c0') throw new Error('Candidate SHA changed; revalidate before running this diagnostic.')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const mod = rel => require(path.join(candidate, 'electron-app', rel))
const { conectarConLaCaja } = mod('local-server/core/enlace-con-caja')
const { RestaurantState } = mod('local-server/core/state')
const { CoreEventStore } = mod('local-server/core/event-store')
const { NdjsonEventStore } = mod('local-server/adapters/storage/ndjson')
const printQueue = mod('local-server/adapters/print-queue')
const { startLocalServer } = mod('local-server')
const { PROTOCOL_VERSION } = mod('local-server/protocol')
const WebSocket = mod('node_modules/ws')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-authority-audit-'))
const report = (id, observation) => console.log('REPRO_CONFIRMED', id, JSON.stringify(observation))
let server, socket
const deadline = setTimeout(() => { console.error('AUDIT_TIMEOUT'); process.exit(2) }, 20000)

async function main() {
  console.log('Candidate de904d71ed0288375bd3a752579d2e2929df61c0; no candidate edits')
  class FakeWS extends EventEmitter {
    static sockets = []
    constructor() { super(); FakeWS.sockets.push(this) }
    send(raw) { this.sent = JSON.parse(raw) }
    close() {}
  }
  let persistedCursor = -1
  const bootReplica = () => {
    const state = new RestaurantState()
    const link = conectarConLaCaja({
      cajaUrl: 'ws://127.0.0.1:1', serverId: 'audit-pos2', restaurantId: 'audit',
      leerCursor: () => persistedCursor, guardarCursor: n => { persistedCursor = n },
      alRecibirEvento: e => state.apply(e), wsInyectado: FakeWS,
    })
    const ws = FakeWS.sockets.at(-1)
    ws.emit('open')
    return { state, link, ws }
  }
  const emit = (ws, message) => ws.emit('message', Buffer.from(JSON.stringify(message)))
  const initial = bootReplica()
  emit(initial.ws, { type: 'SNAPSHOT', sequence: 10, payload: {
    state: { kds_orders: [{ id: 'preexisting-order', items: '[]' }] }, deltas: [],
  } })
  assert.equal(initial.link.cursor(), 10)
  assert.equal(initial.state.toSnapshot().kds_orders.length, 0)
  report('SNAPSHOT_STATE_IGNORED', { cajaOrders: 1, replicaOrders: 0, persistedCursor })
  emit(initial.ws, { type: 'DELTA', sequence: 11, payload: { event: {
    sequence: 11, type: 'ORDER_SENT', payload: { order_id: 'received-live', mesa: 3, items: [{ nombre: 'synthetic' }] },
  } } })
  assert.equal(initial.state.toSnapshot().kds_orders.length, 1)
  initial.link.detener()
  // The actual wiring applies upstream events in memory only (index.js:872-876).
  // Startup rebuilds only the local event log, so no upstream events restore here.
  const reboot = bootReplica()
  emit(reboot.ws, { type: 'SNAPSHOT', sequence: 11, payload: {
    state: { kds_orders: [{ id: 'preexisting-order' }, { id: 'received-live' }] }, deltas: [],
  } })
  assert.equal(reboot.ws.sent.last_sequence, 11)
  assert.equal(reboot.state.toSnapshot().kds_orders.length, 0)
  report('REPLICA_RESTART_LOSES_RECEIVED_ORDERS', { requestedCursor: 11, cajaOrders: 2, replicaOrders: 0 })
  reboot.link.detener()

  let writes = 0
  const failingStore = new CoreEventStore({
    hasProcessedCommand: async () => false,
    append: async () => { await new Promise(r => setTimeout(r, 10)); throw new Error('simulated ENOSPC') },
    saveProcessedCommand: async () => { writes++ },
  })
  const command = { command_id: 'same-synthetic-id', restaurant_id: 'audit', client_id: 'audit', payload: { order_id: 'a' } }
  const attempts = await Promise.allSettled([
    failingStore.processCommand(command, { eventType: 'ORDER_SENT' }),
    failingStore.processCommand(command, { eventType: 'ORDER_SENT' }),
  ])
  assert.equal(attempts[0].status, 'rejected')
  assert.equal(attempts[1].status, 'fulfilled')
  assert.equal(attempts[1].value.duplicate, true)
  assert.equal(writes, 0)
  report('FAILED_PERSISTENCE_RETRY_ACKS_DUPLICATE', { original: 'rejected ENOSPC', retry: attempts[1].value, persisted: writes })

  const opts = { eventLogPath: path.join(tmp, 'events.ndjson'), processedCommandsPath: path.join(tmp, 'commands.ndjson') }
  const first = new NdjsonEventStore(opts)
  await first.load()
  // Simulate restart exactly between the two real writes: event appended, processed index absent.
  await first.append([{ id: command.command_id, type: 'ORDER_SENT', ts: 1, client_id: 'audit', restaurant_id: 'audit', payload: command.payload }])
  const reopened = new CoreEventStore(new NdjsonEventStore(opts))
  await reopened.load()
  const retry = await reopened.processCommand(command, { eventType: 'ORDER_SENT' })
  const rows = await reopened.readAfter(0)
  assert.equal(retry.duplicate, false)
  assert.equal(rows.filter(e => e.id === command.command_id).length, 2)
  report('EVENT_AND_DEDUP_INDEX_NOT_ATOMIC', { injectedCrashBoundary: 'after event append, before dedup index', sameIdEventsAfterRetry: 2 })

  const queuePath = path.join(tmp, 'print-queue.json')
  printQueue.init({ filePath: queuePath })
  const jobId = printQueue.enqueue({ station_id: 'cocina', printer_id: 'synthetic', printer_name: 'synthetic', connection: { type: 'tcp', host: '127.0.0.1', port: 1 }, document_type: 'test', data_b64: 'dGVzdA==' })
  printQueue.markPrinting(jobId)
  printQueue.init({ filePath: queuePath })
  assert.equal(printQueue.getJob(jobId).status, 'printing')
  assert.equal(printQueue.getPendingJobs().length, 0)
  assert.equal(printQueue.getRecoverableJobs().length, 0)
  report('PRINTING_JOB_NOT_RECOVERED_AFTER_RESTART', { restoredStatus: 'printing', pending: 0, recoverable: 0, physicalPrinterUsed: false })

  const oldNow = Date.now
  const state = new RestaurantState()
  const at = oldNow()
  state.apply({ type: 'ORDER_SENT', payload: { order_id: 'local-not-cloud', mesa: 8, items: [{ nombre: 'synthetic' }] } })
  try {
    Date.now = () => at + 46000
    state.apply({ type: 'STATE_SYNC', payload: { mesas: [], kds_queue: [], turno: null } })
  } finally { Date.now = oldNow }
  assert.equal(state.toSnapshot().kds_orders.length, 0)
  report('CLOUD_POLL_CAN_REMOVE_UNSYNCED_LOCAL_ORDER', { injectedAgeSeconds: 46, cloudSnapshotOrders: 0, localOrdersAfterPoll: 0 })

  const dataDir = path.join(tmp, 'pedro')
  fs.mkdirSync(dataDir)
  const cfg = { restaurantId: 'audit-synthetic', terminalRole: 'server_pos', supabaseUrl: '', supabaseKey: '', printersConfig: null }
  // port 0 avoids any known port and disables the mDNS announcement (requires nonzero port).
  // Empty URL/key disable cloud poll and telemetry; all requests below target 127.0.0.1.
  server = await startLocalServer({ dataDir, port: 0, config: cfg })
  const port = server.httpServer.address().port
  const base = `http://127.0.0.1:${port}`
  const bare = await fetch(base + '/state', { signal: AbortSignal.timeout(1000) })
  const html = await (await fetch(base + '/kds', { signal: AbortSignal.timeout(1000) })).text()
  assert.equal(Boolean(cfg.lanSecret), true)
  assert.equal(bare.status, 401)
  assert.equal(html.includes('x-fullsite-lan'), false)
  report('AUTOGENERATED_SECRET_BLOCKS_UNCREDENTIALED_KDS', { secretGenerated: true, stateStatus: 401, kdsHtmlContainsCredentialHeader: false })
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject) })
  const response = new Promise(resolve => socket.once('message', raw => resolve(JSON.parse(raw.toString()))))
  socket.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'COMMAND', restaurant_id: 'audit-synthetic', payload: {
    command_id: 'unauth-local-test', command_type: 'ORDER_SENT', order_id: 'unauth-local-test', mesa: 1, items: [{ nombre: 'synthetic' }],
  } }))
  const ack = await response
  assert.equal(ack.type, 'ACK')
  assert.equal(server.state.toSnapshot().kds_orders.some(x => x.id === 'unauth-local-test'), true)
  report('WEBSOCKET_BYPASSES_HTTP_LAN_AUTH', { subscribed: false, credentialSent: false, response: ack.type, insertedOrder: true })
  console.log('8 observed failure modes confirmed; no UI, Windows, hardware, cloud or production certification claimed.')
}

main().then(() => finish(0), err => { console.error(err); finish(1) })
function finish(code) {
  try { socket?.terminate() } catch {}
  try { server?.close() } catch {}
  clearTimeout(deadline)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(code)
}
