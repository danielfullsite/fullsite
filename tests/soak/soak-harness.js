'use strict'
// ─── POS Bridge Soak-Test Harness ─────────────────────────────────────────────
// Exercises electron-app/local-server for N minutes with simulated restaurant
// traffic (2 POS + 1 KDS over the real WS protocol) plus fault injection
// (SIGKILL, graceful restart, WS network flaps, printer outages), then verifies
// zero data loss and zero duplicates from the on-disk artifacts.
//
// Run:   node tests/soak/soak-harness.js --minutes 240
// Smoke: node tests/soak/soak-harness.js --minutes 5
//
// Exit code 0 only if every invariant holds. Machine-readable results in
// tests/soak/soak-report.json; progress in tests/soak/soak-progress.log.
//
// Everything on the wire uses the real protocol (protocol.js):
//   SUBSCRIBE → SNAPSHOT{state,deltas} ; COMMAND → ACK{duplicate?}|REJECT ; DELTA
// Command types used (all real, from core/command-handler.js COMMAND_TO_EVENT):
//   TURNO_OPENED, MESA_LOCK, ORDER_UPSERTED, MESA_UNLOCK, ORDER_SENT,
//   PRINT_COMMAND, KDS_ITEM_STATUS, ORDER_CLOSED, ORDER_CANCELLED, TURNO_CLOSED

const { spawn, execSync } = require('child_process')
const crypto = require('crypto')
const fs     = require('fs')
const net    = require('net')
const os     = require('os')
const path   = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..')

let WebSocket
try { WebSocket = require('ws') } catch {
  WebSocket = require(path.join(REPO_ROOT, 'electron-app', 'node_modules', 'ws'))
}

const { RestaurantState } = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'core', 'state.js'))
const { PROTOCOL_VERSION, EVENT } = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'protocol.js'))

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { minutes: 240, port: 17817, printerPort: 17919, dataDir: null, keepData: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--minutes')      args.minutes = parseFloat(argv[++i])
    else if (a === '--port')    args.port = parseInt(argv[++i], 10)
    else if (a === '--printer-port') args.printerPort = parseInt(argv[++i], 10)
    else if (a === '--data-dir')     args.dataDir = argv[++i]
    else if (a === '--keep-data')    args.keepData = true
    else { console.error(`Unknown arg: ${a}`); process.exit(2) }
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    console.error('--minutes must be a positive number'); process.exit(2)
  }
  return args
}

const ARGS = parseArgs(process.argv)

const RESTAURANT_ID = 'soak-restaurant'
const BASE_URL      = `http://127.0.0.1:${ARGS.port}`
const WS_URL        = `ws://127.0.0.1:${ARGS.port}/ws`

const PROGRESS_LOG  = path.join(__dirname, 'soak-progress.log')
const SERVER_LOG    = path.join(__dirname, 'soak-server.log')
const REPORT_PATH   = path.join(__dirname, 'soak-report.json')

// ─── Timing plan ──────────────────────────────────────────────────────────────
// Fault intervals compress proportionally for short runs so a smoke run still
// exercises crash + restart (spec: <30 min ⇒ compressed).

const DURATION_MS = ARGS.minutes * 60_000
const DRAIN_MS    = Math.max(30_000, Math.min(3 * 60_000, DURATION_MS * 0.15))
const ACTIVE_MS   = DURATION_MS - DRAIN_MS  // traffic + faults happen in this window

const LONG_RUN        = ARGS.minutes >= 30
const KILL_EVERY_MS   = LONG_RUN ? 20 * 60_000 : Math.max(20_000, ACTIVE_MS / 3)
const GRACE_EVERY_MS  = LONG_RUN ? 30 * 60_000 : Math.max(35_000, ACTIVE_MS / 2.2)
const OUTAGE_EVERY_MS = LONG_RUN ? 7 * 60_000  : Math.max(90_000, ACTIVE_MS / 2.5)
const OUTAGE_DUR_MS   = 15_000
const OPEN_ORDER_EVERY_MS = 2_000   // per POS terminal (± jitter)

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand  = (lo, hi) => lo + Math.random() * (hi - lo)
const now   = () => Date.now()

function ts() {
  const s = Math.floor((now() - T0) / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `+${mm}:${ss}`
}

function progress(line) {
  const out = `[${ts()}] ${line}`
  console.log(out)
  try { fs.appendFileSync(PROGRESS_LOG, out + '\n') } catch {}
}

async function healthOk(timeoutMs = 1000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal })
    return res.ok
  } catch { return false } finally { clearTimeout(t) }
}

