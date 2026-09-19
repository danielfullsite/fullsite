/** Read-only reporting contract. A payment is money only after `accepted`.
 * Preparation/status never settles money. Amounts are safe integer cents;
 * tips are separate from the sale. Invalid or incomplete data is unavailable,
 * never an empty/zero report. Shared by local Corte and cloud projections. */
export class ReporteCajaNoDisponible extends Error {
  constructor(message = 'Los datos de Caja no están completos para calcular el reporte.') { super(message) }
}
type Row = Record<string, unknown>
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReporteCajaNoDisponible()
  return value as Row
}
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new ReporteCajaNoDisponible()
  return value
}
export function centavosReporte(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new ReporteCajaNoDisponible()
  return value
}
const add = (a: number, b: number) => centavosReporte(a + b)
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new ReporteCajaNoDisponible()
  return value
}
export interface PagoReportado {
  id: string; accountId: string; sale: number; tip: number; method: 'cash' | 'card' | 'transfer' | 'external'
  status: 'accepted' | 'pending' | 'unknown' | 'rejected'; acceptedAt: string | null
}
export interface FinanzasReportadas {
  orderId: string; turnoId: string; revision: number; total: number; paid: number; reserved: number; balance: number
  tips: number; reservedTips: number; settled: boolean; payments: PagoReportado[]
}
export function validarFinanzasReporte(value: unknown): FinanzasReportadas {
  const row = object(value)
  const orderId = id(row.order_id), turnoId = id(row.turno_id)
  const revision = centavosReporte(row.revision), total = centavosReporte(row.total_cents)
  if (!revision || !total || row.currency !== 'MXN') throw new ReporteCajaNoDisponible()
  const accounts = new Map<string, Row>()
  let accountTotal = 0
  for (const entry of list(row.accounts)) {
    const account = object(entry), key = id(account.account_id), amount = centavosReporte(account.total_cents)
    if (accounts.has(key)) throw new ReporteCajaNoDisponible()
    accounts.set(key, account); accountTotal = add(accountTotal, amount)
  }
  if (accountTotal !== total) throw new ReporteCajaNoDisponible()
  const ids = new Set<string>()
  const payments = list(row.payments).map(entry => {
    const payment = object(entry), key = id(payment.payment_id), accountId = id(payment.account_id)
    const sale = centavosReporte(payment.amount_cents), tip = centavosReporte(payment.tip_cents ?? 0)
    if (ids.has(key) || !accounts.has(accountId) || !sale || !['accepted', 'pending', 'unknown', 'rejected'].includes(String(payment.status))) throw new ReporteCajaNoDisponible()
    ids.add(key)
    let method: PagoReportado['method']
    if (payment.method === 'cash') method = 'cash'
    else if (payment.method === 'external') method = 'external'
    else if (payment.method === 'manual' && ['card', 'transfer'].includes(String(payment.tender))) method = payment.tender as 'card' | 'transfer'
    else throw new ReporteCajaNoDisponible()
    const acceptedAt = payment.accepted_at == null ? null : id(payment.accepted_at)
    if (acceptedAt && !Number.isFinite(Date.parse(acceptedAt))) throw new ReporteCajaNoDisponible()
    return { id: key, accountId, sale, tip, method, status: payment.status as PagoReportado['status'], acceptedAt }
  })
  let paid = 0, reserved = 0, tips = 0, reservedTips = 0
  for (const [accountId, account] of accounts) {
    let accountPaid = 0, accountReserved = 0
    for (const payment of payments.filter(p => p.accountId === accountId)) {
      if (payment.status === 'accepted') { accountPaid = add(accountPaid, payment.sale); tips = add(tips, payment.tip) }
      if (payment.status === 'pending' || payment.status === 'unknown') { accountReserved = add(accountReserved, payment.sale); reservedTips = add(reservedTips, payment.tip) }
    }
    const balance = centavosReporte(account.total_cents) - accountPaid
    if (balance < accountReserved || account.paid_cents !== accountPaid || account.reserved_cents !== accountReserved || account.balance_cents !== balance) throw new ReporteCajaNoDisponible()
    paid = add(paid, accountPaid); reserved = add(reserved, accountReserved)
  }
  const balance = total - paid, settled = balance === 0
  if (row.paid_cents !== paid || row.reserved_cents !== reserved || row.balance_cents !== balance || row.status !== (settled ? 'settled' : 'open') ||
      (row.tip_cents !== undefined && row.tip_cents !== tips) || (row.reserved_tip_cents !== undefined && row.reserved_tip_cents !== reservedTips)) throw new ReporteCajaNoDisponible()
  return { orderId, turnoId, revision, total, paid, reserved, balance, tips, reservedTips, settled, payments }
}
export interface TurnoReportado { id: string; openedAt: string; opening: number; closedAt: string | null; counted: number | null; difference: number | null }
export interface CorteCaja {
  turno: TurnoReportado | null; turnos: TurnoReportado[]; sequence: number
  sales: number; tips: number; cash: number; card: number; transfer: number; external: number
  reserved: number; reservedTips: number; balance: number; expectedCash: number | null
  ordersWithPayments: number; settledOrders: number; kitchenPending: number
  orders: FinanzasReportadas[]
  cashDeposits: number; cashWithdrawals: number
}
function turnoReportado(value: unknown, closed: boolean): TurnoReportado {
  const row = object(value), openedAt = id(row.opened_at), closedAt = closed ? id(row.closed_at) : null
  if (!Number.isFinite(Date.parse(openedAt)) || closedAt && !Number.isFinite(Date.parse(closedAt))) throw new ReporteCajaNoDisponible()
  const counted = closed ? centavosReporte(row.counted_cash_cents) : null
  const difference = closed ? row.difference_cents : null
  if (closed && (typeof difference !== 'number' || !Number.isSafeInteger(difference))) throw new ReporteCajaNoDisponible()
  return { id: id(row.id), openedAt, opening: centavosReporte(row.opening_cash_cents), closedAt, counted, difference: difference as number | null }
}
export function construirCorteCaja(value: unknown, selectedTurno?: string): CorteCaja {
  const state = object(value)
  if (state.authoritative !== true || state.write_authority !== 'caja' || state.order_snapshot_complete !== true) throw new ReporteCajaNoDisponible('Sin conexión confirmada con Caja. El corte no está disponible.')
  if (state.cash_ledger_version !== 1) throw new ReporteCajaNoDisponible('Actualiza Caja y las terminales para confirmar el historial de efectivo del corte.')
  const sequence = centavosReporte(state.sequence)
  const turnos = list(state.turn_summaries).map(t => turnoReportado(t, true))
  if (state.turno !== null) turnos.push(turnoReportado(state.turno, false))
  if (new Set(turnos.map(t => t.id)).size !== turnos.length) throw new ReporteCajaNoDisponible()
  const turno = selectedTurno ? turnos.find(t => t.id === selectedTurno) : turnos.find(t => !t.closedAt) ?? turnos.at(-1)
  if (selectedTurno && !turno) throw new ReporteCajaNoDisponible('El turno seleccionado no está disponible en Caja.')
  const all = list(state.financial_orders).map(validarFinanzasReporte)
  if (new Set(all.map(o => o.orderId)).size !== all.length || new Set(all.flatMap(o => o.payments.map(p => p.id))).size !== all.reduce((n, o) => n + o.payments.length, 0)) throw new ReporteCajaNoDisponible()
  const orders = turno ? all.filter(o => o.turnoId === turno.id) : []
  const report: CorteCaja = { turno: turno ?? null, turnos, sequence, orders, sales: 0, tips: 0, cash: 0, card: 0, transfer: 0, external: 0,
    reserved: 0, reservedTips: 0, balance: 0, expectedCash: turno?.opening ?? null, ordersWithPayments: 0, settledOrders: 0, kitchenPending: 0,
    cashDeposits: 0, cashWithdrawals: 0 }
  const movementIds = new Set<string>()
  for (const value of list(state.cash_movements)) {
    const movement = object(value), movementId = id(movement.movement_id)
    if (movementIds.has(movementId) || !['deposito', 'retiro'].includes(String(movement.type))) throw new ReporteCajaNoDisponible()
    movementIds.add(movementId)
    const amount = centavosReporte(movement.amount_cents)
    if (!amount) throw new ReporteCajaNoDisponible()
    if (id(movement.turno_id) === turno?.id) {
      if (movement.type === 'deposito') report.cashDeposits = add(report.cashDeposits, amount)
      else report.cashWithdrawals = add(report.cashWithdrawals, amount)
    }
  }
  for (const order of orders) {
    report.sales = add(report.sales, order.paid); report.tips = add(report.tips, order.tips)
    report.reserved = add(report.reserved, order.reserved); report.reservedTips = add(report.reservedTips, order.reservedTips); report.balance = add(report.balance, order.balance)
    if (order.paid > 0) report.ordersWithPayments++
    if (order.settled) report.settledOrders++
    for (const payment of order.payments.filter(p => p.status === 'accepted')) report[payment.method] = add(report[payment.method], add(payment.sale, payment.tip))
  }
  for (const entry of list(state.salon_orders)) {
    const order = object(entry)
    if (order.turno_id === turno?.id && !all.some(fin => fin.orderId === (order.order_id ?? order.id))) report.balance = add(report.balance, centavosReporte(order.total_cents))
  }
  report.kitchenPending = list(state.kds_orders).filter(entry => object(entry).turno_id === turno?.id).length
  if (turno) report.expectedCash = centavosReporte(add(add(turno.opening, report.cash), report.cashDeposits) - report.cashWithdrawals)
  return report
}
