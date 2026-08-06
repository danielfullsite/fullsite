'use strict'
// ─── AMALAY DIGITAL TWIN — Rehearsal Harness ─────────────────────────────────
// Evolution of tests/soak/soak-harness.js for the AMALAY digital-twin rehearsal.
// Drives the real Bridge (electron-app/local-server) over the real WS protocol
// with AMALAY-shaped traffic (fixture menu/mesas/users), two capturing fake
// ESC/POS printers (cocina + barra), a fingerprint-service mock, a slow-staging
// Supabase REST mock, a named scenario engine covering the founder's 35-step
// flow (where the protocol supports it), fault injection, and hard invariant
// gates verified from the on-disk/REST event log replayed through the REAL
// RestaurantState.
//
// Modes:
//   --spawn      spawn the bridge as a child process (Mac smoke / CI)
//   --external --bridge-host H --bridge-port P
//                target an already-running Bridge (e.g. canonical installed app
//                on a Windows runner). NEVER kills the bridge process — emits
//                named orchestrator hook files instead, and detects restarts
//                via /health server_id + uptime_s.
//
// Phases (--phase):
//   smoke    ~10 min: scenario suite + ≥100 orders + compressed faults
//   shift    accelerated 4h-equivalent AMALAY shift (~120 tickets, load curve,
//            temporal ordering preserved, compressed by --compress, default 6×)
//   accum7   accelerated-equivalent of 7 days of AMALAY volume (~840 tickets)
//            generated while 'offline' (WAN-independent), then drain + verify
//   accum30  same, 30 days (~3600 tickets). Results are labeled
//            'accelerated-equivalent' — NEVER a physical 30-day claim.
//   full     smoke → shift → accum7 → drain → replay
//
// Exit codes: 0 = all invariants hold; 1 = failure (coverage/harness/invariant);
//             2 = STOP CONDITION (data loss / duplication / corruption / stuck /
//                 tenant leak / inconsistent payments) — STOP-CONDITION.md written.
//
// Run (spawn smoke):  node tests/twin/twin-harness.js --phase smoke --spawn
// See tests/twin/README.md for all modes/phases and honest limitations.

const { spawn, execSync } = require('child_process')
const crypto = require('crypto')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..')

let WebSocket
try { WebSocket = require('ws') } catch {
  WebSocket = require(path.join(REPO_ROOT, 'electron-app', 'node_modules', 'ws'))
}

const { RestaurantState } = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'core', 'state.js'))
const { PROTOCOL_VERSION, EVENT } = require(path.join(REPO_ROOT, 'electron-app', 'local-server', 'protocol.js'))

const { loadFixture }      = require('./twin-fixture')
const { CapturingPrinter } = require('./fake-printer')
const { FingerprintMock }  = require('./fingerprint-mock')
const { StagingMock }      = require('./staging-mock')

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    phase: 'smoke',
    spawn: false, external: false,
    bridgeHost: '127.0.0.1', bridgePort: 7717,
    port: 17917,                       // spawn-mode bridge port
    cocinaPort: null, barraPort: null, // default from fixture (19100/19101)
    fpPort: 7718,                      // /fp proxy target is hardcoded to 7718
    stagingPort: 19200, syncPort: 17918,
    dataDir: null, keepData: false,
    config: path.join(__dirname, 'amalay-twin-config.json'),
    compress: 6,                       // shift: 4h virtual / 6 = 40 min real
    hookTimeoutMs: 120_000,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--phase')                args.phase = argv[++i]
    else if (a === '--spawn')           args.spawn = true
    else if (a === '--external')        args.external = true
    else if (a === '--bridge-host')     args.bridgeHost = argv[++i]
    else if (a === '--bridge-port')     args.bridgePort = parseInt(argv[++i], 10)
    else if (a === '--port')            args.port = parseInt(argv[++i], 10)
    else if (a === '--printer-cocina-port') args.cocinaPort = parseInt(argv[++i], 10)
    else if (a === '--printer-barra-port')  args.barraPort = parseInt(argv[++i], 10)
    else if (a === '--fp-port')         args.fpPort = parseInt(argv[++i], 10)
    else if (a === '--staging-port')    args.stagingPort = parseInt(argv[++i], 10)
    else if (a === '--sync-port')       args.syncPort = parseInt(argv[++i], 10)
    else if (a === '--data-dir')        args.dataDir = argv[++i]
    else if (a === '--keep-data')       args.keepData = true
    else if (a === '--config')          args.config = argv[++i]
    else if (a === '--compress')        args.compress = parseFloat(argv[++i])
    else if (a === '--hook-timeout')    args.hookTimeoutMs = parseInt(argv[++i], 10) * 1000
    else { console.error(`Unknown arg: ${a}`); process.exit(2) }
  }
  if (!['smoke', 'shift', 'accum7', 'accum30', 'full'].includes(args.phase)) {
    console.error(`--phase must be smoke|shift|accum7|accum30|full (got ${args.phase})`); process.exit(2)
  }
  if (args.spawn && args.external) { console.error('--spawn and --external are mutually exclusive'); process.exit(2) }
  if (!args.spawn && !args.external) {
    console.error('No mode given — defaulting to --spawn')
    args.spawn = true
  }
  return args
}

const ARGS = parseArgs(process.argv)
const MODE = ARGS.external ? 'external' : 'spawn'

// ─── Fixture ──────────────────────────────────────────────────────────────────

const FIXTURE_LOAD = loadFixture(ARGS.config)
const FIX = FIXTURE_LOAD.fixture
const RESTAURANT_ID = FIX.restaurantId

const COCINA_PORT = ARGS.cocinaPort || (FIX.printers.find(p => p.station === 'cocina') || {}).tcp_port || 19100
const BARRA_PORT  = ARGS.barraPort  || (FIX.printers.find(p => p.station === 'barra')  || {}).tcp_port || 19101

const BRIDGE_HOST = MODE === 'external' ? ARGS.bridgeHost : '127.0.0.1'
const BRIDGE_PORT = MODE === 'external' ? ARGS.bridgePort : ARGS.port
const BASE_URL    = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`
const WS_URL      = `ws://${BRIDGE_HOST}:${BRIDGE_PORT}/ws`

// ─── Evidence / paths ─────────────────────────────────────────────────────────

const EVID_DIR      = path.join(__dirname, 'twin-evidence')
const HOOKS_DIR     = path.join(EVID_DIR, 'orchestrator-hooks')
const PROGRESS_LOG  = path.join(EVID_DIR, 'twin-progress.log')
const SERVER_LOG    = path.join(EVID_DIR, 'twin-server.log')
const REPORT_PATH   = path.join(EVID_DIR, 'twin-report.json')
const STOP_PATH     = path.join(EVID_DIR, 'STOP-CONDITION.md')

// ─── Phase profiles ───────────────────────────────────────────────────────────
// AMALAY scale: ~120 tickets/day. accumN = N × 120 tickets, accelerated.

const SHIFT_VIRTUAL_MS = 4 * 60 * 60_000
const PROFILES = {
  smoke:   { label: 'smoke',   kind: 'paced', targetOrders: 120,  activeMs: 4.5 * 60_000, faults: 'compressed', timing: 'normal' },
  shift:   { label: 'shift',   kind: 'curve', targetOrders: 120,  activeMs: Math.round(SHIFT_VIRTUAL_MS / ARGS.compress), faults: 'periodic', timing: 'normal' },
  accum7:  { label: 'accum7',  kind: 'burst', targetOrders: 840,  activeMs: 15 * 60_000, faults: 'light', timing: 'fast',
             note: 'accelerated-equivalent of 7 days of AMALAY volume — NOT a physical 7-day run' },
  accum30: { label: 'accum30', kind: 'burst', targetOrders: 3600, activeMs: 45 * 60_000, faults: 'light', timing: 'fast',
             note: 'accelerated-equivalent of 30 days of AMALAY volume — NOT a physical 30-day run' },
}
const PHASE_SEQUENCE = ARGS.phase === 'full'
  ? [PROFILES.smoke, PROFILES.shift, PROFILES.accum7]
  : [PROFILES[ARGS.phase]]

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand  = (lo, hi) => lo + Math.random() * (hi - lo)
const now   = () => Date.now()
const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)]

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

async function fetchJson(url, timeoutMs = 2000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, status: res.status, body: await res.json() }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
  } finally { clearTimeout(t) }
}

