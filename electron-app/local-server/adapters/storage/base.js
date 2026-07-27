'use strict'
// ─── EventStore — Abstract Interface ─────────────────────────────────────────
// All storage implementations must extend this class.
// The rest of the system depends ONLY on this interface — never on NDJSON or SQLite directly.
//
// Durability guarantees required before this store can become authoritative for payments/turnos:
//  • Durable write (survives power cut)
//  • Recovery after corruption (detect + refuse corrupt data)
//  • Monotonic sequence (no gaps, no reuse)
//  • Idempotency store (hasProcessedCommand / saveProcessedCommand)
//  • Outbox transactional (append event + mark command processed atomically, or both fail)
//  • Snapshot support (rebuild state from checkpoint instead of full replay)
//
// Phase 1 (NdjsonEventStore) satisfies: monotonic sequence, idempotency, basic durability.
// Phase 2 (SqliteEventStore) must satisfy all guarantees above before payments migrate here.

/**
 * @typedef {Object} LocalEvent
 * @property {string}  id            - UUID (client-generated idempotency key)
 * @property {number}  sequence      - monotonic integer assigned by the store
 * @property {string}  type          - EVENT.* constant
 * @property {number}  ts            - unix milliseconds
 * @property {string}  client_id     - originating terminal UUID
 * @property {string}  restaurant_id
 * @property {Object}  payload
 * @property {boolean} synced        - true once delivered to Supabase
 */

/**
 * @typedef {Object} AppendResult
 * @property {number[]} sequences - sequence numbers assigned to each appended event
 */

class EventStore {
  /**
   * Append one or more events atomically.
   * Assigns monotonic sequence numbers starting from getLastSequence() + 1.
   * @param {Omit<LocalEvent, 'sequence'>[]} events
   * @returns {Promise<AppendResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async append(events) { throw new Error('EventStore.append not implemented') }

  /**
   * Return all events with sequence > sequence, in order.
   * @param {number} sequence
   * @returns {Promise<LocalEvent[]>}
   */
  // eslint-disable-next-line no-unused-vars
  async readAfter(sequence) { throw new Error('EventStore.readAfter not implemented') }

  /**
   * Return the highest sequence number currently stored, or 0 if empty.
   * @returns {Promise<number>}
   */
  async getLastSequence() { throw new Error('EventStore.getLastSequence not implemented') }

  /**
   * Return true if a command with this idempotency key has already been processed.
   * Used to safely retry commands without duplicating effects.
   * @param {string} idempotencyKey
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line no-unused-vars
  async hasProcessedCommand(idempotencyKey) { throw new Error('EventStore.hasProcessedCommand not implemented') }

  /**
   * Record that a command has been processed, linking it to the resulting event.
   * Must be called after append() succeeds for the same command.
   * @param {string} idempotencyKey
   * @param {string} eventId
   * @param {number} sequence
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async saveProcessedCommand(idempotencyKey, eventId, sequence) { throw new Error('EventStore.saveProcessedCommand not implemented') }

  /**
   * Return count of events where synced = false.
   * Used for heartbeat telemetry.
   * @returns {Promise<number>}
   */
  async unsyncedCount() { throw new Error('EventStore.unsyncedCount not implemented') }

  /**
   * Mark a batch of events as synced to Supabase.
   * @param {number[]} sequences
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async markSynced(sequences) { throw new Error('EventStore.markSynced not implemented') }
}

module.exports = { EventStore }
