'use strict'
// ─── Canonical V2 Upgrade + Rollback Rehearsal — live-data driver ─────────────
// Drives the REAL Bridge (booted from the INSTALLED app.asar by
// bridge-runner.js) over the real WS protocol to create, verify and reconcile
// live operational data across the 1.3.0 → 1.3.3 → rollback cycle.
//
// Phases (one workflow step each; the Bridge child lives inside the phase):
//   a  — 1.3.0: create live data (turno, orders open/closed, authorized
//        cancellation, split payments, cash movements in TURNO_CLOSED payload,
//        kitchen prints completed, barra/caja prints stranded on a down
//        printer, dedup probe, client outbox left unsent), snapshot baseline.
//   b  — 1.3.3: replay + preservation checks, dedup-ledger survival, new
//        orders, outbox replay, mid-activity hard-kill + recovery,
//        exactly-once audit, print-queue drain once the barra printer is up.
//   c  — 1.3.0 restored: after ROLLBACK.ps1 + reinstall, semantic identity
//        with the phase-a baseline and a live runtime probe.
//
// Every check lands in <evidence>/phase-<x>-verdict.json. Any failed check
// exits non-zero — the workflow step fails and the run stops loudly. No
// silent fixes (founder stop-conditions).
//
// Env: UR_EVIDENCE, UR_DATA_DIR, UR_BRIDGE_INDEX, UR_WS_MODULE,
//      UR_EXPECT_VERSION (optional exact version assert for phase b),
//      UR_PORT/UR_COCINA_PORT/UR_BARRA_PORT (defaults 7717/19100/19101)

const { spawn } = require('child_process')
const fs   = require('fs')
const path = require('path')

let WebSocket
try { WebSocket = require('ws') } catch {
  WebSocket = require(process.env.UR_WS_MODULE)
}
const { CapturingPrinter } = require(path.join(__dirname, '..', 'twin', 'fake-printer.js'))

const PHASE      = (process.argv[2] || '').toLowerCase()
const EVIDENCE   = process.env.UR_EVIDENCE
const DATA_DIR   = process.env.UR_DATA_DIR
const PORT       = parseInt(process.env.UR_PORT || '7717', 10)
const COCINA_PORT = parseInt(process.env.UR_COCINA_PORT || '19100', 10)
const BARRA_PORT  = parseInt(process.env.UR_BARRA_PORT || '19101', 10)
const RID        = 'upgrade-rehearsal'
const BASE       = `http://127.0.0.1:${PORT}`
const STATE_FILE = () => path.join(EVIDENCE, 'driver-state.json')

if (!['a', 'b', 'c'].includes(PHASE)) { console.error('usage: node driver.js a|b|c'); process.exit(2) }
if (!EVIDENCE || !DATA_DIR || !process.env.UR_BRIDGE_INDEX) {
  console.error('UR_EVIDENCE, UR_DATA_DIR and UR_BRIDGE_INDEX are required'); process.exit(2)
}
fs.mkdirSync(EVIDENCE, { recursive: true })

// ── check collector ──────────────────────────────────────────────────────────
const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail) })
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`)
  return !!pass
}
function finish(extra) {
  const pass = checks.every(c => c.pass)
  const verdict = { phase: PHASE, pass, checks, ...extra }
  fs.writeFileSync(path.join(EVIDENCE, `phase-${PHASE}-verdict.json`), JSON.stringify(verdict, null, 2))
  console.log(`PHASE ${PHASE.toUpperCase()} VERDICT: ${pass ? 'PASS' : 'FAIL'} (${checks.filter(c => !c.pass).length} failed / ${checks.length})`)
  process.exit(pass ? 0 : 1)
}
process.on('unhandledRejection', (e) => {
  check('unhandled-rejection', false, (e && e.stack) || e)
  finish({})
})

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, everyMs, label) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await fn() } catch { v = false }
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`)
    await sleep(everyMs)
  }
}

async function httpJson(p) {
  const res = await fetch(BASE + p)
  if (!res.ok) throw new Error(`${p} -> HTTP ${res.status}`)
  return res.json()
}