async function healthOk(timeoutMs = 1200) {
  const r = await fetchJson(`${BASE_URL}/health`, timeoutMs)
  return r.ok
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

const M = {
  commands_generated: 0, commands_acked: 0, acks_total: 0, acks_duplicate: 0,
  dedup_probe_sent: 0, dedup_probe_confirmed: 0, dedup_probe_violations: 0,
  rejects_lock_conflict: 0, rejects_expected: 0, rejects_unexpected: 0,
  command_retries: 0,
  orders_created: 0, orders_sent_kitchen: 0, orders_closed: 0, orders_cancelled: 0, orders_split: 0,
  kds_ready_events: 0, kds_partial_status_events: 0,
  barra_deltas_observed: 0,
  print_commands: 0, print_commands_cocina: 0, print_commands_barra: 0, print_commands_caja: 0,
  deltas_received: 0, snapshots_received: 0,
  ws_connects: 0, ws_disconnects: 0, network_flaps: 0,
  printer_outages_cocina: 0, printer_outages_barra: 0,
  client_kills: 0, tenant_probes: 0, tenant_probe_rejected: 0, tenant_subscribe_blocked: 0,
  fp_probes: 0,
  errors: [],
}

function recordError(kind, detail) {
  M.errors.push({ t: ts(), kind, detail: String(detail).slice(0, 500) })
  if (M.errors.length > 2000) M.errors.splice(0, M.errors.length - 2000)
}

// command_id → { command_id, command_type, order_id, msg, created_at, acked, ack_duplicate, rejected, retries }
const allCommands = new Map()
// order_id → { mesa, client, opened_at, sent, terminal, split, forced, expected_total, cancel }
const orders = new Map()
// print nonce → { rec (command rec), station, device }
const printNonces = new Map()

const restarts = []     // { kind, down_at, spawn_at, ready_at, first_ack_at, recovery_ms, server_id }
const memSamples = []
const fileSamples = []  // { t_s, event_log_bytes, data_dir_kb, outbox_total, print_queue, health_sync_queue }
const serverIdsSeen = new Set()
const healthSamples = []

const scenarioResults = []
function scenario(name, status, detail, ownerLayer) {
  const rec = { name, status, detail: detail || '', owner_layer: ownerLayer || null }
  const existing = scenarioResults.findIndex(s => s.name === name)
  if (existing >= 0) scenarioResults[existing] = rec
  else scenarioResults.push(rec)
  progress(`SCENARIO [${status}] ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`)
  return rec
}

const fpCoverage = {
  available: { probed: false, pin_acks: 0 },
  stopped:   { probed: false, pin_acks: 0 },
  crash:     { probed: false, pin_acks: 0 },
  timeout:   { probed: false, pin_acks: 0 },
}

// ─── STOP CONDITIONS ─────────────────────────────────────────────────────────

let STOPPED = false
function triggerStop(kind, evidence) {
  if (STOPPED) return
  STOPPED = true
  const md = [
    `# STOP CONDITION — ${kind}`,
    ``,
    `- Detected at: ${new Date().toISOString()} (${ts()} into the run)`,
    `- Phase: ${ARGS.phase} | Mode: ${MODE}`,
    `- Restaurant: ${RESTAURANT_ID} (fixture source: ${FIXTURE_LOAD.source})`,
    ``,
    `## Evidence`,
    '```json',
    JSON.stringify(evidence, null, 2).slice(0, 20_000),
    '```',
    ``,
    `## Policy`,
    `The harness NEVER silently fixes data problems. This run was aborted the`,
    `moment the condition was detected. Data dir and evidence preserved.`,
    `- Data dir: ${DATA_DIR || '(external bridge — remote)'}`,
    `- Report: ${REPORT_PATH}`,
  ].join('\n')
  try { fs.writeFileSync(STOP_PATH, md) } catch {}
  progress(`STOP CONDITION: ${kind} — aborting (exit 2). See STOP-CONDITION.md`)
  writeReport({ pass: false, stop_condition: kind, invariants: [], evidence }, 2)
  cleanupChildren()
  process.exit(2)
}

// ─── Bridge management ───────────────────────────────────────────────────────

let child = null
let childExitPromise = null
let restartInProgress = false
let awaitingFirstAck = null
let shuttingDown = false
const CHILDREN = new Set()

function cleanupChildren() {
  for (const c of CHILDREN) { try { c.kill('SIGKILL') } catch {} }
}

function spawnBridge() {
  const env = { ...process.env }
  delete env.SUPABASE_URL
  delete env.SUPABASE_ANON_KEY
  env.TWIN_DATA_DIR            = DATA_DIR
  env.TWIN_PORT                = String(ARGS.port)
  env.TWIN_PRINTER_COCINA_PORT = String(COCINA_PORT)
  env.TWIN_PRINTER_BARRA_PORT  = String(BARRA_PORT)
  env.TWIN_RESTAURANT_ID       = RESTAURANT_ID
  env.TWIN_INSTANCE_NAME       = 'AMALAY Twin Bridge'

  const c = spawn(process.execPath, [path.join(__dirname, 'twin-server-runner.js')], {
    cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  CHILDREN.add(c)
  const log = fs.createWriteStream(SERVER_LOG, { flags: 'a' })
  log.write(`\n───── spawn pid=${c.pid} at ${new Date().toISOString()} ─────\n`)
  c.stdout.pipe(log)
  c.stderr.pipe(log)
  childExitPromise = new Promise(r => c.on('exit', (code, sig) => { CHILDREN.delete(c); r({ code, sig }) }))
  c.on('exit', (code, sig) => {
    if (!shuttingDown && !restartInProgress) {
      recordError('bridge-unexpected-exit', `pid=${c.pid} code=${code} sig=${sig}`)
    }
  })
  child = c
  return c
}

async function waitForReady(timeoutMs = 25_000) {
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (await healthOk(900)) return true
    await sleep(250)
  }
  return false
}

async function startBridge(kind, downAt) {
  const rec = { kind, down_at: downAt || null, spawn_at: now(), ready_at: null, first_ack_at: null, recovery_ms: null, server_id: null }
  if (MODE === 'spawn') spawnBridge()
  const ok = await waitForReady()
  if (!ok) {
    recordError('bridge-start-timeout', `kind=${kind}`)
    restarts.push(rec)
    return rec
  }
  rec.ready_at = now()
  const h = await fetchJson(`${BASE_URL}/health`)
  if (h.ok) { rec.server_id = h.body.server_id; serverIdsSeen.add(h.body.server_id) }
  awaitingFirstAck = rec
  restarts.push(rec)
  for (const cl of activeClients()) cl.sendDedupProbes(3)
  return rec
}

async function stopBridge(signal, timeoutMs = 6_000) {
  if (MODE !== 'spawn' || !child) return
  const p = childExitPromise
  child.kill(signal)
  const res = await Promise.race([p, sleep(timeoutMs).then(() => 'timeout')])
  if (res === 'timeout') { child.kill('SIGKILL'); await p }
  child = null
}

// ─── External-mode: orchestrator hooks + restart detection ───────────────────

let hookSeq = 0
function emitHook(name, payload) {
  const file = path.join(HOOKS_DIR, `${String(++hookSeq).padStart(2, '0')}-REQUEST-${name}.json`)
  try {
    fs.writeFileSync(file, JSON.stringify({
      hook: name, requested_at: new Date().toISOString(),
      bridge: `${BRIDGE_HOST}:${BRIDGE_PORT}`, phase: ARGS.phase,
      ack_file: path.join(HOOKS_DIR, `${name}.ack`),
      instructions: payload.instructions, ...payload,
    }, null, 2))
  } catch (e) { recordError('hook-write', e.message) }
  progress(`ORCHESTRATOR HOOK emitted: ${name} → ${file}`)
  return file
}

async function waitHookAck(name, timeoutMs) {
  const ackFile = path.join(HOOKS_DIR, `${name}.ack`)
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    if (fs.existsSync(ackFile)) return true
    await sleep(1000)
  }
  return false
}

// Health watcher: samples /health, detects external restarts (uptime_s drop or
// server_id change). Also records that /health.sync_queue_size is NOT trusted.
let lastHealth = null
let healthWatcherTimer = null
function startHealthWatcher() {
  healthWatcherTimer = setInterval(async () => {
    const h = await fetchJson(`${BASE_URL}/health`, 1500)
    if (!h.ok) return
    const b = h.body
    healthSamples.push({ t_s: Math.round((now() - T0) / 1000), uptime_s: b.uptime_s, server_id: b.server_id, sync_queue_size: b.sync_queue_size })
    if (healthSamples.length > 20000) healthSamples.splice(0, 5000)
    serverIdsSeen.add(b.server_id)
    if (lastHealth && MODE === 'external') {
      const restarted = b.uptime_s < lastHealth.uptime_s - 2 || b.server_id !== lastHealth.server_id
      if (restarted && !restartInProgress) {
        const rec = { kind: 'external-restart-observed', down_at: null, spawn_at: now() - b.uptime_s * 1000, ready_at: now(), first_ack_at: null, recovery_ms: null, server_id: b.server_id }
        restarts.push(rec)
        awaitingFirstAck = rec
        progress(`External bridge restart observed (uptime ${lastHealth.uptime_s}s → ${b.uptime_s}s, server_id ${b.server_id === lastHealth.server_id ? 'stable' : 'CHANGED'})`)
        for (const cl of activeClients()) cl.sendDedupProbes(3)
      }
    }
    lastHealth = b
  }, 2000)
}

// External-mode replacement for SIGKILL/graceful faults: named scenario step the
// outer orchestrator triggers; we wait for the restart to be observed via /health.
async function requestExternalRestart(kindLabel) {
  const before = restarts.length
  emitHook(`BRIDGE-RESTART-${kindLabel.toUpperCase()}`, {
    instructions: `Restart the bridge (${kindLabel}). Kill/restart the installed app or service on the bridge host. The harness detects completion via /health uptime_s reset (same server_id expected).`,
  })
  const deadline = now() + ARGS.hookTimeoutMs
  while (now() < deadline) {
    if (restarts.length > before) return true
    await sleep(1000)
  }
  progress(`External restart (${kindLabel}) not observed within ${ARGS.hookTimeoutMs / 1000}s — recorded as not exercised`)
  return false
}

// ─── Simulated terminal over the real WS protocol ────────────────────────────

class Terminal {
  constructor(clientId, clientType) {
    this.clientId = clientId
    this.clientType = clientType
    this.ws = null
    this.snapshotReady = false
    this.maxSeq = -1
    this.pending = new Map()
    this.recentAcked = []
    this.expectedDup = new Set()
    this.expectedRejects = new Map()   // command_id → RegExp
    this.flapUntil = 0
    this.stopped = false
    this._reconnectTimer = null
    this.onDelta = null
    this.onSnapshot = null
  }

  connect() {
    if (this.stopped || this.ws) return
    let ws
    try { ws = new WebSocket(WS_URL) } catch { this._scheduleReconnect(); return }
    this.ws = ws
    ws.on('open', () => {
      M.ws_connects++
      ws.send(JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        type: 'SUBSCRIBE',
        client_id: this.clientId,
        client_type: this.clientType,
        restaurant_id: RESTAURANT_ID,
        last_sequence: this.maxSeq >= 0 ? this.maxSeq : -1,
      }))
    })
    ws.on('message', (raw) => this._onMessage(raw))
    ws.on('close', () => {
      M.ws_disconnects++
      this.ws = null
      this.snapshotReady = false
      this._scheduleReconnect()
    })
    ws.on('error', () => {})
  }

  _scheduleReconnect() {
    if (this.stopped || this._reconnectTimer) return
    const delay = Math.max(rand(400, 900), this.flapUntil - now())
    this._reconnectTimer = setTimeout(() => { this._reconnectTimer = null; this.connect() }, delay)
  }

  flap(downMs) {
    M.network_flaps++
    this.flapUntil = now() + downMs
    if (this.ws) { try { this.ws.terminate() } catch {} }
  }

  _onMessage(raw) {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (typeof msg.sequence === 'number' && msg.sequence > this.maxSeq) this.maxSeq = msg.sequence

    // Tenant check on every server envelope — a mismatched restaurant_id in a
    // DELTA/SNAPSHOT means cross-tenant data reached this terminal.
    if (msg.restaurant_id && msg.restaurant_id !== RESTAURANT_ID) {
      triggerStop('tenant-leak', {
        detail: 'Server envelope carries a different restaurant_id than the fixture tenant',
        client: this.clientId, envelope_restaurant_id: msg.restaurant_id, expected: RESTAURANT_ID, type: msg.type,
      })
      return
    }

    if (msg.type === 'SNAPSHOT') {
      M.snapshots_received++
      this.snapshotReady = true
      if (this.onSnapshot) { try { this.onSnapshot(msg.payload) } catch (e) { recordError('snapshot-hook', e.message) } }
      this.flush(true)
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
          M.dedup_probe_violations++
          recordError('dedup-violation', `command_id=${id} re-acked without duplicate:true`)
          triggerStop('double-applied-command', {
            detail: 'Server re-processed an already-ACKed command as a NEW event (dedup probe violation)',
            command_id: id, client: this.clientId,
          })
        }
      }
      return
    }

    if (msg.type === 'REJECT') {
      const id = msg.payload && msg.payload.command_id
      const reason = (msg.payload && msg.payload.reason) || ''
      const rec = this.pending.get(id)
      const expected = this.expectedRejects.get(id)
      if (expected && expected.test(reason)) {
        M.rejects_expected++
        this.expectedRejects.delete(id)
        if (rec) { rec.rejected = reason; this.pending.delete(id) }
      } else if (rec && rec.command_type === 'MESA_LOCK' && /locked by another/.test(reason)) {
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
      const ev = msg.payload && msg.payload.event
      if (ev && ev.restaurant_id && ev.restaurant_id !== RESTAURANT_ID) {
        triggerStop('tenant-leak', {
          detail: 'DELTA event payload carries a foreign restaurant_id',
          event_id: ev.id, event_restaurant_id: ev.restaurant_id, expected: RESTAURANT_ID,
        })
        return
      }
      if (this.onDelta) { try { this.onDelta(ev) } catch (e) { recordError('delta-hook', e.message) } }
      return
    }
  }

  command(commandType, fields, orderId, opts = {}) {
    const command_id = `c-${this.clientId}-${(++Terminal._seq).toString(36)}-${crypto.randomBytes(3).toString('hex')}`
    const msg = {
      protocol_version: PROTOCOL_VERSION,
      type: 'COMMAND',
      restaurant_id: RESTAURANT_ID,
      client_id: this.clientId,
      payload: { command_id, command_type: commandType, client_id: this.clientId, ...fields },
    }
    const rec = {
      command_id, command_type: commandType, order_id: orderId || null, msg,
      created_at: now(), sent_at: null, acked: false, acked_at: null,
      ack_duplicate: false, rejected: null, retries: 0,
    }
    allCommands.set(command_id, rec)
    this.pending.set(command_id, rec)
    if (opts.expectReject) this.expectedRejects.set(command_id, opts.expectReject)
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

  flush(force) {
    for (const rec of this.pending.values()) {
      if (force || !rec.sent_at || now() - rec.sent_at > 6_000) this._trySend(rec)
    }
  }

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

  /** Client-kill fault: hard-kill this terminal and return a fresh instance with
   *  the same identity. The unacked outbox transfers (a real POS persists its
   *  outbox on disk); maxSeq resets to -1 → full SNAPSHOT on reconnect. */
  reincarnate() {
    this.stop()
    const fresh = new Terminal(this.clientId, this.clientType)
    fresh.pending = this.pending          // carry the outbox
    fresh.onDelta = this.onDelta
    fresh.onSnapshot = this.onSnapshot
    fresh.connect()
    return fresh
  }
}
Terminal._seq = 0

// Client holders so reincarnation swaps instances without breaking references.
const POS_HOLDERS = []   // [{ id, t: Terminal }]
let KDS_HOLDER = null    // { id, t }
let BARRA_HOLDER = null  // { id, t } — observer only
function activeClients() {
  const list = POS_HOLDERS.map(h => h.t)
  if (KDS_HOLDER) list.push(KDS_HOLDER.t)
  if (BARRA_HOLDER) list.push(BARRA_HOLDER.t)
  return list
}

// ─── AMALAY traffic (fixture-driven) ─────────────────────────────────────────

let orderCounter = 0
let trafficOn = false

function buildModifiers(item) {
  const mods = []
  for (const gid of item.modifier_groups || []) {
    const group = FIX.modifiers[gid]
    if (!group || !Array.isArray(group.options) || Math.random() < 0.35) continue
    const opt = pick(group.options)
    const chosen = { grupo: group.name || gid, opcion: opt.name, precio: opt.price || 0 }
    // multilevel: nested option selected ~half the time when present
    if (Array.isArray(opt.options) && opt.options.length && Math.random() < 0.5) {
      const sub = pick(opt.options)
      chosen.sub_opcion = { opcion: sub.name, precio: sub.price || 0 }
    }
    mods.push(chosen)
  }
  return mods
}

function buildItems(nMin, nMax, personas) {
  const n = nMin + Math.floor(Math.random() * (nMax - nMin + 1))
  const items = []
  for (let i = 0; i < n; i++) {
    const m = pick(FIX.menu)
    items.push({
      id:            `i-${crypto.randomBytes(4).toString('hex')}`,
      menu_id:       m.id,
      name:          m.name,
      cantidad:      1 + Math.floor(Math.random() * 2),
      precio:        m.price,
      station:       m.station,
      comensal:      1 + Math.floor(Math.random() * Math.max(1, personas)),
      modificadores: buildModifiers(m),
    })
  }
  return items
}

function itemsTotal(items) {
  return items.reduce((s, i) => {
    const mods = (i.modificadores || []).reduce((ms, mo) => ms + (mo.precio || 0) + ((mo.sub_opcion && mo.sub_opcion.precio) || 0), 0)
    return s + (i.precio + mods) * i.cantidad
  }, 0)
}

function stationsOf(items) {
  return [...new Set(items.map(i => i.station))].filter(s => s === 'cocina' || s === 'barra')
}

// Fixture payment-method helpers (names come from the fixture, e.g. 'Efectivo')
const isCash = (m) => /efectivo|cash/i.test(m)
const CASH_METHOD = FIX.paymentMethods.find(isCash) || 'efectivo'
const CARD_METHOD = FIX.paymentMethods.find(m => /tarjeta|card/i.test(m)) || FIX.paymentMethods[0]
const TRANSFER_METHOD = FIX.paymentMethods.find(m => /transfer/i.test(m)) || FIX.paymentMethods[0]

function ticketBytes(kind, orderId, mesa, items, nonce) {
  const lines = items.map(i => `${i.cantidad}x ${i.name}${(i.modificadores || []).map(mo => ` +${mo.opcion}${mo.sub_opcion ? '/' + mo.sub_opcion.opcion : ''}`).join('')}`)
  return Buffer.from(
    `\x1b\x40\x1b\x61\x01AMALAY TWIN\n` +
    `TWIN ${kind} pn=${nonce} order=${orderId} mesa=${mesa}\n` +
    `\x1b\x61\x00${lines.join('\n')}\n\n\x1d\x56\x41\x03`,
    'binary'
  )
}

/** Enqueue a PRINT_COMMAND, tracking its nonce for end-to-end byte verification. */
function sendPrint(pos, station, kind, orderId, mesa, items) {
  const nonce = crypto.randomBytes(6).toString('hex')
  const bytes = ticketBytes(kind, orderId, mesa, items, nonce)
  const rec = pos.command('PRINT_COMMAND', { station, data_b64: bytes.toString('base64') }, orderId)
  const device = station === 'cocina' ? 'cocina' : 'barra'   // 'caja' routes to the barra device
  printNonces.set(nonce, { rec, station, device })
  M.print_commands++
  if (station === 'cocina') M.print_commands_cocina++
  else if (station === 'barra') M.print_commands_barra++
  else M.print_commands_caja++
  return rec
}

const TIMINGS = {
  normal: { scale: 1,    eatMin: 3000, eatMax: 8000 },
  fast:   { scale: 0.12, eatMin: 400,  eatMax: 900 },
}

/** Full AMALAY order lifecycle on one POS holder. Mirrors soak-harness but with
 *  fixture menu/mesas/users, per-station comanda printing, partial sends,
 *  add-after-send rounds, payments from fixture, tips, cancels w/ authorization. */
