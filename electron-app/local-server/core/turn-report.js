'use strict'
// One calculation for the non-mutating X report and the durable Z close.
// Preparation is deliberately absent: accepted money includes partial payments
// and orders still in the kitchen. Pending/unknown attempts are not receipts.
function cents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_REPORT_AMOUNT')
  return value
}
function sum(a,b) { return cents(a+cents(b)) }
function turnReport(turno, financialOrders, salonOrders = []) {
  if (!turno?.id || !Array.isArray(financialOrders)) throw new Error('TURN_REPORT_UNAVAILABLE')
  const result = { turno_id: turno.id, opening_cash_cents: cents(turno.opening_cash_cents),
    cash_sales_cents: 0, total_paid_cents: 0, reserved_cents: 0, balance_cents: 0,
    settled_orders: 0, open_orders: 0, unprepared_orders: 0, payments_by_method: {} }
  const ids = new Set()
  for (const order of financialOrders.filter(o => o.turno_id === turno.id)) {
    if (!Array.isArray(order.payments)) throw new Error('TURN_REPORT_UNAVAILABLE')
    let paid = 0, reserved = 0
    for (const payment of order.payments) {
      if (!payment.payment_id || ids.has(payment.payment_id)) throw new Error('DUPLICATE_REPORT_PAYMENT')
      ids.add(payment.payment_id)
      cents(payment.amount_cents)
      if (payment.status === 'accepted') {
        if (!['cash','external'].includes(payment.method)) throw new Error('INVALID_REPORT_METHOD')
        paid = sum(paid,payment.amount_cents)
        result.total_paid_cents = sum(result.total_paid_cents,payment.amount_cents)
        if (payment.method === 'cash') result.cash_sales_cents = sum(result.cash_sales_cents,payment.amount_cents)
        const key = payment.method === 'cash' ? 'cash' : `external:${payment.provider || 'unknown'}`
        result.payments_by_method[key] = sum(result.payments_by_method[key] || 0,payment.amount_cents)
      } else if (['pending','unknown'].includes(payment.status)) reserved = sum(reserved,payment.amount_cents)
      else if (payment.status !== 'rejected') throw new Error('INVALID_REPORT_PAYMENT_STATUS')
    }
    const balance = cents(cents(order.total_cents)-paid)
    if (paid!==order.paid_cents || reserved!==order.reserved_cents || balance!==order.balance_cents || reserved>balance) throw new Error('REPORT_PAYMENT_MISMATCH')
    result.balance_cents = sum(result.balance_cents,balance)
    result.reserved_cents = sum(result.reserved_cents,reserved)
    result[balance === 0 ? 'settled_orders' : 'open_orders']++
  }
  const prepared = new Set(financialOrders.map(o => o.order_id))
  for (const order of salonOrders.filter(o => o.turno_id === turno.id && !prepared.has(o.order_id || o.id))) {
    result.balance_cents = sum(result.balance_cents,order.total_cents)
    result.open_orders++; result.unprepared_orders++
  }
  result.expected_cash_cents = sum(result.opening_cash_cents,result.cash_sales_cents)
  return result
}
module.exports = { turnReport }
