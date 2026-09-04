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

/**
 * Motivos de rechazo. Existen para que el hub pueda DECIRLE al cliente por que
 * lo rechazo, en vez de ignorarlo.
 *
 * POR QUE: antes esta funcion devolvia `null` para los tres casos. El hub hacia
 * `if (!msg) return` — sin error, sin cerrar el socket, sin log. Un cliente que
 * olvidara `protocol_version` quedaba CONECTADO Y MUDO para siempre: el socket
 * abierto, `clientCount()` en 0, y ninguna pista de por que. Costo dos corridas
 * completas de la E2E del enlace ascendente el 2026-09-03.
 *
 * Es la misma familia que costo la semana: un fallo indistinguible de que no
 * pase nada.
 */
const RECHAZO = {
  ILEGIBLE:        'mensaje ilegible (JSON invalido)',
  TIPO_DESCONOCIDO:'tipo de mensaje desconocido',
  SIN_VERSION:     'falta protocol_version',
}

/**
 * Igual que `parseClientMessage` pero DICE por que rechazo.
 * Devuelve { msg } si es valido, o { rechazo } con el motivo.
 */
function revisarMensajeDeCliente(raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { return { rechazo: RECHAZO.ILEGIBLE } }
  if (!msg || !msg.type || !C2S[msg.type]) return { rechazo: RECHAZO.TIPO_DESCONOCIDO }
  if (!msg.protocol_version) return { rechazo: RECHAZO.SIN_VERSION }
  return { msg }
}

/**
 * Se conserva con la MISMA firma y el mismo comportamiento (null al rechazar)
 * para no romper a quien ya la usa. Delega en la de arriba: una sola definicion
 * de que es valido.
 */
function parseClientMessage(raw) {
  return revisarMensajeDeCliente(raw).msg || null
}

module.exports = {
  PROTOCOL_VERSION,
  RECHAZO,
  revisarMensajeDeCliente,
  S2C,
  C2S,
  EVENT,
  CHANNEL,
  CLIENT_TYPE,
  serverEnvelope,
  parseClientMessage,
}