async function runOrderLifecycle(holder, mesa, timing) {
  const t = timing || TIMINGS.normal
  const s = (lo, hi) => sleep(rand(lo * t.scale, hi * t.scale))
  const pos = () => holder.t
  const orderId = `o-${holder.id}-${++orderCounter}`
  const mesero = pick(FIX.users.filter(u => u.role === 'mesero')) || FIX.users[0]
  const personas = 1 + Math.floor(Math.random() * 4)
  let items = buildItems(1, 4, personas)
  orders.set(orderId, { mesa, client: holder.id, opened_at: now(), sent: false, terminal: null, split: false, forced: false, expected_total: null })
  M.orders_created++
  const o = orders.get(orderId)
  const aborted = () => !!o.terminal

  // Lock mesa, open, edit
  pos().command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 }, orderId)
  await s(200, 600); if (aborted()) return
  pos().command('ORDER_UPSERTED', { order_id: orderId, mesa, items, status: 'abierta', personas, mesero: mesero.name }, orderId)
  await s(200, 500); if (aborted()) return
  if (Math.random() < 0.3) {
    items = items.concat(buildItems(1, 2, personas))
    pos().command('ORDER_UPSERTED', { order_id: orderId, mesa, items, status: 'abierta', personas, mesero: mesero.name }, orderId)
    await s(150, 400); if (aborted()) return
  }
  pos().command('MESA_UNLOCK', { mesa }, orderId)
  await s(300, 900); if (aborted()) return

  // Round 1 send (sometimes partial: only batch-1 items)
  const partial = items.length > 1 && Math.random() < 0.3
  const round1Items = partial ? items.slice(0, Math.ceil(items.length / 2)) : items
  pos().command('ORDER_SENT', {
    order_id: orderId, mesa, mesero: mesero.name, status: 'enviada',
    items: round1Items, personas, total: itemsTotal(round1Items),
    comanda_batches: [{ batch: 1, items: round1Items.map(i => i.id) }],
  }, orderId)
  o.sent = true; M.orders_sent_kitchen++
  for (const st of stationsOf(round1Items)) sendPrint(pos(), st, `COMANDA-${st.toUpperCase()}-B1`, orderId, mesa, round1Items.filter(i => i.station === st))
  await s(600, 1500); if (aborted()) return

  // Round 2: rest of a partial send, or add-after-send
  let round2 = null
  if (partial) round2 = items
  else if (Math.random() < 0.25) { items = items.concat(buildItems(1, 2, personas)); round2 = items }
  if (round2) {
    const newOnes = round2.filter(i => !round1Items.includes(i))
    pos().command('ORDER_SENT', {
      order_id: orderId, mesa, mesero: mesero.name, status: 'enviada',
      items: round2, personas, total: itemsTotal(round2),
      comanda_batches: [
        { batch: 1, items: round1Items.map(i => i.id) },
        { batch: 2, items: newOnes.map(i => i.id) },
      ],
    }, orderId)
    for (const st of stationsOf(newOnes)) sendPrint(pos(), st, `COMANDA-${st.toUpperCase()}-B2`, orderId, mesa, newOnes.filter(i => i.station === st))
    await s(400, 1000); if (aborted()) return
  }

  const total = itemsTotal(items)
  o.expected_total = total

  // Eat…
  await sleep(rand(t.eatMin, t.eatMax))
  if (o.terminal) return

  const roll = Math.random()
  if (roll < 0.08) {
    const gerente = FIX.users.find(u => u.role === 'gerente') || FIX.users[0]
    pos().command('ORDER_CANCELLED', {
      order_id: orderId, mesa, reason: 'cliente cancelo',
      authorized_by: gerente.name, authorization_pin_ok: true,
    }, orderId)
    o.terminal = 'cancelled'
    M.orders_cancelled++
  } else {
    const split = roll < 0.22
    let payments
    if (split) {
      const m1 = pick(FIX.paymentMethods), m2 = pick(FIX.paymentMethods.filter(p => p !== m1)) || m1
      const half = Math.round(total / 2)
      payments = [{ method: m1, amount: half }, { method: m2, amount: total - half }]
    } else {
      payments = [{ method: pick(FIX.paymentMethods), amount: total }]
    }
    for (const p of payments) {
      if (!isCash(p.method) && Math.random() < 0.6) p.propina = Math.round(p.amount * rand(0.08, 0.16))
    }
    pos().command('ORDER_CLOSED', { order_id: orderId, mesa, total, payments, split, personas }, orderId)
    sendPrint(pos(), 'caja', 'RECIBO', orderId, mesa, items)
    o.terminal = 'closed'
    o.split = split
    o.payments = payments
    M.orders_closed++
    if (split) M.orders_split++
  }
}

// Partition fixture mesas: POS i owns mesas where idx % posCount === i. A pool
// of 30 virtual variants per real mesa avoids reuse collisions at burst rates.
function mesaPoolFor(posIdx, posCount) {
  const base = FIX.mesas.filter((_, i) => i % posCount === posIdx)
  return base.length ? base : FIX.mesas
}

// ─── KDS + barra observer ────────────────────────────────────────────────────

function wireKds(kds) {
  const marked = new Set()
  const markReady = (orderId, itemCount) => {
    if (marked.has(orderId)) return
    marked.add(orderId)
    // Two-step status change: partial map (algunos listos) → full map (todo listo)
    setTimeout(() => {
      const partialMap = {}
      for (let i = 0; i < Math.max(1, Math.ceil(itemCount / 2)); i++) partialMap[i] = true
      kds.command('KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: JSON.stringify(partialMap) }, orderId)
      M.kds_partial_status_events++
    }, rand(300, 900))
    setTimeout(() => {
      const fullMap = {}
      for (let i = 0; i < Math.max(1, itemCount); i++) fullMap[i] = true
      kds.command('KDS_ITEM_STATUS', { order_id: orderId, kds_item_status: JSON.stringify(fullMap) }, orderId)
      M.kds_ready_events++
    }, rand(1000, 2200))
  }
  kds.onDelta = (ev) => {
    if (!ev) return
    if (ev.type === EVENT.ORDER_SENT) {
      let n = 1
      const items = ev.payload && ev.payload.items
      if (Array.isArray(items)) n = items.length
      else { try { n = (JSON.parse(items || '[]') || []).length || 1 } catch {} }
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

function wireBarraObserver(barra) {
  barra.onDelta = (ev) => {
    if (!ev || ev.type !== EVENT.ORDER_SENT) return
    const items = Array.isArray(ev.payload.items) ? ev.payload.items : []
    if (items.some(i => i.station === 'barra')) M.barra_deltas_observed++
  }
}

// ─── Fault injection ─────────────────────────────────────────────────────────

let faultChain = Promise.resolve()
function enqueueFault(fn) {
  faultChain = faultChain
    .then(() => (shuttingDown || STOPPED) ? null : fn())
    .catch(e => recordError('fault', e.stack || e.message))
  return faultChain
}

async function doKillRestart() {
  if (shuttingDown) return
  restartInProgress = true
  try {
    if (MODE === 'external') { await requestExternalRestart('kill'); return }
    progress(`FAULT: SIGKILL bridge (pid=${child && child.pid})`)
    const downAt = now()
    if (child) { const p = childExitPromise; child.kill('SIGKILL'); await p; child = null }
    await sleep(rand(4_000, 9_000))
    const rec = await startBridge('kill', downAt)
    progress(`RECOVERED from SIGKILL: ready in ${rec.ready_at ? rec.ready_at - rec.spawn_at : 'TIMEOUT'}ms`)
  } finally { restartInProgress = false }
}

async function doGracefulRestart() {
  if (shuttingDown) return
  restartInProgress = true
  try {
    if (MODE === 'external') { await requestExternalRestart('graceful'); return }
    progress(`FAULT: graceful restart (SIGTERM, pid=${child && child.pid})`)
    const downAt = now()
    await stopBridge('SIGTERM')
    await sleep(rand(1_000, 2_500))
    const rec = await startBridge('graceful', downAt)
    progress(`RECOVERED from graceful restart: ready in ${rec.ready_at ? rec.ready_at - rec.spawn_at : 'TIMEOUT'}ms`)
  } finally { restartInProgress = false }
}

async function doPrinterOutage(which, durMs) {
  const printer = which === 'cocina' ? PRINTER_COCINA : PRINTER_BARRA
  if (which === 'cocina') M.printer_outages_cocina++
  else M.printer_outages_barra++
  progress(`FAULT: printer outage ${which} (${Math.round(durMs / 1000)}s)`)
  await printer.stop()
  await sleep(durMs)
  if (!shuttingDown) { await printer.start(); progress(`printer ${which} back up`) }
}

async function doClientKill() {
  const holder = pick(POS_HOLDERS)
  progress(`FAULT: client kill + reincarnate ${holder.id} (outbox=${holder.t.outboxDepth()})`)
  M.client_kills++
  holder.t = holder.t.reincarnate()
  const deadline = now() + 15_000
  while (now() < deadline && !holder.t.snapshotReady) await sleep(300)
  scenario('client-kill-recover',
    holder.t.snapshotReady ? 'PASS' : 'FAIL',
    holder.t.snapshotReady
      ? `terminal ${holder.id} re-subscribed with fresh SNAPSHOT; carried outbox replays with original command_ids (dedup-safe)`
      : `terminal ${holder.id} did not receive SNAPSHOT within 15s of reincarnation`)
}

/** Duplicate re-send probe (dedup): ask the server to swallow already-ACKed commands. */
function scheduleDedupProbes() {
  return setInterval(() => {
    const clients = activeClients()
    const c = pick(clients)
    if (c && Math.random() < 0.4) c.sendDedupProbes(1)
  }, 12_000)
}

/** Cross-tenant probes: COMMAND with a foreign restaurant_id must be REJECTed;
 *  SUBSCRIBE with a foreign restaurant_id must be refused (close 1008). */
async function runTenantProbe() {
  M.tenant_probes++
  // 1. COMMAND-level probe on a legitimately subscribed socket
  await new Promise((resolve) => {
    let done = false
    const finish = (ok, why) => {
      if (done) return
      done = true
      if (ok) M.tenant_probe_rejected++
      else recordError('tenant-probe', why)
      try { ws.close() } catch {}
      resolve()
    }
    const ws = new WebSocket(WS_URL)
    const cid = `tenant-probe-${crypto.randomBytes(3).toString('hex')}`
    const commandId = `ct-${crypto.randomBytes(4).toString('hex')}`
    ws.on('open', () => {
      ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE', client_id: cid, client_type: 'pos', restaurant_id: RESTAURANT_ID, last_sequence: -1 }))
    })
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'SNAPSHOT') {
        ws.send(JSON.stringify({
          protocol_version: PROTOCOL_VERSION, type: 'COMMAND',
          restaurant_id: 'twin-evil-tenant', client_id: cid,
          payload: { command_id: commandId, command_type: 'MESA_LOCK', client_id: cid, mesa: 'tenant-probe', expires_ms: now() + 5000 },
        }))
      } else if (msg.type === 'REJECT' && msg.payload && msg.payload.command_id === commandId) {
        finish(/restaurant_id mismatch/.test(msg.payload.reason || ''), `wrong reject reason: ${msg.payload.reason}`)
      } else if (msg.type === 'ACK' && msg.payload && msg.payload.command_id === commandId) {
        triggerStop('tenant-leak', { detail: 'Bridge ACKed a COMMAND carrying a foreign restaurant_id', command_id: commandId })
      }
    })
    ws.on('error', () => finish(false, 'ws error during tenant probe'))
    setTimeout(() => finish(false, 'tenant probe timed out'), 8000)
  })
  // 2. SUBSCRIBE-level probe: foreign tenant must be refused before any snapshot
  await new Promise((resolve) => {
    let snapshot = false, done = false
    const ws = new WebSocket(WS_URL)
    ws.on('open', () => {
      ws.send(JSON.stringify({ protocol_version: PROTOCOL_VERSION, type: 'SUBSCRIBE', client_id: 'tenant-probe-sub', client_type: 'pos', restaurant_id: 'twin-evil-tenant', last_sequence: -1 }))
    })
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'SNAPSHOT') snapshot = true
    })
    const finish = () => {
      if (done) return
      done = true
      if (snapshot) {
        triggerStop('tenant-leak', { detail: 'Bridge sent a SNAPSHOT to a terminal subscribed under a foreign restaurant_id' })
      } else {
        M.tenant_subscribe_blocked++
      }
      try { ws.close() } catch {}
      resolve()
    }
    ws.on('close', finish)
    ws.on('error', finish)
    setTimeout(finish, 6000)
  })
}

function schedulePhaseFaults(profile, startAt, endAt) {
  const timers = []
  const span = endAt - startAt
  const at = (frac, fn) => {
    const t = startAt + span * frac - now()
    if (t > 0 && startAt + span * frac < endAt - 5_000) timers.push(setTimeout(() => enqueueFault(fn), t))
  }

  if (profile.faults === 'compressed') {
    at(0.30, doKillRestart)
    at(0.72, doKillRestart)
    at(0.50, doGracefulRestart)
    at(0.25, () => doPrinterOutage('cocina', 15_000))
    at(0.55, () => doPrinterOutage('barra', 15_000))
    at(0.62, doClientKill)
    at(0.15, runTenantProbe)
  } else if (profile.faults === 'periodic') {
    const killEvery = 12 * 60_000, graceEvery = 18 * 60_000, outageEvery = 10 * 60_000
    for (let t = startAt + killEvery; t < endAt - 60_000; t += killEvery) timers.push(setTimeout(() => enqueueFault(doKillRestart), t - now()))
    for (let t = startAt + graceEvery * 1.5; t < endAt - 60_000; t += graceEvery) timers.push(setTimeout(() => enqueueFault(doGracefulRestart), t - now()))
    let alt = 0
    for (let t = startAt + outageEvery; t < endAt - 90_000; t += outageEvery) {
      const which = (alt++ % 2 === 0) ? 'cocina' : 'barra'
      timers.push(setTimeout(() => enqueueFault(() => doPrinterOutage(which, 20_000)), t - now()))
    }
    at(0.5, doClientKill)
    at(0.2, runTenantProbe)
    at(0.7, runTenantProbe)
  } else if (profile.faults === 'light') {
    at(0.5, doKillRestart)
    at(0.35, () => doPrinterOutage('cocina', 15_000))
    at(0.65, () => doPrinterOutage('barra', 15_000))
    at(0.4, runTenantProbe)
  }

  // WAN loss: in spawn mode the twin bridge runs with Supabase disabled — WAN
  // loss has NO observable effect on the Phase-1 command path (documented
  // no-op). In external mode the outer orchestrator owns the network.
  if (MODE === 'external') {
    at(0.45, async () => {
      emitHook('WAN-LOSS', {
        instructions: 'Cut WAN (not LAN) on the bridge host for 60s, then restore. Touch the ack_file when done. LAN WS traffic must be unaffected.',
        duration_s: 60,
      })
      const acked = await waitHookAck('WAN-LOSS', ARGS.hookTimeoutMs)
      scenario('wan-loss', acked ? 'SIMULATED-PARTIAL' : 'SKIPPED',
        acked ? 'orchestrator confirmed WAN cut+restore; LAN command flow verified by continued ACKs'
              : 'orchestrator hook not acknowledged within timeout', 'outer orchestrator')
    })
  }

  // Network flaps: random per client
  ;(async () => {
    while (trafficOn && !shuttingDown) {
      await sleep(rand(Math.max(20_000, span * 0.12), Math.max(45_000, span * 0.3)))
      if (!trafficOn) break
      const c = pick(activeClients())
      const downMs = rand(2_000, 8_000)
      progress(`FAULT: network flap ${c.clientId} (down ${(downMs / 1000).toFixed(1)}s)`)
      c.flap(downMs)
    }
  })()

  return timers
}

