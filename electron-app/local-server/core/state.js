'use strict'
// ─── In-Memory State Machine ──────────────────────────────────────────────────
// Maintains the operational state of the restaurant by projecting the event log.
// Rebuilt from the full log on startup. In Phase 2 will also support snapshots.
//
// Phase 1: state is also updated by Supabase polls (STATE_SYNC events).
//          The local server observes Supabase and re-broadcasts changes over WS.
// Phase 2: state is authoritative — writes go to local server first.

const { EVENT } = require('../protocol')

const PREPARATION_STATUS = new Set(['enviada', 'preparando', 'lista', 'entregada'])
const FINANCIAL_CLOSED = new Set(['cerrada', 'pagada', 'closed', 'paid'])
const cancelled = o => o.status === 'cancelada' || o.status === 'void'
const settled = o => o.payment_status === 'pagada' || FINANCIAL_CLOSED.has(o.status)
// Cloud account revisions order full snapshots, not independent kitchen status
// events. Zero/absent revisions are legacy offline writes, not cloud versions.
function staleAccountSnapshot(existing, payload) {
  return existing && (payload.items != null || payload.items_sent != null) &&
    Number.isSafeInteger(payload.order_revision) && payload.order_revision > 0 &&
    Number.isSafeInteger(existing.order_revision) && payload.order_revision < existing.order_revision
}
// Preserve only business fields. Command credentials/transport metadata must never
// enter a snapshot sent to another terminal.
function orderFields(payload) {
  const fields = ['mesa', 'customer_name', 'mesero', 'personas', 'subtotal', 'iva',
    'total', 'descuento', 'propina', 'pagos', 'saldo', 'order_revision', 'turno_id',
    'notas', 'created_at', 'updated_at', 'closed_at', 'payment_status', 'preparation_status',
    'order_number', 'cuentas', 'accounts']
  return Object.fromEntries(fields.filter(k => payload[k] !== undefined).map(k => [k, payload[k]]))
}

function balanceOf(order) {
  if (settled(order)) return 0
  if (order.saldo != null && Number.isFinite(Number(order.saldo))) return Number(order.saldo)
  if (order.total == null || !Number.isFinite(Number(order.total))) return null
  // A legacy order with no payment records is unpaid. Never fabricate a payment.
  let pagos = order.pagos
  if (typeof pagos === 'string') { try { pagos = JSON.parse(pagos) } catch { return null } }
  const paid = Array.isArray(pagos) ? pagos.reduce((sum, p) =>
    sum + ((!p.estado || p.estado === 'aceptado') ? Math.round(Number(p.monto || 0) * 100) : 0), 0) : 0
  return Math.max(0, (Math.round(Number(order.total) * 100) - paid) / 100)
}

class RestaurantState {
  constructor({ localAuthorityEnabled = false } = {}) {
    this._writeAuthority = localAuthorityEnabled === true ? 'caja' : 'legacy'
    this._mesas  = new Map()  // mesa → { status, order_id, locked_by, locked_at }
    this._orders = new Map()  // order_id → order object
    this._kds    = []         // [{order_id, mesa, items_sent, sent_at, station}]
    this._locks  = new Map()  // mesa → { client_id, expires_ms }
    this._turno  = null       // { id, opened_by, opened_at } | null
    this._turnIdentities = new Set()
    this._orderNumbers = new Map() // turno_id → last committed ordinal (including settled/void orders)
    this._turnSummaries = new Map()
    this._cashMovements = new Map()
    this._itemTransfers = new Set()
    this._lastSupabaseSync = null
    this._orderSnapshotComplete = false
    this._financialOrders = new Map()
    this._printDocuments = new Map()
    this._printResolutions = new Map()
    this._canonicalPrintJobs = new Map()
    this._drawerOperations = new Map()
    this._drawerResolutions = new Map()
  }

  // ─── Projection ─────────────────────────────────────────────────────────

