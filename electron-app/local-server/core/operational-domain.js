'use strict'
const { turnReport } = require('./turn-report')
// Pure preparation of Caja-owned orders. The handler serializes this with money
// commands and commits the result before projecting or acknowledging it.
const COMMANDS = new Set(['ORDER_SAVE', 'ORDER_SEND', 'ORDER_MOVE', 'ORDER_VOID', 'TURN_OPEN', 'TURN_CLOSE', 'CASH_MOVEMENT', 'KITCHEN_SET'])
const clone = value => JSON.parse(JSON.stringify(value))
class OperationalError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new OperationalError(code, message) }
const int = (value, name, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_OPERATIONAL_VALUE', `${name} inválido`)
  return value
}
const id = (value, name) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('INVALID_OPERATIONAL_VALUE', `${name} requerido`)
  return value
}
const note = (value, name, max = 1000) => {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > max) fail('INVALID_OPERATIONAL_VALUE', `${name} inválido`)
  return value
}
const parse = value => typeof value === 'string' ? JSON.parse(value) : value
const price = value => {
  const cents = Math.round(value * 100)
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value * 100 - cents) > 1e-7) fail('CATALOG_NOT_READY', 'Precio del catálogo inválido')
  return int(cents, 'precio')
}
function authorize(actor, permission) {
  if (!actor?.id || !Array.isArray(actor.permissions) || !Number.isFinite(actor.expires_at) || actor.expires_at <= Date.now()) fail('ACTOR_REQUIRED', 'Inicia sesión de empleado en Caja')
  if (!actor.permissions.includes(permission)) fail('PERMISSION_DENIED', `Permiso requerido: ${permission}`)
}
function table(value, catalog) {
  if (value === null) return null
  return int(value, 'mesa', 1, catalog.config.mesas)
}
function checkTable(mesa, state, orderId) {
  if (mesa === null) return
  const occupied = state.getMesa(mesa)
  if (occupied.order_id && occupied.order_id !== orderId && occupied.status !== 'libre') fail('TABLE_OCCUPIED', 'Otra cuenta ya ocupa la mesa; vuelve a abrirla')
}
function checkCustomer(order, state) {
  if (order.mesa !== null) return
  order.customer_name = order.customer_name.trim()
  if (!order.customer_name) fail('CUSTOMER_NAME_REQUIRED', 'Identifica la cuenta sin mesa')
  const key = value => String(value || '').normalize('NFKC').toLocaleLowerCase('es-MX').trim()
  if (state.toSnapshot().salon_orders.some(o => o.mesa === null && o.order_id !== order.order_id && key(o.customer_name) === key(order.customer_name))) fail('CUSTOMER_ACCOUNT_EXISTS', 'Ya existe una cuenta abierta con ese nombre; abre la cuenta actual')
}
function resolveStation(category, catalog) {
  const routing = catalog.settings['pos.station_routing']
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) fail('CATALOG_ROUTING_REQUIRED', 'Prepara las estaciones de cada categoría en Caja')
  const normalize = value => String(value).normalize('NFKC').trim().toLocaleLowerCase('es-MX')
  const stations = []
  for (const [station, categories] of Object.entries(routing)) {
    if (!['cocina', 'barra', 'caja'].includes(station) || !Array.isArray(categories) || categories.some(c => typeof c !== 'string')) fail('CATALOG_ROUTING_REQUIRED', 'Configuración de estaciones inválida')
    if (categories.some(value => value === category.id || normalize(value) === normalize(category.name))) stations.push(station)
  }
  if (stations.length !== 1) fail('CATALOG_ROUTING_REQUIRED', `Asigna una sola estación para ${category.name}`)
  return stations[0]
}
function lineFromCatalog(input, catalog, catalogRevision) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ITEMS', 'Renglón inválido')
  // Reject prices, status and quantities attributed by the browser. Only IDs,
  // quantity and the operator's notes participate in the request contract.
  if (Object.keys(input).some(k => !['line_id', 'product_id', 'quantity', 'modifier_ids', 'notes', 'seat'].includes(k))) fail('UNTRUSTED_ORDER_FIELDS', 'Envía productos y opciones por ID; Caja calcula los importes')
  const lineId = id(input.line_id, 'line_id'), productId = id(input.product_id, 'product_id')
  let category, product
  for (const candidate of catalog.categories) {
    const found = candidate.items.find(p => p.id === productId)
    if (found) { category = candidate; product = found; break }
  }
  if (!product) fail('PRODUCT_UNAVAILABLE', 'Producto fuera del catálogo preparado en Caja')
  const selected = input.modifier_ids ?? []
  if (!Array.isArray(selected) || selected.length > 100 || new Set(selected).size !== selected.length) fail('INVALID_MODIFIERS', 'Opciones inválidas o repetidas')
  selected.forEach(v => id(v, 'modifier_id'))
  const groupIds = new Set([...catalog.modifiers.item_links.filter(l => l.item_id === productId).map(l => l.group_id),
    ...catalog.modifiers.category_links.filter(l => l.category_id === category.id).map(l => l.modifier_group_id)])
  const mods = selected.map(modId => {
    const mod = catalog.modifiers.mods.find(m => m.id === modId)
    if (!mod || !groupIds.has(mod.group_id)) fail('INVALID_MODIFIERS', 'La opción no pertenece al producto')
    return mod
  })
  for (const group of catalog.modifiers.groups.filter(g => groupIds.has(g.id))) {
    const count = mods.filter(m => m.group_id === group.id).length
    const min = group.required ? Math.max(1, group.min_selections) : group.min_selections
    if (count < min || group.max_selections !== null && count > group.max_selections) fail('MODIFIER_SELECTION_REQUIRED', `Revisa las opciones de ${group.name}`)
  }
  const base = price(product.price), extra = mods.reduce((sum, m) => int(sum + price(m.price), 'extras'), 0)
  const quantity = int(input.quantity, 'quantity', 1, 10000)
  const amount = int(int(base + extra, 'precio unitario') * quantity, 'importe del renglón')
  return { id: lineId, menuItemId: productId, nombre: product.name, category_id: category.id,
    station: resolveStation(category, catalog),
    precio: base / 100, precioExtra: extra / 100, cantidad: quantity, subtotal: amount / 100,
    unit_price_cents: base + extra, total_cents: amount, modifier_ids: [...selected].sort(),
    modificadores: mods.map(m => m.price > 0 ? `${m.name} +$${m.price}` : m.name),
    notas: note(input.notes, 'notes'), silla: int(input.seat ?? 0, 'seat', 0, 1000),
    sent_quantity: 0, catalog_revision: catalogRevision }
}

