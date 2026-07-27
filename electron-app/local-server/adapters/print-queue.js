'use strict'
// ─── Print Queue ──────────────────────────────────────────────────────────────
// Persistent print job queue backed by a JSON file.
//
// Guarantees:
//   - A job is written to disk BEFORE the print attempt
//   - POS or Local Server restart does not lose pending jobs
//   - Each job has a stable UUID — retries do not generate new jobs
//   - Manual reprint is distinguished from automatic retry (reprint: true)
//   - Changing printer config while jobs are pending does not auto-reroute them
//     (job stores printer_id + connection snapshot at enqueue time)
//
// Job status lifecycle:
//   pending → printing → printed
//          ↘ retrying ↗ ↘ failed
//   Any state → cancelled (manual)
//
// File format: single JSON array (queue is small; NDJSON not warranted here).
// File is rewritten on every status change (atomic write via tmp + rename).

const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const { randomUUID } = require('crypto')

const VALID_STATUSES = ['pending', 'printing', 'printed', 'retrying', 'failed', 'cancelled']
const MAX_ATTEMPTS   = 3
const JOB_TTL_MS     = 24 * 60 * 60 * 1000   // drop printed/failed jobs older than 24h on load

let _filePath = null
let _jobs     = []  // in-memory mirror

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialize the queue. Loads any pending jobs from disk.
 * Call once on server startup before processing any print jobs.
 *
 * @param {{ filePath: string }} opts
 */
function init({ filePath }) {
  _filePath = filePath
  _jobs = _load()
  _gcOld()
  console.log(`[print-queue] Loaded ${_jobs.length} jobs from disk (${_getPending().length} pending/retrying)`)
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

/**
 * Add a new print job to the queue.
 * The job is persisted to disk before returning.
 *
 * @param {{
 *   station_id: string,
 *   printer_id: string,
 *   printer_name: string,
 *   connection: object,         — snapshot of printer connection at enqueue time
 *   document_type: string,
 *   data_b64: string,           — base64 ESC/POS bytes
 *   copies?: number,
 *   reprint?: boolean,
 * }} opts
 * @returns {string} job_id
 */
function enqueue(opts) {
  const job = {
    job_id:        randomUUID(),
    station_id:    opts.station_id,
    printer_id:    opts.printer_id,
    printer_name:  opts.printer_name,
    connection:    opts.connection,   // snapshot — not live config reference
    document_type: opts.document_type || 'receipt',
    data_b64:      opts.data_b64,
    copies:        opts.copies || 1,
    reprint:       opts.reprint || false,
    status:        'pending',
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString(),
    attempts:      0,
    last_error:    null,
  }
  _jobs.push(job)
  _persist()
  return job.job_id
}

// ── Status transitions ────────────────────────────────────────────────────────

function markPrinting(jobId) {
  return _transition(jobId, 'printing', j => {
    j.attempts += 1
  })
}

function markPrinted(jobId) {
  return _transition(jobId, 'printed', j => {
    j.last_error = null
  })
}

function markFailed(jobId, errorMsg) {
  return _transition(jobId, 'failed', j => {
    j.last_error = errorMsg || 'Unknown error'
  })
}

function markRetrying(jobId, errorMsg) {
  return _transition(jobId, 'retrying', j => {
    j.last_error = errorMsg || null
  })
}

function markCancelled(jobId) {
  return _transition(jobId, 'cancelled')
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getJob(jobId) {
  return _jobs.find(j => j.job_id === jobId) || null
}

function getAllJobs() {
  return [..._jobs]
}

function getPendingJobs() {
  return _getPending()
}

function getJobsByStatus(status) {
  return _jobs.filter(j => j.status === status)
}

// ── Retry logic ───────────────────────────────────────────────────────────────

/**
 * Should this job be automatically retried?
 * Returns false if max attempts reached or job was manually cancelled.
 */
function canRetry(jobId) {
  const job = getJob(jobId)
  if (!job) return false
  return job.attempts < MAX_ATTEMPTS && job.status !== 'cancelled'
}

// ── Internal ─────────────────────────────────────────────────────────────────

function _getPending() {
  return _jobs.filter(j => j.status === 'pending' || j.status === 'retrying')
}

function _transition(jobId, newStatus, mutate) {
  const idx = _jobs.findIndex(j => j.job_id === jobId)
  if (idx < 0) {
    console.warn(`[print-queue] Job not found: ${jobId}`)
    return false
  }
  if (!VALID_STATUSES.includes(newStatus)) {
    console.warn(`[print-queue] Invalid status: ${newStatus}`)
    return false
  }
  _jobs[idx] = { ..._jobs[idx], status: newStatus, updated_at: new Date().toISOString() }
  if (mutate) mutate(_jobs[idx])
  _persist()
  return true
}

function _load() {
  if (!_filePath) return []
  try {
    if (!fs.existsSync(_filePath)) return []
    const raw = fs.readFileSync(_filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(j => j && j.job_id && j.status)
  } catch (e) {
    console.warn('[print-queue] Error loading queue file:', e.message)
    return []
  }
}

function _persist() {
  if (!_filePath) return
  try {
    const tmp = _filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(_jobs, null, 2), 'utf8')
    fs.renameSync(tmp, _filePath)
  } catch (e) {
    console.error('[print-queue] Error persisting queue:', e.message)
  }
}

function _gcOld() {
  const cutoff = Date.now() - JOB_TTL_MS
  const before = _jobs.length
  _jobs = _jobs.filter(j => {
    if (j.status === 'pending' || j.status === 'retrying') return true  // keep pending always
    return new Date(j.created_at).getTime() > cutoff
  })
  if (_jobs.length < before) {
    _persist()
    console.log(`[print-queue] GC: removed ${before - _jobs.length} old jobs`)
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  init,
  enqueue,
  markPrinting,
  markPrinted,
  markFailed,
  markRetrying,
  markCancelled,
  getJob,
  getAllJobs,
  getPendingJobs,
  getJobsByStatus,
  canRetry,
  MAX_ATTEMPTS,
  VALID_STATUSES,
  _forTesting: { _load, _persist, _gcOld, _getPending },
}