function readQueue() {
  const f = path.join(DATA_DIR, 'print-queue.json')
  if (!fs.existsSync(f)) return []
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}
function readEvents() {
  const f = path.join(DATA_DIR, 'events.ndjson')
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
    try { return JSON.parse(l) } catch (e) { throw new Error(`events.ndjson line ${i + 1} is not valid JSON: ${e.message}`) }
  })
}
function jobNonce(job) {
  try { return Buffer.from(job.data_b64 || '', 'base64').toString('latin1') } catch { return '' }
}
function escpos(nonce) {
  // ESC @ init + centered nonce + feed + GS V cut — realistic minimal ticket.
  return Buffer.from('\x1b\x40\x1b\x61\x01FULLSITE REHEARSAL\n' + nonce + '\n\n\x1d\x56\x41\x03', 'latin1')
}
function loadState() { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) }
function saveState(s) { fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2)) }

// ── bridge child management ──────────────────────────────────────────────────
let bridgeChild = null
async function spawnBridge(tag) {
  const out = fs.openSync(path.join(EVIDENCE, `bridge-${PHASE}-${tag}-stdout.log`), 'a')
  const err = fs.openSync(path.join(EVIDENCE, `bridge-${PHASE}-${tag}-stderr.log`), 'a')
  bridgeChild = spawn(process.execPath, [path.join(__dirname, 'bridge-runner.js')], {
    env: { ...process.env, UR_PORT: String(PORT), UR_RESTAURANT_ID: RID, UR_COCINA_PORT: String(COCINA_PORT), UR_BARRA_PORT: String(BARRA_PORT) },
    stdio: ['ignore', out, err],
  })
  const health = await waitFor(async () => {
    const h = await httpJson('/health').catch(() => null)
    return (h && h.ok) ? h : false
  }, 60_000, 1000, `bridge /health (${tag})`)
  return health
}
async function killBridge(hard) {
  if (!bridgeChild) return
  const child = bridgeChild
  bridgeChild = null
  const exited = new Promise(r => child.once('exit', r))
  try { child.kill() } catch {}   // TerminateProcess on Windows — a hard kill either way
  await Promise.race([exited, sleep(hard ? 5000 : 10000)])
}

// ── WS terminal ──────────────────────────────────────────────────────────────
let cmdSeq = 0
class Term {
  constructor(id, type) { this.id = id; this.type = type; this.pending = new Map(); this.snapshot = null }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`)
      const to = setTimeout(() => reject(new Error(`WS connect timeout for ${this.id}`)), 15000)
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({
          protocol_version: '1.0', type: 'SUBSCRIBE',
          client_id: this.id, client_type: this.type, restaurant_id: RID, last_sequence: -1,
        }))
      })
      this.ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()) } catch { return }
        if (msg.type === 'SNAPSHOT') { this.snapshot = msg.payload; clearTimeout(to); resolve(); return }
        if (msg.type === 'ACK' || msg.type === 'REJECT') {
          const id = msg.payload && msg.payload.command_id
          const p = this.pending.get(id)
          if (p) {
            this.pending.delete(id)
            p.resolve({
              acked: msg.type === 'ACK', duplicate: !!(msg.payload && msg.payload.duplicate),
              rejected: msg.type === 'REJECT', reason: (msg.payload && msg.payload.reason) || '',
              sequence: msg.sequence,
            })
          }
        }
      })
      this.ws.on('error', (e) => { clearTimeout(to); reject(e) })
    })
  }
  sendEnvelope(envelope, timeoutMs) {
    const id = envelope.payload.command_id
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => { this.pending.delete(id); reject(new Error(`ACK timeout for ${id} (${envelope.payload.command_type})`)) }, timeoutMs || 15000)
      this.pending.set(id, { resolve: (r) => { clearTimeout(to); resolve(r) } })
      this.ws.send(JSON.stringify(envelope), (err) => {
        if (err) { clearTimeout(to); this.pending.delete(id); reject(err) }
      })
    })
  }
  makeEnvelope(commandType, fields) {
    const command_id = `ur-${PHASE}-${(++cmdSeq).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
    return {
      protocol_version: '1.0', type: 'COMMAND', restaurant_id: RID,
      payload: { command_id, command_type: commandType, client_id: this.id, ...fields },
    }
  }
  async command(commandType, fields) {
    const env = this.makeEnvelope(commandType, fields)
    const r = await this.sendEnvelope(env)
    if (!r.acked) throw new Error(`${commandType} ${env.payload.command_id} rejected: ${r.reason}`)
    return { ...r, envelope: env }
  }
  close() { try { this.ws.close() } catch {} }
}

