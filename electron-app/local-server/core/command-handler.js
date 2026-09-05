'use strict'
// ─── Command Handler ──────────────────────────────────────────────────────────
// Validates incoming WS commands and routes them to the event store.
// Phase 1: only MESA_LOCK, MESA_UNLOCK, KDS_ITEM_STATUS are fully handled here.
// Other events (ORDER_SENT, ORDER_CLOSED) arrive as observations from the POS,
// not as authoritative commands — Supabase is still the write authority in Phase 1.

const { EVENT } = require('../protocol')

// Map from command_type (from client) → eventType (stored in log)
const COMMAND_TO_EVENT = {
  ORDER_UPSERTED:  EVENT.ORDER_UPSERTED,
  ORDER_SENT:      EVENT.ORDER_SENT,
  ORDER_CLOSED:    EVENT.ORDER_CLOSED,
  ORDER_CANCELLED: EVENT.ORDER_CANCELLED,
  KDS_ITEM_STATUS: EVENT.KDS_ITEM_STATUS,
  MESA_LOCK:       EVENT.MESA_LOCK,
  MESA_UNLOCK:     EVENT.MESA_UNLOCK,
  TURNO_OPENED:    EVENT.TURNO_OPENED,
  TURNO_CLOSED:    EVENT.TURNO_CLOSED,
  PRINT_COMMAND:   EVENT.PRINT_COMMAND,
}

class CommandHandler {
  /**
   * @param {{ eventStore: import('./event-store').CoreEventStore, state: import('./state').RestaurantState, wsHub: import('./ws-hub').WsHub, printer: import('../adapters/printer'), restaurantId: string }} opts
   */
  constructor({ eventStore, state, wsHub, printer, restaurantId }) {
    this._store         = eventStore
    this._state         = state
    this._hub           = wsHub
    this._printer       = printer
    this._restaurantId  = restaurantId
  }

  /**
   * Process a command received from a WS client.
   * @param {object} msg   - parsed client WS message
   * @param {string} fromClientId
   * @returns {Promise<{ event?: object, duplicate?: boolean, error?: string }>}
   */
  async handle(msg, fromClientId) {
    const cmdPayload = msg.payload || {}
    const commandType = cmdPayload.command_type

    if (!commandType || !COMMAND_TO_EVENT[commandType]) {
      return { error: `Unknown command_type: ${commandType}` }
    }

    const commandId = cmdPayload.command_id
    if (!commandId) return { error: 'Missing command_id' }

    // Validate restaurant_id
    if (msg.restaurant_id && msg.restaurant_id !== this._restaurantId) {
      return { error: 'restaurant_id mismatch' }
    }

    // MESA_LOCK: check for conflicting lock from a different terminal
    if (commandType === 'MESA_LOCK') {
      const { mesa } = cmdPayload
      const existingLock = this._state.getLock(mesa)
      if (existingLock && existingLock.client_id !== fromClientId && existingLock.expires_ms > Date.now()) {
        return { error: `Mesa ${mesa} locked by another terminal` }
      }
    }

    if (commandType === 'PRINT_COMMAND' && (!cmdPayload.station || !cmdPayload.data_b64)) {
      return { error: 'PRINT_COMMAND requires station and data_b64' }
    }

    const { duplicate, event } = await this._store.processCommand(
      { command_id: commandId, type: commandType, client_id: fromClientId, restaurant_id: this._restaurantId, payload: cmdPayload },
      {
        eventType: COMMAND_TO_EVENT[commandType],
        buildEffects: commandType === 'PRINT_COMMAND' ? () => {
          if (!this._printer?.prepareJobs) throw new Error('Durable printer adapter unavailable')
          return { print_jobs: this._printer.prepareJobs(
            cmdPayload.station, Buffer.from(cmdPayload.data_b64, 'base64'), cmdPayload.document_type,
            { commandId, reprint: cmdPayload.reprint === true }
          ) }
        } : undefined,
      }
    )

    // Idempotent materialization runs on retries too: a crash may have committed
    // the event but not yet populated the printer queue. The original routing and
    // bytes, held in event.effects, must survive config changes and restart.
    await this._recoverEffect(event)
    if (duplicate) return { duplicate: true, receipt: { event_id: event.id, sequence: event.sequence } }
    this._state.apply(event)

    // Broadcast the new event to all connected clients
    await this._hub.broadcast(event)

    return { event }
  }
  async _recoverEffect(event) {
    if (!event?.effects?.print_jobs) return
    if (!this._printer?.enqueuePreparedJobs) throw new Error('Durable printer adapter unavailable')
    await this._printer.enqueuePreparedJobs(event.effects.print_jobs)
  }

  // Call at startup after event-store replay, before accepting new commands.
  // Legacy PRINT_COMMAND events without intents are not replayed: they may already
  // have printed and cannot be deduplicated safely.
  async recoverPendingEffects() {
    let recovered = 0
    for (const event of await this._store.readAfter(0)) {
      if (!event.effects?.print_jobs) continue
      await this._recoverEffect(event)
      recovered++
    }
    return { recovered }
  }

}

module.exports = { CommandHandler }
