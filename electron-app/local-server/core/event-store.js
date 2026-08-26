'use strict'
// ─── EventStore — Core Wrapper ────────────────────────────────────────────────
// Adds idempotency enforcement and command deduplication on top of any EventStore
// implementation. The rest of the system calls this wrapper, never storage directly.

const crypto = require('crypto')

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
  async processCommand(cmd, { eventType }) {
    const { command_id } = cmd

    // Un comando ya en vuelo con el MISMO command_id es un duplicado, aunque todavía
    // no esté marcado en disco. Sin esto hay una carrera: entre el chequeo de
    // hasProcessedCommand y el saveProcessedCommand hay dos `await`, y todo reintento
    // que caiga en esa ventana pasa el chequeo y escribe su propio evento.
    //
    // No es teórico: es justo el escenario T-14 (el POS reenvía porque no le llegó el
    // ACK). Si el ACK viene lento en vez de perderse, el reenvío se traslapa con el
    // original. Reproducido con 5 reintentos concurrentes: 5 eventos en vez de 1.
    // En ORDER_CLOSED eso es un cobro duplicado.
    //
    // Se espera al que ya va en camino y se responde duplicate, que es exactamente lo
    // que habría contestado si hubiera llegado un instante después.
    const enVuelo = this._enVuelo.get(command_id)
    if (enVuelo) {
      await enVuelo.catch(() => {})
      return { duplicate: true, event: null }
    }

    const promesa = this._procesarComando(cmd, { eventType })
    this._enVuelo.set(command_id, promesa)
    try {
      return await promesa
    } finally {
      this._enVuelo.delete(command_id)
    }
  }

  /** @private Camino real de processCommand, serializado por command_id. */
  async _procesarComando(cmd, { eventType }) {
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