class OperationalDomain {
  prepare(payload, { state, catalogEnvelope, actor, now = new Date().toISOString() }) {
    const type = payload.command_type
    const permission = { ORDER_SAVE: 'pos.orders.write', ORDER_SEND: 'pos.orders.send', ORDER_MOVE: 'pos.orders.move', ORDER_VOID: 'pos.orders.cancel', TURN_OPEN: 'pos.turns.open', TURN_CLOSE: 'pos.turns.close', CASH_MOVEMENT: 'retiros_programados', KITCHEN_SET: 'actualizar_estatus_orden' }[type]
    if (!permission) fail('UNKNOWN_OPERATIONAL_COMMAND', 'Comando operativo desconocido')
    authorize(actor, permission)
    const turno = state.getTurno()
    const turnoId = id(payload.turno_id, 'turno_id')
    if (type === 'TURN_OPEN') {
      if (turno) fail('TURN_ALREADY_OPEN', 'Ya existe un turno; abre el turno actual')
      if (state.hasTurnIdentity?.(turnoId)) fail('TURN_ID_REUSED', 'El turno nuevo requiere una identidad nueva')
      return { turno: { id: turnoId, opened_by: actor.id, opened_at: now, opening_cash_cents: int(payload.opening_cash_cents ?? 0, 'opening_cash_cents'), authority: 'caja' } }
    }
    if (!turno || turno.id !== turnoId) fail('TURNO_MISMATCH', 'La operación debe pertenecer al turno actual de Caja')
    if (type === 'CASH_MOVEMENT') {
      const movementId = id(payload.movement_id, 'movement_id')
      if (!['retiro', 'deposito'].includes(payload.type)) fail('INVALID_CASH_MOVEMENT', 'Elige retiro o depósito')
      const amount = int(payload.amount_cents, 'amount_cents', 1)
      const reason = note(payload.reason, 'reason', 1000).trim()
      if (!reason) fail('REASON_REQUIRED', 'Escribe el motivo del movimiento')
      const previous = state.getCashMovements().find(m => m.id === movementId)
      if (previous) {
        if (previous.turno_id !== turnoId || previous.type !== payload.type || previous.amount_cents !== amount || previous.reason !== reason) fail('MOVEMENT_ID_REUSED', 'La identidad pertenece a otro movimiento')
        return { cash_movement: previous }
      }
      const report = turnReport(turno, state.getFinancialOrders(), state.toSnapshot().salon_orders, state.getCashMovements())
      if (payload.type === 'retiro' && amount > report.expected_cash_cents) fail('INSUFFICIENT_CASH', 'El retiro supera el efectivo esperado en Caja')
      return { cash_movement: { id: movementId, turno_id: turnoId, type: payload.type,
        amount_cents: amount, reason, actor: actor.id, approved_by: actor.id, created_at: now } }
    }
    if (type === 'TURN_CLOSE') {
      const snapshot = state.toSnapshot()
      if (snapshot.salon_orders.length || state.getFinancialOrders().some(o => o.turno_id === turnoId && (o.balance_cents > 0 || o.reserved_cents > 0))) fail('UNSETTLED_FINANCIAL_ACCOUNTS', 'Quedan cuentas abiertas o intentos de pago por resolver')
      if (snapshot.kds_orders.length) fail('PENDING_KITCHEN_WORK', 'Quedan comandas sin entregar en cocina')
      const counted = int(payload.counted_cash_cents, 'counted_cash_cents')
      const report = turnReport(turno, state.getFinancialOrders(), snapshot.salon_orders, state.getCashMovements())
      const { opening_cash_cents: opening, cash_sales_cents: cashSales,
        total_paid_cents: totalPaid, expected_cash_cents: expected } = report
      return { turno: null, closed_turno: { ...turno, closed_by: actor.id, closed_at: now,
        opening_cash_cents: opening, cash_sales_cents: cashSales, total_paid_cents: totalPaid,
        deposits_cents: report.deposits_cents, withdrawals_cents: report.withdrawals_cents,
        expected_cash_cents: expected, counted_cash_cents: counted, difference_cents: counted - expected,
        notes: note(payload.notes, 'notes', 1000) } }
    }
    const orderId = id(payload.order_id, 'order_id')
    const existing = state.getOrder(orderId)
    if (type === 'KITCHEN_SET') {
      if (!existing || existing.authority !== 'caja' || existing.status === 'cancelada' || existing.turno_id !== turnoId) fail('ORDER_NOT_FOUND', 'La comanda ya no está disponible en este turno')
      if (int(payload.expected_kitchen_revision, 'expected_kitchen_revision') !== (existing.kitchen_revision || 0)) fail('KITCHEN_REVISION_CONFLICT', 'Cocina cambió; revisa la comanda y vuelve a confirmar')
      const rank = { enviada: 0, preparando: 1, lista: 2, entregada: 3 }
      if (!['preparando', 'lista', 'entregada'].includes(payload.status)) fail('INVALID_PREPARATION_STATUS', 'Estado de preparación inválido')
      if (!Array.isArray(payload.item_ids) || !payload.item_ids.length || payload.item_ids.length > 1000 || new Set(payload.item_ids).size !== payload.item_ids.length) fail('INVALID_KITCHEN_ITEMS', 'Selecciona productos enviados a cocina')
      const keys = new Set(payload.item_ids.map(v => id(v, 'item_id')))
      const next = clone(existing)
      if ([...keys].some(key => !next.kitchen_items.some(item => item.id === key))) fail('INVALID_KITCHEN_ITEMS', 'El producto no pertenece a esta comanda')
      for (const item of next.kitchen_items) if (keys.has(item.id)) {
        if (rank[payload.status] < rank[item.preparation_status || 'enviada']) fail('PREPARATION_REGRESSION', 'La preparación confirmada no puede retroceder')
        item.preparation_status = payload.status; item.prepared_by = actor.id; item.prepared_at = now
      }
      const statusOf = rows => rows.every(i => i.preparation_status === 'entregada') ? 'entregada'
        : rows.every(i => rank[i.preparation_status || 'enviada'] >= 2) ? 'lista'
          : rows.some(i => rank[i.preparation_status || 'enviada'] >= 1) ? 'preparando' : 'enviada'
      const batches = parse(next.comanda_batches)
      for (const batchId of Object.keys(batches)) batches[batchId].status = statusOf(next.kitchen_items.filter(i => i.comanda_batch_id === batchId))
      next.comanda_batches = JSON.stringify(batches)
      next.preparation_status = statusOf(next.kitchen_items); next.status = next.preparation_status
      next.kitchen_revision = int((existing.kitchen_revision || 0) + 1, 'kitchen_revision')
      next.updated_at = now
      return { operational_order: next }
    }
    const expected = int(payload.expected_revision, 'expected_revision')
    if (existing && existing.authority !== 'caja') fail('LEGACY_ORDER_REQUIRES_CUTOVER', 'Esta orden requiere migración de autoridad antes de editarla por LAN')
    if (existing && (existing.turno_id !== turnoId || ['cancelada', 'pagada', 'cerrada', 'dividida'].includes(existing.status) || existing.payment_status === 'pagada')) fail('ORDER_NOT_OPEN', 'La cuenta ya no está abierta en este turno')
    if (expected !== (existing?.order_revision ?? 0)) fail('ORDER_REVISION_CONFLICT', 'La cuenta cambió en otra terminal; recárgala antes de confirmar')
    const financial = state.getFinancialOrder(orderId)
    if (financial) {
      if (!['ORDER_SAVE', 'ORDER_SEND'].includes(type)) fail('FINANCIAL_ORDER_LOCKED', 'Esta operación requiere un ajuste de las cuentas de cobro')
      if (financial.status === 'settled') fail('ORDER_NOT_OPEN', 'La cuenta ya está liquidada')
      if (!Number.isSafeInteger(payload.expected_financial_revision) || payload.expected_financial_revision !== financial.revision) fail('FINANCIAL_REVISION_CONFLICT', 'Confirma la revisión actual de pagos conservando el borrador')
    }
    if (existing && existing.created_by !== actor.id && !actor.permissions.includes('ver_todas_cuentas')) fail('PERMISSION_DENIED', 'No tienes permiso para modificar la cuenta de otro empleado')
    if (type !== 'ORDER_SAVE' && !existing) fail('ORDER_NOT_FOUND', 'Guarda la cuenta en Caja antes de continuar')
    let next = existing ? clone(existing) : { id: orderId, order_id: orderId, authority: 'caja', turno_id: turnoId,
      created_by: actor.id, mesero: actor.name || actor.id, created_at: now, status: 'abierta', payment_status: 'pendiente', preparation_status: null,
      comanda_batches: '{}', kitchen_items: [], kitchen_revision: 0, kds_item_status: '{}', descuento: 0, propina: 0, pagos: [], _kds_sent: false }
    next.order_revision = int(expected + 1, 'order_revision'); next.updated_at = now
    if (type === 'ORDER_SAVE') {
      if (!catalogEnvelope?.ready || !catalogEnvelope.catalog) fail('CATALOG_NOT_READY', 'Prepara el catálogo de Caja antes de operar')
      if (payload.catalog_revision !== catalogEnvelope.revision) fail('CATALOG_REVISION_CONFLICT', 'El catálogo cambió; revisa productos y precios')
      if (Object.keys(payload).some(k => !['command_id', 'command_type', 'order_id', 'turno_id', 'expected_revision', 'expected_financial_revision', 'account_id', 'catalog_revision', 'mesa', 'customer_name', 'personas', 'notas', 'items', 'restaurant_id', 'location_id', 'client_id'].includes(k))) fail('UNTRUSTED_ORDER_FIELDS', 'Caja calcula importes y atribución; ajustes requieren su comando autorizado')
      if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 1000) fail('INVALID_ITEMS', 'La cuenta requiere de 1 a 1000 renglones')
      const catalog = catalogEnvelope.catalog
      const mesa = table(payload.mesa, catalog)
      if (!existing) authorize(actor, mesa === null ? 'abrir_cuentas_llevar' : 'abrir_cuentas_restaurante')
      if (existing && mesa !== existing.mesa) fail('ORDER_MOVE_REQUIRED', 'Usa el cambio de mesa autorizado')
      checkTable(mesa, state, orderId)
      const oldItems = parse(existing?.items ?? [])
      const seen = new Set()
      const items = payload.items.map(input => {
        const line = lineFromCatalog(input, catalog, catalogEnvelope.revision)
        if (seen.has(line.id)) fail('DUPLICATE_LINE_ID', 'Cada renglón requiere identidad única')
        seen.add(line.id)
        const old = oldItems.find(i => i.id === line.id)
        if (old && (old.sent_quantity > 0 || financial)) {
          if (financial && line.cantidad < old.cantidad) fail('FINANCIAL_ADDITION_ONLY', 'Las cuentas preparadas admiten consumo adicional; reducir requiere ajuste autorizado')
          if (line.cantidad < old.sent_quantity || line.menuItemId !== old.menuItemId ||
            line.notas !== old.notas || line.silla !== old.silla || JSON.stringify(line.modifier_ids) !== JSON.stringify(old.modifier_ids)) fail('SENT_ITEM_LOCKED', 'No se pueden quitar ni cambiar productos ya enviados; requiere cancelación autorizada')
          // A sent line retains its accepted price. Further units at changed
          // catalog prices must be entered as a new line, never repriced silently.
          if (line.cantidad > old.cantidad && line.unit_price_cents !== old.unit_price_cents) fail('SENT_PRICE_CHANGED', 'Agrega un renglón nuevo con el precio actualizado')
          if (line.cantidad > old.cantidad && line.station !== old.station) fail('SENT_ROUTING_CHANGED', 'Agrega un renglón nuevo con la estación actualizada')
          return { ...old, cantidad: line.cantidad, total_cents: int(old.unit_price_cents * line.cantidad, 'importe'), subtotal: old.unit_price_cents * line.cantidad / 100 }
        }
        return line
      })
      if (oldItems.some(i => (i.sent_quantity > 0 || financial) && !seen.has(i.id))) fail('SENT_ITEM_LOCKED', 'No se pueden retirar productos enviados o asignados a una cuenta de cobro')
      const subtotal = items.reduce((sum, line) => int(sum + line.total_cents, 'subtotal'), 0)
      const ivaRate = existing?.iva_rate ?? catalog.config.iva_rate
      // Preserve the accepted tax/discount on prior consumption. Only the new
      // round is priced now, using the order's pinned tax rate. Take the rounded
      // cumulative difference so repeated small rounds cannot lose tax cents.
      const addedSubtotal = financial ? int(subtotal - int(existing.subtotal_cents, 'subtotal anterior'), 'consumo adicional') : subtotal
      const addedTax = financial ? Math.round(subtotal * ivaRate) - Math.round(existing.subtotal_cents * ivaRate) : Math.round(subtotal * ivaRate)
      const iva = financial ? int(existing.iva_cents + addedTax, 'iva') : int(addedTax, 'iva')
      const total = financial ? int(existing.total_cents + addedSubtotal + iva - existing.iva_cents, 'total') : int(subtotal + iva, 'total')
      Object.assign(next, { mesa, customer_name: note(payload.customer_name, 'customer_name', 200), personas: int(payload.personas ?? 1, 'personas', 1, 1000),
        notas: note(payload.notas, 'notas'), items: JSON.stringify(items), catalog_revision: catalogEnvelope.revision, iva_rate: ivaRate,
        subtotal_cents: subtotal, iva_cents: iva, total_cents: total, subtotal: subtotal / 100, iva: iva / 100, total: total / 100, saldo: total / 100 })
      checkCustomer(next, state)
    } else if (type === 'ORDER_SEND') {
      const items = parse(next.items)
      const additions = items.filter(i => i.cantidad > i.sent_quantity)
      if (!additions.length) fail('NOTHING_TO_SEND', 'Todos los productos guardados ya están enviados')
      const batches = parse(next.comanda_batches || '{}'), batchId = id(payload.command_id, 'command_id')
      const sequence = Object.keys(batches).length
      const delta = additions.map(item => ({ ...item, id: `${batchId}:${item.id}`, source_line_id: item.id,
        cantidad: item.cantidad - item.sent_quantity, subtotal: (item.cantidad - item.sent_quantity) * item.unit_price_cents / 100,
        total_cents: (item.cantidad - item.sent_quantity) * item.unit_price_cents, comanda_batch_id: batchId, comanda_batch_seq: sequence }))
      batches[batchId] = { status: 'enviada', created_at: now, seq: sequence, items: delta.map(i => ({ line_id: i.source_line_id, quantity: i.cantidad })) }
      next.items = JSON.stringify(items.map(i => ({ ...i, sent_quantity: i.cantidad })))
      next.kitchen_items = [...(next.kitchen_items || []), ...delta]
      next.kitchen_revision = int((next.kitchen_revision || 0) + 1, 'kitchen_revision')
      next.comanda_batches = JSON.stringify(batches); next._kds_sent = true
      next.status = 'enviada'; next.preparation_status = 'enviada'
    } else if (type === 'ORDER_MOVE') {
      if (!catalogEnvelope?.ready) fail('CATALOG_NOT_READY', 'No se pudo verificar el salón de Caja')
      const mesa = table(payload.mesa, catalogEnvelope.catalog)
      checkTable(mesa, state, orderId); next.mesa = mesa
      if (mesa === null) next.customer_name = note(payload.customer_name, 'customer_name', 200)
      checkCustomer(next, state)
    } else if (type === 'ORDER_VOID') {
      next.cancellation_reason = note(payload.reason, 'reason', 500).trim()
      if (!next.cancellation_reason) fail('CANCELLATION_REASON_REQUIRED', 'Indica el motivo de cancelación')
      next.status = 'cancelada'; next.cancelled_by = actor.id; next.cancelled_at = now
    }
    return { operational_order: next }
  }
}
module.exports = { OperationalDomain, OperationalError, OPERATIONAL_COMMANDS: COMMANDS, authorizeOperational: authorize }