// Fake ESC/POS bytes for PRINT_COMMAND payloads
function fakeTicketB64(kind, orderId) {
  return Buffer.from(`\x1b\x40[SOAK ${kind}] order=${orderId} ts=${now()}\n\x1d\x56\x41\x03`, 'binary').toString('base64')
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

const M = {
  commands_generated:    0,
  commands_acked:        0,    // unique commands acked at least once
  acks_total:            0,
  acks_duplicate:        0,    // ACK{duplicate:true} — server-side dedup fired
  dedup_probe_sent:      0,    // deliberate resends of already-acked commands
  dedup_probe_confirmed: 0,    // ...answered with duplicate:true
  dedup_probe_violations:0,    // ...answered as a NEW event (would be a server bug)
  rejects_lock_conflict: 0,    // expected REJECT (mesa locked)
  rejects_unexpected:    0,
  command_retries:       0,    // same command_id re-sent (timeout / reconnect)
  orders_created:        0,
  orders_sent_kitchen:   0,
  orders_closed:         0,
  orders_cancelled:      0,
  orders_split:          0,
  kds_ready_events:      0,
  print_commands:        0,
  deltas_received:       0,
  snapshots_received:    0,
  ws_connects:           0,
  ws_disconnects:        0,
  network_flaps:         0,
  printer_outages:       0,
  printer_conns_seen:    0,
  errors:                [],
}

function recordError(kind, detail) {
  M.errors.push({ t: ts(), kind, detail: String(detail).slice(0, 500) })
  if (M.errors.length > 2000) M.errors.splice(0, M.errors.length - 2000)
}

// Every command ever generated: command_id → record
// { command_id, command_type, order_id, msg, created_at, acked, ack_duplicate, rejected, retries }
const allCommands = new Map()
// Orders driven by the harness: order_id → { mesa, opened, sent, terminal:'closed'|'cancelled'|null, split }
const orders = new Map()

const restarts = []   // { kind:'kill'|'graceful'|'final-flush', down_at, spawn_at, ready_at, first_ack_at, recovery_ms }
const memSamples = []   // { t_s, rss_kb }
const queueSamples = [] // { t_s, outbox_total, print_queue: {status:count} }

// ─── Fake printer (TCP, ESC/POS sink) ─────────────────────────────────────────

class FakePrinter {
  constructor(port) {
    this.port = port
    this.bytes = 0
    this.up = false
    this.server = null
  }
  start() {
    return new Promise((resolve) => {
      this.sockets = new Set()
      this.server = net.createServer((sock) => {
        M.printer_conns_seen++
        this.sockets.add(sock)
        sock.on('data', (d) => { this.bytes += d.length })
        sock.on('error', () => {})
        sock.on('close', () => this.sockets.delete(sock))
      })
      this.server.on('error', (e) => recordError('fake-printer', e.message))
      this.server.listen(this.port, '127.0.0.1', () => { this.up = true; resolve() })
    })
  }
  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.up = false
      for (const s of this.sockets || []) { try { s.destroy() } catch {} }
      this.server.close(() => resolve())
      this.server = null
    })
  }
}

// ─── Server child-process management ─────────────────────────────────────────

let child = null
let childExitPromise = null
let restartInProgress = false
let awaitingFirstAck = null // restart record waiting for its first ACK
let shuttingDown = false

