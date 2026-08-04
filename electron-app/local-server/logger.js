'use strict'
// ─── Rotating File Logger ─────────────────────────────────────────────────────
// Pure Node.js — no external dependencies.
// Writes structured lines to <logDir>/server.log.
// Rotation: when the active file reaches maxSizeBytes, shift older files and
// open a fresh server.log. Keeps at most MAX_FILES archived copies.
//
// File series:
//   server.log        ← active (current writes)
//   server.1.log      ← most recent archive
//   …
//   server.5.log      ← oldest archive (dropped on next rotation)
//
// Usage:
//   const logger = require('./logger')
//   logger.init(logDir)
//   logger.patchConsole()          // redirect console.* to file + stdout
//   logger.getLastEntry()          // { ts, level, msg } for /health

const fs   = require('fs')
const path = require('path')

const DEFAULT_MAX_SIZE  = 5 * 1024 * 1024  // 5 MB
const MAX_FILES         = 5

let _logPath      = null
let _curSize      = 0
let _lastEntry    = null   // { ts, level, msg } — for /health
let _maxSizeBytes = DEFAULT_MAX_SIZE

// ── Rotation ──────────────────────────────────────────────────────────────────

function _rotate() {
  if (!_logPath) return
  const ext  = path.extname(_logPath)           // '.log'
  const base = _logPath.slice(0, -ext.length)   // '/path/to/server'

  // Drop the oldest archive
  try { fs.unlinkSync(`${base}.${MAX_FILES}${ext}`) } catch {}

  // Shift: server.(N-1).log → server.N.log  (N = MAX_FILES … 2)
  for (let i = MAX_FILES - 1; i >= 1; i--) {
    try { fs.renameSync(`${base}.${i}${ext}`, `${base}.${i + 1}${ext}`) } catch {}
  }

  // Move active log to server.1.log
  try { fs.renameSync(_logPath, `${base}.1${ext}`) } catch {}
  _curSize = 0
}

// ── Core write ────────────────────────────────────────────────────────────────

function _write(level, args) {
  const msg  = args
    .map(a => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ')
  const ts   = new Date().toISOString()
  const line = `${ts} [${level.padEnd(5)}] ${msg}\n`
  const bytes = Buffer.byteLength(line, 'utf8')

  _lastEntry = { ts, level, msg: msg.slice(0, 500) }

  if (_logPath) {
    if (_curSize + bytes > _maxSizeBytes) _rotate()
    try {
      fs.appendFileSync(_logPath, line, 'utf8')
      _curSize += bytes
    } catch {}
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the logger. Safe to call multiple times — subsequent calls are
 * ignored unless logDir changes.
 *
 * @param {string} logDir   Directory for log files (created if missing)
 * @param {{ maxSizeBytes?: number }} [opts]  Override rotation threshold (for tests)
 */
function init(logDir, opts = {}) {
  _maxSizeBytes = opts.maxSizeBytes || DEFAULT_MAX_SIZE
  fs.mkdirSync(logDir, { recursive: true })
  _logPath = path.join(logDir, 'server.log')
  try {
    _curSize = fs.statSync(_logPath).size
  } catch {
    _curSize = 0
  }
}

/** Return the last log entry — used by /health for remote diagnosis. */
function getLastEntry() { return _lastEntry }

/** Return the active log file path — null before init(). */
function getLogPath()   { return _logPath }

function info  (...args) { _write('INFO',  args) }
function warn  (...args) { _write('WARN',  args) }
function error (...args) { _write('ERROR', args) }

/**
 * Redirect console.log / .warn / .error / .info to the file logger.
 * Call this once from Electron main.js after logger.init().
 */
function patchConsole() {
  console.log   = (...args) => _write('INFO',  args)
  console.info  = (...args) => _write('INFO',  args)
  console.warn  = (...args) => _write('WARN',  args)
  console.error = (...args) => _write('ERROR', args)
}

module.exports = { init, getLastEntry, getLogPath, info, warn, error, patchConsole }
