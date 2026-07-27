'use strict'
// ─── Fullsite Local Server — Wire Protocol ────────────────────────────────────
// All messages on the wire follow the envelopes defined here.
// Increment PROTOCOL_VERSION minor when adding fields, major on breaking changes.

const PROTOCOL_VERSION = '1.0'

// Server → Client
const S2C = {
  SNAPSHOT:         'SNAPSHOT',         // full state on subscribe
  DELTA:            'DELTA',            // one event broadcast
  ACK:              'ACK',              // command accepted
  REJECT:           'REJECT',           // command rejected (reason + details)
  PONG:             'PONG',             // response to client PING
  UPDATE_AVAILABLE: 'UPDATE_AVAILABLE', // staged update ready
}

// Client → Server
const C2S = {
  SUBSCRIBE: 'SUBSCRIBE', // register terminal identity
  COMMAND:   'COMMAND',   // submit an operational command
  PING:      'PING',      // keepalive
}

// Operational event types (Phase 1 — observe only; Phase 2 — authoritative)
const EVENT = {
  ORDER_UPSERTED:  'ORDER_UPSERTED',
  ORDER_SENT:      'ORDER_SENT',
  ORDER_CLOSED:    'ORDER_CLOSED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  KDS_ITEM_STATUS: 'KDS_ITEM_STATUS',
  MESA_LOCK:       'MESA_LOCK',
  MESA_UNLOCK:     'MESA_UNLOCK',
  TURNO_OPENED:    'TURNO_OPENED',
  TURNO_CLOSED:    'TURNO_CLOSED',
  PRINT_COMMAND:   'PRINT_COMMAND',
  STATE_SYNC:      'STATE_SYNC',  // bulk sync from Supabase poll
}

// Update release channels
const CHANNEL = {
  DEVELOPMENT: 'development',
  PILOT:       'pilot',
  STABLE:      'stable',
}

// Client types
const CLIENT_TYPE = {
  POS:   'pos',
  KDS:   'kds',
  BARRA: 'barra',
  ADMIN: 'admin',
}

// ─── Envelope builders ────────────────────────────────────────────────────────

function serverEnvelope(type, payload, { serverId, restaurantId, sequence }) {
  return JSON.stringify({
    protocol_version: PROTOCOL_VERSION,
    server_id: serverId,
    restaurant_id: restaurantId,
    sequence,
    ts: Date.now(),
    type,
    payload: payload || {},
  })
}

function parseClientMessage(raw) {
  try {
    const msg = JSON.parse(raw)
    if (!msg.type || !C2S[msg.type]) return null
    if (!msg.protocol_version) return null
    return msg
  } catch {
    return null
  }
}

module.exports = {
  PROTOCOL_VERSION,
  S2C,
  C2S,
  EVENT,
  CHANNEL,
  CLIENT_TYPE,
  serverEnvelope,
  parseClientMessage,
}
