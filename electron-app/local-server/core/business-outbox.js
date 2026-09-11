'use strict'

// Independent of the shadow synced flag. Only a transaction receipt from the
// branch's fenced writer advances this cursor. No business write from payload.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { replaceFile } = require('../adapters/storage/durable-file')
const INITIAL_HASH = '0'.repeat(64)
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value

function committedEnvelope(event) {
  // synced and printing effects are transport/execution metadata. The full
  // committed business result is essential; the shadow copy omitted it.
  return canonical({ id: event.id, sequence: event.sequence, type: event.type, ts: event.ts,
    client_id: event.client_id ?? null, restaurant_id: event.restaurant_id,
    payload: event.payload ?? {}, result: event.result ?? null })
}
const historyHash = (previous, event) => crypto.createHash('sha256').update(previous + '\n' + JSON.stringify(committedEnvelope(event))).digest('hex')

class BusinessOutbox {
  constructor({ eventStore, directory, materializeUrl = 'https://app.fullsite.mx/api/pos/caja/materialize', restaurantId, locationId, streamId, credential,
    baselineSequence = 0, baselineHistoryHash = INITIAL_HASH, fetchImpl = fetch, intervalMs = 5000, batchSize = 100, timeoutMs = 8000 }) {
    if (!eventStore || !directory || !restaurantId || !locationId || !/^[a-f0-9-]{36}$/i.test(streamId || '') ||
      typeof credential !== 'string' || credential.length < 32 ||
      !Number.isSafeInteger(baselineSequence) || baselineSequence < 0 || !validHash(baselineHistoryHash)) throw new Error('Business sync configuration incomplete')
    const origin = new URL(materializeUrl)
    if (origin.protocol !== 'https:') throw new Error('Business sync requires HTTPS')
    this.store = eventStore; this.url = origin.href
    this.scope = { stream_id: streamId, restaurant_id: restaurantId, location_id: locationId }
    this.credential = credential; this.fetch = fetchImpl; this.batchSize = batchSize; this.timeoutMs = timeoutMs; this.intervalMs = intervalMs
    this.baseline = { sequence: baselineSequence, history_hash: baselineHistoryHash }
    this.cursor = { ...this.scope, ...this.baseline }
    this.file = path.join(directory, 'business-sync-checkpoint.json')
    fs.mkdirSync(directory, { recursive: true })
    if (fs.existsSync(this.file)) {
      const checkpoint = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!Object.entries(this.scope).every(([key, value]) => checkpoint[key] === value) ||
        !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < baselineSequence || !validHash(checkpoint.history_hash)) throw new Error('Business sync checkpoint scope invalid')
      this.cursor = checkpoint
    }
    this.timer = null; this.running = null; this.lastError = null; this.pending = null
  }
  start() {
    if (this.timer) return
    const tick = () => { this.flush().catch(() => {}) }
    tick(); this.timer = setInterval(tick, this.intervalMs); this.timer.unref?.()
  }
  stop() { clearInterval(this.timer); this.timer = null }
  status() { return { configured: true, ...this.scope, last_sequence: this.cursor.sequence, pending_events: this.pending, error: this.lastError } }
  flush() {
    if (this.running) return this.running
    this.running = this._flush().then(result => { this.lastError = null; return result }, error => {
      this.lastError = error.code || 'BUSINESS_SYNC_PENDING'
      throw error
    }).finally(() => { this.running = null })
    return this.running
  }
  async _flush() {
    const all = (await this.store.readAfter(0)).sort((a, b) => a.sequence - b.sequence)
    let localHash = INITIAL_HASH, previousSequence = 0
    let baselineMatched = this.baseline.sequence === 0 && this.baseline.history_hash === INITIAL_HASH
    let cursorMatched = this.cursor.sequence === 0 && this.cursor.history_hash === INITIAL_HASH
    const pending = []
    for (const event of all) {
      if (event.sequence !== previousSequence + 1 || event.restaurant_id !== this.scope.restaurant_id) throw failure('LOCAL_STREAM_HISTORY_CONFLICT')
      const previousHash = localHash
      localHash = historyHash(localHash, event); previousSequence = event.sequence
      if (event.sequence === this.baseline.sequence) baselineMatched = localHash === this.baseline.history_hash
      if (event.sequence === this.cursor.sequence) cursorMatched = localHash === this.cursor.history_hash
      if (event.sequence > this.cursor.sequence) pending.push({ event, previousHash, hash: localHash })
    }
    if (!baselineMatched || !cursorMatched) throw failure('LOCAL_STREAM_HISTORY_CONFLICT')
    this.pending = pending.length
    let confirmed = 0, materialized = 0
    for (const { event, previousHash, hash } of pending.slice(0, this.batchSize)) {
      const response = await this.fetch(this.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_stream_id: this.scope.stream_id, p_credential: this.credential,
          p_previous_history_hash: previousHash, p_history_hash: hash, p_event: committedEnvelope(event) }),
        redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) throw failure(response.status === 401 || response.status === 403 ? 'BUSINESS_SYNC_UNAUTHORIZED' : 'BUSINESS_SYNC_REJECTED')
      const receipt = await response.json()
      if (receipt?.stream_id !== this.scope.stream_id || receipt.sequence !== event.sequence || receipt.event_id !== event.id ||
        receipt.history_hash !== hash || typeof receipt.materialized !== 'boolean' || typeof receipt.duplicate !== 'boolean') throw failure('INVALID_BUSINESS_RECEIPT')
      const next = { ...this.scope, sequence: event.sequence, history_hash: hash }
      replaceFile(this.file, JSON.stringify(next))
      this.cursor = next
      confirmed++; if (receipt.materialized) materialized++
      this.pending--
    }
    return { confirmed, materialized, pending: this.pending, last_sequence: this.cursor.sequence }
  }
}
function failure(code) { return Object.assign(new Error(code), { code }) }
module.exports = { BusinessOutbox, committedEnvelope, historyHash, INITIAL_HASH }
