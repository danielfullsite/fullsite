'use strict'
// Caja owns the drawer ledger. A movement records an explicitly verified cash
// deposit/withdrawal; it neither charges a sale nor triggers a physical drawer.
const { OperationalError } = require('./operational-domain-error')
const fail = (code, message) => { throw new OperationalError(code, message) }
const cents = (value, positive = false) => {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail('INVALID_CASH_MOVEMENT', 'El importe debe ser centavos enteros válidos')
  return value
}
const add = (a, b) => cents(a + b)
function summarizeCash(turno, finances, movements) {
  const opening = cents(turno.opening_cash_cents ?? 0)
  let cashSales = 0, cashTips = 0, deposits = 0, withdrawals = 0
  for (const order of finances.filter(o => o.turno_id === turno.id)) for (const payment of order.payments) {
    if (payment.status === 'accepted' && payment.method === 'cash') {
      cashSales = add(cashSales, cents(payment.amount_cents, true))
      cashTips = add(cashTips, cents(payment.tip_cents ?? 0))
    }
  }
  const seen = new Set()
  for (const movement of movements) {
    if (!movement || typeof movement.movement_id !== 'string' || !movement.movement_id || seen.has(movement.movement_id) ||
      !['deposito', 'retiro'].includes(movement.type)) fail('INVALID_CASH_LEDGER', 'El historial de efectivo no está confirmado')
    seen.add(movement.movement_id)
    if (movement.turno_id !== turno.id) continue
    if (movement.type === 'deposito') deposits = add(deposits, cents(movement.amount_cents, true))
    else withdrawals = add(withdrawals, cents(movement.amount_cents, true))
  }
  const available = add(add(add(opening, cashSales), cashTips), deposits)
  if (withdrawals > available) fail('INVALID_CASH_LEDGER', 'Las salidas superan el efectivo registrado')
  return { opening_cash_cents: opening, cash_sales_cents: cashSales, cash_tip_cents: cashTips,
    cash_deposits_cents: deposits, cash_withdrawals_cents: withdrawals, expected_cash_cents: available - withdrawals }
}
function prepareCashMovement(payload, { state, actor, now }) {
  const turno = state.getTurno()
  if (!turno || turno.id !== payload.turno_id) fail('TURNO_MISMATCH', 'El movimiento debe pertenecer al turno abierto')
  if (Object.keys(payload).some(key => !['command_type', 'command_id', 'turno_id', 'movement_id', 'type', 'amount_cents', 'reason', 'restaurant_id', 'client_id', 'location_id'].includes(key))) fail('INVALID_CASH_MOVEMENT', 'Caja asigna el autor y el saldo del movimiento')
  if (typeof payload.movement_id !== 'string' || !payload.movement_id.trim() || payload.movement_id.length > 200 ||
    !['retiro', 'deposito'].includes(payload.type) || typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 1000) fail('INVALID_CASH_MOVEMENT', 'Indica el tipo y motivo del movimiento')
  const amount = cents(payload.amount_cents, true)
  const movements = state.getCashMovements()
  const existing = movements.find(m => m.movement_id === payload.movement_id)
  if (existing) {
    if (existing.turno_id !== turno.id || existing.type !== payload.type || existing.amount_cents !== amount || existing.reason !== payload.reason.trim()) fail('CASH_MOVEMENT_ID_CONFLICT', 'Este movimiento ya identifica otra operación')
    return { cash_movement: existing, cash_summary: summarizeCash(turno, state.getFinancialOrders(), movements), repeated_movement: true }
  }
  const before = summarizeCash(turno, state.getFinancialOrders(), movements)
  if (payload.type === 'retiro' && amount > before.expected_cash_cents) fail('INSUFFICIENT_DRAWER_CASH', 'El retiro supera el efectivo registrado en el cajón')
  const movement = { movement_id: payload.movement_id, turno_id: turno.id, type: payload.type, amount_cents: amount,
    reason: payload.reason.trim(), actor: actor.id, approved_by: actor.id, created_at: now }
  return { cash_movement: movement, cash_summary: summarizeCash(turno, state.getFinancialOrders(), [...movements, movement]) }
}
module.exports = { summarizeCash, prepareCashMovement }