function spawnServer() {
  const env = { ...process.env }
  delete env.SUPABASE_URL
  delete env.SUPABASE_ANON_KEY
  env.SOAK_DATA_DIR      = DATA_DIR
  env.SOAK_PORT          = String(ARGS.port)
  env.SOAK_PRINTER_PORT  = String(ARGS.printerPort)
  env.SOAK_RESTAURANT_ID = RESTAURANT_ID

  const c = spawn(process.execPath, [path.join(__dirname, 'server-runner.js')], {
    cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = fs.createWriteStream(SERVER_LOG, { flags: 'a' })
  log.write(`\n───── spawn pid=${c.pid} at ${new Date().toISOString()} ─────\n`)
  c.stdout.pipe(log)
  c.stderr.pipe(log)
  childExitPromise = new Promise(r => c.on('exit', (code, sig) => r({ code, sig })))
  c.on('exit', (code, sig) => {
    if (!shuttingDown && !restartInProgress) {
      recordError('server-unexpected-exit', `pid=${c.pid} code=${code} sig=${sig}`)
    }
  })
  child = c
  return c
}

async function waitForReady(timeoutMs = 20_000) {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (await healthOk(900)) return true
    await sleep(250)
  }
  return false
}

async function startServer(kind, downAt) {
  const rec = { kind, down_at: downAt || null, spawn_at: now(), ready_at: null, first_ack_at: null, recovery_ms: null }
  spawnServer()
  const ok = await waitForReady()
  if (!ok) {
    recordError('server-start-timeout', `kind=${kind} pid=${child && child.pid}`)
    rec.ready_at = null
    restarts.push(rec)
    return rec
  }
  rec.ready_at = now()
  awaitingFirstAck = rec
  restarts.push(rec)
  // Poke: resend a few already-acked commands (same command_ids) so (a) we get a
  // fast first-ACK for recovery-time measurement and (b) dedup across restart is
  // exercised as designed against processed-commands.ndjson.
  for (const cl of CLIENTS) cl.sendDedupProbes(3)
  return rec
}

async function stopServer(signal, timeoutMs = 6_000) {
  if (!child) return
  const p = childExitPromise
  child.kill(signal)
  const res = await Promise.race([p, sleep(timeoutMs).then(() => 'timeout')])
  if (res === 'timeout') {
    child.kill('SIGKILL')
    await p
  }
  child = null
}

// ─── Simulated terminal (POS / KDS) over real WS protocol ────────────────────

class Terminal {
  constructor(clientId, clientType) {
    this.clientId = clientId
    this.clientType = clientType
    this.ws = null
    this.snapshotReady = false
    this.maxSeq = -1
    this.pending = new Map()      // command_id → record (unacked)
    this.recentAcked = []         // last acked records (for dedup probes)
    this.expectedDup = new Set()  // command_ids we deliberately resent post-ack
    this.flapUntil = 0            // suppress reconnect while network-flapped
    this.stopped = false
    this._reconnectTimer = null
    this.onDelta = null           // hook (KDS)
    this.onSnapshot = null        // hook (KDS)
  }

  connect() {
    if (this.stopped || this.ws) return
    let ws
    try { ws = new WebSocket(WS_URL) } catch (e) { this._scheduleReconnect(); return }
    this.ws = ws
    ws.on('open', () => {
      M.ws_connects++
      ws.send(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type:             'SUBSCRIBE',
        client_id:        this.clientId,
        client_type:      this.clientType,
        restaurant_id:    RESTAURANT_ID,
        last_sequence:    this.maxSeq >= 0 ? this.maxSeq : -1,
      }))
    })
    ws.on('message', (raw) => this._onMessage(raw))
    ws.on('close', () => {
      M.ws_disconnects++
      this.ws = null
      this.snapshotReady = false
      this._scheduleReconnect()
    })
    ws.on('error', () => { /* close follows */ })
  }

  _scheduleReconnect() {
    if (this.stopped || this._reconnectTimer) return
    const delay = Math.max(rand(400, 900), this.flapUntil - now())
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this.connect()
    }, delay)
  }

  flap(downMs) {
    // Simulated network drop: hard-terminate the socket, stay down for downMs.
    M.network_flaps++
    this.flapUntil = now() + downMs
    if (this.ws) { try { this.ws.terminate() } catch {} }
  }

  _onMessage(raw) {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (typeof msg.sequence === 'number' && msg.sequence > this.maxSeq) this.maxSeq = msg.sequence

    if (msg.type === 'SNAPSHOT') {
      M.snapshots_received++
      this.snapshotReady = true
      if (this.onSnapshot) { try { this.onSnapshot(msg.payload) } catch (e) { recordError('snapshot-hook', e.message) } }
      this.flush(true)  // resend everything unacked after (re)connect
      return
    }

    if (msg.type === 'ACK') {
      M.acks_total++
      const id = msg.payload && msg.payload.command_id
      if (msg.payload && msg.payload.duplicate) M.acks_duplicate++
      if (awaitingFirstAck && !awaitingFirstAck.first_ack_at) {
        awaitingFirstAck.first_ack_at = now()
        awaitingFirstAck.recovery_ms = awaitingFirstAck.first_ack_at - awaitingFirstAck.spawn_at
        awaitingFirstAck = null
      }
      const rec = this.pending.get(id)
      if (rec) {
        rec.acked = true
        rec.acked_at = now()
        rec.ack_duplicate = !!(msg.payload && msg.payload.duplicate)
        this.pending.delete(id)
        M.commands_acked++
        this.recentAcked.push(rec)
        if (this.recentAcked.length > 8) this.recentAcked.shift()
      } else if (this.expectedDup.has(id)) {
        this.expectedDup.delete(id)
        if (msg.payload && msg.payload.duplicate) {
          M.dedup_probe_confirmed++
        } else {
          // Server re-processed a command it already ACKed → duplicate event.
          M.dedup_probe_violations++
          recordError('dedup-violation', `command_id=${id} re-acked without duplicate:true`)
        }
      }
      return
    }

    if (msg.type === 'REJECT') {
      const id = msg.payload && msg.payload.command_id
      const reason = (msg.payload && msg.payload.reason) || ''
      const rec = this.pending.get(id)
      if (rec && rec.command_type === 'MESA_LOCK' && /locked by another/.test(reason)) {
        M.rejects_lock_conflict++
        rec.rejected = reason
        this.pending.delete(id)
      } else {
        M.rejects_unexpected++
        recordError('unexpected-reject', `client=${this.clientId} cmd=${id} reason=${reason}`)
        if (rec) { rec.rejected = reason; this.pending.delete(id) }
      }
      return
    }

    if (msg.type === 'DELTA') {
      M.deltas_received++
      if (this.onDelta) {
        try { this.onDelta(msg.payload && msg.payload.event) } catch (e) { recordError('delta-hook', e.message) }
      }
      return
    }
    // PONG / UPDATE_AVAILABLE ignored
  }

  /** Enqueue a command. Generated regardless of connectivity; replayed with the
   *  SAME command_id on reconnect/retry so server-side dedup is exercised. */
  command(commandType, fields, orderId) {
    const command_id = `c-${this.clientId}-${(++Terminal._seq).toString(36)}-${crypto.randomBytes(3).toString('hex')}`
    const msg = {
      protocol_version: PROTOCOL_VERSION,
      type:             'COMMAND',
      restaurant_id:    RESTAURANT_ID,
      client_id:        this.clientId,
      payload: { command_id, command_type: commandType, client_id: this.clientId, ...fields },
    }
    const rec = {
      command_id, command_type: commandType, order_id: orderId || null, msg,
      created_at: now(), sent_at: null, acked: false, acked_at: null,
      ack_duplicate: false, rejected: null, retries: 0,
    }
    allCommands.set(command_id, rec)
    this.pending.set(command_id, rec)
    M.commands_generated++
    this._trySend(rec)
    return rec
  }

  _trySend(rec) {
    if (!this.ws || this.ws.readyState !== 1 || !this.snapshotReady) return
    try {
      this.ws.send(JSON.stringify(rec.msg))
      if (rec.sent_at) { rec.retries++; M.command_retries++ }
      rec.sent_at = now()
    } catch {}
  }

  /** (Re)send unacked commands. force=true → resend all (after reconnect). */
  flush(force) {
    for (const rec of this.pending.values()) {
      if (force || !rec.sent_at || now() - rec.sent_at > 6_000) this._trySend(rec)
    }
  }

  /** Deliberately resend up-to-n already-ACKed commands with their original
   *  command_ids. The server must answer ACK{duplicate:true} and append nothing. */
  sendDedupProbes(n) {
    if (!this.ws || this.ws.readyState !== 1 || !this.snapshotReady) return
    const sample = this.recentAcked.slice(-n)
    for (const rec of sample) {
      this.expectedDup.add(rec.command_id)
      try { this.ws.send(JSON.stringify(rec.msg)); M.dedup_probe_sent++ } catch {}
    }
  }

  outboxDepth() { return this.pending.size }

  stop() {
    this.stopped = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this.ws) { try { this.ws.close() } catch {} }
  }
}
Terminal._seq = 0

