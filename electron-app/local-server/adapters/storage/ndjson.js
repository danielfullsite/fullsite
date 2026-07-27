'use strict'
// ─── NdjsonEventStore — Phase 1 Implementation ───────────────────────────────
// Append-only NDJSON log for events. Suitable for restaurant-scale volumes (~500 events/day).
// Swap for SqliteEventStore in Phase 2 without touching the rest of the system.
//
// Format: one JSON object per line in events.ndjson.
// Processed commands: separate processed-commands.ndjson file.
// Corruption detection: each line is independently parseable; corrupt lines are skipped with a log.

const fs   = require('fs')
const path = require('path')
const { EventStore } = require('./base')

class NdjsonEventStore extends EventStore {
  /**
   * @param {{ eventLogPath: string, processedCommandsPath: string }} opts
   */
  constructor({ eventLogPath, processedCommandsPath }) {
    super()
    this._logPath = eventLogPath
    this._cmdPath = processedCommandsPath
    this._sequence = 0
    this._processedCommands = new Map() // key → { eventId, sequence }
    this._unsyncedCount = 0
    this._loaded = false
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  async load() {
    if (this._loaded) return
    this._loaded = true

    // Replay event log to determine last sequence + unsynced count
    if (fs.existsSync(this._logPath)) {
      const lines = fs.readFileSync(this._logPath, 'utf8').split('\n').filter(Boolean)
      let corrupt = 0
      for (const line of lines) {
        try {
          const ev = JSON.parse(line)
          if (typeof ev.sequence === 'number' && ev.sequence > this._sequence) {
            this._sequence = ev.sequence
          }
          if (!ev.synced) this._unsyncedCount++
        } catch {
          corrupt++
        }
      }
      if (corrupt > 0) {
        console.warn(`[event-store] ${corrupt} corrupt line(s) skipped in ${this._logPath}`)
      }
    }

    // Load processed commands index
    if (fs.existsSync(this._cmdPath)) {
      const lines = fs.readFileSync(this._cmdPath, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const { key, eventId, sequence } = JSON.parse(line)
          if (key) this._processedCommands.set(key, { eventId, sequence })
        } catch {}
      }
    }

    console.log(`[event-store] Loaded. lastSequence=${this._sequence} unsynced=${this._unsyncedCount} processedCmds=${this._processedCommands.size}`)
  }

  // ─── EventStore interface ────────────────────────────────────────────────

  async append(events) {
    if (!this._loaded) await this.load()
    const sequences = []
    const lines = []

    for (const ev of events) {
      this._sequence++
      const full = { ...ev, sequence: this._sequence, synced: false }
      sequences.push(this._sequence)
      lines.push(JSON.stringify(full))
      this._unsyncedCount++
    }

    // Append all lines atomically (single write syscall)
    fs.appendFileSync(this._logPath, lines.join('\n') + '\n', 'utf8')

    return { sequences }
  }

  async readAfter(sequence) {
    if (!this._loaded) await this.load()
    if (!fs.existsSync(this._logPath)) return []

    const lines = fs.readFileSync(this._logPath, 'utf8').split('\n').filter(Boolean)
    const result = []
    for (const line of lines) {
      try {
        const ev = JSON.parse(line)
        if (typeof ev.sequence === 'number' && ev.sequence > sequence) {
          result.push(ev)
        }
      } catch {}
    }
    return result
  }

  async getLastSequence() {
    if (!this._loaded) await this.load()
    return this._sequence
  }

  async hasProcessedCommand(idempotencyKey) {
    if (!this._loaded) await this.load()
    return this._processedCommands.has(idempotencyKey)
  }

  async saveProcessedCommand(idempotencyKey, eventId, sequence) {
    if (!this._loaded) await this.load()
    this._processedCommands.set(idempotencyKey, { eventId, sequence })
    const line = JSON.stringify({ key: idempotencyKey, eventId, sequence }) + '\n'
    fs.appendFileSync(this._cmdPath, line, 'utf8')
  }

  async unsyncedCount() {
    if (!this._loaded) await this.load()
    return this._unsyncedCount
  }

  async markSynced(sequences) {
    if (!this._loaded) await this.load()
    // NDJSON: rewrite the file with updated synced flags.
    // At restaurant scale this is fast enough; SQLite will handle this with an UPDATE.
    if (!fs.existsSync(this._logPath)) return
    const seqSet = new Set(sequences)
    const lines = fs.readFileSync(this._logPath, 'utf8').split('\n').filter(Boolean)
    const updated = lines.map(line => {
      try {
        const ev = JSON.parse(line)
        if (seqSet.has(ev.sequence) && !ev.synced) {
          ev.synced = true
          this._unsyncedCount = Math.max(0, this._unsyncedCount - 1)
          return JSON.stringify(ev)
        }
        return line
      } catch {
        return line
      }
    })
    fs.writeFileSync(this._logPath, updated.join('\n') + '\n', 'utf8')
  }

  // ─── Diagnostic ─────────────────────────────────────────────────────────

  getStats() {
    return {
      lastSequence: this._sequence,
      unsyncedCount: this._unsyncedCount,
      processedCommands: this._processedCommands.size,
    }
  }
}

module.exports = { NdjsonEventStore }