// ── printers ─────────────────────────────────────────────────────────────────
function makePrinter(station, port, tag) {
  return new CapturingPrinter({ station, port, evidenceDir: path.join(EVIDENCE, `printer-${station}-${PHASE}${tag ? '-' + tag : ''}`) })
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE A — 1.3.0 live data + baseline
// ═════════════════════════════════════════════════════════════════════════════
async function phaseA() {
  const cocina = makePrinter('cocina', COCINA_PORT)
  await cocina.start()                    // barra printer intentionally NOT started

  // Seed the two config files the real installed app persists in its data dir
  // (same pre-seed the certified twin run used). Everything else is created by
  // the running 1.3.0 Bridge itself.
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({
    restaurant_id: RID, terminal_id: 'SERVER1-REHEARSAL', instance_name: 'Fullsite POS Rehearsal', channel: 'stable',
  }, null, 2))

  const health0 = await spawnBridge('boot')
  check('a-bridge-boot', true, `version=${health0.version} seq=${health0.last_sequence}`)
  check('a-tenant', health0.restaurant_id === RID, health0.restaurant_id)

  const pos = new Term('pos-driver', 'pos')
  const kds = new Term('kds-driver', 'kds')
  await pos.connect(); await kds.connect()

  const acked = []   // every non-duplicate ACKed envelope, in order
  async function cmd(type, fields) {
    const r = await pos.command(type, fields)
    if (!check(`a-ack-${type}-${fields.order_id || fields.turno_id || fields.mesa || fields.station || 'x'}`, r.acked && !r.duplicate, r.reason || 'ok')) return null
    acked.push(r.envelope)
    return r
  }

  // Turno 1: opens, absorbs the closed orders, closes with cash movements.
  await cmd('TURNO_OPENED', { turno_id: 't-100', opened_by: 'caja-uno', fondo: 2000 })

  const item = (n, precio) => ({ id: `i-${n}`, nombre: n, qty: 1, precio })
  const orders = {
    'o-101': { mesa: '1', mesero: 'Mesero Uno',  items: [item('chilaquiles', 145), item('cafe', 55)] },
    'o-102': { mesa: '2', mesero: 'Mesero Dos',  items: [item('bowl', 180.5), item('jugo', 60)] },
    'o-103': { mesa: '3', mesero: 'Mesero Uno',  items: [item('paninis', 160), item('smoothie', 95), item('pastel', 85)] },
    'o-104': { mesa: '4', mesero: 'Mesero Tres', items: [item('pizza', 210)] },
  }
  for (const [order_id, o] of Object.entries(orders)) {
    await cmd('ORDER_UPSERTED', { order_id, mesa: o.mesa, status: 'abierta', mesero: o.mesero, items: o.items, turno_id: 't-100' })
    await cmd('ORDER_SENT',     { order_id, mesa: o.mesa, mesero: o.mesero, items: o.items, turno_id: 't-100' })
  }
  await cmd('KDS_ITEM_STATUS', { order_id: 'o-101', item_id: 'i-chilaquiles', status: 'preparando' })
  await cmd('KDS_ITEM_STATUS', { order_id: 'o-101', item_id: 'i-chilaquiles', status: 'listo' })

  // Kitchen tickets — cocina printer is up: these must complete.
  const cocinaNonces = []
  for (let n = 1; n <= 4; n++) {
    const nonce = `UR-COCINA-A-${n}`
    cocinaNonces.push(nonce)
    await cmd('PRINT_COMMAND', { station: 'cocina', data_b64: escpos(nonce).toString('base64'), document_type: 'kitchen_ticket', order_id: `o-10${n}` })
  }

  // Closures: single payment, 2-way split, 3-way split with tip.
  await cmd('ORDER_CLOSED', { order_id: 'o-101', mesa: '1', turno_id: 't-100', total: 200,   payments: [{ metodo: 'efectivo', monto: 200 }] })
  await cmd('ORDER_CLOSED', { order_id: 'o-102', mesa: '2', turno_id: 't-100', total: 240.5, payments: [{ metodo: 'tarjeta', monto: 140.5 }, { metodo: 'efectivo', monto: 100 }] })
  await cmd('ORDER_CLOSED', { order_id: 'o-103', mesa: '3', turno_id: 't-100', total: 340,   propina: 45, payments: [{ metodo: 'tarjeta', monto: 150 }, { metodo: 'efectivo', monto: 90 }, { metodo: 'transferencia', monto: 100 }] })
  // Authorized cancellation (manager PIN verified upstream — payload is opaque to the Bridge).
  await cmd('ORDER_CANCELLED', { order_id: 'o-104', mesa: '4', turno_id: 't-100', authorized_by: 'manager-1', pin_verified: true, reason: 'cliente cancelo' })

  // Cash movements + corte ride the TURNO_CLOSED payload (corte-Z is not a
  // Phase-1 Bridge command — known product finding, payload is the field truth).
  await cmd('TURNO_CLOSED', { turno_id: 't-100', closed_by: 'caja-uno',
    movimientos: [{ tipo: 'retiro', monto: 500, autorizado_por: 'manager-1' }, { tipo: 'deposito', monto: 200 }],
    corte: { efectivo_esperado: 2090, tarjeta: 290.5, transferencia: 100 } })

  // Turno 2 stays OPEN through the upgrade, with two live orders on the floor.
  await cmd('TURNO_OPENED', { turno_id: 't-200', opened_by: 'caja-dos', fondo: 1500 })
  await cmd('MESA_LOCK',   { mesa: '7', expires_ms: Date.now() + 30000 })
  await cmd('ORDER_UPSERTED', { order_id: 'o-201', mesa: '7', status: 'abierta', mesero: 'Mesero Dos', items: [item('ceviche', 190)], turno_id: 't-200' })
  await cmd('ORDER_SENT',     { order_id: 'o-201', mesa: '7', mesero: 'Mesero Dos', items: [item('ceviche', 190)], turno_id: 't-200' })
  await cmd('MESA_UNLOCK', { mesa: '7' })
  await cmd('ORDER_UPSERTED', { order_id: 'o-202', mesa: '8', status: 'abierta', mesero: 'Mesero Tres', items: [item('pancakes', 120), item('frappe', 75)], turno_id: 't-200' })
  await cmd('ORDER_SENT',     { order_id: 'o-202', mesa: '8', mesero: 'Mesero Tres', items: [item('pancakes', 120), item('frappe', 75)], turno_id: 't-200' })

  // Barra/caja tickets — barra printer is DOWN: these must strand in the queue
  // (1.3.0 has no recoverable state and no recovery loop; they park 'retrying').
  const barraNonces = []
  for (const [n, station] of [[1, 'barra'], [2, 'barra'], [3, 'caja']]) {
    const nonce = `UR-BARRA-A-${n}`
    barraNonces.push(nonce)
    await cmd('PRINT_COMMAND', { station, data_b64: escpos(nonce).toString('base64'), document_type: station === 'caja' ? 'receipt' : 'bar_ticket', order_id: 'o-201' })
  }

  // Dedup probe under 1.3.0: byte-identical resend must ACK duplicate:true.
  const dupProbe = acked.find(e => e.payload.command_type === 'ORDER_UPSERTED' && e.payload.order_id === 'o-101')
  const dupR = await pos.sendEnvelope(dupProbe)
  check('a-dedup-live', dupR.acked && dupR.duplicate, JSON.stringify(dupR))

  // Client outbox: 3 commands a terminal queued but never delivered.
  const outbox = [
    pos.makeEnvelope('ORDER_UPSERTED', { order_id: 'o-301', mesa: '9', status: 'abierta', mesero: 'Mesero Uno', items: [item('toast', 98)], turno_id: 't-200' }),
    pos.makeEnvelope('KDS_ITEM_STATUS', { order_id: 'o-201', item_id: 'i-ceviche', status: 'preparando' }),
    pos.makeEnvelope('PRINT_COMMAND', { station: 'cocina', data_b64: escpos('UR-COCINA-OUTBOX-1').toString('base64'), document_type: 'kitchen_ticket', order_id: 'o-301' }),
  ]

  // Print quiescence: cocina jobs printed; barra jobs parked non-failed.
  await waitFor(() => {
    const q = readQueue()
    const coc = q.filter(j => j.printer_id === 'ur-imp-cocina')
    const bar = q.filter(j => j.printer_id === 'ur-imp-barra')
    return coc.length >= 4 && coc.every(j => j.status === 'printed') &&
           bar.length >= 3 && bar.every(j => ['retrying', 'recoverable', 'pending'].includes(j.status))
  }, 60_000, 1000, 'phase-a print quiescence')
  const qA = readQueue()
  const cocinaJobsA = qA.filter(j => j.printer_id === 'ur-imp-cocina')
  const barraJobsA  = qA.filter(j => j.printer_id === 'ur-imp-barra')
  check('a-print-cocina-completed', cocinaJobsA.length === 4 && cocinaJobsA.every(j => j.status === 'printed'),
    cocinaJobsA.map(j => j.status).join(','))
  check('a-print-barra-stranded-not-failed', barraJobsA.length === 3 && barraJobsA.every(j => j.status !== 'failed'),
    barraJobsA.map(j => j.status).join(','))
  check('a-print-cocina-bytes', cocinaNonces.every(n => cocina.countMarker(n) === 1),
    `captured=${cocina.jobCount}`)

  const health = await httpJson('/health')
  const state  = await httpJson('/state')
  fs.writeFileSync(path.join(EVIDENCE, 'phase-a-health.json'), JSON.stringify(health, null, 2))
  fs.writeFileSync(path.join(EVIDENCE, 'phase-a-state.json'),  JSON.stringify(state, null, 2))

  check('a-sequence-equals-acked', health.last_sequence === acked.length, `seq=${health.last_sequence} acked=${acked.length}`)
  check('a-turno-open', state.turno && state.turno.id === 't-200', JSON.stringify(state.turno))
  const kdsIds = (state.kds_orders || []).map(o => o.id || o.order_id).sort()
  check('a-open-orders', JSON.stringify(kdsIds) === JSON.stringify(['o-201', 'o-202']), kdsIds.join(','))
  // Known WARN (pre-existing, PRR register): sync_queue_size never drains
  // because markSynced has no caller. Recorded, not hidden; must equal seq.
  check('a-sync-queue-known-warn', health.sync_queue_size === health.last_sequence, `sync_queue_size=${health.sync_queue_size}`)

  pos.close(); kds.close()
  await killBridge(false)
  await cocina.stop()

  // Post-mortem on disk: every line parses; exactly-once per command_id.
  const events = readEvents()
  check('a-events-parse-count', events.length === acked.length + 0, `lines=${events.length}`)
  const idCounts = new Map()
  for (const ev of events) {
    const cid = ev.payload && ev.payload.command_id
    if (cid) idCounts.set(cid, (idCounts.get(cid) || 0) + 1)
  }
  const dupIds = [...idCounts.entries()].filter(([, c]) => c > 1)
  check('a-exactly-once-on-disk', dupIds.length === 0, dupIds.map(([id, c]) => `${id}x${c}`).join(',') || 'none')

  saveState({
    versionA: health0.version,
    lastSequenceA: health.last_sequence,
    ackedA: acked,
    dupProbe,
    outbox,
    cocinaNoncesA: cocinaNonces,
    barraNoncesA: barraNonces,
    stateA: { turno: state.turno, kds: kdsIds },
    queueA: { cocinaPrinted: cocinaJobsA.length, barraStranded: barraJobsA.length },
  })
  finish({ metrics: { commands_acked: acked.length, last_sequence: health.last_sequence } })
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE B — post-upgrade verify + crash + drain
// ═════════════════════════════════════════════════════════════════════════════
async function phaseB() {
  const S = loadState()
  const cocina = makePrinter('cocina', COCINA_PORT)
  await cocina.start()                    // barra STILL down at boot
  const barra = makePrinter('barra', BARRA_PORT)

  const health0 = await spawnBridge('boot')
  check('b-bridge-boot', true, `version=${health0.version} seq=${health0.last_sequence}`)
  check('b-tenant-preserved', health0.restaurant_id === RID, health0.restaurant_id)
  check('b-version-changed', health0.version !== S.versionA, `${S.versionA} -> ${health0.version}`)
  if (process.env.UR_EXPECT_VERSION) {
    check('b-version-exact', health0.version === process.env.UR_EXPECT_VERSION, `expected=${process.env.UR_EXPECT_VERSION} got=${health0.version}`)
  }
  check('b-replay-complete', health0.last_sequence === S.lastSequenceA, `seq=${health0.last_sequence} expected=${S.lastSequenceA}`)

  const state0 = await httpJson('/state')
  fs.writeFileSync(path.join(EVIDENCE, 'phase-b-state-postboot.json'), JSON.stringify(state0, null, 2))
  check('b-turno-preserved', state0.turno && state0.turno.id === 't-200', JSON.stringify(state0.turno))
  const kdsIds0 = (state0.kds_orders || []).map(o => o.id || o.order_id).sort()
  check('b-open-orders-preserved', JSON.stringify(kdsIds0) === JSON.stringify(S.stateA.kds), kdsIds0.join(','))

  const pos = new Term('pos-driver-b', 'pos')
  await pos.connect()

  // Dedup ledger survived the upgrade: phase-A envelope must ACK duplicate.
  const dupR = await pos.sendEnvelope(S.dupProbe)
  check('b-dedup-preserved', dupR.acked && dupR.duplicate, JSON.stringify({ acked: dupR.acked, duplicate: dupR.duplicate, reason: dupR.reason }))

  // Print queue crossed the upgrade intact: 3 barra jobs, right bytes, none failed/lost.
  const qB = readQueue()
  const barraJobsB = qB.filter(j => j.printer_id === 'ur-imp-barra')
  check('b-print-queue-preserved', barraJobsB.length === 3 && barraJobsB.every(j => ['retrying', 'recoverable', 'pending', 'printing'].includes(j.status)),
    barraJobsB.map(j => j.status).join(','))
  check('b-print-queue-bytes-preserved', S.barraNoncesA.every(n => barraJobsB.some(j => jobNonce(j).includes(n))), 'nonces intact')
  const cocinaJobsB = qB.filter(j => j.printer_id === 'ur-imp-cocina')
  check('b-print-history-preserved', cocinaJobsB.filter(j => j.status === 'printed').length >= S.queueA.cocinaPrinted,
    `printed=${cocinaJobsB.filter(j => j.status === 'printed').length}`)

  // New orders on 1.3.3.
  const seqBefore = (await httpJson('/health')).last_sequence
  const r1 = await pos.command('ORDER_UPSERTED', { order_id: 'o-401', mesa: '10', status: 'abierta', mesero: 'Mesero Uno', items: [{ id: 'i-bagel', nombre: 'bagel', qty: 1, precio: 88 }], turno_id: 't-200' })
  const r2 = await pos.command('ORDER_SENT', { order_id: 'o-401', mesa: '10', mesero: 'Mesero Uno', items: [{ id: 'i-bagel', nombre: 'bagel', qty: 1, precio: 88 }], turno_id: 't-200' })
  const seqAfter = (await httpJson('/health')).last_sequence
  check('b-new-orders', r1.acked && r2.acked && seqAfter === seqBefore + 2, `seq ${seqBefore} -> ${seqAfter}`)

  // Outbox replay with ORIGINAL command_ids: never-delivered -> fresh ACKs; a
  // second delivery of the same id -> duplicate. Outbox drains to zero.
  let outboxFresh = 0
  for (const env of S.outbox) {
    const r = await pos.sendEnvelope(env)
    if (r.acked && !r.duplicate) outboxFresh++
  }
  check('b-outbox-replay', outboxFresh === S.outbox.length, `${outboxFresh}/${S.outbox.length} fresh ACKs`)
  const reDup = await pos.sendEnvelope(S.outbox[0])
  check('b-outbox-dedup-after-drain', reDup.acked && reDup.duplicate, JSON.stringify({ duplicate: reDup.duplicate }))

  // ── crash injection: hard-kill mid-burst, then recover ────────────────────
  const burstAcked = []
  let killDone = false
  let burstErrors = 0
  const burstUnsent = []
  for (let n = 1; n <= 5; n++) {
    const items = [{ id: `i-b${n}`, nombre: `burst-${n}`, qty: 1, precio: 100 + n }]
    for (const type of ['ORDER_UPSERTED', 'ORDER_SENT']) {
      const env = pos.makeEnvelope(type, { order_id: `o-50${n}`, mesa: `${10 + n}`, status: 'abierta', mesero: 'Mesero Dos', items, turno_id: 't-200' })
      if (killDone) { burstUnsent.push(env); continue }
      try {
        const r = await pos.sendEnvelope(env, 5000)
        if (r.acked) burstAcked.push(env)
      } catch { burstErrors++; burstUnsent.push(env) }
      if (burstAcked.length === 6 && !killDone) {
        killDone = true
        await killBridge(true)   // hard TerminateProcess with commands in flight
      }
    }
  }
  pos.close()
  check('b-crash-injected', killDone && burstAcked.length >= 6, `acked-before-kill=${burstAcked.length} errors=${burstErrors}`)

  // ── recovery boot ─────────────────────────────────────────────────────────
  const healthR = await spawnBridge('recovery')
  check('b-recovery-boot', !!healthR.ok, `seq=${healthR.last_sequence} version=${healthR.version}`)

  const pos2 = new Term('pos-driver-b2', 'pos')
  await pos2.connect()

  // Every command ACKed before the kill must already be on disk: resend -> duplicate.
  let survived = 0
  for (const env of burstAcked) {
    const r = await pos2.sendEnvelope(env)
    if (r.acked && r.duplicate) survived++
  }
  check('b-crash-no-ack-lost', survived === burstAcked.length, `${survived}/${burstAcked.length} ACKed pre-kill found post-restart`)

  // Unsent/unACKed burst commands reconcile idempotently (fresh or duplicate both fine).
  let reconciled = 0
  for (const env of burstUnsent) {
    const r = await pos2.sendEnvelope(env)
    if (r.acked) reconciled++
  }
  check('b-crash-outbox-reconciled', reconciled === burstUnsent.length, `${reconciled}/${burstUnsent.length}`)

  // Exactly-once across the whole log (corruption check included: every line parses).
  const events = readEvents()
  const idCounts = new Map()
  for (const ev of events) {
    const cid = ev.payload && ev.payload.command_id
    if (cid) idCounts.set(cid, (idCounts.get(cid) || 0) + 1)
  }
  const dupIds = [...idCounts.entries()].filter(([, c]) => c > 1)
  check('b-exactly-once-on-disk', dupIds.length === 0, dupIds.map(([id, c]) => `${id}x${c}`).join(',') || `events=${events.length}`)

  // ── drain: barra printer comes back; queue must flush ─────────────────────
  await barra.start()
  await waitFor(() => {
    const q = readQueue()
    const bar = q.filter(j => j.printer_id === 'ur-imp-barra')
    return bar.length >= 3 && bar.every(j => j.status === 'printed')
  }, 240_000, 5000, 'barra queue drain after printer restore')
  check('b-print-drain', S.barraNoncesA.every(n => barra.countMarker(n) >= 1),
    `barra captured=${barra.jobCount}`)
  check('b-print-outbox-ticket', cocina.countMarker('UR-COCINA-OUTBOX-1') >= 1, `cocina captured=${cocina.jobCount}`)
  const qFinal = readQueue()
  const stuck = qFinal.filter(j => ['pending', 'retrying', 'recoverable', 'printing'].includes(j.status))
  check('b-no-stuck-jobs', stuck.length === 0, stuck.map(j => `${j.printer_id}:${j.status}`).join(',') || 'queue clean')

  const healthF = await httpJson('/health')
  const stateF  = await httpJson('/state')
  fs.writeFileSync(path.join(EVIDENCE, 'phase-b-health-final.json'), JSON.stringify(healthF, null, 2))
  fs.writeFileSync(path.join(EVIDENCE, 'phase-b-state-final.json'),  JSON.stringify(stateF, null, 2))
  check('b-sync-queue-known-warn', healthF.sync_queue_size === healthF.last_sequence, `sync_queue_size=${healthF.sync_queue_size} (pre-existing WARN, unchanged by upgrade)`)

  pos2.close()
  await killBridge(false)
  await cocina.stop(); await barra.stop()

  finish({ metrics: {
    last_sequence_final: healthF.last_sequence,
    burst_acked_pre_kill: burstAcked.length,
    burst_reconciled: reconciled,
    events_on_disk: events.length,
    print_jobs_failed_counter: healthF.print_jobs_failed,
  } })
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE C — post-rollback: 1.3.0 restored, baseline semantics + runtime probe
// ═════════════════════════════════════════════════════════════════════════════
async function phaseC() {
  const S = loadState()
  const cocina = makePrinter('cocina', COCINA_PORT, 'post')
  const barra  = makePrinter('barra',  BARRA_PORT,  'post')
  await cocina.start(); await barra.start()

  const health0 = await spawnBridge('boot')
  check('c-bridge-boot', true, `version=${health0.version} seq=${health0.last_sequence}`)
  check('c-version-restored', health0.version === S.versionA, `expected=${S.versionA} got=${health0.version}`)
  check('c-tenant-restored', health0.restaurant_id === RID, health0.restaurant_id)
  check('c-sequence-restored', health0.last_sequence === S.lastSequenceA, `seq=${health0.last_sequence} expected=${S.lastSequenceA}`)

  const state = await httpJson('/state')
  fs.writeFileSync(path.join(EVIDENCE, 'phase-c-state.json'), JSON.stringify(state, null, 2))
  check('c-turno-restored', state.turno && state.turno.id === 't-200', JSON.stringify(state.turno))
  const kdsIds = (state.kds_orders || []).map(o => o.id || o.order_id).sort()
  check('c-open-orders-restored', JSON.stringify(kdsIds) === JSON.stringify(S.stateA.kds), kdsIds.join(','))

  const pos = new Term('pos-driver-c', 'pos')
  await pos.connect()
  const dupR = await pos.sendEnvelope(S.dupProbe)
  check('c-dedup-ledger-restored', dupR.acked && dupR.duplicate, JSON.stringify({ duplicate: dupR.duplicate }))

  // Restored queue still holds the 3 stranded barra jobs (or has printed them
  // now that the printer is up — either proves the jobs were restored, not lost).
  const q = readQueue()
  const barraJobs = q.filter(j => j.printer_id === 'ur-imp-barra')
  check('c-print-queue-restored', barraJobs.length === 3 && barraJobs.every(j => j.status !== 'failed'),
    barraJobs.map(j => j.status).join(','))
  check('c-print-bytes-restored', S.barraNoncesA.every(n => barraJobs.some(j => jobNonce(j).includes(n))), 'nonces intact')

  // Live runtime probe on restored 1.3.0: the restaurant can keep operating.
  const r = await pos.command('ORDER_UPSERTED', { order_id: 'o-601', mesa: '12', status: 'abierta', mesero: 'Mesero Uno', items: [{ id: 'i-cafe', nombre: 'cafe', qty: 1, precio: 55 }], turno_id: 't-200' })
  const healthP = await httpJson('/health')
  check('c-runtime-probe', r.acked && healthP.last_sequence === S.lastSequenceA + 1, `seq=${healthP.last_sequence}`)

  pos.close()
  await killBridge(false)
  await cocina.stop(); await barra.stop()
  finish({ metrics: { last_sequence: healthP.last_sequence } })
}

;({ a: phaseA, b: phaseB, c: phaseC })[PHASE]().catch((e) => {
  check(`${PHASE}-fatal`, false, (e && e.stack) || e)
  killBridge(true).finally(() => finish({}))
})