// ─── Traffic: POS order lifecycles + KDS reactions ───────────────────────────

const MENU = [
  { name: 'Chilaquiles Verdes', price: 145, mods: ['pollo', 'huevo estrellado', 'sin cebolla'] },
  { name: 'Half & Half',        price: 155, mods: ['rojo/verde', 'extra queso'] },
  { name: 'Panini Caprese',     price: 128, mods: ['sin pesto'] },
  { name: 'Bowl Proteina',      price: 139, mods: ['sin aguacate', 'extra pollo'] },
  { name: 'Latte',              price: 62,  mods: ['deslactosada', 'avena'] },
  { name: 'Jugo Verde',         price: 55,  mods: [] },
  { name: 'Pancakes',           price: 98,  mods: ['miel extra', 'sin fresa'] },
]

function randomItems() {
  const n = 1 + Math.floor(Math.random() * 4)
  const items = []
  for (let i = 0; i < n; i++) {
    const m = MENU[Math.floor(Math.random() * MENU.length)]
    items.push({
      id:             `i-${crypto.randomBytes(4).toString('hex')}`,
      name:           m.name,
      cantidad:       1 + Math.floor(Math.random() * 2),
      precio:         m.price,
      modificadores:  m.mods.filter(() => Math.random() < 0.4),
    })
  }
  return items
}

let trafficOn = false
let orderCounter = 0

/** Full order lifecycle on one POS terminal. Commands are enqueued on wall-clock
 *  timers regardless of server availability (offline queue + replay). */
async function runOrderLifecycle(pos, mesa) {
  const orderId = `o-${pos.clientId}-${++orderCounter}`
  const items = randomItems()
  const total = items.reduce((s, i) => s + i.precio * i.cantidad, 0)
  orders.set(orderId, { mesa, opened_at: now(), sent: false, terminal: null, split: false, client: pos.clientId })
  M.orders_created++

  const aborted = () => !!orders.get(orderId).terminal  // drain force-closed it

  // 1. Lock mesa while editing
  pos.command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 }, orderId)
  await sleep(rand(200, 600))
  if (aborted()) return

  // 2. Open the order
  pos.command('ORDER_UPSERTED', { order_id: orderId, mesa, items, status: 'abierta' }, orderId)
  await sleep(rand(200, 500))
  if (aborted()) return

  // 3. Occasionally add items (upsert again with full list)
  if (Math.random() < 0.35) {
    items.push(...randomItems())
    pos.command('ORDER_UPSERTED', { order_id: orderId, mesa, items, status: 'abierta' }, orderId)
    await sleep(rand(150, 400))
    if (aborted()) return
  }

  // 4. Done editing
  pos.command('MESA_UNLOCK', { mesa }, orderId)
  await sleep(rand(400, 1200))
  if (aborted()) return

  // 5. Send to kitchen (full items list — server contract) + kitchen comanda print
  pos.command('ORDER_SENT', {
    order_id: orderId, mesa, mesero: pos.clientId, status: 'enviada',
    items, personas: 1 + Math.floor(Math.random() * 4), total,
    comanda_batches: [{ batch: 1, items: items.map(i => i.id) }],
  }, orderId)
  const o = orders.get(orderId); o.sent = true; M.orders_sent_kitchen++
  pos.command('PRINT_COMMAND', { station: 'cocina', data_b64: fakeTicketB64('COMANDA', orderId) }, orderId)
  M.print_commands++

  // 6. Table eats… then pay/cancel
  await sleep(rand(3_000, 8_000))

  if (o.terminal) return  // drain phase already force-closed this order
  const roll = Math.random()
  if (roll < 0.10) {
    // Cancellation with authorization
    pos.command('ORDER_CANCELLED', {
      order_id: orderId, mesa,
      reason: 'cliente cancelo', authorized_by: 'gerente-soak', authorization_pin_ok: true,
    }, orderId)
    o.terminal = 'cancelled'
    M.orders_cancelled++
  } else {
    const split = roll < 0.22   // ~12% of orders pay split
    const payments = split
      ? [
          { method: 'tarjeta',  amount: Math.round(total / 2) },
          { method: 'efectivo', amount: total - Math.round(total / 2) },
        ]
      : [{ method: Math.random() < 0.5 ? 'tarjeta' : 'efectivo', amount: total }]
    pos.command('ORDER_CLOSED', { order_id: orderId, mesa, total, payments, split }, orderId)
    pos.command('PRINT_COMMAND', { station: 'caja', data_b64: fakeTicketB64('RECIBO', orderId) }, orderId)
    M.print_commands++
    o.terminal = 'closed'
    M.orders_closed++
    if (split) { o.split = true; M.orders_split++ }
  }
}

function startPosTraffic(pos, mesaBase) {
  let mesaIdx = 0
  ;(async () => {
    while (trafficOn) {
      const mesa = String(mesaBase + (mesaIdx++ % 30))
      runOrderLifecycle(pos, mesa).catch(e => recordError('lifecycle', e.stack || e.message))
      await sleep(rand(OPEN_ORDER_EVERY_MS * 0.7, OPEN_ORDER_EVERY_MS * 1.3))
    }
  })()
}

