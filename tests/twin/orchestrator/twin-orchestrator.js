'use strict'
// ─── AMALAY Twin — external-mode ORCHESTRATOR (Windows CI) ───────────────────
// Services the hook files the twin harness emits in external mode
// (tests/twin/twin-harness.js emitHook/waitHookAck) while the harness drives
// the CANONICAL INSTALLED "Fullsite POS.exe" bridge on the same runner.
//
// Hook contract (learned from twin-harness.js, do not change unilaterally):
//   • Request:  <hooks-dir>/NN-REQUEST-<NAME>.json
//               { hook, requested_at, bridge, phase, ack_file, instructions, ... }
//   • Ack:      create the file named in `ack_file` (existence IS the ack;
//               contents are audit-trail only).
//   • BRIDGE-RESTART-KILL / BRIDGE-RESTART-GRACEFUL completion is NOT the ack
//     file — the harness detects it via /health uptime_s reset with the SAME
//     server_id (a changed server_id fails its config-persistence gate), so
//     restarts must never wipe %APPDATA%\Fullsite POS. Ack files are still
//     written for the audit trail.
//   • WAN-LOSS is the only hook whose ack file the harness actively awaits
//     (waitHookAck). FP-STATES / CLOCK-SKEW / DISK-PRESSURE /
//     FINAL-FLUSH-RESTART are emitted fire-and-forget (recorded
//     SIMULATED-PARTIAL by the harness regardless).
//
// Per-hook behavior implemented here:
//   BRIDGE-RESTART-GRACEFUL  Ctrl+Shift+Q (the app's global quit shortcut —
//                            the kiosk close handler otherwise shows a modal
//                            confirm dialog) → wait exit → fallback WM_CLOSE →
//                            fallback taskkill /F. Relaunch, wait /health.
//   BRIDGE-RESTART-KILL      taskkill /F /T. Relaunch, wait /health.
//   WAN-LOSS                 no-op by design: the whole run is null-routed via
//                            the hosts file. Verifies https://app.fullsite.mx
//                            still fails, then acks.
//   FP-STATES                no-op + ack: no fingerprint service exists on the
//                            runner (C:\fullsite absent); the harness
//                            self-manages its PIN probes in external mode.
//   CLOCK-SKEW               Set-Date +7 min, hold 60 s, Set-Date −7 min
//                            (restore guaranteed: try/finally + process-exit
//                            hook), best-effort w32tm /resync. Acks with a
//                            skip reason if the runner denies Set-Date.
//   DISK-PRESSURE            fsutil file createnew ballast to leave < 2 GB
//                            free, hold 45 s, delete (finally + exit hook).
//                            Acks with a skip reason if impractical.
//   FINAL-FLUSH-RESTART      acked WITHOUT restarting: the hook is optional
//                            per its own instructions, and the harness only
//                            sleeps 10 s before verification fetches /events —
//                            an app relaunch (5–20 s) would race verification.
//
// Also samples the bridge process (Get-Process every 30 s → CSV) and watches
// for any TCP connection to the production fullsite.mx IPs (TWIN_PROD_IPS).
//
// Env: TWIN_APP_EXE    path to installed "Fullsite POS.exe"      (required)
//      TWIN_HOOKS_DIR  harness hooks dir                          (required)
//      TWIN_OUT_DIR    evidence output dir                        (required)
//      TWIN_STOP_FILE  stop sentinel — exit when it appears       (required)
//      TWIN_BRIDGE_URL default http://127.0.0.1:7717
//      TWIN_PROD_IPS   comma-separated real fullsite.mx IPs (optional)
// Exit: 0 = clean stop; 1 = fatal orchestrator error.

const { spawn, execFileSync } = require('child_process')
const fs   = require('fs')
const path = require('path')