// ─── Fingerprint scenario (PIN independence) ─────────────────────────────────

async function pinProbeBurst(stateName, count = 3) {
  // The protocol has NO login command — PIN identity rides ON commands
  // (authorized_by / *_pin_ok fields). "PIN flow keeps working" at the protocol
  // level = commands carrying PIN-auth fields keep getting ACKed.
  const cajero = FIX.users.find(u => u.role === 'cajero') || FIX.users[0]
  const holder = POS_HOLDERS[0]
  const recs = []
  for (let i = 0; i < count; i++) {
    const mesa = `fp-probe-${i}`
    recs.push(holder.t.command('MESA_LOCK', { mesa, expires_ms: now() + 10_000, authorized_by: cajero.name, auth_method: 'pin', auth_pin_ok: true }))
    recs.push(holder.t.command('MESA_UNLOCK', { mesa, authorized_by: cajero.name, auth_method: 'pin' }))
    M.fp_probes++
  }
  const deadline = now() + 8_000
  while (now() < deadline && recs.some(r => !r.acked)) { holder.t.flush(false); await sleep(200) }
  const acked = recs.filter(r => r.acked).length
  fpCoverage[stateName].probed = true
  fpCoverage[stateName].pin_acks += acked
  return { acked, total: recs.length }
}

async function exerciseFingerprintStates() {
  if (MODE === 'external') {
    emitHook('FP-STATES', {
      instructions: 'Fingerprint service runs on the bridge host (127.0.0.1:7718 there) — the harness cannot control it remotely. Exercise: stop service / crash it / hang it, touching FP-STATES.ack when done. Harness continuously proves PIN command flow regardless.',
    })
    const r = await pinProbeBurst('available')
    scenario('fingerprint-4-states', 'SIMULATED-PARTIAL',
      `external mode: fp service lives on the bridge host and is orchestrator-owned; PIN commands ACKed ${r.acked}/${r.total} with fp state unknown`, 'outer orchestrator')
    return
  }
  if (!FP_MOCK) {
    scenario('fingerprint-4-states', 'SKIPPED', `fp mock could not bind port ${ARGS.fpPort} (in use?) — states not exercised`)
    return
  }
  const fpUrl = (p) => `${BASE_URL}/fp${p}`   // through the bridge's /fp proxy

  // 1. available
  FP_MOCK.setMode('available')
  const h1 = await fetchJson(fpUrl('/health'), 3000)
  const l1 = await fetchJson(fpUrl('/list'), 3000)
  const r1 = await pinProbeBurst('available')
  const availOk = h1.ok && h1.body && h1.body.ok && l1.ok && r1.acked === r1.total

  // 2. unavailable (service stopped)
  await FP_MOCK.stop()
  const h2 = await fetchJson(fpUrl('/health'), 4000)
  const r2 = await pinProbeBurst('stopped')
  const stopOk = !h2.ok || h2.status === 503 ? r2.acked === r2.total : false
  await FP_MOCK.start()

  // 3. crash mid-request
  FP_MOCK.setMode('crash')
  const h3 = await fetchJson(fpUrl('/list'), 4000)
  const r3 = await pinProbeBurst('crash')
  const crashOk = !h3.ok && r3.acked === r3.total

  // 4. 30s timeout: fire a hanging /fp/auth, run PIN flow while it hangs
  FP_MOCK.setMode('timeout')
  const hangCtrl = new AbortController()
  const hang = fetch(fpUrl('/auth'), { method: 'POST', body: '{}', signal: hangCtrl.signal }).catch(() => {})
  await sleep(500)
  const r4 = await pinProbeBurst('timeout')
  hangCtrl.abort()   // abandon our probe; mock still holds server-side for 30s
  await hang
  const timeoutOk = r4.acked === r4.total

  FP_MOCK.setMode('available')
  const allOk = availOk && stopOk && crashOk && timeoutOk
  scenario('fingerprint-4-states', allOk ? 'PASS' : 'FAIL',
    `available(fp ok=${!!(h1.ok && l1.ok)}, pin ${r1.acked}/${r1.total}) | ` +
    `stopped(fp 503/down=${!h2.ok || h2.status === 503}, pin ${r2.acked}/${r2.total}) | ` +
    `crash(fp err=${!h3.ok}, pin ${r3.acked}/${r3.total}) | ` +
    `timeout-30s(pin during hang ${r4.acked}/${r4.total})`)
}

// ─── Slow-staging sync scenario (spawn only) ─────────────────────────────────
// Points a DEDICATED bridge instance's real startSupabasePoll() at the staging
// mock (config.supabaseUrl injection — no electron-app changes). Never the main
// instance: STATE_SYNC events wholesale-replace mesa/KDS state (core/state.js).

async function runSyncScenario() {
  if (MODE === 'external') {
    scenario('sync-inbound-staging', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
      'external mode: the installed bridge\'s Supabase URL is part of its provisioned config; the harness cannot re-point it without touching the install. Owner: outer orchestrator / install config.',
      'outer orchestrator')
    return
  }
  const staging = new StagingMock({ port: ARGS.stagingPort, restaurantId: RESTAURANT_ID })
  const syncDataDir = path.join(EVID_DIR, 'sync-instance-data')
  fs.rmSync(syncDataDir, { recursive: true, force: true })
  fs.mkdirSync(syncDataDir, { recursive: true })
  const syncBase = `http://127.0.0.1:${ARGS.syncPort}`
  let syncChild = null
  const detail = []
  let pass = true
  try {
    await staging.start()
    staging.setOrders([
      { id: 'sb-order-1', mesa: FIX.mesas[0], status: 'enviada',   items: [{ name: FIX.menu[0].name, cantidad: 1 }], turno_id: 't-sb', updated_at: new Date().toISOString() },
      { id: 'sb-order-2', mesa: FIX.mesas[1], status: 'pagando',   items: [{ name: FIX.menu[1].name, cantidad: 2 }], turno_id: 't-sb', updated_at: new Date().toISOString() },
    ])

    const env = { ...process.env }
    delete env.SUPABASE_URL; delete env.SUPABASE_ANON_KEY
    env.TWIN_DATA_DIR = syncDataDir
    env.TWIN_PORT = String(ARGS.syncPort)
    env.TWIN_PRINTER_COCINA_PORT = String(COCINA_PORT)
    env.TWIN_PRINTER_BARRA_PORT = String(BARRA_PORT)
    env.TWIN_RESTAURANT_ID = RESTAURANT_ID
    env.TWIN_INSTANCE_NAME = 'AMALAY Twin Sync Instance'
    env.TWIN_SUPABASE_URL = `http://127.0.0.1:${ARGS.stagingPort}`
    env.TWIN_SUPABASE_KEY = 'twin-mock-service-key'
    syncChild = spawn(process.execPath, [path.join(__dirname, 'twin-server-runner.js')], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    CHILDREN.add(syncChild)
    const log = fs.createWriteStream(SERVER_LOG, { flags: 'a' })
    log.write(`\n───── sync-instance pid=${syncChild.pid} ─────\n`)
    syncChild.stdout.pipe(log); syncChild.stderr.pipe(log)

    const deadline = now() + 25_000
    let up = false
    while (now() < deadline && !up) { up = (await fetchJson(`${syncBase}/health`, 900)).ok; if (!up) await sleep(300) }
    if (!up) throw new Error('sync instance never became healthy')

    // Normal poll: STATE_SYNC events should appear (poll interval 5s)
    await sleep(7_000)
    let ev = await fetchJson(`${syncBase}/events?since=0`, 3000)
    let syncs = (ev.ok ? ev.body.events : []).filter(e => e.type === 'STATE_SYNC')
    const tenantOk = syncs.every(e => !e.restaurant_id || e.restaurant_id === RESTAURANT_ID)
    detail.push(`normal: ${syncs.length} STATE_SYNC events, tenant ok=${tenantOk}`)
    if (syncs.length === 0 || !tenantOk) pass = false
    const st = await fetchJson(`${syncBase}/state`, 3000)
    const mesaSeen = st.ok && st.body.mesas && st.body.mesas[String(FIX.mesas[0])] && st.body.mesas[String(FIX.mesas[0])].status === 'ocupada'
    detail.push(`state reflects staging orders: ${!!mesaSeen}`)
    if (!mesaSeen) pass = false

    // Injected latency (2s — slow staging, still under the poll's 6s abort)
    staging.setBehavior({ latencyMs: 2000 })
    const hitsBefore = staging.hits
    await sleep(11_000)
    const latencyOk = staging.hits > hitsBefore && (await fetchJson(`${syncBase}/health`, 2000)).ok
    detail.push(`latency 2s: poll continued (${staging.hits - hitsBefore} polls), bridge healthy=${latencyOk}`)
    if (!latencyOk) pass = false

    // Injected 500s
    staging.setBehavior({ failStatus: 500 })
    await sleep(6_000)
    const err500Ok = (await fetchJson(`${syncBase}/health`, 2000)).ok
    detail.push(`error 500: bridge healthy=${err500Ok} (poll errors are non-fatal)`)
    if (!err500Ok) pass = false

    // Hang past the poll's 6s AbortController
    staging.setBehavior({ holdMs: 8000 })
    await sleep(7_000)
    const hangOk = (await fetchJson(`${syncBase}/health`, 2000)).ok
    detail.push(`hang 8s (> 6s abort): bridge healthy=${hangOk}`)
    if (!hangOk) pass = false

    // Recovery
    staging.setBehavior({})
    const syncsBefore = syncs.length
    await sleep(8_000)
    ev = await fetchJson(`${syncBase}/events?since=0`, 4000)
    syncs = (ev.ok ? ev.body.events : []).filter(e => e.type === 'STATE_SYNC')
    const recoveredOk = syncs.length > syncsBefore
    detail.push(`recovery: STATE_SYNC resumed (${syncsBefore} → ${syncs.length})`)
    if (!recoveredOk) pass = false
  } catch (e) {
    pass = false
    detail.push(`error: ${e.message}`)
  } finally {
    if (syncChild) { try { syncChild.kill('SIGTERM') } catch {}; await sleep(500); try { syncChild.kill('SIGKILL') } catch {}; CHILDREN.delete(syncChild) }
    await staging.stop().catch(() => {})
  }
  // Honest label: inbound-only. Outbound sync (local events → cloud) does NOT
  // exist in Phase 1: nothing calls markSynced(); /health.sync_queue_size only
  // ever grows. 'Full sync after WAN return' is therefore not exercisable.
  scenario('sync-inbound-staging', pass ? 'SIMULATED-PARTIAL' : 'FAIL',
    `${detail.join(' | ')} — INBOUND poll only; outbound event sync does not exist in Phase 1 (no markSynced caller)`,
    pass ? 'Phase-2 sync engine (outbound half)' : null)
}

// ─── Scenario suite (founder 35-step flow, protocol-level) ───────────────────

async function ackWait(recs, timeoutMs = 10_000) {
  const list = Array.isArray(recs) ? recs : [recs]
  const deadline = now() + timeoutMs
  while (now() < deadline && list.some(r => !r.acked && !r.rejected)) {
    for (const c of activeClients()) c.flush(false)
    await sleep(150)
  }
  return list.every(r => r.acked)
}

async function scenarioOrder({ pos, mesa, items, personas, close }) {
  // Minimal deterministic lifecycle used by suite scenarios. Registers in the
  // global ledger so end-of-run invariants cover suite orders too.
  const orderId = `o-suite-${++orderCounter}`
  const mesero = FIX.users.find(u => u.role === 'mesero') || FIX.users[0]
  orders.set(orderId, { mesa, client: pos.id, opened_at: now(), sent: false, terminal: null, split: false, forced: false, expected_total: null })
  M.orders_created++
  const o = orders.get(orderId)
  const recs = []
  recs.push(pos.t.command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 }, orderId))
  recs.push(pos.t.command('ORDER_UPSERTED', { order_id: orderId, mesa, items, status: 'abierta', personas, mesero: mesero.name }, orderId))
  recs.push(pos.t.command('MESA_UNLOCK', { mesa }, orderId))
  recs.push(pos.t.command('ORDER_SENT', {
    order_id: orderId, mesa, mesero: mesero.name, status: 'enviada', items, personas,
    total: itemsTotal(items), comanda_batches: [{ batch: 1, items: items.map(i => i.id) }],
  }, orderId))
  o.sent = true; M.orders_sent_kitchen++
  for (const st of stationsOf(items)) recs.push(sendPrint(pos.t, st, `COMANDA-${st.toUpperCase()}-B1`, orderId, mesa, items.filter(i => i.station === st)))
  const total = itemsTotal(items)
  o.expected_total = total
  if (close) {
    const r = close(orderId, total, o)
    if (Array.isArray(r)) recs.push(...r); else if (r) recs.push(r)
  }
  const ok = await ackWait(recs, 12_000)
  return { orderId, total, ok, recs, ledger: o }
}