/** KDS: watch ORDER_SENT (deltas + snapshot kds_orders), mark every item done. */
function wireKds(kds) {
  const marked = new Set()
  const markReady = (orderId, itemCount) => {
    if (marked.has(orderId)) return
    marked.add(orderId)
    setTimeout(() => {
      const map = {}
      for (let i = 0; i < Math.max(1, itemCount); i++) map[i] = true
      kds.command('KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: JSON.stringify(map) }, orderId)
      M.kds_ready_events++
    }, rand(500, 1500))
  }
  kds.onDelta = (ev) => {
    if (!ev) return
    if (ev.type === EVENT.ORDER_SENT) {
      let n = 1
      try { n = (JSON.parse(ev.payload.items || '[]') || []).length || (ev.payload.items || []).length || 1 } catch {}
      if (Array.isArray(ev.payload.items)) n = ev.payload.items.length
      markReady(ev.payload.order_id, n)
    }
  }
  kds.onSnapshot = (payload) => {
    const kdsOrders = (payload && payload.state && payload.state.kds_orders) || []
    for (const o of kdsOrders) {
      let n = 1
      try { n = (JSON.parse(o.items || '[]') || []).length || 1 } catch {}
      markReady(o.order_id || o.id, n)
    }
  }
}

// ─── Fault injection scheduler ───────────────────────────────────────────────

// All restarts run through a serial chain so a kill and a graceful restart that
// fire close together both happen (in order) instead of one being skipped.
let faultChain = Promise.resolve()
function enqueueFault(fn) {
  faultChain = faultChain
    .then(() => (shuttingDown || !trafficOn) ? null : fn())
    .catch(e => recordError('fault', e.stack || e.message))
  return faultChain
}

async function doKillRestart() {
  if (shuttingDown) return
  restartInProgress = true
  try {
    progress(`FAULT: SIGKILL server (pid=${child && child.pid})`)
    const downAt = now()
    if (child) { const p = childExitPromise; child.kill('SIGKILL'); await p; child = null }
    await sleep(rand(5_000, 10_000))   // server stays dead; clients keep generating
    const rec = await startServer('kill', downAt)
    progress(`RECOVERED from SIGKILL: ready in ${rec.ready_at ? rec.ready_at - rec.spawn_at : 'TIMEOUT'}ms`)
  } finally { restartInProgress = false }
}

async function doGracefulRestart() {
  if (shuttingDown) return
  restartInProgress = true
  try {
    progress(`FAULT: graceful restart (SIGTERM, pid=${child && child.pid})`)
    const downAt = now()
    await stopServer('SIGTERM')
    await sleep(rand(1_000, 2_500))
    const rec = await startServer('graceful', downAt)
    progress(`RECOVERED from graceful restart: ready in ${rec.ready_at ? rec.ready_at - rec.spawn_at : 'TIMEOUT'}ms`)
  } finally { restartInProgress = false }
}

function startFaultSchedulers(trafficEndAt) {
  const timers = []
  const schedule = (firstAt, every, fn) => {
    let t = firstAt
    while (t < trafficEndAt - 10_000) {
      timers.push(setTimeout(fn, t - now()))
      t += every
    }
  }
  schedule(now() + KILL_EVERY_MS, KILL_EVERY_MS, () => enqueueFault(doKillRestart))
  schedule(now() + GRACE_EVERY_MS + GRACE_EVERY_MS / 2, GRACE_EVERY_MS, () => enqueueFault(doGracefulRestart))

  // Network flaps: each client drops randomly
  for (const cl of CLIENTS) {
    ;(async () => {
      while (trafficOn) {
        await sleep(rand(Math.max(15_000, ACTIVE_MS * 0.15), Math.max(30_000, ACTIVE_MS * 0.35)))
        if (!trafficOn) break
        const downMs = rand(2_000, 8_000)
        progress(`FAULT: network flap ${cl.clientId} (down ${(downMs / 1000).toFixed(1)}s)`)
        cl.flap(downMs)
      }
    })()
  }

  // Printer outages
  schedule(now() + OUTAGE_EVERY_MS * 0.6, OUTAGE_EVERY_MS, async () => {
    if (shuttingDown) return
    M.printer_outages++
    progress(`FAULT: printer outage (${OUTAGE_DUR_MS / 1000}s)`)
    await PRINTER.stop()
    await sleep(OUTAGE_DUR_MS)
    if (!shuttingDown) { await PRINTER.start(); progress('printer back up') }
  })

  return timers
}

// ─── Sampling / reporting ────────────────────────────────────────────────────

function samplePrintQueue() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'print-queue.json'), 'utf8')
    const jobs = JSON.parse(raw)
    const byStatus = {}
    for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1
    return byStatus
  } catch { return null }
}