  /** Apply one event to the state. Returns the fields that changed. */
  apply(event) {
    const { type, payload } = event
    if (['PAYMENT_DRAWER_OPEN', 'DRAWER_OPEN'].includes(type) && event.result?.drawer_operation) {
      const operation = JSON.parse(JSON.stringify(event.result.drawer_operation))
      this._drawerOperations.set(operation.operation_id, operation)
      return { changed: ['drawer_operations'] }
    }
    if (type === 'DRAWER_UNCERTAIN_RESOLVE' && event.result?.drawer_resolution) {
      const resolution = JSON.parse(JSON.stringify(event.result.drawer_resolution))
      this._drawerResolutions.set(JSON.stringify([resolution.job_id, resolution.uncertain_episode_id]), { ...resolution, command_id: payload.command_id })
      return { changed: ['drawer_resolutions'] }
    }
    if (['ORDER_SEND', 'ORDER_PRECHECK_PRINT', 'PAYMENT_RECEIPT_PRINT'].includes(type)) {
      for (const job of event.effects?.print_jobs || []) this._canonicalPrintJobs.set(job.job_id, {
        job_id: job.job_id, command_id: payload.command_id, document_type: job.document_type,
      })
    }
    if (type === 'PRINT_UNCERTAIN_RESOLVE' && event.result?.print_resolution) {
      const resolution = JSON.parse(JSON.stringify(event.result.print_resolution))
      this._printResolutions.set(JSON.stringify([resolution.job_id, resolution.uncertain_episode_id]), { ...resolution, command_id: payload.command_id })
      return { changed: ['print_resolutions'] }
    }
    if (['ORDER_PRECHECK_PRINT', 'PAYMENT_RECEIPT_PRINT'].includes(type) && event.result?.print_document) {
      const document = JSON.parse(JSON.stringify(event.result.print_document))
      this._printDocuments.set(document.document_id, document)
      return { changed: ['print_documents'] }
    }
    if (['ORDER_SAVE', 'ORDER_SEND', 'ORDER_MOVE', 'ORDER_VOID', 'KITCHEN_SET'].includes(type) && event.result?.operational_order) {
      const order = JSON.parse(JSON.stringify(event.result.operational_order))
      const financial = event.result.financial_order
      if (financial) {
        this._financialOrders.set(financial.order_id, JSON.parse(JSON.stringify(financial)))
        order.saldo = financial.balance_cents / 100
        order.payment_status = financial.status === 'settled' ? 'pagada' : 'pendiente'
      }
      const previous = this._orders.get(order.order_id)
      if (previous?.mesa != null && this._mesas.get(String(previous.mesa))?.order_id === order.order_id) {
        this._mesas.set(String(previous.mesa), { status: 'libre', order_id: null, locked_by: null })
      }
      order._from_cloud = false
      this._orders.set(order.order_id, order)
      this._rememberOrderNumber(order)
      if (order.mesa != null && !cancelled(order) && !settled(order)) this._mesas.set(String(order.mesa), { status: 'ocupada', order_id: order.order_id, locked_by: null })
      this._kds = this._kds.filter(k => k.order_id !== order.order_id)
      if (order._kds_sent && !cancelled(order) && order.preparation_status !== 'entregada') {
        this._kds.push({ order_id: order.order_id, mesa: order.mesa, items_sent: order.kitchen_items, sent_at: Date.parse(order.updated_at) })
      }
      this._orderSnapshotComplete = true
      return { changed: ['orders', 'mesas', 'kds', ...(financial ? ['financial_orders'] : [])] }
    }
    if (type === 'CASH_MOVEMENT' && event.result?.cash_movement) {
      const movement = JSON.parse(JSON.stringify(event.result.cash_movement))
      this._cashMovements.set(movement.id, movement)
      return { changed: ['cash_movements'] }
    }
    if (['TURN_OPEN', 'TURN_CLOSE'].includes(type) && event.result && 'turno' in event.result) {
      this._turno = event.result.turno ? JSON.parse(JSON.stringify(event.result.turno)) : null
      if (this._turno?.id) this._turnIdentities.add(this._turno.id)
      if (event.result.closed_turno?.id) this._turnSummaries.set(event.result.closed_turno.id, JSON.parse(JSON.stringify(event.result.closed_turno)))
      this._orderSnapshotComplete = true
      return { changed: ['turno'] }
    }
    // FinancialDomain validates commands before durable commit. The projector
    // only consumes that persisted result; it never infers acceptance from UI
    // counters or fabricates payments. Financial revision is independent of OCC.
    if (type?.startsWith('FINANCIAL_') && event.result?.financial_order) {
      const financial = event.result.financial_order
      this._financialOrders.set(financial.order_id, JSON.parse(JSON.stringify(financial)))
      const order = this._orders.get(financial.order_id)
      if (order) {
        order._from_cloud = false
        order.saldo = financial.balance_cents / 100
        order.payment_status = financial.status === 'settled' ? 'pagada' : 'pendiente'
        if (financial.status === 'settled' && this._mesas.get(String(order.mesa))?.order_id === financial.order_id) {
          this._mesas.set(String(order.mesa), { status: 'libre', order_id: null, locked_by: null })
        }
      }
      return { changed: ['financial_orders', 'orders', 'mesas'] }
    }

    switch (type) {
      case EVENT.ORDER_ITEMS_TRANSFERRED:
        return this._applyItemsTransferred(payload)
      case EVENT.ORDER_UPSERTED:
        return this._applyOrderUpserted(payload)

      case EVENT.ORDER_SENT:
        // El ts del evento, no el reloj del replay: tras reiniciar Pedro las
        // comandas conservan su antiguedad en cocina (barrido 2026-09-10, LENTE-5).
        return this._applyOrderSent(payload, event.ts)

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
        this._turnIdentities.add(payload.turno_id)
        this._orderSnapshotComplete = true
        return { changed: ['turno'] }

      case EVENT.TURNO_CLOSED:
        // El cierre del dia LIMPIA el piso. Antes solo se soltaba el turno y
        // _orders/_kds/_mesas sobrevivian (incluso a reinicios, via event store):
        // el KDS en modo LAN amanecia con las comandas de ayer — el "empalme"
        // reportado en campo. Con _turno=null ademas _applyStateSync no filtraba
        // nada (belongsToAnotherTurno siempre false), asi que nada lo corregia.
        //
        // El aviso ahora es DURABLE (lib/aviso-lan.ts reintenta): un TURNO_CLOSED
        // que llega horas tarde, ya con OTRO turno abierto, no puede barrer el piso
        // del turno nuevo. Solo limpia si es el turno vigente (o no hay ninguno).
        if (payload?.turno_id && this._turno?.id && payload.turno_id !== this._turno.id) return { changed: [] }
        this._turno = null
        this._orders.clear()
        this._kds = []
        this._mesas.clear()
        this._orderSnapshotComplete = true
        return { changed: ['turno', 'orders', 'kds', 'mesas'] }

      case EVENT.STATE_SYNC:
        // Una foto heredada compactada al cargar el log (adapters/storage/ndjson.js)
        // no trae salon: se salta. La siguiente foto viva la reemplaza entera.
        if (payload?.compacted === true) return { changed: [] }
        return this._applyStateSync(payload)

      default:
        return { changed: [] }
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  _applyOrderUpserted(payload) {
    const { order_id, mesa, items, status } = payload
    const existing = this._orders.get(order_id)
    // A replayed LAN update is not authorization to reopen a cancelled account.
    if (existing && cancelled(existing)) return { changed: [] }
    if (staleAccountSnapshot(existing, payload)) return { changed: [] }
    if (existing) {
      // Status update from KDS (preparando / lista / entregada) or POS merge
      this._orders.set(order_id, {
        ...existing,
        _from_cloud: false,
        ...orderFields(payload),
        status:      status      || existing.status,
        preparation_status: PREPARATION_STATUS.has(status) ? status : existing.preparation_status,
        items:       items != null ? (typeof items === 'string' ? items : JSON.stringify(items)) : existing.items,
        updated_at:  new Date().toISOString(),
      })
    } else {
      this._orders.set(order_id, {
        id: order_id, order_id, mesa, status: status || 'abierta',
        items: items == null ? null : (typeof items === 'string' ? items : JSON.stringify(items)),
        mesero: '', notas: null, kds_item_status: null, comanda_batches: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        ...orderFields(payload),
        preparation_status: PREPARATION_STATUS.has(status) ? status : null,
      })
    }
    if (existing?.mesa != null && mesa != null && existing.mesa !== mesa && this._mesas.get(String(existing.mesa))?.order_id === order_id) {
      this._mesas.set(String(existing.mesa), { status: 'libre', order_id: null, locked_by: null })
    }
    const order = this._orders.get(order_id)
    if (payload.total != null && payload.saldo == null) delete order.saldo
    if (FINANCIAL_CLOSED.has(status)) { order.payment_status = 'pagada'; order.saldo = 0 }
    if (order.mesa != null && !settled(order) && !cancelled(order)) this._mesas.set(String(order.mesa), { status: 'ocupada', order_id, locked_by: null })
    if ((settled(order) || cancelled(order)) && this._mesas.get(String(order.mesa))?.order_id === order_id) {
      this._mesas.set(String(order.mesa), { status: 'libre', order_id: null, locked_by: null })
    }
    if (order.preparation_status === 'entregada' || cancelled(order)) this._kds = this._kds.filter(k => k.order_id !== order_id)
    return { changed: ['mesas', 'orders'] }
  }

  // A transfer is one projection transaction for both identities. It relocates
  // existing preparation; unlike ORDER_SENT it never creates a print effect.
  _applyItemsTransferred(payload) {
    const { source_order: source, target_order: target, item_id, command_id } = payload
    if (!source?.id || !target?.id || !Array.isArray(source.items) || !Array.isArray(target.items) ||
      source.id === target.id || !item_id || this._itemTransfers.has(command_id)) return { changed: [] }
    const parse = (value, fallback) => {
      if (typeof value !== 'string') return value ?? fallback
      try { return JSON.parse(value) } catch { return fallback }
    }
    const previousSource = this._orders.get(source.id)
    const previousTarget = this._orders.get(target.id)
    const previousItems = parse(previousSource?.items, [])
    const movedIndex = previousItems.findIndex(i => i.id === item_id)
    const moved = previousItems[movedIndex] || target.items.find(i => i.id === item_id)
    const preparation = moved?.preparation_status || previousSource?.preparation_status || source.preparation_status || source.status
    const wasSent = !!previousSource?._kds_sent || PREPARATION_STATUS.has(preparation)
    const sourceDone = parse(previousSource?.kds_item_status, {})
    const movedDone = sourceDone[movedIndex] ?? (preparation === 'lista' || preparation === 'entregada')
    // Remap positional legacy completion flags by immutable item ID when a row
    // leaves an account. Removing index 0 must not mark the next item done.
    for (const [receipt, previous] of [[source, previousSource], [target, previousTarget]]) {
      if (previous && (cancelled(previous) || staleAccountSnapshot(previous, receipt))) continue
      this._applyOrderUpserted({ ...receipt, order_id: receipt.id })
      const current = this._orders.get(receipt.id)
      if (cancelled(current)) current._kds_sent = false
      if (previous?.preparation_status) current.preparation_status = previous.preparation_status
      const oldItems = parse(previous?.items, [])
      const done = parse(previous?.kds_item_status, {})
      const flags = {}
      receipt.items.forEach((item, index) => {
        const oldIndex = oldItems.findIndex(old => old.id === item.id)
        if (oldIndex >= 0 && done[oldIndex] !== undefined) flags[index] = done[oldIndex]
        else if (receipt.id === target.id && item.id === item_id && movedDone) flags[index] = true
      })
      current.kds_item_status = JSON.stringify(flags)
    }
    const destination = this._orders.get(target.id)
    if (destination && !cancelled(destination) && wasSent) {
      const items = parse(destination.items, [])
      const index = items.findIndex(i => i.id === item_id)
      if (index >= 0) {
        // Preserve a newer destination's item metadata. Only carry preparation
        // when this identity has not already advanced it independently.
        if (!items[index].preparation_status && PREPARATION_STATUS.has(preparation)) {
          items[index] = { ...items[index], preparation_status: movedDone && preparation !== 'entregada' ? 'lista' : preparation }
        }
        destination.items = JSON.stringify(items)
        destination._kds_sent = true
        if ((!previousTarget?._kds_sent || ['lista', 'entregada'].includes(previousTarget.preparation_status) && !movedDone) &&
          !staleAccountSnapshot(previousTarget, target) && preparation !== 'entregada') destination.preparation_status = 'enviada'
      }
    }
    // Rebuild both minimal queues from the resulting accounts, including when
    // a newer snapshot made one side of the receipt stale.
    for (const id of [source.id, target.id]) {
      this._kds = this._kds.filter(k => k.order_id !== id)
      const order = this._orders.get(id)
      const items = parse(order?.items, []).filter(i => !i.cancelled && i.preparation_status !== 'entregada')
      if (order?._kds_sent && !cancelled(order) && order.preparation_status !== 'entregada' && items.length) {
        this._kds.push({ order_id: id, mesa: order.mesa, items_sent: items, sent_at: Date.parse(order.created_at) })
      }
    }
    if (command_id) this._itemTransfers.add(command_id)
    return { changed: ['orders', 'mesas', 'kds'] }
  }

  // ORDER_SENT: first round OR additional round from same order.
  // POS always sends the FULL updated items list on each round.
  // On first send: store complete order object so KDS can display without Supabase.
  // On subsequent sends: replace items (preserving kds_item_status — new indices
  //   are absent from the map which the KDS treats as not-done).
  _applyOrderSent(payload, ts = null) {
    const { order_id, mesa, mesero, status, notas, comanda_batches, personas, total, turno_id } = payload
    const momento = Number.isFinite(ts) && ts > 0 ? ts : Date.now()
    // Accept both 'items' (POS broadcast) and 'items_sent' (legacy test fixture / old protocol)
    const items = payload.items ?? payload.items_sent ?? []
    const itemsStr = typeof items === 'string' ? items : JSON.stringify(items)
    const combatStr = comanda_batches != null
      ? (typeof comanda_batches === 'string' ? comanda_batches : JSON.stringify(comanda_batches))
      : null
    const existing = this._orders.get(order_id)
    if (existing && cancelled(existing)) return { changed: [] }
    if (staleAccountSnapshot(existing, payload)) return { changed: [] }

    if (existing && existing._kds_sent) {
      // Additional round — replace items, preserve kds_item_status and immutable fields
      this._orders.set(order_id, {
        ...existing,
        _from_cloud: false,
        ...orderFields(payload),
        items:            itemsStr,
        comanda_batches:  combatStr ?? existing.comanda_batches,
        status:           'enviada',   // new round resets to enviada
        preparation_status: 'enviada',
        updated_at:       new Date(momento).toISOString(),
        // kds_item_status NOT touched — new item indices are simply absent (→ not-done)
      })
    } else {
      const now = new Date(momento).toISOString()
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
        turno_id:         turno_id ?? null,
        kds_item_status:  null,
        created_at:       now,
        updated_at:       now,
        _kds_sent:        true,   // internal flag: this order has reached kitchen
        ...orderFields(payload),
        preparation_status: PREPARATION_STATUS.has(status) ? status : 'enviada',
      })
    }
    const current = this._orders.get(order_id)
    if (payload.total != null && payload.saldo == null) delete current.saldo
    if (current.mesa != null && !settled(current)) this._mesas.set(String(current.mesa), { status: 'ocupada', order_id, locked_by: null })

    // kds_queue: minimal entry for Supabase-poll STATE_SYNC compatibility
    const inKds = this._kds.find(k => k.order_id === order_id)
    if (!inKds) {
      this._kds.push({ order_id, mesa, items_sent: items || [], sent_at: momento })
    } else {
      inKds.items_sent = items || []
    }

    return { changed: ['orders', 'kds'] }
  }

