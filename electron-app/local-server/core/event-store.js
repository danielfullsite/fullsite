'use strict'
// ─── EventStore — Core Wrapper ────────────────────────────────────────────────
// Adds idempotency enforcement and command deduplication on top of any EventStore
// implementation. The rest of the system calls this wrapper, never storage directly.

const crypto = require('crypto')

class CoreEventStore {
  /** @param {import('../adapters/storage/base').EventStore} store */
  constructor(store) {
    this._store = store
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
  async processCommand(cmd, { eventType }) {
    const { command_id, client_id, restaurant_id, payload } = cmd

    // Idempotency: reject duplicate commands
    if (await this._store.hasProcessedCommand(command_id)) {
      return { duplicate: true, event: null }
    }

    const event = {
      id:            command_id, // command_id IS the event id (idempotent pairing)
      type:          eventType,
      ts:            Date.now(),
      client_id,
      restaurant_id,
      payload,
    }

    const { sequences } = await this._store.append([event])
    const sequence = sequences[0]
    await this._store.saveProcessedCommand(command_id, event.id, sequence)

    return { duplicate: false, event: { ...event, sequence, synced: false } }
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