const APP_EXE    = process.env.TWIN_APP_EXE
const HOOKS_DIR  = process.env.TWIN_HOOKS_DIR
const OUT_DIR    = process.env.TWIN_OUT_DIR
const STOP_FILE  = process.env.TWIN_STOP_FILE
const BRIDGE_URL = process.env.TWIN_BRIDGE_URL || 'http://127.0.0.1:7717'
const PROD_IPS   = (process.env.TWIN_PROD_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
const APP_IMAGE  = APP_EXE ? path.basename(APP_EXE) : 'Fullsite POS.exe'
const PROC_NAME  = APP_IMAGE.replace(/\.exe$/i, '')

if (!APP_EXE || !HOOKS_DIR || !OUT_DIR || !STOP_FILE) {
  console.error('orchestrator: TWIN_APP_EXE, TWIN_HOOKS_DIR, TWIN_OUT_DIR and TWIN_STOP_FILE are required')
  process.exit(1)
}

fs.mkdirSync(HOOKS_DIR, { recursive: true })
fs.mkdirSync(OUT_DIR, { recursive: true })

const LOG_PATH     = path.join(OUT_DIR, 'orchestrator-log.ndjson')
const MEM_CSV      = path.join(OUT_DIR, 'bridge-memory.csv')
const SUMMARY_PATH = path.join(OUT_DIR, 'orchestrator-summary.json')

const state = {
  started_at: new Date().toISOString(),
  hooks: [],            // { file, hook, started_at, finished_at, action, detail, ok }
  anomalies: [],        // strings — anything that should fail the run loudly
  mem_samples: 0,
  prod_ip_hits: 0,
  clock_skew_active: false,
  ballast_file: null,
}

function log(event, extra) {
  const rec = { ts: new Date().toISOString(), event, ...(extra || {}) }
  try { fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n') } catch {}
  console.log(`[orch] ${rec.ts} ${event}${extra ? ' ' + JSON.stringify(extra) : ''}`)
}

function anomaly(msg) {
  state.anomalies.push(msg)
  log('ANOMALY', { msg })
  writeSummary(false)
}

function writeSummary(final) {
  const summary = {
    started_at: state.started_at,
    finished_at: final ? new Date().toISOString() : null,
    final: !!final,
    bridge_url: BRIDGE_URL,
    app_exe: APP_EXE,
    prod_ips_watched: PROD_IPS,
    prod_ip_connection_hits: state.prod_ip_hits,
    mem_samples: state.mem_samples,
    hooks_serviced: state.hooks,
    anomalies: state.anomalies,
  }
  try { fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2)) } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function ps(command, timeoutMs) {
  return execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { encoding: 'utf8', timeout: timeoutMs || 30000, windowsHide: true })
}

function appPids() {
  try {
    const out = ps(`Get-Process -Name '${PROC_NAME}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }`)
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(Number)
  } catch { return [] }
}

function launchApp() {
  const child = spawn(APP_EXE, [], { detached: true, stdio: 'ignore' })
  child.unref()
  log('app-launched', { exe: APP_EXE })
}

async function waitHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const body = await res.json()
        if (body && body.ok) return body
      }
    } catch {}
    await sleep(1500)
  }
  return null
}

async function waitAppGone(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (appPids().length === 0) return true
    await sleep(1000)
  }
  return false
}

function killApp(force) {
  try {
    const args = force ? ['/F', '/T', '/IM', APP_IMAGE] : ['/IM', APP_IMAGE]
    execFileSync('taskkill', args, { encoding: 'utf8', timeout: 15000, windowsHide: true })
  } catch (e) { log('taskkill-nonzero', { force: !!force, msg: String(e.message).slice(0, 200) }) }
}

// ─── Hook handlers ────────────────────────────────────────────────────────────

function ack(hook, payload) {
  const ackFile = hook.ack_file || path.join(HOOKS_DIR, `${hook.hook}.ack`)
  try {
    fs.writeFileSync(ackFile, JSON.stringify({ acked_at: new Date().toISOString(), hook: hook.hook, ...payload }, null, 2))
  } catch (e) { anomaly(`could not write ack file ${ackFile}: ${e.message}`) }
}

async function restartBridge(hook, kind) {
  let method = null
  if (kind === 'graceful') {
    // 1. The app registers Ctrl+Shift+Q as a GLOBAL quit shortcut (allowClose
    //    path). This is the only headless way to close it politely — the kiosk
    //    window's close handler otherwise opens a modal confirm dialog.
    try {
      ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^+q')")
      if (await waitAppGone(20000)) method = 'global-shortcut-ctrl-shift-q'
    } catch (e) { log('sendkeys-failed', { msg: String(e.message).slice(0, 200) }) }
    // 2. WM_CLOSE (taskkill without /F). Expected to be swallowed by the
    //    confirm dialog, but harmless to try before forcing.
    if (!method) {
      killApp(false)
      if (await waitAppGone(10000)) method = 'wm-close'
    }
    // 3. Forced — recorded as degraded so the evidence is honest about it.
    if (!method) {
      killApp(true)
      await waitAppGone(15000)
      method = 'DEGRADED-taskkill-force (graceful close blocked by kiosk confirm dialog)'
    }
  } else {
    killApp(true)
    await waitAppGone(15000)
    method = 'taskkill-force'
  }

  await sleep(2500) // let the single-instance lock release
  launchApp()
  const health = await waitHealth(90000)
  if (!health) {
    anomaly(`bridge did not become healthy after ${kind} restart`)
    return { action: `restart-${kind}`, method, ok: false, detail: 'no /health within 90s after relaunch' }
  }
  return { action: `restart-${kind}`, method, ok: true, detail: `healthy again, server_id=${health.server_id} uptime_s=${health.uptime_s}` }
}

