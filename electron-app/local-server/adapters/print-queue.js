'use strict'
// Durable print jobs. A restart during printing means outcome unknown: keep the
// job visible for operator reconciliation, never automatically print it again.
const fs = require('fs')
const { randomUUID } = require('crypto')
const { replaceFile } = require('./storage/durable-file')
const VALID_STATUSES = ['pending', 'printing', 'printed', 'retrying', 'failed', 'recoverable', 'uncertain', 'cancelled']
const MAX_ATTEMPTS = 3
const JOB_TTL_MS = 24 * 60 * 60 * 1000
const clone = value => JSON.parse(JSON.stringify(value))
let _filePath = null
let _jobs = []
let _fault = null

function init({ filePath }) {
  _filePath = filePath
  _fault = null
  const loaded = _load()
  const recovered = loaded.map(j => j.status === 'printing' ? {
    ...j, status: 'uncertain', updated_at: new Date().toISOString(),
    last_error: 'El proceso se interrumpió durante la impresión. Verifica el papel antes de reimprimir.',
  } : j)
  _jobs = loaded
  if (recovered.some((j, i) => j !== loaded[i])) _commit(recovered)
  _gcOld()
}
function enqueueMany(options) {
  const jobs = clone(_jobs)
  const ids = []
  for (const opts of options) {
    const jobId = opts.job_id || randomUUID()
    const existing = jobs.find(j => j.job_id === jobId)
    if (existing) {
      for (const key of ['station_id', 'printer_id', 'data_b64', 'document_type', 'copies']) {
        const proposed = key === 'document_type' ? (opts[key] || 'receipt') : key === 'copies' ? (opts[key] || 1) : opts[key]
        if (existing[key] !== proposed) throw new Error('PRINT_JOB_ID_REUSED: job content differs')
      }
      ids.push(jobId)
      continue
    }
    const now = new Date().toISOString()
    jobs.push({
      job_id: jobId, command_id: opts.command_id || null,
      station_id: opts.station_id, printer_id: opts.printer_id,
      printer_name: opts.printer_name, connection: clone(opts.connection),
      document_type: opts.document_type || 'receipt', data_b64: opts.data_b64,
      copies: opts.copies || 1, copies_printed: 0, reprint: opts.reprint || false,
      status: 'pending', created_at: now, updated_at: now, attempts: 0, last_error: null,
    })
    ids.push(jobId)
  }
  if (jobs.length !== _jobs.length) _commit(jobs)
  else _assertHealthy()
  return ids
}
function enqueue(opts) { return enqueueMany([opts])[0] }
function markPrinting(id) { return _transition(id, 'printing', j => { j.attempts++ }) }
function markCopyPrinted(id) { return _transition(id, 'printing', j => { j.copies_printed = (j.copies_printed || 0) + 1 }) }
function markPrinted(id) { return _transition(id, 'printed', j => { j.last_error = null }) }
function markFailed(id, error) { return _transition(id, 'failed', j => { j.last_error = error || 'Unknown error' }) }
function markRetrying(id, error) { return _transition(id, 'retrying', j => { j.last_error = error || null }) }
function markRecoverable(id, error) { return _transition(id, 'recoverable', j => { j.last_error = error || 'Printer unavailable' }) }
function markUncertain(id, error) { return _transition(id, 'uncertain', j => { j.last_error = error || 'Print outcome unknown; verify paper before reprinting' }) }
function markCancelled(id) { return _transition(id, 'cancelled') }
function resolveUncertain(id, outcome) {
  if (getJob(id)?.status !== 'uncertain') return false
  if (outcome === 'printed') return markPrinted(id)
  if (outcome === 'reprint') return _transition(id, 'pending', j => {
    j.reprint = true; j.attempts = 0; j.last_error = 'Reimpresión solicitada tras verificar el resultado incierto'
  })
  throw new Error('Expected printed or reprint reconciliation')
}
function retryRecoverableJobs() {
  const ids = _jobs.filter(j => j.status === 'recoverable').map(j => j.job_id)
  if (ids.length) _commit(_jobs.map(j => ids.includes(j.job_id) ? {
    ...j, status: 'pending', attempts: 0, updated_at: new Date().toISOString(),
  } : j))
  return ids
}
function getJob(id) { const j = _jobs.find(j => j.job_id === id); return j ? clone(j) : null }
function getAllJobs() { return clone(_jobs) }
function getPendingJobs() { return clone(_getPending()) }
function getJobsByStatus(status) { return clone(_jobs.filter(j => j.status === status)) }
function getRecoverableJobs() { return getJobsByStatus('recoverable') }
function getUncertainJobs() { return getJobsByStatus('uncertain') }
function canRetry(id) {
  const job = getJob(id)
  return !!job && job.attempts < MAX_ATTEMPTS && ['pending', 'retrying', 'printing', 'recoverable'].includes(job.status)
}
function _getPending() { return _jobs.filter(j => j.status === 'pending' || j.status === 'retrying') }
function _transition(id, status, mutate) {
  _assertHealthy()
  const idx = _jobs.findIndex(j => j.job_id === id)
  if (idx < 0 || !VALID_STATUSES.includes(status)) return false
  const jobs = clone(_jobs)
  jobs[idx] = { ...jobs[idx], status, updated_at: new Date().toISOString() }
  if (mutate) mutate(jobs[idx])
  _commit(jobs)
  return true
}
function _load() {
  if (!_filePath || !fs.existsSync(_filePath)) return []
  const jobs = JSON.parse(fs.readFileSync(_filePath, 'utf8'))
  const ids = new Set()
  if (!Array.isArray(jobs) || jobs.some(j => {
    if (!j || !j.job_id || !VALID_STATUSES.includes(j.status) || ids.has(j.job_id)) return true
    ids.add(j.job_id); return false
  })) throw new Error('PRINT_QUEUE_CORRUPT: refusing to discard unresolved jobs')
  return jobs
}
function _assertHealthy() {
  if (!_filePath) throw new Error('PRINT_QUEUE_NOT_INITIALIZED')
  if (_fault) throw new Error(`PRINT_QUEUE_UNAVAILABLE: ${_fault.message}`)
}
function _commit(jobs) {
  _assertHealthy()
  try { replaceFile(_filePath, JSON.stringify(jobs, null, 2)) } catch (error) {
    _fault = error // a rename might already have succeeded; reload before further effects.
    throw error
  }
  _jobs = jobs
}
function _persist() { _commit(_jobs) }
function _gcOld() {
  const cutoff = Date.now() - JOB_TTL_MS
  // Command-owned receipts must survive as long as their event can be replayed.
  const jobs = _jobs.filter(j => j.command_id || !['printed', 'failed', 'cancelled'].includes(j.status) || new Date(j.created_at).getTime() > cutoff)
  if (jobs.length !== _jobs.length) _commit(jobs)
}
module.exports = {
  init, enqueue, enqueueMany, markPrinting, markCopyPrinted, markPrinted, markFailed,
  markRetrying, markCancelled, markRecoverable, markUncertain, resolveUncertain,
  retryRecoverableJobs, getRecoverableJobs, getUncertainJobs, getJob, getAllJobs,
  getPendingJobs, getJobsByStatus, canRetry, MAX_ATTEMPTS, VALID_STATUSES,
  _forTesting: { _load, _persist, _gcOld, _getPending },
}