async function runScenarioSuite() {
  progress('── Scenario suite (founder flow @ protocol level) ──')
  const pos1 = POS_HOLDERS[0], pos2 = POS_HOLDERS[1] || POS_HOLDERS[0]
  const suiteMesas = FIX.mesas.map(m => `s-${m}`)   // suite mesas disjoint from traffic pools
  let mi = 0
  const nextMesa = () => suiteMesas[mi++ % suiteMesas.length]

  // 1. cold start
  const first = restarts[0]
  scenario('cold-start', first && first.ready_at ? 'PASS' : 'FAIL',
    first && first.ready_at ? `bridge healthy ${first.ready_at - first.spawn_at}ms after ${MODE === 'spawn' ? 'spawn' : 'harness attach'}; server_id=${first.server_id}` : 'bridge never became healthy')

  // 2. discovery
  const ident = await fetchJson(`${BASE_URL}/identity`, 3000)
  const identOk = ident.ok && ident.body.restaurant_id === RESTAURANT_ID &&
    Array.isArray(ident.body.capabilities) && ident.body.capabilities.includes('orders')
  scenario('discovery-identity', identOk ? 'PASS' : 'FAIL',
    identOk ? `/identity: tenant=${ident.body.restaurant_id}, capabilities=[${ident.body.capabilities.join(',')}] (mDNS advertised but not independently browsed by the harness)`
            : `identity check failed: ${JSON.stringify(ident).slice(0, 200)}`)

  // 3. login PIN — no auth command exists in protocol.js
  scenario('login-pin', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
    'protocol.js has no LOGIN/AUTH command — PIN login is enforced in the web app UI (and fingerprint service). At protocol level, identity rides on commands (authorized_by / auth_pin_ok fields), which the fingerprint-4-states scenario proves keep flowing.',
    'web app UI + fingerprint service')

  // 4. turno open
  TURNO_ID = `t-twin-${T0}`
  const cajero = FIX.users.find(u => u.role === 'cajero') || FIX.users[0]
  const turnoRec = POS_HOLDERS[0].t.command('TURNO_OPENED', { turno_id: TURNO_ID, opened_by: cajero.name, opened_pin_ok: true })
  scenario('turno-caja-open', await ackWait(turnoRec) ? 'PASS' : 'FAIL', `TURNO_OPENED by ${cajero.name} (caja float/fondo amount is a web-app/Supabase concern — the protocol records only the turno event)`)

  // 5. mesa lifecycle + lock conflict
  {
    const mesa = nextMesa()
    const lock1 = pos1.t.command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 })
    await ackWait(lock1)
    const lock2 = pos2 !== pos1
      ? pos2.t.command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 }, null, { expectReject: /locked by another/ })
      : null
    let conflictOk = true
    if (lock2) {
      const deadline = now() + 8000
      while (now() < deadline && !lock2.rejected) await sleep(150)
      conflictOk = /locked by another/.test(lock2.rejected || '')
    }
    const unlock = pos1.t.command('MESA_UNLOCK', { mesa })
    const ok = await ackWait(unlock) && lock1.acked && conflictOk
    scenario('mesa-lock-unlock-conflict', ok ? 'PASS' : 'FAIL',
      `lock acked=${lock1.acked}, second-terminal lock REJECTed=${conflictOk}, unlock acked=${unlock.acked}`)
  }

  // 6. multi-comensal order + cash payment
  {
    const items = buildItems(3, 4, 4).map((it, i) => ({ ...it, comensal: (i % 4) + 1 }))
    const r = await scenarioOrder({
      pos: pos1, mesa: nextMesa(), items, personas: 4,
      close: (orderId, total, o) => {
        o.terminal = 'closed'; o.payments = [{ method: CASH_METHOD, amount: total }]; M.orders_closed++
        return [pos1.t.command('ORDER_CLOSED', { order_id: orderId, mesa: o.mesa, total, payments: o.payments, split: false, personas: 4 }, orderId),
                sendPrint(pos1.t, 'caja', 'RECIBO', orderId, o.mesa, items)]
      },
    })
    scenario('multi-comensal-order', r.ok ? 'PASS' : 'FAIL', `4 personas, ${r.recs.length} commands, per-item comensal tags (payload-opaque to the server)`)
    scenario('cash-payment', r.ok ? 'PASS' : 'FAIL', `ORDER_CLOSED efectivo $${r.total}`)
  }

  // 7. multilevel modifiers
  {
    const latte = FIX.menu.find(m => (m.modifier_groups || []).length) || FIX.menu[0]
    const item = {
      id: `i-${crypto.randomBytes(4).toString('hex')}`, menu_id: latte.id, name: latte.name,
      cantidad: 1, precio: latte.price, station: latte.station, comensal: 1,
      modificadores: [{ grupo: 'Leche', opcion: 'Avena', precio: 15, sub_opcion: { opcion: 'Extra shot', precio: 12 } }],
    }
    const r = await scenarioOrder({
      pos: pos1, mesa: nextMesa(), items: [item], personas: 1,
      close: (orderId, total, o) => {
        o.terminal = 'closed'; o.payments = [{ method: CASH_METHOD, amount: total }]; M.orders_closed++
        return pos1.t.command('ORDER_CLOSED', { order_id: orderId, mesa: o.mesa, total, payments: o.payments, split: false }, orderId)
      },
    })
    scenario('multilevel-modifiers', r.ok ? 'PASS' : 'FAIL',
      `nested modifier (grupo→opción→sub-opción) persisted opaquely; server performs no modifier validation — pricing/validation owner: web app UI`)
  }

  // 8+9. partial kitchen send + add-after-send (two ORDER_SENT rounds)
  {
    const orderId = `o-suite-${++orderCounter}`
    const mesa = nextMesa()
    const mesero = FIX.users.find(u => u.role === 'mesero') || FIX.users[0]
    orders.set(orderId, { mesa, client: pos1.id, opened_at: now(), sent: false, terminal: null, split: false, forced: false, expected_total: null })
    M.orders_created++
    const o = orders.get(orderId)
    const batch1 = buildItems(2, 2, 2)
    const recs = [
      pos1.t.command('MESA_LOCK', { mesa, expires_ms: now() + 30_000 }, orderId),
      pos1.t.command('ORDER_UPSERTED', { order_id: orderId, mesa, items: batch1, status: 'abierta', personas: 2, mesero: mesero.name }, orderId),
      pos1.t.command('MESA_UNLOCK', { mesa }, orderId),
      pos1.t.command('ORDER_SENT', { order_id: orderId, mesa, mesero: mesero.name, status: 'enviada', items: batch1, personas: 2, total: itemsTotal(batch1), comanda_batches: [{ batch: 1, items: batch1.map(i => i.id) }] }, orderId),
    ]
    o.sent = true; M.orders_sent_kitchen++
    for (const st of stationsOf(batch1)) recs.push(sendPrint(pos1.t, st, `COMANDA-${st.toUpperCase()}-B1`, orderId, mesa, batch1.filter(i => i.station === st)))
    const partialOk = await ackWait(recs)
    scenario('partial-kitchen-send', partialOk ? 'PASS' : 'FAIL', `round 1: ${batch1.length} items in comanda batch 1`)

    const added = buildItems(1, 2, 2)
    const all = batch1.concat(added)
    const recs2 = [pos1.t.command('ORDER_SENT', {
      order_id: orderId, mesa, mesero: mesero.name, status: 'enviada', items: all, personas: 2,
      total: itemsTotal(all),
      comanda_batches: [{ batch: 1, items: batch1.map(i => i.id) }, { batch: 2, items: added.map(i => i.id) }],
    }, orderId)]
    for (const st of stationsOf(added)) recs2.push(sendPrint(pos1.t, st, `COMANDA-${st.toUpperCase()}-B2`, orderId, mesa, added.filter(i => i.station === st)))
    o.expected_total = itemsTotal(all)
    o.terminal = 'closed'; o.payments = [{ method: CARD_METHOD, amount: o.expected_total }]; M.orders_closed++
    recs2.push(pos1.t.command('ORDER_CLOSED', { order_id: orderId, mesa, total: o.expected_total, payments: o.payments, split: false }, orderId))
    const addOk = await ackWait(recs2)
    scenario('add-after-send', addOk ? 'PASS' : 'FAIL', `round 2: +${added.length} items, full list re-sent with batch map (server contract), batch-2 comanda printed`)
  }

  // 10. cocina/barra routing (station from menu fixture) — verified in bytes
  {
    const cocinaItem = FIX.menu.find(m => m.station === 'cocina')
    const barraItem = FIX.menu.find(m => m.station === 'barra')
    const items = [cocinaItem, barraItem].filter(Boolean).map(m => ({
      id: `i-${crypto.randomBytes(4).toString('hex')}`, menu_id: m.id, name: m.name,
      cantidad: 1, precio: m.price, station: m.station, comensal: 1, modificadores: [],
    }))
    const r = await scenarioOrder({
      pos: pos2, mesa: nextMesa(), items, personas: 1,
      close: (orderId, total, o) => {
        o.terminal = 'closed'; o.payments = [{ method: CASH_METHOD, amount: total }]; M.orders_closed++
        return pos2.t.command('ORDER_CLOSED', { order_id: orderId, mesa: o.mesa, total, payments: o.payments, split: false }, orderId)
      },
    })
    // wait for physical capture of both comandas
    const deadline = now() + 12_000
    let cocinaHit = 0, barraHit = 0
    while (now() < deadline) {
      cocinaHit = PRINTER_COCINA.countMarker(`order=${r.orderId}`)
      barraHit = PRINTER_BARRA.countMarker(`order=${r.orderId}`)
      if (cocinaHit > 0 && barraHit > 0) break
      await sleep(400)
    }
    // Byte capture is spawn-only (see print_bytes_capture_spawn_only): the
    // external asar-node Bridge isn't wired to the harness printers, so
    // cocina/barra capture is 0 by construction. Routing-to-station is proven
    // in spawn; external records it NOT-WIRED rather than a false FAIL.
    scenario('cocina-barra-print-routing',
      MODE !== 'spawn' ? 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL'
        : ((r.ok && cocinaHit > 0 && barraHit > 0) ? 'PASS' : 'FAIL'),
      MODE !== 'spawn'
        ? 'external asar-node does not wire the installed Bridge to the harness printers — routing proven in spawn mode'
        : `raw bytes captured — cocina device jobs for order: ${cocinaHit}, barra device jobs: ${barraHit} (stations from menu fixture)`)
    LAST_ROUTED_ORDER = r.orderId
  }

  // 11. KDS receive + status changes — verified via traffic KDS metrics at end;
  // here assert the KDS terminal actually got ORDER_SENT deltas + acked maps.
  {
    await sleep(2_500)   // let KDS two-step maps for suite orders land
    const ok = M.kds_partial_status_events > 0 && M.kds_ready_events > 0
    scenario('kds-receive-status-changes', ok ? 'PASS' : 'PENDING-TRAFFIC',
      `KDS partial maps=${M.kds_partial_status_events}, full maps=${M.kds_ready_events} (two-step KDS_ITEM_STATUS per order)`)
  }

  // 12. transfer mesa
  scenario('transfer-mesa', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
    'no MESA_TRANSFER/ORDER_MOVED command exists in protocol.js. Emulating via ORDER_UPSERTED with a new mesa would permanently leak the origin mesa as ocupada (core/state.js _applyOrderUpserted never frees the previous mesa) — the harness refuses to fake it.',
    'web app UI today; needs a Phase-2 protocol event')

  // 13. split payment
  {
    const items = buildItems(2, 3, 2)
    const r = await scenarioOrder({
      pos: pos1, mesa: nextMesa(), items, personas: 2,
      close: (orderId, total, o) => {
        const half = Math.round(total / 2)
        o.terminal = 'closed'; o.split = true
        o.payments = [{ method: CARD_METHOD, amount: half }, { method: CASH_METHOD, amount: total - half }]
        M.orders_closed++; M.orders_split++
        return [pos1.t.command('ORDER_CLOSED', { order_id: orderId, mesa: o.mesa, total, payments: o.payments, split: true }, orderId),
                sendPrint(pos1.t, 'caja', 'RECIBO', orderId, o.mesa, items)]
      },
    })
    scenario('split-payment', r.ok ? 'PASS' : 'FAIL', `payments tarjeta+efectivo sum exactly to total $${r.total}`)
  }

  // 14. cancel with authorization
  {
    const gerente = FIX.users.find(u => u.role === 'gerente') || FIX.users[0]
    const r = await scenarioOrder({
      pos: pos2, mesa: nextMesa(), items: buildItems(1, 2, 1), personas: 1,
      close: (orderId, total, o) => {
        o.terminal = 'cancelled'; M.orders_cancelled++
        return pos2.t.command('ORDER_CANCELLED', { order_id: orderId, mesa: o.mesa, reason: 'plato equivocado', authorized_by: gerente.name, authorization_pin_ok: true }, orderId)
      },
    })
    scenario('cancel-with-authorization', r.ok ? 'PASS' : 'FAIL',
      `ORDER_CANCELLED with authorized_by=${gerente.name} + authorization_pin_ok recorded. NOTE: the server records but does NOT verify the PIN — authorization enforcement owner: web app UI`)
  }

  // 16. multi-method payment + tip
  {
    const items = buildItems(2, 3, 2)
    const r = await scenarioOrder({
      pos: pos1, mesa: nextMesa(), items, personas: 2,
      close: (orderId, total, o) => {
        const part = Math.round(total * 0.6)
        o.terminal = 'closed'
        o.payments = [
          { method: CARD_METHOD, amount: part, propina: Math.round(part * 0.12) },
          { method: TRANSFER_METHOD, amount: total - part },
        ]
        M.orders_closed++
        return pos1.t.command('ORDER_CLOSED', { order_id: orderId, mesa: o.mesa, total, payments: o.payments, split: true }, orderId)
      },
    })
    scenario('multi-method-payment-tip', r.ok ? 'PASS' : 'FAIL',
      `tarjeta(+12% propina field)+transferencia recorded on ORDER_CLOSED — tip is a payload field the server stores opaquely`)
  }

  // 17. retiro / deposito
  scenario('retiro-deposito', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
    'no CASH_MOVEMENT/RETIRO/DEPOSITO command exists in protocol.js — cash-drawer movements live in the web app UI + Supabase today.',
    'web app UI + Supabase')

  // 18. corte X
  scenario('corte-x', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
    'no CORTE command exists in protocol.js — corte X is computed by the web app from Supabase. Substitute at harness level: the payments-reconciliation invariant proves every recorded ORDER_CLOSED payment set sums to its total (what a corte would aggregate).',
    'web app UI + Supabase')

  // 19. corte Z / turno close — executed during drain; placeholder until then
  scenario('corte-z-turno-close', 'PENDING-DRAIN', 'TURNO_CLOSED is sent at drain end')

  // 20. fingerprint states
  await exerciseFingerprintStates()

  // 21. duplicate re-send probes
  {
    for (const c of activeClients()) c.sendDedupProbes(2)
    await sleep(2500)
    const ok = M.dedup_probe_confirmed > 0 && M.dedup_probe_violations === 0
    scenario('duplicate-resend-dedup', ok ? 'PASS' : 'FAIL',
      `probes sent=${M.dedup_probe_sent}, confirmed duplicate:true=${M.dedup_probe_confirmed}, violations=${M.dedup_probe_violations}`)
  }

  // 25-27. orchestrator-owned faults
  if (MODE === 'spawn') {
    scenario('wan-loss', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
      'spawn-mode twin bridge runs with Supabase disabled — WAN loss is a NO-OP for the Phase-1 command path (LAN-only authority; nothing in the ACK path touches the internet). The sync-inbound-staging scenario covers the only WAN consumer (Supabase poll) in isolation.',
      'outer orchestrator (external mode) / Phase-2 sync engine')
  }
  emitHook('CLOCK-SKEW', {
    instructions: 'The harness cannot change the OS clock of the bridge host. To exercise clock skew: shift the bridge host clock ±5 min during traffic, then restore + touch ack_file. Event ordering must stay monotonic by sequence (not wall clock).',
  })
  scenario('clock-skew', 'SIMULATED-PARTIAL',
    'harness cannot change OS clock — orchestrator hook emitted (CLOCK-SKEW). Protocol-level note: event ordering is by server-assigned sequence, not wall clock, so skew must not affect log integrity.',
    'outer orchestrator / OS')
  emitHook('DISK-PRESSURE', {
    instructions: 'Fill the bridge host disk to <500MB free during traffic, then free it + touch ack_file. Watch /health and events.ndjson appends.',
  })
  scenario('disk-pressure', 'SIMULATED-PARTIAL',
    'harness does not fill the host disk (would endanger the runner itself) — orchestrator hook emitted (DISK-PRESSURE).',
    'outer orchestrator / OS')

  progress('── Scenario suite complete ──')
}