async function handleWanLoss() {
  // The WAN to production is null-routed via the hosts file for the ENTIRE
  // run — there is nothing to cut. Verify the null-route still holds, ack.
  let detail
  try {
    await fetch('https://app.fullsite.mx/', { signal: AbortSignal.timeout(6000) })
    anomaly('WAN-LOSS check: request to https://app.fullsite.mx UNEXPECTEDLY SUCCEEDED — hosts null-route not effective')
    detail = 'UNEXPECTED SUCCESS reaching app.fullsite.mx'
    return { action: 'wan-loss-noop', ok: false, detail }
  } catch (e) {
    detail = `no-op by design: app.fullsite.mx null-routed via hosts for the whole run; probe failed as expected (${String(e.cause || e.message).slice(0, 120)})`
    return { action: 'wan-loss-noop', ok: true, detail }
  }
}

async function handleClockSkew() {
  const SKEW_MIN = 7, HOLD_MS = 60000
  try {
    ps(`Set-Date -Date ((Get-Date).AddMinutes(${SKEW_MIN})) | Out-Null`)
  } catch (e) {
    return { action: 'clock-skew', ok: true, skipped: true, detail: `Set-Date denied on this runner — skipped with reason (${String(e.message).slice(0, 150)})` }
  }
  state.clock_skew_active = true
  log('clock-skew-applied', { minutes: SKEW_MIN, hold_ms: HOLD_MS })
  try {
    await sleep(HOLD_MS)
  } finally {
    restoreClock(SKEW_MIN)
  }
  return { action: 'clock-skew', ok: true, detail: `+${SKEW_MIN}min applied for ${HOLD_MS / 1000}s, then restored (−${SKEW_MIN}min + best-effort w32tm /resync)` }
}

function restoreClock(minutes) {
  if (!state.clock_skew_active) return
  try {
    ps(`Set-Date -Date ((Get-Date).AddMinutes(-${minutes})) | Out-Null`)
    state.clock_skew_active = false
    log('clock-skew-restored', { minutes })
  } catch (e) {
    anomaly(`FAILED TO RESTORE CLOCK after +${minutes}min skew: ${e.message}`)
  }
  try { ps('w32tm /resync /force | Out-Null', 20000) } catch {} // best-effort re-sync
}

async function handleDiskPressure() {
  const TARGET_FREE = Math.floor(1.8 * 1024 * 1024 * 1024) // leave < 2GB free
  const HOLD_MS = 45000
  let free
  try {
    free = parseInt(ps("(Get-PSDrive C).Free").trim(), 10)
  } catch (e) {
    return { action: 'disk-pressure', ok: true, skipped: true, detail: `could not read free space — skipped (${String(e.message).slice(0, 120)})` }
  }
  if (!Number.isFinite(free)) return { action: 'disk-pressure', ok: true, skipped: true, detail: 'free-space query returned non-numeric — skipped' }
  const size = free - TARGET_FREE
  if (size <= 0) return { action: 'disk-pressure', ok: true, detail: `C: already has only ${(free / 1e9).toFixed(2)}GB free (< target) — nothing to do` }

  const ballast = path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'twin-disk-ballast.bin')
  try {
    execFileSync('fsutil', ['file', 'createnew', ballast, String(size)], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  } catch (e) {
    try { fs.rmSync(ballast, { force: true }) } catch {}
    return { action: 'disk-pressure', ok: true, skipped: true, detail: `fsutil createnew failed — skipped (${String(e.message).slice(0, 150)})` }
  }
  state.ballast_file = ballast
  let freeUnder = null
  try { freeUnder = parseInt(ps("(Get-PSDrive C).Free").trim(), 10) } catch {}
  log('disk-pressure-applied', { ballast_bytes: size, free_before: free, free_during: freeUnder })
  try {
    await sleep(HOLD_MS)
  } finally {
    try { fs.rmSync(ballast, { force: true }); state.ballast_file = null } catch (e) { anomaly(`could not delete ballast file ${ballast}: ${e.message}`) }
  }
  return {
    action: 'disk-pressure', ok: true,
    detail: `ballast of ${(size / 1e9).toFixed(2)}GB held ${HOLD_MS / 1000}s (free ${(free / 1e9).toFixed(2)}GB → ${freeUnder !== null ? (freeUnder / 1e9).toFixed(2) : '?'}GB), then deleted`,
  }
}

