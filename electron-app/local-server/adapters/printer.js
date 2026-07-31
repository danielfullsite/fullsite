'use strict'
// ─── Printer Adapter (Windows — Phase 1) ─────────────────────────────────────
// Physical print routing via TCP/IP (ESC/POS on port 9100) and USB/Windows.
//
// This adapter is config-driven — it never contains IPs, printer names, or
// station definitions. All routing is resolved from the v2 printers config
// via printer-config-schema.resolveStation().
//
// Public interface (consumed by the Local Server HTTP router and WS command handler):
//   init({ printersConfig, queueFilePath })  — call once on startup
//   printToStation(stationId, data, documentType)  — print bytes to a logical station
//   kickDrawer()           — open cash drawer on the 'caja' station
//   buildTestTicket(name, version)  — build ESC/POS test bytes
//   getStations()          — return { station_id: [printer, ...] } for the /health endpoint
//   getPrintJobsFailed()   — total failed print attempts since startup
//   setStations(config)    — update running config + persist (for UI changes)
//
// Print queue guarantees:
//   - Job is written to disk BEFORE the print attempt
//   - Restart does not lose pending jobs
//   - Each job has a stable UUID; retries do not generate new jobs
//   - Manual reprint is flagged as reprint:true

const net        = require('net')
const fs         = require('fs')
const path       = require('path')
const os         = require('os')
const { execSync } = require('child_process')
const printerSchema = require('./printer-config-schema')
const printQueue    = require('./print-queue')

let _config       = null   // v2 printers config object
let _configPath   = null   // path to persist config changes
let _printJobsFailed = 0
let _recoveryInterval = null

// Errors that mean "printer unreachable" — infrastructure, not content.
// These jobs park as `recoverable` and are re-queued when the printer comes back.
const RECOVERABLE_ERROR_PATTERNS = [
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ENETUNREACH',
  'ETIMEDOUT', 'TCP timeout', 'EHOSTUNREACH',
]

function _isRecoverableError(errorMsg) {
  if (!errorMsg) return false
  return RECOVERABLE_ERROR_PATTERNS.some(p => errorMsg.includes(p))
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   printersConfig: object|null,  — validated v2 printers config, or null
 *   configPath: string|null,
 *   queueFilePath: string|null,
 * }} opts
 */
function init({ printersConfig, configPath, queueFilePath }) {
  _config     = printersConfig || null
  _configPath = configPath || null

  if (queueFilePath) {
    printQueue.init({ filePath: queueFilePath })
    // On startup, retry any pending or recoverable jobs from previous run
    _retryPendingJobs().catch(e => console.warn('[printer] Pending job retry error:', e.message))
    // Periodic recovery: re-queue recoverable jobs every 60s (Wansoft polls every 15s indefinitely).
    // This ensures printer-unavailable jobs are retried without manual intervention.
    if (_recoveryInterval) clearInterval(_recoveryInterval)
    _recoveryInterval = setInterval(() => {
      const revived = printQueue.retryRecoverableJobs()
      if (revived.length > 0) {
        _retryPendingJobs().catch(e => console.warn('[printer] Recovery retry error:', e.message))
      }
    }, 60_000)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function getStations() {
  if (!_config || !Array.isArray(_config.printers)) return {}
  return printerSchema.getConfiguredStations(_config.printers)
    .reduce((acc, stationId) => {
      acc[stationId] = _config.printers.filter(
        p => p.enabled && p.station_ids.includes(stationId)
      )
      return acc
    }, {})
}

function getPrintJobsFailed() { return _printJobsFailed }

/**
 * Update the running printer config and persist to disk.
 * Validates the new config before applying.
 * Returns { ok, errors }.
 */
function setStations(newConfig) {
  const { valid, errors } = printerSchema.validate(newConfig)
  if (!valid) return { ok: false, errors }
  _config = newConfig
  if (_configPath) {
    try { fs.writeFileSync(_configPath, JSON.stringify(newConfig, null, 2)) } catch (e) {
      console.warn('[printer] Could not persist config:', e.message)
    }
  }
  return { ok: true, errors: [] }
}

/**
 * Print ESC/POS bytes to a logical station.
 *
 * @param {string} stationId   — e.g. 'cocina', 'barra', 'caja'
 * @param {Buffer} data        — raw ESC/POS bytes
 * @param {string} [documentType] — e.g. 'kitchen_ticket', 'receipt'
 * @param {{ reprint?: boolean }} [opts]
 *
 * @throws {Error} with code 'PRINTER_NOT_CONFIGURED' if no printers config loaded
 * @throws {Error} with code 'STATION_NOT_CONFIGURED' if station has no printers
 * @throws {Error} with code 'ALL_PRINTERS_FAILED' if every printer attempt failed
 */
async function printToStation(stationId, data, documentType, opts = {}) {
  if (!_config || !Array.isArray(_config.printers) || _config.printers.length === 0) {
    throw Object.assign(
      new Error(`PRINTER_NOT_CONFIGURED: No printer configuration loaded. Use the setup wizard to configure printers.`),
      { code: 'PRINTER_NOT_CONFIGURED', station: stationId }
    )
  }

  const { printers, diagnostic } = printerSchema.resolveStation(_config.printers, stationId, documentType)

  if (printers.length === 0) {
    throw Object.assign(
      new Error(`STATION_NOT_CONFIGURED: No enabled printers found for station "${stationId}". Diagnostic: ${diagnostic}`),
      { code: 'STATION_NOT_CONFIGURED', station: stationId, diagnostic }
    )
  }

  const data_b64 = data.toString('base64')
  const errors   = []
  let   succeeded = 0

  for (const printer of printers) {
    const copies = printer.copies || 1
    const jobId = printQueue.enqueue({
      station_id:    stationId,
      printer_id:    printer.printer_id,
      printer_name:  printer.name,
      connection:    printer.connection,
      document_type: documentType || 'receipt',
      data_b64,
      copies,
      reprint:       opts.reprint || false,
    })

    printQueue.markPrinting(jobId)
    let lastError = null

    for (let copy = 0; copy < copies; copy++) {
      try {
        await _physicalPrint(printer.connection, data)
      } catch (e) {
        lastError = e.message
      }
    }

    if (lastError) {
      _printJobsFailed++
      errors.push({ printer: printer.name, error: lastError })

      if (printQueue.canRetry(jobId)) {
        printQueue.markRetrying(jobId, lastError)
      } else if (_isRecoverableError(lastError)) {
        // Infrastructure failure (printer unreachable) — park as recoverable.
        // The 60s recovery interval will re-queue when the printer comes back.
        printQueue.markRecoverable(jobId, lastError)
      } else {
        printQueue.markFailed(jobId, lastError)
      }
    } else {
      printQueue.markPrinted(jobId)
      succeeded++
    }
  }

  if (succeeded === 0) {
    const msg = errors.map(e => `${e.printer}: ${e.error}`).join('; ')
    throw Object.assign(
      new Error(`ALL_PRINTERS_FAILED for station "${stationId}": ${msg}`),
      { code: 'ALL_PRINTERS_FAILED', station: stationId, errors }
    )
  }
}

// ESC/POS: kick cash drawer on pin 2 (standard RJ-11 port)
const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

async function kickDrawer() {
  await printToStation('caja', DRAWER_KICK, 'receipt')
}

function buildTestTicket(stationId, version) {
  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Monterrey' })
  return Buffer.from(
    '\x1b\x40\x1b\x61\x01\x1d\x21\x11FULLSITE LOCAL\n' +
    `\x1d\x21\x00\x1b\x61\x01--- TEST ---\n\n` +
    `\x1b\x61\x00Estacion: ${stationId}\nTerminal: ${os.hostname()}\n` +
    `Fecha: ${now}\nVersion: ${version}\n\n` +
    '\x1b\x61\x01Impresora OK\n\n\x1d\x56\x41\x03',
    'binary'
  )
}

// ── Physical print ────────────────────────────────────────────────────────────

async function _physicalPrint(connection, data) {
  if (connection.type === 'tcp') {
    await _printTcp(connection.host, connection.port, data)
  } else if (connection.type === 'usb' || connection.type === 'windows') {
    const names = connection.names || []
    let lastErr
    for (const name of names) {
      try { _printUsb(name, data); return } catch (e) { lastErr = e }
    }
    throw lastErr || new Error('No USB printer names configured')
  } else {
    throw new Error(`Unknown connection type: ${connection.type}`)
  }
}

function _printTcp(host, port, data) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket()
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error(`TCP timeout ${host}:${port}`)) }, 5000)
    socket.connect(port, host, () => {
      clearTimeout(timeout)
      socket.write(data, () => { socket.end(); resolve() })
    })
    socket.on('error', (err) => { clearTimeout(timeout); reject(err) })
  })
}

