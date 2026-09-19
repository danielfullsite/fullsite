'use strict'
const { OperationalError, authorizeOperational } = require('./operational-domain')
const PRINT_COMMANDS = new Set(['PRINT_PRECHECK', 'PRINT_RECEIPT', 'PRINT_COPY', 'DRAWER_OPEN'])
const fail = (code, message) => { throw new OperationalError(code, message) }
const text = (value, max = 200) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const cents = value => { if (!Number.isSafeInteger(value) || value < 0) fail('PRINT_AMOUNT_INVALID', 'Caja no confirmó los importes del documento'); return value }
const money = value => `$${(cents(value) / 100).toFixed(2)}`
const reasonOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) fail('PRINT_REASON_REQUIRED', 'Escribe un motivo de hasta 200 caracteres')
  return value.trim()
}
const asciiTicket = lines => Buffer.from('\x1b\x40' + lines.map(line => text(line, 300)).join('\n') + '\n\n\n\x1d\x56\x41\x03', 'ascii')
function authorizedOrder(state, orderId, actor) {
  const order = state.getOrder(orderId)
  if (!order || order.authority !== 'caja') fail('PRINT_ORDER_REQUIRED', 'Selecciona una cuenta guardada y confirmada en Caja')
  if (order.created_by !== actor.id && !actor.permissions.includes('ver_todas_cuentas')) fail('PERMISSION_DENIED', 'No tienes permiso para imprimir la cuenta de otro empleado')
  return order
}
/** Authorization runs before receipt lookup, including duplicate command IDs.
 * No client-supplied totals, ESC/POS bytes, printer or document text are accepted. */
function authorizeControlledPrint(payload, actor) {
  authorizeOperational(actor, payload.command_type === 'DRAWER_OPEN' ? 'cajero' : 'imprimir_cuentas')
  if (payload.command_type === 'PRINT_COPY') {
    authorizeOperational(actor, 'gerente'); authorizeOperational(actor, 'reimpresion_preticket')
  }
  const allowed = ['command_id', 'command_type', 'restaurant_id', 'location_id', 'client_id',
    ...(payload.command_type === 'DRAWER_OPEN' ? ['turno_id', 'reason'] : payload.command_type === 'PRINT_COPY' ? ['source_command_id', 'reason'] : ['order_id', 'expected_order_revision', 'expected_financial_revision'])]
  if (Object.keys(payload).some(key => !allowed.includes(key))) fail('UNTRUSTED_PRINT_FIELDS', 'Caja prepara el documento; no acepta texto, importes ni bytes propuestos por la terminal')
}
async function authorizePrintScope(payload, state, actor, store) {
  if (payload.command_type === 'DRAWER_OPEN') return
  if (payload.command_type !== 'PRINT_COPY') { authorizedOrder(state, payload.order_id, actor); return }
  const source = (await store.readAfter(0)).find(event => event.payload?.command_id === payload.source_command_id)?.result?.print_document
  if (!source || source.copy || !['precheck', 'receipt'].includes(source.kind)) fail('PRINT_COPY_SOURCE_INVALID', 'Elige una precuenta o recibo original; el cajón no se puede reimprimir')
  authorizedOrder(state, source.order_id, actor)
}
function preparedJobs(printer, document, commandId) {
  if (!printer?.prepareJobs) fail('PRINTER_NOT_CONFIGURED', 'Configura una impresora de Caja antes de solicitar esta acción')
  const data = document.kind === 'drawer' ? Buffer.from([0x1b, 0x70, 0, 0x19, 0xfa]) : asciiTicket(document.lines)
  let jobs
  try { jobs = printer.prepareJobs('caja', data, document.kind === 'precheck' ? 'pre_ticket' : 'receipt', { commandId, reprint: document.copy === true }) }
  catch (error) { fail(error.code || 'PRINTER_NOT_CONFIGURED', `No se preparó la salida de Caja: ${error.message}`) }
  if (!Array.isArray(jobs) || !jobs.length) fail('PRINTER_NOT_CONFIGURED', 'No hay impresora configurada para este documento de Caja')
  // A drawer request must never pulse multiple devices or inherit ticket copies.
  if (document.kind === 'drawer' && jobs.length !== 1) fail('DRAWER_DESTINATION_AMBIGUOUS', 'Configura una sola impresora de Caja para abrir el cajón')
  return jobs.map(job => ({ ...job, ...(document.kind === 'drawer' ? { copies: 1 } : {}) }))
}

/** Produces immutable business text and adapter intents inside the command's
 * existing fsync transaction. Looking up a prior document recovers its original
 * jobs; only an explicit manager-authorized COPY creates another paper job. */
