'use strict'
// ─── In-Memory State Machine ──────────────────────────────────────────────────
// Maintains the operational state of the restaurant by projecting the event log.
// Rebuilt from the full log on startup. In Phase 2 will also support snapshots.
//
// Phase 1: state is also updated by Supabase polls (STATE_SYNC events).
//          The local server observes Supabase and re-broadcasts changes over WS.
// Phase 2: state is authoritative — writes go to local server first.

const { EVENT } = require('../protocol')

class RestaurantState {
  constructor() {
    this._mesas  = new Map()  // mesa → { status, order_id, locked_by, locked_at }
    this._orders = new Map()  // order_id → order object
    this._kds    = []         // [{order_id, mesa, items_sent, sent_at, station}]
    this._locks  = new Map()  // mesa → { client_id, expires_ms }
    this._turno  = null       // { id, opened_by, opened_at } | null
    this._lastSupabaseSync = null
  }

  // ─── Projection ─────────────────────────────────────────────────────────

  /** Apply one event to the state. Returns the fields that changed. */
  apply(event) {
    const { type, payload } = event

    switch (type) {
      case EVENT.ORDER_UPSERTED:
        return this._applyOrderUpserted(payload)

      case EVENT.ORDER_SENT:
        return this._applyOrderSent(payload)

      case EVENT.ORDER_CLOSED:
        return this._applyOrderClosed(payload)

      case EVENT.ORDER_CANCELLED:
        return this._applyOrderCancelled(payload)

      case EVENT.KDS_ITEM_STATUS:
        return this._applyKdsItemStatus(payload)

      case EVENT.MESA_LOCK:
        return this._applyMesaLock(payload)

      case EVENT.MESA_UNLOCK:
        return this._applyMesaUnlock(payload)

      case EVENT.TURNO_OPENED:
        this._turno = { id: payload.turno_id, opened_by: payload.opened_by, opened_at: payload.ts }
        return { changed: ['turno'] }

      case EVENT.TURNO_CLOSED:
        this._turno = null
        return { changed: ['turno'] }

      case EVENT.STATE_SYNC:
        return this._applyStateSync(payload)

      default:
        return { changed: [] }
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  _applyOrderUpserted({ order_id, mesa, items }) {
    this._orders.set(order_id, { order_id, mesa, items, status: 'abierta' })
    this._mesas.set(String(mesa), { status: 'ocupada', order_id, locked_by: null })
    return { changed: ['mesas', 'orders'] }
  }

  _applyOrderSent({ order_id, mesa, items_sent, station }) {
    const existing = this._kds.find(k => k.order_id === order_id)
    if (existing) {
      existing.items_sent = [...(existing.items_sent || []), ...(items_sent || [])]
    } else {
      this._kds.push({ order_id, mesa, items_sent: items_sent || [], sent_at: Date.now(), station })
    }
    return { changed: ['kds'] }
  }

  _applyOrderClosed({ order_id, mesa }) {
    this._orders.delete(order_id)
    this._kds = this._kds.filter(k => k.order_id !== order_id)
    this._mesas.set(String(mesa), { status: 'libre', order_id: null, locked_by: null })
    this._locks.delete(String(mesa))
    return { changed: ['mesas', 'orders', 'kds'] }
  }

  _applyOrderCancelled({ order_id, mesa }) {
    this._orders.delete(order_id)
    this._kds = this._kds.filter(k => k.order_id !== order_id)
    if (mesa) this._mesas.set(String(mesa), { status: 'libre', order_id: null, locked_by: null })
    return { changed: ['mesas', 'orders', 'kds'] }
  }

  _applyKdsItemStatus({ order_id, item_id, status }) {
    const entry = this._kds.find(k => k.order_id === order_id)
    if (entry && status === 'entregada') {
      entry.items_sent = (entry.items_sent || []).filter(i => i.id !== item_id)
      if (entry.items_sent.length === 0) {
        this._kds = this._kds.filter(k => k.order_id !== order_id)
      }
    }
    return { changed: ['kds'] }
  }

  _applyMesaLock({ mesa, client_id, expires_ms }) {
    this._locks.set(String(mesa), { client_id, expires_ms: expires_ms || Date.now() + 30_000 })
    const m = this._mesas.get(String(mesa)) || { status: 'libre', order_id: null }
    this._mesas.set(String(mesa), { ...m, locked_by: client_id })
    return { changed: ['mesas', 'locks'] }
  }

  _applyMesaUnlock({ mesa, client_id }) {
    const lock = this._locks.get(String(mesa))
    if (lock && lock.client_id === client_id) {
      this._locks.delete(String(mesa))
      const m = this._mesas.get(String(mesa))
      if (m) this._mesas.set(String(mesa), { ...m, locked_by: null })
    }
    return { changed: ['mesas', 'locks'] }
  }

  // Phase 1: bulk sync from Supabase poll replaces the state entirely for mesas/kds/turno
  _applyStateSync({ mesas, kds_queue, turno, synced_at }) {
    if (mesas) {
      this._mesas.clear()
      for (const m of mesas) {
        this._mesas.set(String(m.mesa), {
          status:    m.status || (m.order_id ? 'ocupada' : 'libre'),
          order_id:  m.order_id || null,
          locked_by: null,
        })
      }
    }
    if (kds_queue) {
      this._kds = kds_queue
    }
    if (turno !== undefined) {
      this._turno = turno
    }
    if (synced_at) {
      this._lastSupabaseSync = synced_at
    }
    return { changed: ['mesas', 'kds', 'turno'] }
  }

  // ─── Garbage collect expired locks (call periodically) ────────────────────

  gcLocks() {
    const now = Date.now()
    for (const [mesa, lock] of this._locks) {
      if (lock.expires_ms < now) {
        this._locks.delete(mesa)
        const m = this._mesas.get(mesa)
        if (m) this._mesas.set(mesa, { ...m, locked_by: null })
      }
    }
  }

  // ─── Snapshot ────────────────────────────────────────────────────────────

  toSnapshot() {
    return {
      mesas:              Object.fromEntries(this._mesas),
      kds_queue:          [...this._kds],
      turno:              this._turno,
      locks:              Object.fromEntries(this._locks),
      last_supabase_sync: this._lastSupabaseSync,
    }
  }

  getMesa(mesa)    { return this._mesas.get(String(mesa)) || { status: 'libre', order_id: null } }
  getKdsQueue()    { return [...this._kds] }
  getTurno()       { return this._turno }
  getLock(mesa)    { return this._locks.get(String(mesa)) || null }
  hasActiveTurno() { return this._turno !== null }
}

module.exports = { RestaurantState }