function _printUsb(printerName, data) {
  const tmpFile = path.join(os.tmpdir(), `fs_print_${Date.now()}.bin`)
  try {
    fs.writeFileSync(tmpFile, data)
    try {
      execSync(`copy /b "${tmpFile}" "\\\\%COMPUTERNAME%\\${printerName}"`, {
        timeout: 5000, windowsHide: true, shell: 'cmd.exe',
      })
    } catch {
      execSync(
        `powershell -Command "Get-Content '${tmpFile}' -Encoding Byte -ReadCount 0 | Out-Printer '${printerName}'"`,
        { timeout: 8000, windowsHide: true }
      )
    }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

// ── Pending job retry on startup ──────────────────────────────────────────────

async function _retryPendingJobs() {
  // On startup, also revive recoverable jobs from previous run — printer may be back.
  printQueue.retryRecoverableJobs()

  const pending = printQueue.getPendingJobs()
  if (pending.length === 0) return

  console.log(`[printer] Retrying ${pending.length} pending jobs from previous run...`)

  for (const job of pending) {
    if (!printQueue.canRetry(job.job_id)) {
      printQueue.markFailed(job.job_id, 'Max retry attempts exceeded on startup')
      continue
    }

    printQueue.markPrinting(job.job_id)
    try {
      const data = Buffer.from(job.data_b64, 'base64')
      await _physicalPrint(job.connection, data)
      printQueue.markPrinted(job.job_id)
      console.log(`[printer] Recovered job ${job.job_id} (${job.printer_name})`)
    } catch (e) {
      if (printQueue.canRetry(job.job_id)) {
        printQueue.markRetrying(job.job_id, e.message)
      } else if (_isRecoverableError(e.message)) {
        printQueue.markRecoverable(job.job_id, e.message)
      } else {
        printQueue.markFailed(job.job_id, e.message)
      }
      console.warn(`[printer] Could not recover job ${job.job_id}:`, e.message)
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  init,
  getStations,
  getPrintJobsFailed,
  setStations,
  printToStation,
  kickDrawer,
  buildTestTicket,
  // Exposed for /print-queue HTTP endpoint
  getQueue: printQueue.getAllJobs,
  getPendingJobs: printQueue.getPendingJobs,
  getRecoverableJobs: printQueue.getRecoverableJobs,
}