async function prepareControlledPrint(payload, { state, actor, printer, store, catalog, now = new Date().toISOString() }) {
  authorizeControlledPrint(payload, actor)
  const type = payload.command_type, events = await store.readAfter(0)
  let document, reason
  const audit = () => ({ requested_by: actor.id, requested_at: now, ...(reason ? { reason } : {}) })
  if (type === 'DRAWER_OPEN') {
    reason = reasonOf(payload.reason)
    if (!state.getTurno()?.id || state.getTurno().id !== payload.turno_id) fail('TURNO_MISMATCH', 'Confirma el turno abierto antes de solicitar el cajón')
    document = { kind: 'drawer', turno_id: payload.turno_id, source_command_id: payload.command_id, requested_by: actor.id, created_at: now, reason }
  } else if (type === 'PRINT_COPY') {
    reason = reasonOf(payload.reason)
    const source = events.find(event => event.payload?.command_id === payload.source_command_id)
    const original = source?.result?.print_document
    if (!original || original.copy || !['precheck', 'receipt'].includes(original.kind) || !Array.isArray(original.lines)) fail('PRINT_COPY_SOURCE_INVALID', 'Elige una precuenta o recibo original; el cajón no se puede reimprimir')
    authorizedOrder(state, original.order_id, actor)
    document = { ...original, source_command_id: payload.command_id, original_command_id: original.source_command_id, copy: true,
      requested_by: actor.id, created_at: now, reason,
      lines: ['*** COPIA ***', `Original ${text(original.source_command_id)}`, `Motivo: ${text(reason)}`, ...original.lines] }
  } else {
    const order = authorizedOrder(state, payload.order_id, actor)
    const financial = state.getFinancialOrder(order.order_id)
    if (payload.expected_order_revision !== order.order_revision || payload.expected_financial_revision !== (financial?.revision ?? 0)) fail('PRINT_REVISION_CONFLICT', 'La cuenta cambió; vuelve a consultar antes de imprimir')
    if (order.status === 'cancelada') fail('PRINT_ORDER_CANCELLED', 'La cuenta está anulada; consulta su auditoría')
    const kind = type === 'PRINT_PRECHECK' ? 'precheck' : 'receipt'
    const accepted = financial?.payments.filter(payment => payment.status === 'accepted') ?? []
    if (kind === 'receipt' && !accepted.length) fail('PRINT_NO_ACCEPTED_PAYMENTS', 'No hay pagos confirmados; solicita una precuenta')
    const existing = events.find(event => {
      const d = event.result?.print_document
      return d && !d.copy && d.kind === kind && d.order_id === order.order_id && d.order_revision === order.order_revision && d.financial_revision === (financial?.revision ?? 0)
    })
    if (existing) return { result: { print_document: existing.result.print_document, print_request: audit(), existing_document: true }, effects: existing.effects }
    const lines = [text(catalog?.catalog?.config?.display_name || 'Fullsite'), kind === 'precheck' ? 'PRECUENTA - NO ES COMPROBANTE DE PAGO' : 'RECIBO DE PAGOS REGISTRADOS',
      `Orden ${text(order.order_id)}`, order.mesa === null ? `Cuenta ${text(order.customer_name)}` : `Mesa ${order.mesa}`, `Empleado ${text(order.mesero)}`, text(now), '-'.repeat(40)]
    if (kind === 'precheck') {
      let items = order.items
      if (typeof items === 'string') { try { items = JSON.parse(items) } catch { fail('PRINT_ORDER_REQUIRED', 'Caja no confirmó los productos guardados') } }
      if (!Array.isArray(items) || !items.length) fail('PRINT_ORDER_REQUIRED', 'La cuenta no tiene consumo guardado')
      for (const item of items) {
        lines.push(`${item.cantidad} x ${text(item.nombre, 100)} ${money(item.total_cents)}`)
        for (const modifier of item.modificadores ?? []) lines.push(`  ${text(modifier, 100)}`)
      }
      lines.push('-'.repeat(40), `Subtotal ${money(order.subtotal_cents)}`, `IVA ${money(order.iva_cents)}`)
    } else {
      for (const payment of accepted) {
        const method = payment.method === 'cash' ? 'Efectivo' : payment.method === 'manual' ? payment.tender === 'card' ? 'Tarjeta independiente (registro manual)' : 'Transferencia (registro manual)' : 'Proveedor externo'
        lines.push(method, `Consumo ${money(payment.amount_cents)}`, `Propina ${money(payment.tip_cents ?? 0)}`, `Pago ${text(payment.payment_id)}`)
        if (payment.evidence?.reference) lines.push(`Referencia ${text(payment.evidence.reference)}`)
        if (payment.change_cents) lines.push(`Cambio ${money(payment.change_cents)}`)
      }
      lines.push('-'.repeat(40), 'El registro manual no es autorizacion bancaria.')
    }
    lines.push(`Consumo total ${money(order.total_cents)}`, `Consumo pagado ${money(financial?.paid_cents ?? 0)}`,
      `Propina recibida ${money(financial?.tip_cents ?? 0)}`, `Saldo pendiente ${money(financial?.balance_cents ?? order.total_cents)}`)
    document = { kind, order_id: order.order_id, turno_id: order.turno_id, order_revision: order.order_revision, financial_revision: financial?.revision ?? 0,
      source_command_id: payload.command_id, requested_by: actor.id, created_at: now, lines }
  }
  const jobs = preparedJobs(printer, document, payload.command_id)
  document.job_ids = jobs.map(job => job.job_id)
  return { result: { print_document: document, print_request: audit(), existing_document: false }, effects: { print_jobs: jobs } }
}
module.exports = { PRINT_COMMANDS, authorizeControlledPrint, authorizePrintScope, prepareControlledPrint }