  _applyOrderClosed(payload) {
    const { order_id } = payload
    const order = this._orders.get(order_id)
    const mesa = payload.mesa ?? order?.mesa
    // D2: settlement changes debt, not preparation. Keep the full order so a
    // paid-before-cooking comanda survives snapshots, reconnects and replay.
    if (order) this._orders.set(order_id, { ...order, _from_cloud: false, ...orderFields(payload),
      payment_status: 'pagada', saldo: 0, closed_at: payload.closed_at || new Date().toISOString() })
    if (this._mesas.get(String(mesa))?.order_id === order_id) {
      this._mesas.set(String(mesa), { status: 'libre', order_id: null, locked_by: null })
      this._locks.delete(String(mesa))
    }
    return { changed: ['mesas', 'orders', 'kds'] }
  }

  _applyOrderCancelled({ order_id, mesa }) {
    // Retain the cancellation through event replay so late updates cannot revive
    // this identity. The table may already belong to a newer account.
    const order = this._orders.get(order_id)
    this._orders.set(order_id, { ...order, id: order_id, order_id,
      mesa: order?.mesa ?? mesa, status: 'cancelada', _from_cloud: false, _kds_sent: false })
    this._kds = this._kds.filter(k => k.order_id !== order_id)
    for (const table of new Set([mesa, order?.mesa])) {
      if (table != null && this._mesas.get(String(table))?.order_id === order_id) {
        this._mesas.set(String(table), { status: 'libre', order_id: null, locked_by: null })
        this._locks.delete(String(table))
      }
    }
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

  // Cloud bootstrap can add records; absence is never a cancellation receipt
  // for an accepted LAN command. Only explicit complete reads establish that an
  // unknown table/name has no account.
  _applyStateSync({ mesas, kds_queue, turno, synced_at, orders, order_snapshot_complete }) {
    // With the explicit cutover active, polling is observational only. It may
    // not reopen closed shifts, resurrect voids or invent a second order writer.
    if (this._writeAuthority === 'caja') {
      if (synced_at) this._lastSupabaseSync = synced_at
      return { changed: ['last_supabase_sync'] }
    }
    const now = Date.now()
    // Polling cloud is an observation, never a receipt that closes a local
    // financial shift. Losing the current shift would strand accepted debt and
    // make every subsequent payment fail TURNO_MISMATCH after WAN recovery.
    if (turno !== undefined && this._turno && turno?.id !== this._turno.id &&
      this.getFinancialOrders().some(order => order.turno_id === this._turno.id &&
        (order.balance_cents > 0 || order.reserved_cents > 0))) {
      turno = this._turno
    }

    // order_ids que el poll ya conoce (ya están en Supabase)
    const pollOrderIds = new Set()
    if (Array.isArray(mesas))     for (const m of mesas)     if (m && m.order_id) pollOrderIds.add(m.order_id)
    if (Array.isArray(kds_queue)) for (const k of kds_queue) if (k && k.order_id) pollOrderIds.add(k.order_id)

    // Órdenes locales activas + frescas + aún no vistas por el poll → proteger del clobber
    const isActive = (o) => o && o.status !== 'cerrada' && o.status !== 'cancelada' && o.status !== 'pagada'
    const protectedOrders = [...this._orders.values()].filter((o) => {
      // An absent cloud row is not a cancellation receipt. Locally accepted
      // orders (including paid kitchen work) survive any length of WAN outage.
      if (!o._from_cloud) return !cancelled(o)
      if (!isActive(o)) return false
      if (pollOrderIds.has(o.order_id)) return false
      const ts = Date.parse(o.updated_at || o.created_at) || 0
      return (now - ts) < RestaurantState.SYNC_GRACE_MS
    })
    const protectedMesas    = new Set(protectedOrders.map((o) => (o.mesa != null ? String(o.mesa) : null)).filter(Boolean))
    const protectedOrderIds = new Set(protectedOrders.map((o) => o.order_id))

    // Reconcile the full KDS projection too. Previously STATE_SYNC replaced only
    // kds_queue, while stale full orders remained in _orders indefinitely and won
    // in kds-ui's source preference. That is how orders from a previous shift could
    // reappear even when Supabase no longer returned them.
    const activeTurnoId = turno && turno.id ? turno.id : null
    for (const [orderId, order] of this._orders) {
      if (!order._kds_sent) continue
      const belongsToAnotherTurno = activeTurnoId && order.turno_id && order.turno_id !== activeTurnoId
      // Una orden local YA COBRADA de un turno que la nube ya cerro es el empalme
      // de ayer: no debe dinero ni trabajo. Se retira aunque sea local.
      if (!order._from_cloud && belongsToAnotherTurno && settled(order)) { this._orders.delete(orderId); continue }
      const absentAndPastGrace = !pollOrderIds.has(orderId) && !protectedOrderIds.has(orderId)
      if (!protectedOrderIds.has(orderId) && (belongsToAnotherTurno || absentAndPastGrace)) this._orders.delete(orderId)
    }

    if (mesas) {
      const keep = new Map()
      for (const key of protectedMesas) { const cur = this._mesas.get(key); if (cur) keep.set(key, cur) }
      this._mesas.clear()
      for (const m of mesas) {
        const key = String(m.mesa)
        if (protectedMesas.has(key)) continue  // no pisar mesa con orden local fresca
        const locallyCancelled = m.order_id && cancelled(this._orders.get(m.order_id) || {})
        this._mesas.set(key, {
          status:    locallyCancelled ? 'libre' : m.status || (m.order_id ? 'ocupada' : 'libre'),
          order_id:  locallyCancelled ? null : m.order_id || null,
          locked_by: null,
        })
      }
      for (const [key, val] of keep) this._mesas.set(key, val)  // re-aplica las protegidas
    }
    if (kds_queue) {
      const protectedKds = this._kds.filter((k) => protectedOrderIds.has(k.order_id))
      const fromPoll     = kds_queue.filter((k) => !protectedOrderIds.has(k.order_id) && !cancelled(this._orders.get(k.order_id) || {}))
      this._kds = [...fromPoll, ...protectedKds]
    }
    if (turno !== undefined) {
      this._turno = turno
    }
    if (synced_at) {
      this._lastSupabaseSync = synced_at
    }
    // Bootstrap carries actual full records, not the kitchen-only projection.
    // A partial/old snapshot cannot prove an empty restaurant.
    if (Array.isArray(orders)) {
      for (const row of orders) {
        const id = row?.id ?? row?.order_id
        if (!id || row.items == null) continue
        const existing = this._orders.get(id)
        // Cloud bootstrap must not replace accepted local commands. Their
        // materialization is reconciled through command receipts, not polling.
        //
        // UNA FILA CERRADA EN NUBE SI ES UN RECIBO. Lo de arriba protege a las ordenes
        // locales de la AUSENCIA en nube: un poll parcial no puede cancelar nada. Esto
        // es lo contrario: la fila EXISTE y dice `cerrada`/`pagada`. En modo legacy la
        // nube es la autoridad de cobro (el POS le guarda el cobro ANTES de avisar a la
        // LAN), asi que ese estado ya materializo el dinero.
        //
        // Sin esto, si el ORDER_CLOSED de la LAN se perdia —la caja acababa de cambiar
        // de IP, el WiFi parpadeo justo al cobrar— esta orden quedaba `enviada` aqui
        // para siempre: la mesa ocupada en las tres pantallas y cobrable otra vez. Es
        // el video de Eduardo del 2026-08-24 («si vuelves a ingresar, hay un platillo,
        // y se puede volver a cobrar»), reproducido en el laboratorio el 2026-09-10.
        // El POS ya reintenta ese aviso (lib/aviso-lan.ts); esta es la segunda
        // cerradura, por si la terminal que cobro nunca vuelve a encender.
        //
        // Solo se toca el DINERO (payment_status, saldo, closed_at) y la mesa: los
        // platillos y la preparacion se conservan, igual que en _applyOrderClosed (D2).
        // Y solo se libera la mesa si sigue apuntando a ESTA orden.
        if (existing && !existing._from_cloud) {
          // UNA FILA CANCELADA EN NUBE TAMBIEN ES UN RECIBO (misma familia que el
          // cierre de abajo): el POS cancela contra la nube antes de avisar a la
          // LAN, y si el aviso se pierde la cocina seguia preparando y la mesa
          // quedaba ocupada hasta el corte (barrido 2026-09-10, pedro-core LENTE-2).
          if (cancelled(row) && !cancelled(existing) && !settled(existing)) {
            this._applyOrderCancelled({ order_id: id, mesa: existing.mesa })
            continue
          }
          // Mesa movida en la nube: se libera la vieja si aun apunta aqui y se
          // ocupa la nueva si nadie mas la tiene.
          if (row.mesa != null && existing.mesa != null && String(row.mesa) !== String(existing.mesa) &&
              !settled(existing) && !cancelled(existing)) {
            const vieja = String(existing.mesa), nueva = String(row.mesa)
            if (this._mesas.get(vieja)?.order_id === id) { this._mesas.set(vieja, { status: 'libre', order_id: null, locked_by: null }); this._locks.delete(vieja) }
            const ocupante = this._mesas.get(nueva)?.order_id
            if (!ocupante || ocupante === id) this._mesas.set(nueva, { status: 'ocupada', order_id: id, locked_by: null })
            this._orders.set(id, { ...existing, mesa: row.mesa, updated_at: new Date().toISOString() })
            this._kds = this._kds.map(k => k.order_id === id ? { ...k, mesa: row.mesa } : k)
          }
          const actual = this._orders.get(id)
          if (FINANCIAL_CLOSED.has(row.status) && !settled(actual) && !cancelled(actual)) {
            this._orders.set(id, { ...actual, payment_status: 'pagada', saldo: 0,
              closed_at: row.closed_at || actual.closed_at || new Date().toISOString(),
              updated_at: new Date().toISOString() })
            const mesa = actual.mesa != null ? String(actual.mesa) : null
            if (mesa && this._mesas.get(mesa)?.order_id === id) {
              this._mesas.set(mesa, { status: 'libre', order_id: null, locked_by: null })
              this._locks.delete(mesa)
            }
          }
          continue
        }
        this._orders.set(id, { ...row, id, order_id: id, _from_cloud: true,
          _kds_sent: row.status !== 'abierta',
          preparation_status: row.preparation_status ?? (PREPARATION_STATUS.has(row.status) ? row.status : null),
          payment_status: row.payment_status ?? (FINANCIAL_CLOSED.has(row.status) ? 'pagada' : 'pendiente'),
        })
        // La fila dice cancelada/cerrada pero la mesa pudo quedar "protegida" por
        // la ventana de gracia (orden fresca ausente de mesas/kds_queue): la
        // proteccion es contra la AUSENCIA, no contra una fila que si llego.
        if (cancelled(row) || FINANCIAL_CLOSED.has(row.status)) {
          const mesa = row.mesa ?? existing?.mesa
          if (mesa != null && this._mesas.get(String(mesa))?.order_id === id) {
            this._mesas.set(String(mesa), { status: 'libre', order_id: null, locked_by: null })
            this._locks.delete(String(mesa))
          }
          if (cancelled(row)) this._kds = this._kds.filter(k => k.order_id !== id)
        }
      }
      this._orderSnapshotComplete = order_snapshot_complete === true && orders.every(row => {
        if (!(row?.id ?? row?.order_id)) return false
        let items = row.items
        if (typeof items === 'string') { try { items = JSON.parse(items) } catch { return false } }
        return Array.isArray(items)
      })
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

  /**
   * Reconstruye este estado desde el snapshot de OTRO Pedro (la caja).
   *
   * ── POR QUE EXISTE ────────────────────────────────────────────────────────
   *
   * Una terminal secundaria aplica en memoria los eventos que le llegan de la
   * caja, pero NO los escribe en su propio event store — ese log es de lo que
   * ELLA origino. Al reiniciar, su estado se reconstruye desde su log y queda
   * SIN las ordenes de las demas terminales.
   *
   * Y como el cursor SI se persiste, al reconectar pide "dame desde N", la caja
   * contesta "nada nuevo" con toda razon, y el salon se queda vacio PARA
   * SIEMPRE. Un tablero de cocina en blanco con mesas servidas.
   *
   * Encontrado el 2026-09-04 en revision cruzada. El hub siempre mando el estado
   * completo en el SNAPSHOT (ws-hub.js:99-102); el enlace lo tiraba y aplicaba
   * solo los deltas.
   *
   * ── POR QUE NO SE REUSA STATE_SYNC ────────────────────────────────────────
   *
   * `_applyStateSync` espera `mesas` como ARREGLO y no consume `kds_orders`;
   * `toSnapshot` devuelve `mesas` como OBJETO y las ordenes van en `kds_orders`.
   * Pasarle uno al otro perderia las ordenes en silencio. Esta es la inversa
   * EXACTA de `toSnapshot`, y por eso vive pegada a ella: si una cambia, la otra
   * tiene que cambiar en la misma pantalla.
   *
   * REEMPLAZA, no fusiona: la caja es la autoridad y su foto es la verdad. Lo
   * local que no este ahi es residuo de una sesion anterior.
   */
  hidratarDesdeSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return false
    this._writeAuthority = snap.write_authority === 'caja' ? 'caja' : 'legacy'
    this._itemTransfers = new Set(Array.isArray(snap.item_transfers) ? snap.item_transfers : [])

    this._cashMovements = new Map((Array.isArray(snap.cash_movements) ? snap.cash_movements : []).map(m => [m.id, JSON.parse(JSON.stringify(m))]))
    this._mesas = new Map(Object.entries(snap.mesas || {}))
    this._locks = new Map(Object.entries(snap.locks || {}))
    this._kds   = Array.isArray(snap.kds_queue) ? [...snap.kds_queue] : []
    this._orderNumbers = new Map(Object.entries(snap.order_numbers || {}).filter(([, n]) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647))
    this._turno = snap.turno ?? null
    this._turnIdentities = new Set(Array.isArray(snap.turn_identities) ? snap.turn_identities : [])
    this._turnSummaries = new Map((Array.isArray(snap.turn_summaries) ? snap.turn_summaries : []).filter(t => t?.id).map(t => [t.id, JSON.parse(JSON.stringify(t))]))
    this._lastSupabaseSync = snap.last_supabase_sync ?? null
    this._financialOrders = new Map((Array.isArray(snap.financial_orders) ? snap.financial_orders : [])
      .filter(o => o?.order_id).map(o => [o.order_id, JSON.parse(JSON.stringify(o))]))
    this._printDocuments = new Map((Array.isArray(snap.print_documents) ? snap.print_documents : [])
      .filter(d => d?.document_id).map(d => [d.document_id, JSON.parse(JSON.stringify(d))]))
    this._printResolutions = new Map((Array.isArray(snap.print_resolutions) ? snap.print_resolutions : [])
      .filter(r => r?.job_id && r?.uncertain_episode_id).map(r => [JSON.stringify([r.job_id, r.uncertain_episode_id]), JSON.parse(JSON.stringify(r))]))
    this._canonicalPrintJobs = new Map((Array.isArray(snap.canonical_print_jobs) ? snap.canonical_print_jobs : [])
      .filter(j => j?.job_id && j?.command_id).map(j => [j.job_id, { ...j }]))
    this._drawerOperations = new Map((Array.isArray(snap.drawer_operations) ? snap.drawer_operations : [])
      .filter(o => o?.operation_id).map(o => [o.operation_id, JSON.parse(JSON.stringify(o))]))
    this._drawerResolutions = new Map((Array.isArray(snap.drawer_resolutions) ? snap.drawer_resolutions : [])
      .filter(r => r?.job_id && r?.uncertain_episode_id).map(r => [JSON.stringify([r.job_id, r.uncertain_episode_id]), JSON.parse(JSON.stringify(r))]))

    // `toSnapshot` quita el flag interno `_kds_sent` antes de mandar. Se repone:
    // sin el, `toSnapshot` de ESTA terminal filtraria las ordenes y el KDS local
    // se quedaria vacio aunque el estado si las tenga.
    this._orders = new Map()
    const kitchen = Array.isArray(snap.kds_orders) ? snap.kds_orders : []
    const kitchenIds = new Set(kitchen.map(o => o?.order_id ?? o?.id))
    for (const o of [...kitchen, ...(Array.isArray(snap.salon_orders) ? snap.salon_orders : [])]) {
      const id = o?.order_id ?? o?.id
      if (!id) continue
      this._orders.set(id, { ...o, id, order_id: id, _from_cloud: o.from_cloud === true, _kds_sent: kitchenIds.has(id) || !!o.preparation_status })
    }
    // Cancelled identities are absent from both visible projections, but must
    // survive reconnect so a delayed broadcast cannot recreate their debt.
    for (const o of Array.isArray(snap.cancelled_orders) ? snap.cancelled_orders : []) {
      const id = o?.order_id ?? o?.id
      if (id && cancelled(o)) this._orders.set(id, { ...o, id, order_id: id, _from_cloud: false, _kds_sent: false })
    }
    for (const order of this._orders.values()) this._rememberOrderNumber(order)
    this._orderSnapshotComplete = snap.order_snapshot_complete === true
    return true
  }

  toSnapshot() {
    // D2: kitchen is preparation work; salon is unsettled debt. Both carry the
    // full order and the financial result so a secondary can reopen the account.
    // `from_cloud` viaja en la foto: sin el, una secundaria hidratada trataba TODA
    // orden como local y ninguna foto de la nube podia quitarle, cancelar ni
    // mover una orden que en la caja venia de la nube (tableros divergentes hasta
    // la siguiente reconexion; barrido 2026-09-10, pedro-core LENTE-3).
    const clean = ({ _kds_sent, _from_cloud, ...rest }) => ({ ...rest, ...(_from_cloud === true ? { from_cloud: true } : {}), saldo: balanceOf(rest),
      financial_order: this._financialOrders.get(rest.order_id ?? rest.id) ?? null })
    // Legacy: la cocina no tiene accion "entregar" (existe solo bajo Caja). Una
    // comanda COBRADA cuya preparacion ya esta lista sale del tablero; si se
    // cobro antes de cocinarse, se queda (D2: el cobro no borra trabajo).
    // Antes cada ticket cobrado quedaba como tarjeta verde hasta el corte
    // (barrido 2026-09-10, kds LENTE-2).
    const cobradaYServida = o => this._writeAuthority !== 'caja' && settled(o) && (o.preparation_status ?? o.status) === 'lista'
    const kds_orders = [...this._orders.values()]
      .filter(o => o._kds_sent && !cancelled(o) && !cobradaYServida(o) &&
        (o.preparation_status ?? o.status) !== 'entregada' &&
        // Legacy financial-only status without preparation cannot invent work.
        (!FINANCIAL_CLOSED.has(o.status) || !!o.preparation_status))
      .map(o => ({ ...clean(o), ...(o.authority === 'caja' ? { items: JSON.stringify(o.kitchen_items || []) } : {}), status: o.preparation_status ?? o.status }))
    const salon_orders = [...this._orders.values()].filter(o => !cancelled(o) && !settled(o)).map(clean)
    const order_snapshot_complete = this._orderSnapshotComplete && [...this._mesas.values()].every(m =>
      !m.order_id || m.status === 'libre' || this._orders.get(m.order_id)?.items != null)

    return {
      write_authority: this._writeAuthority,
      item_transfers: [...this._itemTransfers],
      mesas:              Object.fromEntries(this._mesas),
      kds_queue:          [...this._kds],
      kds_orders,
      salon_orders,
      cancelled_orders: [...this._orders.values()].filter(cancelled).map(o => ({
        id: o.order_id ?? o.id, order_id: o.order_id ?? o.id, mesa: o.mesa, status: 'cancelada',
      })),
      order_snapshot_complete,
      financial_orders: this.getFinancialOrders(),
      print_documents: this.getPrintDocuments(),
      print_resolutions: [...this._printResolutions.values()].map(resolution => JSON.parse(JSON.stringify(resolution))),
      canonical_print_jobs: [...this._canonicalPrintJobs.values()].map(job => ({ ...job })),
      drawer_operations: this.getDrawerOperations(),
      drawer_resolutions: [...this._drawerResolutions.values()].map(resolution => JSON.parse(JSON.stringify(resolution))),
      cash_movements: this.getCashMovements(),
      turno:              this._turno,
      turn_identities: [...this._turnIdentities],
      order_numbers: Object.fromEntries(this._orderNumbers),
      turn_summaries: [...this._turnSummaries.values()].map(t => JSON.parse(JSON.stringify(t))),
      locks:              Object.fromEntries(this._locks),
      last_supabase_sync: this._lastSupabaseSync,
    }
  }

  _rememberOrderNumber(order) {
    if (order.authority !== 'caja' || !order.turno_id) return
    const last = this._orderNumbers.get(order.turno_id) || 0
    if (Number.isSafeInteger(order.order_number) && order.order_number > last) this._orderNumbers.set(order.turno_id, order.order_number)
  }
  getNextOrderNumber(turnoId) { return (this._orderNumbers.get(turnoId) || 0) + 1 }

  getMesa(mesa)    { return this._mesas.get(String(mesa)) || { status: 'libre', order_id: null } }
  getOrder(id) { const order = this._orders.get(id); return order ? JSON.parse(JSON.stringify(order)) : null }
  getFinancialOrder(id) { const order = this._financialOrders.get(id); return order ? JSON.parse(JSON.stringify(order)) : null }
  getCashMovements() { return [...this._cashMovements.values()].map(m => JSON.parse(JSON.stringify(m))) }
  getFinancialOrders() { return [...this._financialOrders.values()].map(order => JSON.parse(JSON.stringify(order))) }
  getPrintDocuments() { return [...this._printDocuments.values()].map(document => JSON.parse(JSON.stringify(document))) }
  getPrintDocument(id) { const document = this._printDocuments.get(id); return document ? JSON.parse(JSON.stringify(document)) : null }
  getPrintResolution(jobId, episodeId) { const resolution = this._printResolutions.get(JSON.stringify([jobId, episodeId])); return resolution ? JSON.parse(JSON.stringify(resolution)) : null }
  getCanonicalPrintJob(jobId) { const job = this._canonicalPrintJobs.get(jobId); return job ? { ...job } : null }
  getDrawerOperations() { return [...this._drawerOperations.values()].map(operation => JSON.parse(JSON.stringify(operation))) }
  getDrawerOperation(id) { const operation = this._drawerOperations.get(id); return operation ? JSON.parse(JSON.stringify(operation)) : null }
  getDrawerResolution(jobId, episodeId) { const resolution = this._drawerResolutions.get(JSON.stringify([jobId, episodeId])); return resolution ? JSON.parse(JSON.stringify(resolution)) : null }
  getKdsQueue()    { return [...this._kds] }
  getTurno()       { return this._turno }
  getLock(mesa)    { return this._locks.get(String(mesa)) || null }
  hasActiveTurno() { return this._turno !== null }
  hasTurnIdentity(id) { return this._turnIdentities.has(id) }
}

// Ventana de gracia (ms) para proteger órdenes locales recién creadas del clobber del
// poll (GAP-002). Debe cubrir el lag entre crear la orden local y que aparezca en
// Supabase (el browser POS la sube por su propia sync_queue). 45s es holgado.
RestaurantState.SYNC_GRACE_MS = 45000

module.exports = { RestaurantState }
