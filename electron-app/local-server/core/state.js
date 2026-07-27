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

  _applyOrderUpserted({ order_id, mesa, items, status }) {
    const existing = this._orders.get(order_id)
    if (existing) {
      // Status update from KDS (preparando / lista / entregada) or POS merge
      this._orders.set(order_id, {
        ...existing,
        status:      status      || existing.status,
        items:       items != null ? (typeof items === 'string' ? items : JSON.stringify(items)) : existing.items,
        updated_at:  new Date().toISOString(),
      })
    } else {
      this._orders.set(order_id, {
        id: order_id, order_id, mesa, status: status || 'abierta',
        items: typeof items === 'string' ? items : JSON.stringify(items || []),
        mesero: '', notas: null, kds_item_status: null, comanda_batches: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
    }
    if (mesa != null) this._mesas.set(String(mesa), { status: 'ocupada', order_id, locked_by: null })
    return { changed: ['mesas', 'orders'] }
  }

  // ORDER_SENT: first round OR additional round from same order.
  // POS always sends the FULL updated items list on each round.
  // On first send: store complete order object so KDS can display without Supabase.
  // On subsequent sends: replace items (preserving kds_item_status — new indices
  //   are absent from the map which the KDS treats as not-done).
  _applyOrderSent(payload) {
    const { order_id, mesa, mesero, status, notas, comanda_batches, personas, total } = payload
    // Accept both 'items' (POS broadcast) and 'items_sent' (legacy test fixture / old protocol)
    const items = payload.items ?? payload.items_sent ?? []
    const itemsStr = typeof items === 'string' ? items : JSON.stringify(items)
    const combatStr = comanda_batches != null
      ? (typeof comanda_batches === 'string' ? comanda_batches : JSON.stringify(comanda_batches))
      : null
    const existing = this._orders.get(order_id)

    if (existing && existing._kds_sent) {
      // Additional round — replace items, preserve kds_item_status and immutable fields
      this._orders.set(order_id, {
        ...existing,
        items:            itemsStr,
        comanda_batches:  combatStr ?? existing.comanda_batches,
        status:           'enviada',   // new round resets to enviada
        updated_at:       new Date().toISOString(),
        // kds_item_status NOT touched — new item indices are simply absent (→ not-done)
      })
    } else {
      const now = new Date().toISOString()
      this._orders.set(order_id, {
        id:               order_id,
        order_id,
        mesa:             mesa   ?? null,
        mesero:           mesero ?? '',
        status:           status ?? 'enviada',
        items:            itemsStr,
        notas:            notas  ?? null,
        comanda_batches:  combatStr,
        personas:         personas ?? 1,
        total:            total    ?? 0,
        kds_item_status:  null,
        created_at:       now,
        updated_at:       now,
        _kds_sent:        true,   // internal flag: this order has reached kitchen
      })
    }

    // kds_queue: minimal entry for Supabase-poll STATE_SYNC compatibility
    const inKds = this._kds.find(k => k.order_id === order_id)
    if (!inKds) {
      this._kds.push({ order_id, mesa, items_sent: items || [], sent_at: Date.now() })
    } else {
      inKds.items_sent = items || []
    }

    return { changed: ['orders', 'kds'] }
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

  // KDS_ITEM_STATUS: two protocols supported.
  // New: kds_item_status = JSON string of the full {idx: bool} map (sent by toggleItemDone).
  // Legacy: item_id + status='entregada' removes a single item from kds_queue.
  _applyKdsItemStatus({ order_id, item_id, status, kds_item_status }) {
    // Update full order object if present
    const order = this._orders.get(order_id)
    if (order) {
      if (kds_item_status !== undefined) {
        this._orders.set(order_id, {
          ...order,
          kds_item_status: typeof kds_item_status === 'string' ? kds_item_status : JSON.stringify(kds_item_status),
          updated_at: new Date().toISOString(),
        })
      }
    }

    // Legacy kds_queue cleanup
    if (status === 'entregada') {
      const entry = this._kds.find(k => k.order_id === order_id)
      if (entry) {
        entry.items_sent = (entry.items_sent || []).filter(i => i.id !== item_id)
        if (entry.items_sent.length === 0) this._kds = this._kds.filter(k => k.order_id !== order_id)
      }
    }
    return { changed: ['orders', 'kds'] }
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
    // kds_orders: full order objects for every order that has been sent to kitchen
    // and is not yet closed/cancelled. KDS uses this to render without Supabase.
    const kds_orders = [...this._orders.values()]
      .filter(o => o._kds_sent && o.status !== 'entregada' && o.status !== 'cerrada')
      .map(({ _kds_sent, ...rest }) => rest)  // strip internal flag before sending

    return {
      mesas:              Object.fromEntries(this._mesas),
      kds_queue:          [...this._kds],
      kds_orders,
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
