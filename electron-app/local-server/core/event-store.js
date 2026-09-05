'use strict'
// ─── EventStore — Core Wrapper ────────────────────────────────────────────────
// Adds idempotency enforcement and command deduplication on top of any EventStore
// implementation. The rest of the system calls this wrapper, never storage directly.

const crypto = require('crypto')
const { sameCommand } = require('./command-identity')

class CoreEventStore {
  /** @param {import('../adapters/storage/base').EventStore} store */
  constructor(store) {
    this._store = store
    // Comandos en vuelo, por command_id. Ver processCommand: la dedup en disco no
    // alcanza cuando dos reintentos del MISMO comando corren a la vez.
    this._enVuelo = new Map()
  }

  async load() {
    if (this._store.load) await this._store.load()
  }

  /**
   * Process a command into an event.
   * If the command was already processed (same command_id), returns the cached ACK.
   * @param {{ command_id: string, type: string, client_id: string, restaurant_id: string, payload: object }} cmd
   * @param {{ eventType: string, ts?: number }} opts
   * @returns {Promise<{ event: LocalEvent, duplicate: boolean }>}
   */
  async processCommand(cmd, { eventType, buildEffects, buildResult }) {
    const event = {
      id: cmd.command_id,
      type: eventType,
      ts: Date.now(),
      client_id: cmd.client_id,
      restaurant_id: cmd.restaurant_id,
      payload: cmd.payload,
    }
    const inFlight = this._enVuelo.get(cmd.command_id)
    if (inFlight) {
      if (!sameCommand(inFlight.event, event)) throw new Error('IDEMPOTENCY_KEY_REUSED: command content differs')
      // Propagate the original storage error. An uncommitted concurrent request
      // cannot become a successful duplicate merely because another request failed.
      const result = await inFlight.promise
      return { ...result, duplicate: true }
    }
    const promise = this._procesarComando(event, buildEffects, buildResult)
    this._enVuelo.set(cmd.command_id, { event, promise })
    try { return await promise } finally { this._enVuelo.delete(cmd.command_id) }
  }

  async _procesarComando(event, buildEffects, buildResult) {
    const existing = await this._store.getProcessedCommand(event.id)
    if (existing) {
      if (!sameCommand(existing, event)) throw new Error('IDEMPOTENCY_KEY_REUSED: command content differs')
      return { duplicate: true, event: existing }
    }
    // Effect intents (including printer routing snapshots) are part of the same
    // durable transaction. Preparing them may validate, but must perform no IO effects.
    if (buildEffects) event.effects = await buildEffects()
    if (buildResult) event.result = await buildResult()
    return this._store.commitCommand(event)
  }

  /**
   * Append an internally-generated event (no command_id — not client-originated).
   * Used for STATE_SYNC events from Supabase polling.
   */
  async appendInternal(eventType, payload, { restaurantId }) {
    const event = {
      id:            crypto.randomUUID(),
      type:          eventType,
      ts:            Date.now(),
      client_id:     'server',
      restaurant_id: restaurantId,
      payload,
    }
    const { sequences } = await this._store.append([event])
    return { ...event, sequence: sequences[0], synced: false }
  }

  async readAfter(sequence)                          { return this._store.readAfter(sequence) }
  async getLastSequence()                            { return this._store.getLastSequence() }
  async unsyncedCount()                              { return this._store.unsyncedCount() }
  async markSynced(sequences)                        { return this._store.markSynced(sequences) }
  getStats()                                         { return this._store.getStats ? this._store.getStats() : {} }
}

module.exports = { CoreEventStore }