function sampleMetrics() {
  const t_s = Math.round((now() - T0) / 1000)
  if (child && child.pid) {
    try {
      const rss = parseInt(execSync(`ps -o rss= -p ${child.pid}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 10)
      if (Number.isFinite(rss)) memSamples.push({ t_s, rss_kb: rss })
    } catch {}
  }
  queueSamples.push({
    t_s,
    outbox_total: CLIENTS.reduce((s, c) => s + c.outboxDepth(), 0),
    print_queue:  samplePrintQueue(),
  })
}

function buildReport(verification, exitCode) {
  return {
    generated_at: new Date().toISOString(),
    config: {
      minutes: ARGS.minutes, port: ARGS.port, printer_port: ARGS.printerPort,
      data_dir: DATA_DIR, restaurant_id: RESTAURANT_ID,
      kill_every_ms: KILL_EVERY_MS, graceful_every_ms: GRACE_EVERY_MS,
      drain_ms: DRAIN_MS, node: process.version,
    },
    started_at: new Date(T0).toISOString(),
    duration_s: Math.round((now() - T0) / 1000),
    totals: { ...M, errors: undefined, error_count: M.errors.length },
    restarts: restarts.map(r => ({
      kind: r.kind,
      ready_ms:    r.ready_at ? r.ready_at - r.spawn_at : null,
      recovery_ms_first_ack: r.recovery_ms,
    })),
    restart_counts: {
      kill:     restarts.filter(r => r.kind === 'kill').length,
      graceful: restarts.filter(r => r.kind === 'graceful').length,
      final_flush: restarts.filter(r => r.kind === 'final-flush').length,
    },
    memory_rss_samples: memSamples,
    queue_depth_samples: queueSamples,
    errors: M.errors,
    verification: verification || { pass: null, note: 'run still in progress' },
    exit_code: exitCode,
  }
}

function writeReport(verification, exitCode) {
  try { fs.writeFileSync(REPORT_PATH, JSON.stringify(buildReport(verification, exitCode), null, 2)) } catch (e) {
    console.error('Could not write report:', e.message)
  }
}

// ─── End-of-run verification ─────────────────────────────────────────────────

function verifyRun() {
  const invariants = []
  const inv = (name, pass, detail) => { invariants.push({ name, pass: !!pass, detail }); return !!pass }

  // 1. Parse events.ndjson
  const evPath = path.join(DATA_DIR, 'events.ndjson')
  const rawLines = fs.existsSync(evPath) ? fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean) : []
  const events = []
  const corrupt = []
  rawLines.forEach((line, i) => {
    try { events.push(JSON.parse(line)) } catch { corrupt.push({ line: i + 1, snippet: line.slice(0, 120) }) }
  })
  inv('no_corrupt_event_lines', corrupt.length === 0, corrupt.length ? corrupt : `${rawLines.length} lines all parseable`)

  // 2. Duplicate event ids / sequences
  const idCount = new Map(), seqCount = new Map()
  for (const ev of events) {
    idCount.set(ev.id, (idCount.get(ev.id) || 0) + 1)
    seqCount.set(ev.sequence, (seqCount.get(ev.sequence) || 0) + 1)
  }
  const dupIds  = [...idCount].filter(([, c]) => c > 1)
  const dupSeqs = [...seqCount].filter(([, c]) => c > 1)
  inv('zero_duplicate_event_ids', dupIds.length === 0, dupIds.slice(0, 20))
  inv('zero_duplicate_sequences', dupSeqs.length === 0, dupSeqs.slice(0, 20))

  // 3. Sequences strictly increasing in file order (append-only integrity)
  let monotonic = true, prev = -Infinity, monoDetail = 'ok'
  for (const ev of events) {
    if (!(ev.sequence > prev)) { monotonic = false; monoDetail = `sequence ${ev.sequence} after ${prev} (event id=${ev.id})`; break }
    prev = ev.sequence
  }
  inv('sequences_strictly_increasing', monotonic, monoDetail)

  // 4. Zero loss: every ACKed command appears exactly once in the log.
  //    (REJECTed MESA_LOCK conflicts legitimately produce no event.)
  const lost = [], duplicated = []
  let ackedCount = 0
  for (const rec of allCommands.values()) {
    if (!rec.acked) continue
    ackedCount++
    const c = idCount.get(rec.command_id) || 0
    if (c === 0) lost.push({ command_id: rec.command_id, type: rec.command_type, order_id: rec.order_id })
    else if (c > 1) duplicated.push({ command_id: rec.command_id, type: rec.command_type, count: c })
  }
  inv('zero_data_loss_acked_commands_persisted', lost.length === 0,
    lost.length ? { lost_count: lost.length, sample: lost.slice(0, 20) } : `${ackedCount} acked commands all present in events.ndjson`)
  inv('zero_duplicate_command_events', duplicated.length === 0, duplicated.slice(0, 20))

  // 5. No unacked commands remain after drain (would be client-visible loss)
  const unacked = [...allCommands.values()].filter(r => !r.acked && !r.rejected)
  inv('all_commands_acked_after_drain', unacked.length === 0,
    unacked.length ? { count: unacked.length, sample: unacked.slice(0, 20).map(r => ({ id: r.command_id, type: r.command_type })) } : 'outboxes fully drained')

  // 6. Every event in the log belongs to a known command (no phantom events)
  const phantom = events.filter(ev => !allCommands.has(ev.id))
  inv('no_phantom_events', phantom.length === 0,
    phantom.slice(0, 10).map(e => ({ id: e.id, type: e.type, client_id: e.client_id })))

  // 7. Order lifecycle: every created order has exactly one terminal event
  const terminalByOrder = new Map()
  for (const ev of events) {
    if (ev.type === EVENT.ORDER_CLOSED || ev.type === EVENT.ORDER_CANCELLED) {
      const oid = ev.payload && ev.payload.order_id
      terminalByOrder.set(oid, (terminalByOrder.get(oid) || 0) + 1)
    }
  }
  const badTerminal = []
  for (const [oid, o] of orders) {
    const n = terminalByOrder.get(oid) || 0
    if (n !== 1) badTerminal.push({ order_id: oid, terminal_events: n, expected: o.terminal })
  }
  inv('every_order_exactly_one_terminal_event', badTerminal.length === 0,
    badTerminal.length ? badTerminal.slice(0, 20) : `${orders.size} orders, each closed/cancelled exactly once`)

  // 8. Replay full log through the REAL RestaurantState (like state.test.js)
  const replay = new RestaurantState()
  let replayError = null
  try { for (const ev of events) replay.apply(ev) } catch (e) { replayError = e.stack }
  replay.gcLocks()
  const snap = replay.toSnapshot()
  const occupiedMesas = Object.entries(snap.mesas).filter(([, m]) => m.status !== 'libre' || m.locked_by)
  inv('replay_no_exception', !replayError, replayError || 'ok')
  inv('replay_final_state_no_open_orders', snap.kds_orders.length === 0 && snap.kds_queue.length === 0,
    { kds_orders: snap.kds_orders.length, kds_queue: snap.kds_queue.length })
  inv('replay_final_state_all_mesas_free', occupiedMesas.length === 0, occupiedMesas.slice(0, 20))
  inv('replay_final_state_turno_closed', snap.turno === null, snap.turno)
  inv('replay_final_state_no_locks', Object.keys(snap.locks).length === 0, snap.locks)

  // 9. processed-commands.ndjson: no duplicate idempotency keys
  const pcPath = path.join(DATA_DIR, 'processed-commands.ndjson')
  const pcKeys = new Map()
  if (fs.existsSync(pcPath)) {
    for (const line of fs.readFileSync(pcPath, 'utf8').split('\n').filter(Boolean)) {
      try { const { key } = JSON.parse(line); pcKeys.set(key, (pcKeys.get(key) || 0) + 1) } catch {}
    }
  }
  const dupKeys = [...pcKeys].filter(([, c]) => c > 1)
  inv('no_duplicate_processed_command_keys', dupKeys.length === 0, dupKeys.slice(0, 20))

  // 10. Print queue: no stuck 'printing' jobs, nothing lost mid-crash
  const pq = samplePrintQueue() || {}
  inv('print_queue_no_stuck_printing_jobs', !(pq.printing > 0), pq)
  const pqWarnings = []
  if (pq.failed) pqWarnings.push(`${pq.failed} jobs in terminal 'failed'`)
  if (pq.recoverable) pqWarnings.push(`${pq.recoverable} jobs parked 'recoverable' at end of run`)
  if (pq.pending || pq.retrying) pqWarnings.push(`${(pq.pending || 0) + (pq.retrying || 0)} jobs still pending/retrying after final flush`)

  // 11. Dedup actually exercised + honored
  inv('dedup_exercised', M.acks_duplicate + M.dedup_probe_confirmed > 0,
    { duplicate_acks: M.acks_duplicate, probes_confirmed: M.dedup_probe_confirmed })
  inv('dedup_no_violations', M.dedup_probe_violations === 0, { violations: M.dedup_probe_violations })

  // 12. Fault coverage + minimum activity
  const killCount = restarts.filter(r => r.kind === 'kill').length
  const graceCount = restarts.filter(r => r.kind === 'graceful').length
  if (DURATION_MS >= 4 * 60_000) {
    inv('at_least_2_kill_restarts', killCount >= 2, { kills: killCount })
    inv('at_least_1_graceful_restart', graceCount >= 1, { graceful: graceCount })
  }
  inv('minimum_traffic_generated', M.orders_created >= 10, { orders_created: M.orders_created })
  inv('no_unexpected_rejects', M.rejects_unexpected === 0, { rejects_unexpected: M.rejects_unexpected })
  inv('no_harness_errors', M.errors.length === 0, M.errors.slice(0, 10))

  const pass = invariants.every(i => i.pass)
  return {
    pass,
    invariants,
    warnings: pqWarnings,
    events_in_log: events.length,
    distinct_order_ids_persisted: new Set(
      events.filter(e => e.payload && e.payload.order_id).map(e => e.payload.order_id)
    ).size,
    print_queue_final: pq,
    fake_printer_bytes_received: PRINTER.bytes,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let T0 = 0
let DATA_DIR = null
let PRINTER = null
let CLIENTS = []

async function main() {
  T0 = now()
  DATA_DIR = ARGS.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-soak-'))
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(PROGRESS_LOG, '')  // truncate per run

  progress(`Soak start: ${ARGS.minutes} min | port=${ARGS.port} | data=${DATA_DIR}`)
  progress(`Plan: kill every ~${Math.round(KILL_EVERY_MS / 1000)}s, graceful every ~${Math.round(GRACE_EVERY_MS / 1000)}s, drain ${Math.round(DRAIN_MS / 1000)}s`)

  // Fake printer up first so print jobs can complete
  PRINTER = new FakePrinter(ARGS.printerPort)
  await PRINTER.start()

  // Boot server
  const first = await startServer('initial', null)
  if (!first.ready_at) { console.error('FATAL: server never became healthy'); writeReport(null, 1); process.exit(1) }

  // Clients: 2 POS + 1 KDS
  const pos1 = new Terminal('pos-1', 'pos')
  const pos2 = new Terminal('pos-2', 'pos')
  const kds1 = new Terminal('kds-1', 'kds')
  wireKds(kds1)
  CLIENTS = [pos1, pos2, kds1]
  for (const c of CLIENTS) c.connect()

  // Wait for subscriptions
  const subDeadline = now() + 10_000
  while (now() < subDeadline && !CLIENTS.every(c => c.snapshotReady)) await sleep(200)

  // Shift open: turno
  pos1.command('TURNO_OPENED', { turno_id: `t-soak-${T0}`, opened_by: 'cajero-soak' })

  // Traffic + faults
  trafficOn = true
  const trafficEndAt = T0 + ACTIVE_MS
  startPosTraffic(pos1, 100)   // mesas 100–129
  startPosTraffic(pos2, 200)   // mesas 200–229 (disjoint → no lock conflicts)
  const faultTimers = startFaultSchedulers(trafficEndAt)

  // Flush / retry loop (client-side replay of unacked commands)
  const flushTimer = setInterval(() => { for (const c of CLIENTS) c.flush(false) }, 2_000)
  // Occasional dedup probes during normal operation
  const probeTimer = setInterval(() => {
    const c = CLIENTS[Math.floor(Math.random() * CLIENTS.length)]
    if (Math.random() < 0.3) c.sendDedupProbes(1)
  }, 15_000)
  // Sampling + rolling report
  const sampleTimer = setInterval(sampleMetrics, 15_000)
  const reportTimer = setInterval(() => writeReport(null, null), 30_000)
  // Progress line every 60s
  const progressTimer = setInterval(() => {
    progress(
      `orders created=${M.orders_created} closed=${M.orders_closed} cancelled=${M.orders_cancelled} | ` +
      `cmds gen=${M.commands_generated} acked=${M.commands_acked} outbox=${CLIENTS.reduce((s, c) => s + c.outboxDepth(), 0)} | ` +
      `dupAcks=${M.acks_duplicate} restarts kill=${restarts.filter(r => r.kind === 'kill').length} graceful=${restarts.filter(r => r.kind === 'graceful').length} | ` +
      `deltas=${M.deltas_received} kdsReady=${M.kds_ready_events} errors=${M.errors.length}`
    )
  }, 60_000)

  // ── Active window ──
  await sleep(Math.max(0, trafficEndAt - now()))
  trafficOn = false
  for (const t of faultTimers) clearTimeout(t)
  progress('Traffic stopped — entering drain phase')

  // Wait out any in-flight restart, make sure server is up for the drain
  await faultChain
  while (restartInProgress) await sleep(500)
  if (!(await healthOk())) {
    restartInProgress = true
    await stopServer('SIGKILL').catch(() => {})
    await startServer('kill', now())
    restartInProgress = false
  }

  // ── Drain: let lifecycles finish, outboxes empty ──
  const drainDeadline = now() + Math.max(30_000, DRAIN_MS - 15_000)
  while (now() < drainDeadline) {
    const openOrders = [...orders.values()].filter(o => !o.terminal).length
    const outbox = CLIENTS.reduce((s, c) => s + c.outboxDepth(), 0)
    if (openOrders === 0 && outbox === 0) break
    for (const c of CLIENTS) c.flush(false)
    await sleep(1_000)
  }
  // Force-close anything still open (lifecycle timers were cut short)
  for (const [oid, o] of orders) {
    if (!o.terminal) {
      const pos = o.client === 'pos-1' ? pos1 : pos2
      pos.command('ORDER_CLOSED', { order_id: oid, mesa: o.mesa, total: 0, payments: [{ method: 'efectivo', amount: 0 }], forced_by_drain: true }, oid)
      o.terminal = 'closed'
      M.orders_closed++
    }
  }
  // Close the shift
  pos1.command('TURNO_CLOSED', { turno_id: `t-soak-${T0}`, closed_by: 'cajero-soak' })

  // Final outbox flush
  const finalDeadline = now() + 30_000
  while (now() < finalDeadline && CLIENTS.reduce((s, c) => s + c.outboxDepth(), 0) > 0) {
    for (const c of CLIENTS) c.flush(false)
    await sleep(1_000)
  }
  progress(`Drain complete — outbox=${CLIENTS.reduce((s, c) => s + c.outboxDepth(), 0)}`)

  // ── Final flush restart: lets the print queue retry 'retrying' jobs on boot ──
  restartInProgress = true
  await stopServer('SIGTERM')
  await sleep(500)
  const flushRec = await startServer('final-flush', null)
  restartInProgress = false
  if (flushRec.ready_at) await sleep(6_000)   // give _retryPendingJobs time with printer up

  // ── Shutdown everything ──
  shuttingDown = true
  clearInterval(flushTimer); clearInterval(probeTimer); clearInterval(sampleTimer)
  clearInterval(reportTimer); clearInterval(progressTimer)
  for (const c of CLIENTS) c.stop()
  await stopServer('SIGTERM')
  await PRINTER.stop()
  progress('Server stopped — verifying artifacts')

  // ── Verify ──
  const verification = verifyRun()
  const exitCode = verification.pass ? 0 : 1
  writeReport(verification, exitCode)

  progress(`VERDICT: ${verification.pass ? 'PASS' : 'FAIL'}`)
  for (const i of verification.invariants) {
    const mark = i.pass ? 'ok  ' : 'FAIL'
    progress(`  [${mark}] ${i.name}${i.pass ? '' : ' — ' + JSON.stringify(i.detail).slice(0, 400)}`)
  }
  for (const w of verification.warnings) progress(`  [warn] ${w}`)
  progress(`Report: ${REPORT_PATH}`)
  progress(`Data dir ${ARGS.keepData || !verification.pass ? 'kept' : 'removed'}: ${DATA_DIR}`)

  if (verification.pass && !ARGS.keepData && !ARGS.dataDir) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
  }
  process.exit(exitCode)
}

// Never leave an orphaned server behind
process.on('exit', () => { if (child) try { child.kill('SIGKILL') } catch {} })
process.on('SIGINT', () => { shuttingDown = true; if (child) try { child.kill('SIGKILL') } catch {}; process.exit(130) })
process.on('unhandledRejection', (e) => {
  recordError('unhandled-rejection', (e && e.stack) || e)
  console.error('unhandledRejection:', e)
})

main().catch((e) => {
  console.error('FATAL harness error:', e && e.stack || e)
  recordError('fatal', e && e.stack || e)
  writeReport(null, 1)
  if (child) try { child.kill('SIGKILL') } catch {}
  process.exit(1)
})