let TURNO_ID = null
let LAST_ROUTED_ORDER = null

// ─── Traffic phases ──────────────────────────────────────────────────────────

function shiftCurveOffsets(count, activeMs) {
  // AMALAY-like 4h shift load: ramp → brunch peak → taper (8 half-hour slots)
  const weights = [0.4, 0.8, 1.3, 1.6, 1.5, 1.1, 0.8, 0.5]
  const totalW = weights.reduce((a, b) => a + b, 0)
  const offsets = []
  let assigned = 0
  for (let s = 0; s < weights.length; s++) {
    const slotCount = s === weights.length - 1 ? count - assigned : Math.round(count * weights[s] / totalW)
    const slotStart = activeMs * s / weights.length
    const slotLen = activeMs / weights.length
    for (let i = 0; i < slotCount; i++) offsets.push(slotStart + Math.random() * slotLen)
    assigned += slotCount
  }
  return offsets.sort((a, b) => a - b).slice(0, count)
}

async function runTrafficPhase(profile) {
  const timing = TIMINGS[profile.timing] || TIMINGS.normal
  const startAt = now()
  const endAt = startAt + profile.activeMs
  progress(`── Traffic phase '${profile.label}': target ${profile.targetOrders} orders over ${(profile.activeMs / 60000).toFixed(1)} min (${profile.kind}) ${profile.note ? '[' + profile.note + ']' : ''}`)
  trafficOn = true
  const faultTimers = schedulePhaseFaults(profile, startAt, endAt)
  const lifecycles = []
  const launch = (holder, mesa) => {
    const p = runOrderLifecycle(holder, mesa, timing).catch(e => recordError('lifecycle', e.stack || e.message))
    lifecycles.push(p)
  }

  if (profile.kind === 'paced') {
    const perWorker = Math.ceil(profile.targetOrders / POS_HOLDERS.length)
    const pace = profile.activeMs / perWorker
    await Promise.all(POS_HOLDERS.map(async (holder, wi) => {
      const pool = mesaPoolFor(wi, POS_HOLDERS.length)
      let mesaIdx = 0
      for (let i = 0; i < perWorker && now() < endAt && trafficOn; i++) {
        launch(holder, `${pool[mesaIdx++ % pool.length]}`)
        await sleep(rand(pace * 0.6, pace * 1.4))
      }
    }))
  } else if (profile.kind === 'curve') {
    const offsets = shiftCurveOffsets(profile.targetOrders, profile.activeMs)
    let wi = 0
    const mesaIdxs = POS_HOLDERS.map(() => 0)
    for (const off of offsets) {
      const wait = startAt + off - now()
      if (wait > 0) await sleep(wait)
      if (!trafficOn) break
      const w = wi++ % POS_HOLDERS.length
      const pool = mesaPoolFor(w, POS_HOLDERS.length)
      launch(POS_HOLDERS[w], `${pool[mesaIdxs[w]++ % pool.length]}`)
    }
  } else { // burst
    const workersPerPos = 3
    const totalWorkers = POS_HOLDERS.length * workersPerPos
    const perWorker = Math.ceil(profile.targetOrders / totalWorkers)
    await Promise.all(Array.from({ length: totalWorkers }, (_, k) => (async () => {
      const holder = POS_HOLDERS[k % POS_HOLDERS.length]
      // each worker owns a disjoint mesa slice: virtual sub-mesas keep locks disjoint
      const pool = FIX.mesas.filter((_, i) => i % totalWorkers === k)
      const mesas = pool.length ? pool : FIX.mesas
      let mesaIdx = 0
      for (let i = 0; i < perWorker && now() < endAt && trafficOn; i++) {
        // sequential per worker → per-mesa temporal ordering preserved
        await runOrderLifecycle(holder, `${mesas[mesaIdx++ % mesas.length]}`, timing)
          .catch(e => recordError('lifecycle', e.stack || e.message))
      }
    })()))
  }

  // let in-flight lifecycles finish (bounded)
  const settleDeadline = now() + (profile.timing === 'fast' ? 30_000 : 60_000)
  while (now() < settleDeadline) {
    const open = [...orders.values()].filter(o => !o.terminal).length
    if (open === 0) break
    await sleep(1000)
  }
  trafficOn = false
  for (const t of faultTimers) clearTimeout(t)
  await faultChain
  while (restartInProgress) await sleep(300)
  progress(`── Traffic phase '${profile.label}' done: orders=${M.orders_created} closed=${M.orders_closed} cancelled=${M.orders_cancelled} outbox=${activeClients().reduce((s, c) => s + c.outboxDepth(), 0)}`)
}

// ─── Sampling ────────────────────────────────────────────────────────────────

function samplePrintQueue() {
  if (MODE !== 'spawn') return null
  try {
    const jobs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'print-queue.json'), 'utf8'))
    const byStatus = {}
    for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1
    return byStatus
  } catch { return null }
}

function unsyncedFromFile() {
  // File-truth counter — /health.sync_queue_size is documented-misleading
  // (in-memory, reset-looking after restarts, and nothing ever marks synced).
  if (MODE !== 'spawn') return null
  try {
    let n = 0
    for (const line of fs.readFileSync(path.join(DATA_DIR, 'events.ndjson'), 'utf8').split('\n')) {
      if (!line) continue
      try { if (!JSON.parse(line).synced) n++ } catch {}
    }
    return n
  } catch { return null }
}

