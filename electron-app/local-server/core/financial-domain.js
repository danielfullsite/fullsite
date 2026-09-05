'use strict'
// Authoritative money rules use integer cents. No preparation/KDS transition is
// produced here. Persistence and serialization belong to CommandHandler.
const clone = value => JSON.parse(JSON.stringify(value))
const COMMANDS = new Set(['FINANCIAL_OPEN', 'FINANCIAL_SPLIT', 'FINANCIAL_PAYMENT_START', 'FINANCIAL_PAYMENT_RESULT'])
const RESERVING = new Set(['pending', 'unknown'])
class FinancialError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, message) => { throw new FinancialError(code, message) }
function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('INVALID_ID', `${name} is required`)
  return value
}
function cents(value, name, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) fail('INVALID_CENTS', `${name} must be safe integer cents`)
  return value
}
function add(a, b) { return cents(a + b, 'sum') }
function revision(value) { return cents(value, 'expected_revision') }
function moneyFromOrder(order) {
  if (order.total_cents !== undefined) return cents(order.total_cents, 'order.total_cents', false)
  // This conversion only validates an existing operational amount. New money
  // command amounts never accept floats or numeric strings.
  const amount = order.total
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) fail('INVALID_ORDER_TOTAL', 'Order requires a valid saved total')
  const scaled = amount * 100
  const rounded = Math.round(scaled)
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 1e-7) fail('INVALID_ORDER_TOTAL', 'Order total has fractions smaller than one cent')
  return rounded
}
function requireSentConsumption(order) {
  let items = order.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = null }
  }
  if (!Array.isArray(items) || !items.length || items.some(item => !item ||
    !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0 ||
    !Number.isSafeInteger(item.sent_quantity) || item.sent_quantity !== item.cantidad)) {
    fail('ORDER_SEND_REQUIRED', 'Envía todos los productos guardados a cocina antes de preparar el cobro. No es necesario esperar su preparación.')
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

function summarize(order) {
  let paid = 0; let reserved = 0
  for (const account of order.accounts) {
    account.paid_cents = 0; account.reserved_cents = 0
    for (const payment of order.payments.filter(p => p.account_id === account.account_id)) {
      if (payment.status === 'accepted') account.paid_cents = add(account.paid_cents, payment.amount_cents)
      if (RESERVING.has(payment.status)) account.reserved_cents = add(account.reserved_cents, payment.amount_cents)
    }
    account.balance_cents = account.total_cents - account.paid_cents
    if (account.balance_cents < account.reserved_cents) fail('OVERPAYMENT', 'Payments exceed account balance')
    paid = add(paid, account.paid_cents); reserved = add(reserved, account.reserved_cents)
  }
  order.paid_cents = paid
  order.reserved_cents = reserved
  order.balance_cents = order.total_cents - paid
  order.status = order.balance_cents === 0 ? 'settled' : 'open'
  return order
}

function requireEvidence(payment, status, evidence, currency) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('PAYMENT_EVIDENCE_REQUIRED', 'Payment outcome requires evidence')
  if (payment.method === 'cash') {
    if (status === 'accepted') {
      if (evidence.kind !== 'cash_received') fail('PAYMENT_EVIDENCE_REQUIRED', 'Cash must be explicitly received')
      id(evidence.received_by, 'received_by')
      cents(evidence.received_cents, 'received_cents', false)
      if (evidence.received_cents < payment.amount_cents) fail('INSUFFICIENT_TENDER', 'Received cash is less than payment amount')
    } else {
      if (evidence.kind !== 'operator_record') fail('PAYMENT_EVIDENCE_REQUIRED', 'Operator record required')
      id(evidence.recorded_by, 'recorded_by'); id(evidence.reason, 'reason')
    }
  } else {
    if (evidence.kind !== 'provider_result' || evidence.provider !== payment.provider || evidence.status !== status) {
      fail('PAYMENT_EVIDENCE_REQUIRED', 'Provider outcome must identify the same provider and status')
    }
    id(evidence.reference, 'provider reference')
    if (evidence.currency !== currency || evidence.amount_cents !== payment.amount_cents) {
      fail('PAYMENT_EVIDENCE_MISMATCH', 'Provider outcome amount/currency differs from reserved attempt')
    }
  }
}