async function serviceHook(file) {
  let hook
  try { hook = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8')) } catch (e) {
    anomaly(`unreadable hook file ${file}: ${e.message}`)
    return
  }
  const rec = { file, hook: hook.hook, started_at: new Date().toISOString() }
  log('hook-received', { file, hook: hook.hook })
  let result
  try {
    switch (hook.hook) {
      case 'BRIDGE-RESTART-GRACEFUL': result = await restartBridge(hook, 'graceful'); break
      case 'BRIDGE-RESTART-KILL':     result = await restartBridge(hook, 'kill');     break
      case 'WAN-LOSS':                result = await handleWanLoss();                 break
      case 'FP-STATES':
        result = {
          action: 'fp-states-noop', ok: true,
          detail: 'no fingerprint service on this runner (C:\\fullsite absent — main.js skips it); harness self-manages PIN probes in external mode and marks the scenario SIMULATED-PARTIAL',
        }
        break
      case 'CLOCK-SKEW':              result = await handleClockSkew();               break
      case 'DISK-PRESSURE':           result = await handleDiskPressure();            break
      case 'FINAL-FLUSH-RESTART':
        result = {
          action: 'final-flush-skip', ok: true, skipped: true,
          detail: 'deliberately NOT restarting: hook is optional per its own instructions, and the harness sleeps only 10s before external verification hits GET /events — an app relaunch (5–20s) would race it. Print-queue boot replay was already exercised by the BRIDGE-RESTART hooks earlier in the phase.',
        }
        break
      default:
        result = { action: 'unknown-hook-ack', ok: true, detail: `unknown hook "${hook.hook}" — acked so the harness is never wedged, flagged as anomaly` }
        anomaly(`unknown hook type: ${hook.hook} (${file})`)
    }
  } catch (e) {
    result = { action: 'handler-error', ok: false, detail: String((e && e.stack) || e).slice(0, 400) }
    anomaly(`handler for ${hook.hook} threw: ${e.message}`)
  }
  ack(hook, result)
  Object.assign(rec, result, { finished_at: new Date().toISOString() })
  state.hooks.push(rec)
  log('hook-serviced', rec)
  writeSummary(false)
}

// ─── Samplers ─────────────────────────────────────────────────────────────────

function sampleMemory() {
  try {
    const out = ps(`Get-Process -Name '${PROC_NAME}' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id),$($_.WorkingSet64),$($_.PrivateMemorySize64)" }`)
    const ts = new Date().toISOString()
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    for (const l of lines) fs.appendFileSync(MEM_CSV, `${ts},${l}\n`)
    state.mem_samples++
  } catch {}
  if (PROD_IPS.length > 0) {
    try {
      const cond = PROD_IPS.map(ip => `$_.RemoteAddress -eq '${ip}'`).join(' -or ')
      const out = ps(`@(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { ${cond} }).Count`)
      const n = parseInt(out.trim(), 10)
      if (Number.isFinite(n) && n > 0) {
        state.prod_ip_hits += n
        anomaly(`netstat sampler: ${n} TCP connection(s) to production fullsite.mx IPs [${PROD_IPS.join(', ')}]`)
      }
    } catch {}
  }
}

// ─── Cleanup guarantees ──────────────────────────────────────────────────────
// If the orchestrator dies mid-hook, the clock and disk must still be restored.
process.on('exit', () => {
  if (state.clock_skew_active) restoreClock(7)
  if (state.ballast_file) { try { fs.rmSync(state.ballast_file, { force: true }) } catch {} }
  writeSummary(true)
})
process.on('SIGINT',  () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))
process.on('uncaughtException', (e) => { anomaly(`uncaughtException: ${(e && e.stack) || e}`); process.exit(1) })

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  fs.writeFileSync(MEM_CSV, 'ts,pid,working_set_bytes,private_bytes\n')
  log('orchestrator-start', { hooks_dir: HOOKS_DIR, bridge: BRIDGE_URL, prod_ips: PROD_IPS })
  writeSummary(false)

  const processed = new Set()
  let lastSample = 0

  while (true) {
    if (fs.existsSync(STOP_FILE)) { log('stop-file-seen'); break }

    if (Date.now() - lastSample >= 30000) { lastSample = Date.now(); sampleMemory() }

    let requests = []
    try {
      requests = fs.readdirSync(HOOKS_DIR)
        .filter(f => /^\d+-REQUEST-.+\.json$/.test(f) && !processed.has(f))
        .sort()
    } catch {}

    // Restart hooks have a hard deadline in the harness (hookTimeout while the
    // health watcher looks for the uptime reset) — service them first.
    requests.sort((a, b) => {
      const ra = a.includes('BRIDGE-RESTART') ? 0 : 1
      const rb = b.includes('BRIDGE-RESTART') ? 0 : 1
      return ra - rb || a.localeCompare(b)
    })

    for (const f of requests) {
      processed.add(f)
      await serviceHook(f)
      if (fs.existsSync(STOP_FILE)) break
    }

    await sleep(1000)
  }

  writeSummary(true)
  log('orchestrator-exit', { hooks: state.hooks.length, anomalies: state.anomalies.length })
  process.exit(0)
}

main().catch(e => { anomaly(`fatal: ${(e && e.stack) || e}`); process.exit(1) })