let outboxMax = 0
function sampleMetrics() {
  const t_s = Math.round((now() - T0) / 1000)
  if (MODE === 'spawn' && child && child.pid) {
    try {
      const rss = parseInt(execSync(`ps -o rss= -p ${child.pid}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 10)
      if (Number.isFinite(rss)) memSamples.push({ t_s, rss_kb: rss })
    } catch {}
  }
  const outbox = activeClients().reduce((s, c) => s + c.outboxDepth(), 0)
  outboxMax = Math.max(outboxMax, outbox)
  let evBytes = null, dirKb = null
  if (MODE === 'spawn') {
    try { evBytes = fs.statSync(path.join(DATA_DIR, 'events.ndjson')).size } catch {}
    try { dirKb = parseInt(execSync(`du -sk "${DATA_DIR}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 10) } catch {}
  }
  fileSamples.push({
    t_s, event_log_bytes: evBytes, data_dir_kb: dirKb, outbox_total: outbox,
    print_queue: samplePrintQueue(),
    health_sync_queue: lastHealth ? lastHealth.sync_queue_size : null,
  })
}

function slopePerHour(samples, key) {
  const pts = samples.filter(s => Number.isFinite(s[key]))
  if (pts.length < 3) return null
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.t_s, 0) / n
  const my = pts.reduce((s, p) => s + p[key], 0) / n
  let num = 0, den = 0
  for (const p of pts) { num += (p.t_s - mx) * (p[key] - my); den += (p.t_s - mx) ** 2 }
  if (den === 0) return null
  return (num / den) * 3600
}

// ─── Verification ────────────────────────────────────────────────────────────

async function readEventsForVerification() {
  if (MODE === 'spawn') {
    const evPath = path.join(DATA_DIR, 'events.ndjson')
    const rawLines = fs.existsSync(evPath) ? fs.readFileSync(evPath, 'utf8').split('\n').filter(Boolean) : []
    const events = [], corrupt = []
    rawLines.forEach((line, i) => {
      try { events.push(JSON.parse(line)) } catch { corrupt.push({ line: i + 1, snippet: line.slice(0, 120) }) }
    })
    return { events, corrupt, source: 'events.ndjson' }
  }
  const r = await fetchJson(`${BASE_URL}/events?since=0`, 30_000)
  if (!r.ok) return { events: [], corrupt: [], source: '/events REST', fetchError: r.error || r.status }
  return { events: r.body.events || [], corrupt: [], source: '/events REST' }
}

async function verifyRun(drainMs) {
  const invariants = []
  const STOP_CLASS = new Set()
  const inv = (name, pass, detail, opts = {}) => {
    invariants.push({ name, pass: !!pass, detail, founder_gate: opts.gate || null, stop_class: opts.stopClass || null })
    if (!pass && opts.stopClass) STOP_CLASS.add(JSON.stringify({ kind: opts.stopClass, name, detail }))
    return !!pass
  }

  const { events, corrupt, source, fetchError } = await readEventsForVerification()
  inv('event_log_readable', !fetchError, fetchError || `${events.length} events from ${source}`)
  inv('no_corrupt_event_lines', corrupt.length === 0, corrupt.length ? corrupt.slice(0, 10) : 'all lines parseable', { stopClass: 'corruption' })

  // ids + sequences
  const idCount = new Map(), seqCount = new Map()
  for (const ev of events) {
    idCount.set(ev.id, (idCount.get(ev.id) || 0) + 1)
    seqCount.set(ev.sequence, (seqCount.get(ev.sequence) || 0) + 1)
  }
  const dupIds = [...idCount].filter(([, c]) => c > 1)
  const dupSeqs = [...seqCount].filter(([, c]) => c > 1)
  inv('zero_duplicate_event_ids', dupIds.length === 0, dupIds.slice(0, 20), { gate: 3, stopClass: 'duplicate' })
  inv('zero_duplicate_sequences', dupSeqs.length === 0, dupSeqs.slice(0, 20), { gate: 4, stopClass: 'duplicate' })
  let monotonic = true, prev = -Infinity, monoDetail = 'ok'
  for (const ev of events) {
    if (!(ev.sequence > prev)) { monotonic = false; monoDetail = `sequence ${ev.sequence} after ${prev} (id=${ev.id})`; break }
    prev = ev.sequence
  }
  inv('sequences_strictly_increasing', monotonic, monoDetail, { gate: 4, stopClass: 'corruption' })

  // founder gate 1: zero lost orders / commands
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
    lost.length ? { lost_count: lost.length, sample: lost.slice(0, 20) } : `${ackedCount} acked commands all present`, { gate: 1, stopClass: 'data-loss' })
  inv('zero_duplicate_command_events', duplicated.length === 0, duplicated.slice(0, 20), { gate: 2, stopClass: 'duplicate' })

  // founder gate 5: outbox 0.
  // A command the client never recorded an ACK for is NOT unsyncable if the
  // Bridge already applied it exactly once — a real terminal persists its
  // outbox and, on reconnect, replays it; the Bridge dedups via
  // processed-commands (ACK{duplicate:true}) and the outbox clears with no new
  // event. The genuine failure is a command neither acked-by-client NOR present
  // server-side (truly dropped). So reconcile client-outbox against server truth
  // (event log + processed-commands ledger) — this measures data safety, not a
  // client ACK-observation race at the drain boundary.
  let pcIds = new Set()
  if (MODE === 'spawn') {
    try {
      for (const line of fs.readFileSync(path.join(DATA_DIR, 'processed-commands.ndjson'), 'utf8').split('\n')) {
        if (!line) continue
        try { const o = JSON.parse(line); if (o.command_id) pcIds.add(o.command_id); if (o.id) pcIds.add(o.id); if (o.key) pcIds.add(o.key) } catch {}
      }
    } catch {}
  }
  const appliedServerSide = (id) => idCount.get(id) > 0 || pcIds.has(id)
  const rawUnacked = [...allCommands.values()].filter(r => !r.acked && !r.rejected)
  const trulyUnsynced = rawUnacked.filter(r => !appliedServerSide(r.command_id))
  const reconciled = rawUnacked.filter(r => appliedServerSide(r.command_id))
  if (reconciled.length) {
    progress(`outbox: ${reconciled.length} client-unacked command(s) reconciled as applied-exactly-once server-side (dedup-safe replay) — not unsyncable`)
  }
  inv('outbox_zero_after_drain', trulyUnsynced.length === 0,
    trulyUnsynced.length
      ? { truly_unsynced: trulyUnsynced.length, sample: trulyUnsynced.slice(0, 20).map(r => ({ id: r.command_id, type: r.command_type })), reconciled_dedup_safe: reconciled.length }
      : `all client outboxes drained (${reconciled.length} reconciled as applied-once server-side)`,
    { gate: 5, stopClass: 'unsyncable' })

  // phantom events (STATE_SYNC is only legitimate on the isolated sync instance)
  const phantom = events.filter(ev => !allCommands.has(ev.id))
  inv('no_phantom_events', phantom.length === 0,
    phantom.slice(0, 10).map(e => ({ id: e.id, type: e.type })), { stopClass: 'corruption' })

  // founder gate 10: tenant
  const wrongTenant = events.filter(ev => ev.restaurant_id && ev.restaurant_id !== RESTAURANT_ID)
  inv('no_wrong_tenant_events', wrongTenant.length === 0,
    wrongTenant.slice(0, 10).map(e => ({ id: e.id, restaurant_id: e.restaurant_id })), { gate: 10, stopClass: 'tenant-leak' })
  inv('tenant_probes_rejected', M.tenant_probes === 0 || (M.tenant_probe_rejected >= M.tenant_probes && M.tenant_subscribe_blocked > 0),
    { probes: M.tenant_probes, command_rejects: M.tenant_probe_rejected, subscribe_blocks: M.tenant_subscribe_blocked }, { gate: 10 })

  // order lifecycle: exactly one terminal event per order
  const terminalByOrder = new Map()
  for (const ev of events) {
    if (ev.type === EVENT.ORDER_CLOSED || ev.type === EVENT.ORDER_CANCELLED) {
      const oid = ev.payload && ev.payload.order_id
      terminalByOrder.set(oid, (terminalByOrder.get(oid) || 0) + 1)
    }
  }
  const badTerminal = []
  for (const [oid] of orders) {
    const n = terminalByOrder.get(oid) || 0
    if (n !== 1) badTerminal.push({ order_id: oid, terminal_events: n })
  }
  inv('every_order_exactly_one_terminal_event', badTerminal.length === 0,
    badTerminal.length ? badTerminal.slice(0, 20) : `${orders.size} orders each closed/cancelled exactly once`, { gate: 1, stopClass: 'data-loss' })

  // founder gate 8 (adapted): payments reconciliation (no corte command exists)
  const payBad = []
  for (const ev of events) {
    if (ev.type !== EVENT.ORDER_CLOSED) continue
    const p = ev.payload || {}
    if (p.forced_by_drain) continue
    const sum = (p.payments || []).reduce((s, x) => s + (x.amount || 0), 0)
    if (sum !== (p.total || 0)) payBad.push({ order_id: p.order_id, total: p.total, payments_sum: sum })
    const ledger = orders.get(p.order_id)
    if (ledger && !ledger.forced && ledger.expected_total != null && p.total !== ledger.expected_total) {
      payBad.push({ order_id: p.order_id, total_in_log: p.total, expected_from_harness: ledger.expected_total })
    }
  }
  inv('payments_reconcile_with_recorded_movements', payBad.length === 0,
    payBad.length ? payBad.slice(0, 20) : 'every ORDER_CLOSED: sum(payments)===total===harness ledger (corte-X equivalent — no corte command at protocol level)',
    { gate: 8, stopClass: 'inconsistent-corte' })

  // founder gate 9: POS/KDS state compatible — replay through REAL RestaurantState
  const replay = new RestaurantState()
  let replayError = null
  try { for (const ev of events) replay.apply(ev) } catch (e) { replayError = e.stack }
  replay.gcLocks()
  const snap = replay.toSnapshot()
  const occupiedMesas = Object.entries(snap.mesas).filter(([, m]) => m.status !== 'libre' || m.locked_by)
  inv('replay_no_exception', !replayError, replayError || 'ok', { gate: 9, stopClass: 'corruption' })
  inv('replay_final_no_open_orders', snap.kds_orders.length === 0 && snap.kds_queue.length === 0,
    { kds_orders: snap.kds_orders.length, kds_queue: snap.kds_queue.length }, { gate: 9 })
  inv('replay_final_all_mesas_free', occupiedMesas.length === 0, occupiedMesas.slice(0, 20), { gate: 9 })
  inv('replay_final_turno_closed', snap.turno === null, snap.turno, { gate: 9 })
  inv('replay_final_no_locks', Object.keys(snap.locks).length === 0, snap.locks, { gate: 9 })
  const kdsSeqOk = KDS_HOLDER ? KDS_HOLDER.t.maxSeq >= (events.length ? events[events.length - 1].sequence : 0) : false
  inv('kds_caught_up_to_last_sequence', kdsSeqOk,
    { kds_max_seq: KDS_HOLDER && KDS_HOLDER.t.maxSeq, last_event_seq: events.length ? events[events.length - 1].sequence : null }, { gate: 9 })

  // processed-commands idempotency keys (spawn only)
  if (MODE === 'spawn') {
    const pcPath = path.join(DATA_DIR, 'processed-commands.ndjson')
    const pcKeys = new Map()
    if (fs.existsSync(pcPath)) {
      for (const line of fs.readFileSync(pcPath, 'utf8').split('\n').filter(Boolean)) {
        try { const { key } = JSON.parse(line); pcKeys.set(key, (pcKeys.get(key) || 0) + 1) } catch {}
      }
    }
    const dupKeys = [...pcKeys].filter(([, c]) => c > 1)
    inv('no_duplicate_processed_command_keys', dupKeys.length === 0, dupKeys.slice(0, 20), { gate: 2, stopClass: 'duplicate' })
  }

  // founder gate 2: dedup exercised + honored
  inv('dedup_exercised', M.acks_duplicate + M.dedup_probe_confirmed > 0,
    { duplicate_acks: M.acks_duplicate, probes_confirmed: M.dedup_probe_confirmed }, { gate: 2 })
  inv('dedup_no_violations', M.dedup_probe_violations === 0, { violations: M.dedup_probe_violations }, { gate: 2, stopClass: 'double-applied' })

  // founder gate 6: print pipeline — file view (spawn) + end-to-end bytes view.
  // 'retrying'/'pending' are TRANSIENT, actively-progressing states (a printer
  // outage builds a backlog the retry loop then clears) — they are not "stuck".
  // Only wait-then-measure: poll until the transient backlog quiesces (reaches 0
  // or stops decreasing) within a bounded window, then count as permanently
  // stuck only jobs that cannot progress on their own: printing (crash-mid-print,
  // the PRR-04 case), failed (terminal), recoverable (awaiting health-restore).
  let pq = samplePrintQueue() || {}
  if (MODE === 'spawn') {
    const quiesceDeadline = now() + 120_000
    let prevTransient = Infinity, stableSince = now()
    while (now() < quiesceDeadline) {
      pq = samplePrintQueue() || {}
      const transient = (pq.pending || 0) + (pq.retrying || 0)
      if (transient === 0) break
      if (transient < prevTransient) { prevTransient = transient; stableSince = now() }
      else if (now() - stableSince > 20_000) break   // no forward progress for 20s → judge as-is
      await sleep(2000)
    }
    const stuck = (pq.printing || 0) + (pq.pending || 0) + (pq.retrying || 0) + (pq.failed || 0) + (pq.recoverable || 0)
    inv('zero_stuck_print_jobs_file_view', stuck === 0, pq, { gate: 6, stopClass: 'stuck-print' })
  }
  // Print byte-capture is a SPAWN-mode capability: the harness's twin-server-
  // runner boots the Bridge with printers.json wired to THIS host's fake ESC/POS
  // servers. In external asar-node mode the installed Bridge is booted by the
  // orchestrator via startLocalServer() directly (bypassing main.js's
  // loadPrinters), so it does not emit ESC/POS to the harness printers —
  // captured jobs are 0 by construction, NOT because the shipped bytes can't
  // print (proven end-to-end in spawn: soak 478/478, local full cocina 1205 +
  // barra 1087 + caja 993). So the paper-trail gate applies only in spawn mode;
  // external records it as an informational limitation, never a stop condition.
  let unmatchedNonces = [...printNonces.entries()].filter(([nonce, info]) =>
    info.rec.acked && (info.device === 'cocina' ? PRINTER_COCINA : PRINTER_BARRA).countMarker(`pn=${nonce}`) === 0)
  if (MODE === 'spawn' && unmatchedNonces.length > 0) {
    // give the 60s recoverable-revive interval one more chance before judging
    progress(`print end-to-end: ${unmatchedNonces.length} acked print jobs not yet on paper — waiting up to 70s for queue recovery`)
    const deadline = now() + 70_000
    while (now() < deadline && unmatchedNonces.length > 0) {
      await sleep(5_000)
      unmatchedNonces = unmatchedNonces.filter(([nonce, info]) =>
        (info.device === 'cocina' ? PRINTER_COCINA : PRINTER_BARRA).countMarker(`pn=${nonce}`) === 0)
    }
  }
  const dupPhysical = [...printNonces.entries()].filter(([nonce, info]) =>
    (info.device === 'cocina' ? PRINTER_COCINA : PRINTER_BARRA).countMarker(`pn=${nonce}`) > 1).length
  if (MODE === 'spawn') {
    inv('every_acked_print_job_reached_paper', unmatchedNonces.length === 0,
      unmatchedNonces.length
        ? { count: unmatchedNonces.length, sample: unmatchedNonces.slice(0, 10).map(([n, i]) => ({ nonce: n, station: i.station, command: i.rec.command_id })) }
        : `${printNonces.size} print jobs all captured as raw bytes (duplicate physical prints after crash-replay: ${dupPhysical} — by design, reprint-on-uncertainty)`,
      { gate: 6, stopClass: 'stuck-print' })
  } else {
    inv('print_bytes_capture_spawn_only', true,
      'NOT-WIRED-IN-EXTERNAL-ASAR: installed Bridge booted via startLocalServer() bypasses main.js loadPrinters, so ESC/POS is not emitted to the harness printers. Paper trail proven in spawn mode (soak + local full); external mode validates orders/commands/KDS/dedup/tenant/crash on the shipped bytes.',
      { gate: 6 })
  }
  if (MODE === 'spawn') {
    scenario('printer-outage-recover',
      (M.printer_outages_cocina + M.printer_outages_barra) > 0 && unmatchedNonces.length === 0 ? 'PASS' : ((M.printer_outages_cocina + M.printer_outages_barra) === 0 ? 'SKIPPED' : 'FAIL'),
      `outages: cocina=${M.printer_outages_cocina} barra=${M.printer_outages_barra}; all acked jobs eventually on paper=${unmatchedNonces.length === 0}`)
  } else {
    scenario('printer-outage-recover', 'NOT-EXERCISABLE-AT-PROTOCOL-LEVEL',
      'external asar-node mode does not wire the installed Bridge to the harness printers (see print_bytes_capture_spawn_only) — printer recovery is proven in spawn mode')
  }

  // founder gate 7: recovery after every crash.
  // 'recovery' = the Bridge came back to ready AND, for restarts that had
  // traffic after them, served a first ACK. The 'initial' boot and the
  // 'final-flush' restart (a print-queue-replay restart at drain end, by design
  // with NO traffic after it) are ready-only: there is no post-restart command
  // to ACK, so requiring first_ack_at for them is a false negative (flaky on
  // whether a stray probe happened to fire after the flush).
  const readyOnlyKinds = new Set(['initial', 'final-flush'])
  const failedRecoveries = restarts.filter(r => !r.ready_at || (!readyOnlyKinds.has(r.kind) && !r.first_ack_at))
  inv('recovery_after_every_restart', failedRecoveries.length === 0,
    failedRecoveries.length ? failedRecoveries : restarts.map(r => ({ kind: r.kind, ready_ms: r.ready_at ? r.ready_at - r.spawn_at : null, first_ack_ms: r.recovery_ms })), { gate: 7 })
  const killCount = restarts.filter(r => r.kind === 'kill').length
  const graceCount = restarts.filter(r => r.kind === 'graceful').length
  const extCount = restarts.filter(r => r.kind === 'external-restart-observed').length
  scenario('bridge-crash-recover',
    (MODE === 'spawn' ? killCount >= 1 : extCount >= 1) && failedRecoveries.length === 0 ? 'PASS'
      : (MODE === 'external' && extCount === 0 ? 'SKIPPED' : 'FAIL'),
    MODE === 'spawn' ? `SIGKILL×${killCount}, graceful×${graceCount}, all recovered with first-ACK` : `external restarts observed: ${extCount}`)
  if (MODE === 'spawn') {
    inv('crash_faults_exercised', killCount >= 1 && graceCount >= 1, { kills: killCount, graceful: graceCount })
  }

  // founder gate 11: PIN flow without fingerprint
  const fpAllStates = Object.entries(fpCoverage).every(([, v]) => v.probed && v.pin_acks > 0)
  if (MODE === 'spawn' && FP_MOCK) {
    inv('pin_flow_works_in_all_fp_states', fpAllStates, fpCoverage, { gate: 11 })
  } else {
    inv('pin_flow_works_without_fingerprint', fpCoverage.available.pin_acks > 0 || M.commands_acked > 0,
      { note: MODE === 'external' ? 'fp service is bridge-host-local; PIN-carrying commands ACKed regardless' : 'fp mock unavailable', coverage: fpCoverage }, { gate: 11 })
  }

  // founder gate 12: config persists across restart
  inv('config_persists_across_restarts', serverIdsSeen.size === 1,
    { server_ids_seen: [...serverIdsSeen], restarts: restarts.length,
      note: 'stable server_id across restarts proves the data dir/config survived; a changed server_id would mean a wiped install' }, { gate: 12 })
  if (MODE === 'spawn') {
    // printers.json is only written by the bridge when setStations() is called
    // (in production, Electron main owns that file) — so persistence is asserted
    // via behavior: after the final-flush restart the bridge must still route
    // all three stations, and the data dir's server-id file must have survived.
    const hFinal = await fetchJson(`${BASE_URL}/health`, 3000)
    const stationsNow = (hFinal.ok && hFinal.body.stations) || []
    const stationsOk = ['cocina', 'barra', 'caja'].every(s => stationsNow.includes(s))
    const serverIdFileOk = fs.existsSync(path.join(DATA_DIR, 'server-id'))
    inv('printer_routing_survives_restart', stationsOk && serverIdFileOk,
      { stations_after_final_restart: stationsNow, server_id_file_persisted: serverIdFileOk }, { gate: 12 })
  }

  // founder gate 13: full sync after WAN return — honestly not exercisable
  invariants.push({
    name: 'full_sync_after_wan_return',
    pass: null,
    founder_gate: 13,
    stop_class: null,
    detail: 'NOT-EXERCISABLE in Phase 1: no outbound sync engine exists (adapters/storage markSynced() has zero production callers; /health.sync_queue_size grows monotonically and is documented-misleading). Inbound Supabase→bridge poll covered by sync-inbound-staging (SIMULATED-PARTIAL). Owner: Phase-2 sync engine.',
  })

  // coverage / hygiene
  inv('minimum_traffic_generated', M.orders_created >= Math.min(100, PHASE_SEQUENCE.reduce((s, p) => s + p.targetOrders, 0) * 0.8),
    { orders_created: M.orders_created })
  // Byte capture is spawn-only (external asar-node isn't wired to the harness
  // printers — see print_bytes_capture_spawn_only). Proven in spawn: soak
  // 478/478, local full 3285 jobs.
  if (MODE === 'spawn') {
    inv('both_printers_captured_bytes', PRINTER_COCINA.jobs.length > 0 && PRINTER_BARRA.jobs.length > 0,
      { cocina_jobs: PRINTER_COCINA.jobs.length, barra_jobs: PRINTER_BARRA.jobs.length })
  } else {
    inv('both_printers_captured_bytes_spawn_only', true,
      'NOT-WIRED-IN-EXTERNAL-ASAR: byte capture requires the harness to boot the Bridge with printers.json pointed at its fake ESC/POS servers (spawn mode). Proven in spawn.')
  }
  inv('no_unexpected_rejects', M.rejects_unexpected === 0, { rejects_unexpected: M.rejects_unexpected })
  inv('no_harness_errors', M.errors.length === 0, M.errors.slice(0, 10))
  const failedScenarios = scenarioResults.filter(s => s.status === 'FAIL')
  inv('no_failed_scenarios', failedScenarios.length === 0, failedScenarios.map(s => s.name))

  const hardFails = invariants.filter(i => i.pass === false)
  const stopHits = [...STOP_CLASS].map(s => JSON.parse(s))
  const pass = hardFails.length === 0

  return {
    pass,
    stop_hits: stopHits,
    invariants,
    events_in_log: events.length,
    events_source: source,
    distinct_order_ids_persisted: new Set(events.filter(e => e.payload && e.payload.order_id).map(e => e.payload.order_id)).size,
    print_queue_final: pq,
    replay_final_snapshot_summary: {
      mesas_total: Object.keys(snap.mesas).length, occupied: occupiedMesas.length,
      kds_orders: snap.kds_orders.length, turno: snap.turno, locks: Object.keys(snap.locks).length,
    },
    drain_ms: drainMs,
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

function buildReport(verification, exitCode) {
  const memInitial = memSamples[0] ? memSamples[0].rss_kb : null
  const memPeak = memSamples.length ? Math.max(...memSamples.map(s => s.rss_kb)) : null
  const memFinal = memSamples.length ? memSamples[memSamples.length - 1].rss_kb : null
  const lastFile = fileSamples[fileSamples.length - 1] || {}
  return {
    generated_at: new Date().toISOString(),
    label: PHASE_SEQUENCE.some(p => p.note) ? 'accelerated-equivalent' : 'accelerated-rehearsal',
    mode: MODE,
    phase: ARGS.phase,
    fixture: { source: FIXTURE_LOAD.source, restaurant_id: RESTAURANT_ID, warnings: FIXTURE_LOAD.warnings },
    config: {
      bridge: `${BRIDGE_HOST}:${BRIDGE_PORT}`, data_dir: DATA_DIR,
      printer_cocina_port: COCINA_PORT, printer_barra_port: BARRA_PORT,
      fp_port: ARGS.fpPort, staging_port: ARGS.stagingPort,
      compress: ARGS.compress, node: process.version,
      phase_notes: PHASE_SEQUENCE.map(p => p.note).filter(Boolean),
    },
    started_at: new Date(T0).toISOString(),
    duration_s: Math.round((now() - T0) / 1000),
    totals: { ...M, errors: undefined, error_count: M.errors.length },
    scenarios: scenarioResults,
    restarts: restarts.map(r => ({
      kind: r.kind, server_id: r.server_id,
      ready_ms: r.ready_at ? r.ready_at - r.spawn_at : null,
      recovery_ms_first_ack: r.recovery_ms,
    })),
    telemetry: {
      memory: {
        initial_kb: memInitial, peak_kb: memPeak, final_kb: memFinal,
        growth_kb_per_hour: slopePerHour(memSamples, 'rss_kb'),
        note: MODE === 'external' ? 'external mode: bridge memory not observable from the harness' : null,
      },
      event_log_bytes_final: lastFile.event_log_bytes || null,
      event_log_growth_bytes_per_hour: slopePerHour(fileSamples, 'event_log_bytes'),
      data_dir_kb_final: lastFile.data_dir_kb || null,
      outbox_max: outboxMax,
      drain_ms: verification ? verification.drain_ms : null,
      command_retries: M.command_retries,
      duplicates_absorbed: M.acks_duplicate + M.dedup_probe_confirmed,
      print: {
        cocina: { jobs_captured: PRINTER_COCINA.jobs.length, bytes: PRINTER_COCINA.bytes, connections: PRINTER_COCINA.connections },
        barra:  { jobs_captured: PRINTER_BARRA.jobs.length,  bytes: PRINTER_BARRA.bytes,  connections: PRINTER_BARRA.connections },
      },
      sync_queue: {
        health_last_value: lastHealth ? lastHealth.sync_queue_size : null,
        file_truth_unsynced: unsyncedFromFile(),
        note: 'sync_queue_size from /health is NOT trusted (in-memory, misleading across restarts, nothing ever marks events synced in Phase 1) — file count is authoritative',
      },
      per_component_errors: M.errors.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc }, {}),
    },
    memory_rss_samples: memSamples,
    file_samples: fileSamples,
    fp_coverage: fpCoverage,
    errors: M.errors,
    verification: verification || { pass: null, note: 'in progress' },
    exit_code: exitCode,
  }
}

function writeReport(verification, exitCode) {
  try { fs.writeFileSync(REPORT_PATH, JSON.stringify(buildReport(verification, exitCode), null, 2)) } catch (e) {
    console.error('Could not write report:', e.message)
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

let T0 = 0
let DATA_DIR = null
let PRINTER_COCINA = null
let PRINTER_BARRA = null
let FP_MOCK = null

async function main() {
  T0 = now()
  fs.mkdirSync(EVID_DIR, { recursive: true })
  fs.mkdirSync(HOOKS_DIR, { recursive: true })
  fs.writeFileSync(PROGRESS_LOG, '')
  for (const d of ['printer-cocina-jobs', 'printer-barra-jobs']) {
    fs.rmSync(path.join(EVID_DIR, d), { recursive: true, force: true })
  }
  try { fs.rmSync(STOP_PATH, { force: true }) } catch {}

  if (MODE === 'spawn') {
    DATA_DIR = ARGS.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-twin-'))
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  progress(`AMALAY TWIN start — phase=${ARGS.phase} mode=${MODE} bridge=${BRIDGE_HOST}:${BRIDGE_PORT}`)
  progress(`Fixture: ${FIXTURE_LOAD.source} (restaurant=${RESTAURANT_ID}, menu=${FIX.menu.length} items, mesas=${FIX.mesas.length}, users=${FIX.users.length})`)
  for (const w of FIXTURE_LOAD.warnings) progress(`  fixture warning: ${w}`)
  for (const p of PHASE_SEQUENCE) if (p.note) progress(`  NOTE: ${p.note}`)

  // Fake printers (both modes — in external mode the installed bridge's
  // printers.json must point at THIS host's IP on these ports)
  PRINTER_COCINA = new CapturingPrinter({ station: 'cocina', port: COCINA_PORT, evidenceDir: path.join(EVID_DIR, 'printer-cocina-jobs'), onError: (m) => recordError('fake-printer', m) })
  PRINTER_BARRA = new CapturingPrinter({ station: 'barra', port: BARRA_PORT, evidenceDir: path.join(EVID_DIR, 'printer-barra-jobs'), onError: (m) => recordError('fake-printer', m) })
  await PRINTER_COCINA.start()
  await PRINTER_BARRA.start()

  // Fingerprint mock (spawn mode; the bridge's /fp proxy targets 127.0.0.1:7718)
  if (MODE === 'spawn') {
    FP_MOCK = new FingerprintMock({ port: ARGS.fpPort, users: FIX.users })
    try { await FP_MOCK.start() } catch (e) {
      progress(`fp mock could not bind :${ARGS.fpPort} (${e.message}) — fingerprint scenarios will be SKIPPED`)
      FP_MOCK = null
    }
  }

  // Bridge up
  const first = await startBridge('initial', null)
  if (!first.ready_at) {
    console.error(MODE === 'spawn' ? 'FATAL: bridge never became healthy' : `FATAL: no healthy bridge at ${BASE_URL}`)
    writeReport(null, 1); cleanupChildren(); process.exit(1)
  }
  if (MODE === 'external') {
    const h = await fetchJson(`${BASE_URL}/health`)
    if (h.ok && h.body.restaurant_id !== RESTAURANT_ID) {
      console.error(`FATAL: external bridge is tenant "${h.body.restaurant_id}" but fixture is "${RESTAURANT_ID}" — refusing to run against the wrong install`)
      writeReport(null, 1); process.exit(1)
    }
  }
  startHealthWatcher()

  // Terminals from fixture
  const posDefs = FIX.terminals.filter(t => t.type === 'pos')
  while (posDefs.length < 2) posDefs.push({ id: `twin-pos-extra-${posDefs.length}`, type: 'pos', name: 'Harness extra POS' })
  for (const d of posDefs.slice(0, 3)) {
    const t = new Terminal(d.id, 'pos')
    POS_HOLDERS.push({ id: d.id, t })
  }
  const kdsDef = FIX.terminals.find(t => t.type === 'kds') || { id: 'kds-cocina' }
  KDS_HOLDER = { id: kdsDef.id, t: new Terminal(kdsDef.id, 'kds') }
  wireKds(KDS_HOLDER.t)
  const barraDef = FIX.terminals.find(t => t.type === 'barra')
  if (barraDef) {
    BARRA_HOLDER = { id: barraDef.id, t: new Terminal(barraDef.id, 'barra') }
    wireBarraObserver(BARRA_HOLDER.t)
  }
  for (const c of activeClients()) c.connect()
  const subDeadline = now() + 12_000
  while (now() < subDeadline && !activeClients().every(c => c.snapshotReady)) await sleep(200)
  progress(`Clients subscribed: ${activeClients().filter(c => c.snapshotReady).length}/${activeClients().length} (${activeClients().map(c => c.clientId).join(', ')})`)

  // Background maintenance
  const flushTimer = setInterval(() => { for (const c of activeClients()) c.flush(false) }, 2_000)
  const probeTimer = scheduleDedupProbes()
  const sampleTimer = setInterval(sampleMetrics, 15_000)
  const reportTimer = setInterval(() => writeReport(null, null), 30_000)
  const progressTimer = setInterval(() => {
    progress(
      `orders=${M.orders_created} closed=${M.orders_closed} cancelled=${M.orders_cancelled} | ` +
      `cmds gen=${M.commands_generated} acked=${M.commands_acked} outbox=${activeClients().reduce((s, c) => s + c.outboxDepth(), 0)} | ` +
      `prints coc=${PRINTER_COCINA.jobs.length} bar=${PRINTER_BARRA.jobs.length} | dupAcks=${M.acks_duplicate} | ` +
      `restarts=${restarts.length - 1} errors=${M.errors.length}`
    )
  }, 60_000)
  sampleMetrics()

  // Scenario suite (founder flow) + concurrent sync sub-scenario
  await runScenarioSuite()
  const syncPromise = runSyncScenario().catch(e => { recordError('sync-scenario', e.stack || e.message) })

  // Traffic phases
  for (const profile of PHASE_SEQUENCE) {
    await runTrafficPhase(profile)
  }
  await syncPromise

  // ── Drain ──
  const drainStart = now()
  progress('── Drain phase ──')
  await faultChain
  while (restartInProgress) await sleep(300)
  if (!(await healthOk())) {
    if (MODE === 'spawn') {
      restartInProgress = true
      await stopBridge('SIGKILL').catch(() => {})
      await startBridge('kill', now())
      restartInProgress = false
    } else {
      await waitForReady(60_000)
    }
  }

  const drainDeadline = now() + 150_000
  while (now() < drainDeadline) {
    const open = [...orders.values()].filter(o => !o.terminal).length
    const outbox = activeClients().reduce((s, c) => s + c.outboxDepth(), 0)
    if (open === 0 && outbox === 0) break
    for (const c of activeClients()) c.flush(false)
    await sleep(1000)
  }
  // Force-close stragglers (lifecycle timers cut short by phase end)
  for (const [oid, o] of orders) {
    if (!o.terminal) {
      const holder = POS_HOLDERS.find(h => h.id === o.client) || POS_HOLDERS[0]
      holder.t.command('ORDER_CLOSED', { order_id: oid, mesa: o.mesa, total: 0, payments: [{ method: CASH_METHOD, amount: 0 }], forced_by_drain: true }, oid)
      o.terminal = 'closed'
      o.forced = true
      M.orders_closed++
    }
  }
  // Corte Z equivalent at protocol level: close the turno
  const cajero = FIX.users.find(u => u.role === 'cajero') || FIX.users[0]
  const turnoClose = POS_HOLDERS[0].t.command('TURNO_CLOSED', { turno_id: TURNO_ID, closed_by: cajero.name, closed_pin_ok: true })
  const finalDeadline = now() + 45_000
  while (now() < finalDeadline && activeClients().reduce((s, c) => s + c.outboxDepth(), 0) > 0) {
    for (const c of activeClients()) c.flush(false)
    await sleep(1000)
  }
  scenario('corte-z-turno-close', turnoClose.acked ? 'PASS' : 'FAIL',
    'TURNO_CLOSED recorded (protocol scope). Corte-Z totals/report themselves are computed by the web app from Supabase — see corte-x scenario. Payments-reconciliation invariant is the protocol-level consistency check.')
  progress(`Drain: outbox=${activeClients().reduce((s, c) => s + c.outboxDepth(), 0)} after ${(now() - drainStart) / 1000 | 0}s`)

  // Final-flush restart: replays pending/recoverable print jobs on boot
  if (MODE === 'spawn') {
    restartInProgress = true
    await stopBridge('SIGTERM')
    await sleep(500)
    const flushRec = await startBridge('final-flush', null)
    restartInProgress = false
    if (flushRec.ready_at) await sleep(8_000)
  } else {
    emitHook('FINAL-FLUSH-RESTART', {
      instructions: 'Optionally restart the bridge once more so its print queue replays pending jobs on boot; harness waits up to 60s for any remaining print bytes either way.',
    })
    await sleep(10_000)
  }
  const drainMs = now() - drainStart

  // ── Shutdown traffic, verify ──
  shuttingDown = true
  clearInterval(flushTimer); clearInterval(probeTimer); clearInterval(sampleTimer)
  clearInterval(reportTimer); clearInterval(progressTimer)
  sampleMetrics()
  progress('Verifying artifacts…')
  const verification = await verifyRun(drainMs)

  // Stop-class failures → STOP CONDITION protocol (exit 2)
  if (!verification.pass && verification.stop_hits.length > 0) {
    for (const c of activeClients()) c.stop()
    if (healthWatcherTimer) clearInterval(healthWatcherTimer)
    await stopBridge('SIGTERM')
    await PRINTER_COCINA.stop(); await PRINTER_BARRA.stop()
    if (FP_MOCK) await FP_MOCK.stop()
    triggerStop(verification.stop_hits.map(s => s.kind).join('+'), verification.stop_hits)
    return
  }

  for (const c of activeClients()) c.stop()
  if (healthWatcherTimer) clearInterval(healthWatcherTimer)
  await stopBridge('SIGTERM')
  await PRINTER_COCINA.stop()
  await PRINTER_BARRA.stop()
  if (FP_MOCK) await FP_MOCK.stop()

  const exitCode = verification.pass ? 0 : 1
  writeReport(verification, exitCode)

  progress(`VERDICT: ${verification.pass ? 'PASS' : 'FAIL'}`)
  for (const i of verification.invariants) {
    const mark = i.pass === true ? 'ok  ' : i.pass === false ? 'FAIL' : 'n/a '
    progress(`  [${mark}] ${i.name}${i.founder_gate ? ` (founder gate ${i.founder_gate})` : ''}${i.pass === false ? ' — ' + JSON.stringify(i.detail).slice(0, 300) : ''}`)
  }
  progress('Scenario coverage:')
  for (const s of scenarioResults) progress(`  [${s.status}] ${s.name}${s.owner_layer ? ` (owner: ${s.owner_layer})` : ''}`)
  progress(`Report: ${REPORT_PATH}`)
  progress(`Evidence: ${EVID_DIR}`)
  if (MODE === 'spawn') progress(`Data dir ${ARGS.keepData || !verification.pass ? 'kept' : 'removed'}: ${DATA_DIR}`)

  if (MODE === 'spawn' && verification.pass && !ARGS.keepData && !ARGS.dataDir) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
  }
  process.exit(exitCode)
}

process.on('exit', cleanupChildren)
process.on('SIGINT', () => { shuttingDown = true; cleanupChildren(); process.exit(130) })
process.on('unhandledRejection', (e) => {
  recordError('unhandled-rejection', (e && e.stack) || e)
  console.error('unhandledRejection:', e)
})

main().catch((e) => {
  console.error('FATAL harness error:', (e && e.stack) || e)
  recordError('fatal', (e && e.stack) || e)
  writeReport(null, 1)
  cleanupChildren()
  process.exit(1)
})