class FinancialDomain {
  constructor() { this._orders = new Map() }
  getOrder(orderId) { const order = this._orders.get(orderId); return order ? clone(order) : null }
  getOrders() { return [...this._orders.values()].map(clone) }
  apply(order) {
    // Applied values originate from prepare() and the checksummed committed log.
    // Validate the aggregate again so a malformed remote snapshot cannot liquidate.
    const verified = this._verifySnapshot(order)
    this._orders.set(verified.order_id, verified)
  }
  hydrate(orders) {
    if (!Array.isArray(orders)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Expected financial orders')
    const next = new Map()
    const paymentIds = new Set(); const providerReferences = new Set()
    for (const order of orders) {
      const verified = this._verifySnapshot(order)
      if (next.has(verified.order_id)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Duplicate order')
      for (const payment of verified.payments) {
        if (paymentIds.has(payment.payment_id)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Payment identity appears in multiple orders')
        paymentIds.add(payment.payment_id)
        if (payment.method === 'external' && payment.status === 'accepted') {
          const reference = JSON.stringify([payment.provider, payment.evidence.reference])
          if (providerReferences.has(reference)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Provider authorization appears in multiple payments')
          providerReferences.add(reference)
        }
      }
      next.set(verified.order_id, verified)
    }
    this._orders = next
  }
  _verifySnapshot(value) {
    if (!value || typeof value !== 'object') fail('INVALID_FINANCIAL_SNAPSHOT', 'Missing financial order')
    const order = clone(value)
    id(order.order_id, 'order_id'); id(order.turno_id, 'turno_id')
    cents(order.revision, 'revision', false); cents(order.order_revision, 'order_revision')
    cents(order.total_cents, 'total_cents', false)
    if (order.currency !== 'MXN' || !Array.isArray(order.accounts) || !order.accounts.length || !Array.isArray(order.payments)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Invalid currency, accounts or payments')
    const ids = new Set(); let total = 0
    for (const account of order.accounts) {
      id(account.account_id, 'account_id'); cents(account.total_cents, 'account.total_cents', false)
      if (ids.has(account.account_id)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Duplicate account')
      ids.add(account.account_id); total = add(total, account.total_cents)
    }
    if (total !== order.total_cents) fail('ACCOUNT_TOTAL_MISMATCH', 'Accounts must sum exactly to the order')
    const paymentIds = new Set()
    for (const payment of order.payments) {
      id(payment.payment_id, 'payment_id'); cents(payment.amount_cents, 'amount_cents', false)
      if (!ids.has(payment.account_id) || paymentIds.has(payment.payment_id) || !['pending', 'unknown', 'accepted', 'rejected'].includes(payment.status) || !['cash', 'external'].includes(payment.method)) fail('INVALID_FINANCIAL_SNAPSHOT', 'Invalid payment')
      paymentIds.add(payment.payment_id)
      if (payment.method === 'external') id(payment.provider, 'provider')
      if (payment.status !== 'pending') requireEvidence(payment, payment.status, payment.evidence, order.currency)
    }
    return summarize(order)
  }

  prepare(payload, { order: operationalOrder, turno, actor } = {}) {
    const type = payload.command_type
    if (!COMMANDS.has(type)) fail('UNKNOWN_FINANCIAL_COMMAND', 'Unsupported financial command')
    revision(payload.expected_revision)
    const orderId = id(payload.order_id, 'order_id')
    const existing = this.getOrder(orderId)
    // Match operational ownership, including new command IDs for repeated
    // payments. A waiter cannot freeze or split another employee's account.
    // Authentication and the command permission are enforced by the runtime.
    if (actor && operationalOrder?.created_by !== actor.id && !actor.permissions?.includes('ver_todas_cuentas')) {
      fail('PERMISSION_DENIED', 'No tienes permiso para modificar la cuenta de otro empleado')
    }
    if (type === 'FINANCIAL_OPEN') {
      if (existing) fail('FINANCIAL_ORDER_EXISTS', 'Order already has durable accounts; reload them')
      if (!operationalOrder || operationalOrder.order_id !== orderId && operationalOrder.id !== orderId) fail('ORDER_NOT_FOUND', 'Save the operational order before opening accounts')
      if (!turno?.id || payload.turno_id !== turno.id || operationalOrder.turno_id !== turno.id) fail('TURNO_MISMATCH', 'Order and account must belong to the current shift')
      if (['cancelada', 'cerrada', 'pagada'].includes(operationalOrder.status)) fail('ORDER_NOT_OPEN', 'Order is no longer open for payment')
      if (revision(payload.expected_revision) !== 0) fail('FINANCIAL_REVISION_CONFLICT', 'New accounts require revision zero')
      if (!Number.isSafeInteger(operationalOrder.order_revision) || operationalOrder.order_revision < 0) {
        fail('ORDER_REVISION_REQUIRED', 'Caja must confirm the saved order revision before collecting')
      }
      const orderRevision = operationalOrder.order_revision
      if (cents(payload.expected_order_revision, 'expected_order_revision') !== orderRevision) fail('ORDER_REVISION_CONFLICT', 'Order changed; reload before payment')
      const total = moneyFromOrder(operationalOrder)
      if (cents(payload.total_cents, 'total_cents', false) !== total) fail('ORDER_TOTAL_CONFLICT', 'Payment total differs from saved order')
      if (payload.currency !== 'MXN') fail('INVALID_CURRENCY', 'Only MXN is supported')
      requireSentConsumption(operationalOrder)
      return { financial_order: summarize({
        order_id: orderId, turno_id: turno.id, currency: 'MXN', revision: 1, order_revision: orderRevision,
        total_cents: total, ...(actor ? { opened_by: actor.id } : {}), accounts: [{ account_id: id(`${orderId}:full`, 'account_id'), total_cents: total }], payments: [],
      }) }
    }
    if (!existing) fail('FINANCIAL_ORDER_NOT_FOUND', 'Open and persist all accounts before collecting money')
    if (!turno?.id || existing.turno_id !== turno.id) fail('TURNO_MISMATCH', 'Payment belongs to a different shift')
    if (type === 'FINANCIAL_PAYMENT_START') {
      id(payload.payment_id, 'payment_id'); id(payload.account_id, 'account_id'); cents(payload.amount_cents, 'amount_cents', false)
      const repeated = existing.payments.find(p => p.payment_id === payload.payment_id)
      if (repeated) {
        if (repeated.account_id !== payload.account_id || repeated.amount_cents !== payload.amount_cents || repeated.method !== payload.method || (repeated.provider || null) !== (payload.provider || null)) fail('PAYMENT_ID_REUSED', 'Payment identity has different content')
        return { financial_order: existing, repeated_payment: true }
      }
      // payment_id is unique across mother orders, not merely inside one account.
      if (this.getOrders().some(o => o.payments.some(p => p.payment_id === payload.payment_id))) fail('PAYMENT_ID_REUSED', 'Payment belongs to another order')
    }
    if (type === 'FINANCIAL_PAYMENT_RESULT') {
      id(payload.payment_id, 'payment_id')
      if (!['accepted', 'rejected', 'unknown'].includes(payload.status)) fail('INVALID_PAYMENT_STATUS', 'Expected accepted, rejected or unknown')
      const repeated = existing.payments.find(p => p.payment_id === payload.payment_id)
      if (!repeated) fail('PAYMENT_NOT_FOUND', 'Reserve a payment attempt before recording its result')
      requireEvidence(repeated, payload.status, payload.evidence, existing.currency)
      if (repeated.status === payload.status && equal(repeated.evidence, payload.evidence)) return { financial_order: existing, repeated_payment: true }
      if (payload.status === 'accepted' && repeated.method === 'external' && this.getOrders().some(o => o.payments.some(p =>
        p.payment_id !== payload.payment_id && p.status === 'accepted' && p.provider === repeated.provider && p.evidence?.reference === payload.evidence.reference
      ))) fail('PROVIDER_REFERENCE_REUSED', 'This provider authorization already paid another attempt')
    }
    if (revision(payload.expected_revision) !== existing.revision) fail('FINANCIAL_REVISION_CONFLICT', 'Account changed; reload its balance before continuing')
    const next = clone(existing)
    if (type === 'FINANCIAL_SPLIT') {
      if (next.payments.length) fail('SPLIT_HAS_PAYMENTS', 'Define all accounts before the first payment attempt')
      if (!Array.isArray(payload.accounts) || payload.accounts.length < 2 || payload.accounts.length > 100) fail('INVALID_SPLIT', 'Split needs 2 to 100 accounts')
      const ids = new Set(); let sum = 0
      next.accounts = payload.accounts.map(account => {
        const accountId = id(account.account_id, 'account_id')
        if (ids.has(accountId)) fail('INVALID_SPLIT', 'Split account identities must be unique')
        ids.add(accountId)
        const amount = cents(account.total_cents, 'account.total_cents', false); sum = add(sum, amount)
        return { account_id: accountId, total_cents: amount, ...(account.label ? { label: String(account.label).slice(0, 200) } : {}) }
      })
      if (sum !== next.total_cents) fail('ACCOUNT_TOTAL_MISMATCH', 'Every cent must belong to exactly one account')
    } else if (type === 'FINANCIAL_PAYMENT_START') {
      const account = next.accounts.find(a => a.account_id === payload.account_id)
      if (!account) fail('ACCOUNT_NOT_FOUND', 'Account does not belong to this order')
      if (!['cash', 'external'].includes(payload.method)) fail('INVALID_PAYMENT_METHOD', 'Expected cash or external')
      if (payload.method === 'external') id(payload.provider, 'provider')
      if (payload.amount_cents > account.balance_cents - account.reserved_cents) fail('OVERPAYMENT', 'Amount exceeds the unreserved account balance')
      next.payments.push({ payment_id: payload.payment_id, account_id: payload.account_id, amount_cents: payload.amount_cents, method: payload.method, status: 'pending', ...(actor ? { created_by: actor.id } : {}), ...(payload.method === 'external' ? { provider: payload.provider } : {}) })
    } else if (type === 'FINANCIAL_PAYMENT_RESULT') {
      id(payload.payment_id, 'payment_id')
      const payment = next.payments.find(p => p.payment_id === payload.payment_id)
      if (!payment) fail('PAYMENT_NOT_FOUND', 'Reserve a payment attempt before recording its result')
      if (!['accepted', 'rejected', 'unknown'].includes(payload.status)) fail('INVALID_PAYMENT_STATUS', 'Expected accepted, rejected or unknown')
      if (!RESERVING.has(payment.status)) fail('PAYMENT_FINAL', 'Final payment results cannot be overwritten')
      requireEvidence(payment, payload.status, payload.evidence, next.currency)
      payment.status = payload.status
      if (actor) payment.resolved_by = actor.id
      payment.evidence = clone(payload.evidence)
      if (payment.method === 'cash' && payload.status === 'accepted') payment.change_cents = payment.evidence.received_cents - payment.amount_cents
    }
    next.revision = add(next.revision, 1)
    summarize(next)
    // This durable transition is exclusively financial. It emits no ORDER_CLOSED.
    if (next.status === 'settled' && !next.settled_at) next.settled_at = new Date().toISOString()
    return { financial_order: next }
  }
}
module.exports = { FinancialDomain, FinancialError, FINANCIAL_COMMANDS: COMMANDS }
