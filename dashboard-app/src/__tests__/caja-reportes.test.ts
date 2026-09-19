import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { construirCorteCaja, validarFinanzasReporte } from '@/lib/caja-reportes'
import { proyectarOrdenReporte, type OrdenParaReporte } from '@/lib/caja-reporte-cloud'

export function financial(id = 'order', turno = 'current', paid = 3000, reserved = 2000) {
  const payments = [
    ...(paid ? [{ payment_id: `${id}-paid`, account_id: `${id}:full`, amount_cents: paid, method: 'cash', status: 'accepted', accepted_at: '2026-09-08T15:00:00Z' }] : []),
    ...(reserved ? [{ payment_id: `${id}-pending`, account_id: `${id}:full`, amount_cents: reserved, method: 'cash', status: 'unknown' }] : []),
  ]
  return { order_id: id, turno_id: turno, currency: 'MXN', revision: 3, order_revision: 2, total_cents: 10000,
    paid_cents: paid, reserved_cents: reserved, balance_cents: 10000 - paid, status: paid === 10000 ? 'settled' : 'open',
    accounts: [{ account_id: `${id}:full`, total_cents: 10000, paid_cents: paid, reserved_cents: reserved, balance_cents: 10000 - paid }], payments }
}
export function snapshot(orders = [financial()]) {
  return { authoritative: true, write_authority: 'caja', sequence: 8, order_snapshot_complete: true,
    cash_ledger_version: 1, cash_movements: [],
    financial_orders: orders, salon_orders: [], kds_orders: [],
    turno: { id: 'current', opened_at: '2026-09-08T14:00:00Z', opening_cash_cents: 50000 },
    turn_summaries: [{ id: 'prior', opened_at: '2026-09-07T14:00:00Z', closed_at: '2026-09-07T23:00:00Z', opening_cash_cents: 20000, counted_cash_cents: 30000, difference_cents: 0 }] }
}
function cloud(fin = financial(), extra: Partial<OrdenParaReporte> = {}): OrdenParaReporte {
  return { id: fin.order_id, turno_id: fin.turno_id, mesa: 2, mesero: 'Ana', personas: 2, total: 100, subtotal: 100, iva: 0,
    descuento: 0, propina: 0, metodo_pago: '', pagos: null, items: [{ nombre: 'Sopa', precio: 100, cantidad: 1 }], status: 'entregada',
    created_at: '2026-09-07T18:00:00Z', caja_stream_id: 'stream', caja_financial_snapshot: fin, financial_revision: fin.revision,
    payment_status: fin.status === 'settled' ? 'pagada' : 'pendiente', ...extra }
}
describe('authoritative Corte', () => {
  it('reads the real financial domain result for manual card, tip, and a later cash partial without reclassifying money', () => {
    const { FinancialDomain } = createRequire(import.meta.url)('../../../electron-app/local-server/core/financial-domain.js')
    const domain = new FinancialDomain()
    const context = { order: { id: 'domain', order_id: 'domain', turno_id: 'current', created_by: 'manager', order_revision: 2, total_cents: 10000, items: [{ cantidad: 1, sent_quantity: 1 }], status: 'preparando' }, turno: { id: 'current' }, actor: { id: 'manager', permissions: [] }, now: '2026-09-08T15:00:00Z' }
    const apply = (payload: Record<string, unknown>) => {
      const result = domain.prepare({ order_id: 'domain', ...payload }, context).financial_order
      domain.apply(result)
      return result
    }
    apply({ command_type: 'FINANCIAL_OPEN', expected_revision: 0, expected_order_revision: 2, total_cents: 10000, currency: 'MXN', turno_id: 'current' })
    apply({ command_type: 'FINANCIAL_PAYMENT_START', expected_revision: 1, account_id: 'domain:full', payment_id: 'card', amount_cents: 3000, tip_cents: 400, method: 'manual', tender: 'card' })
    const confirmed = apply({ command_type: 'FINANCIAL_PAYMENT_RESULT', expected_revision: 2, payment_id: 'card', status: 'accepted', evidence: { kind: 'manual_received', tender: 'card', received_by: 'manager', source: 'fixture-terminal', reference: 'fixture-reference', currency: 'MXN', amount_cents: 3400 } })
    expect(construirCorteCaja({ ...snapshot(), financial_orders: [confirmed] })).toMatchObject({ sales: 3000, tips: 400, card: 3400, cash: 0, balance: 7000 })
    apply({ command_type: 'FINANCIAL_PAYMENT_START', expected_revision: 3, account_id: 'domain:full', payment_id: 'cash', amount_cents: 2000, tip_cents: 100, method: 'cash' })
    const next = apply({ command_type: 'FINANCIAL_PAYMENT_RESULT', expected_revision: 4, payment_id: 'cash', status: 'accepted', evidence: { kind: 'cash_received', received_by: 'manager', received_cents: 2500 } })
    expect(construirCorteCaja({ ...snapshot(), financial_orders: [next] })).toMatchObject({ sales: 5000, tips: 500, card: 3400, cash: 2100, expectedCash: 52100, balance: 5000 })
  })
  it('counts only accepted money, includes partial payment, and separates reservations from balance', () => {
    const report = construirCorteCaja(snapshot())
    expect(report).toMatchObject({ sales: 3000, cash: 3000, reserved: 2000, balance: 7000, expectedCash: 53000, settledOrders: 0 })
  })
  it('cash movements alter the drawer only and zero-balance historical allocations remain reportable', () => {
    const fin = financial()
    fin.accounts.push({ account_id: 'removed-addition', total_cents: 0, paid_cents: 0, reserved_cents: 0, balance_cents: 0 })
    const cash_movements = [
      { movement_id: 'deposit', turno_id: 'current', type: 'deposito', amount_cents: 10000 },
      { movement_id: 'withdrawal', turno_id: 'current', type: 'retiro', amount_cents: 15000 },
      { movement_id: 'old', turno_id: 'prior', type: 'deposito', amount_cents: 999 },
    ]
    expect(construirCorteCaja({ ...snapshot([fin]), cash_movements })).toMatchObject({ sales: 3000, cash: 3000, cashDeposits: 10000, cashWithdrawals: 15000, expectedCash: 48000 })
    expect(() => construirCorteCaja({ ...snapshot(), cash_ledger_version: undefined })).toThrow('Actualiza Caja')
    expect(() => construirCorteCaja({ ...snapshot(), cash_movements: [cash_movements[0], cash_movements[0]] })).toThrow()
  })
  it('paid food still preparing counts as paid; delivered food with debt remains debt', () => {
    const state = { ...snapshot([financial('paid', 'current', 10000, 0), financial('delivered', 'current', 0, 0)]),
      kds_orders: [{ id: 'paid', turno_id: 'current', status: 'preparando' }], salon_orders: [{ id: 'delivered', turno_id: 'current', status: 'entregada', total_cents: 10000 }] }
    expect(construirCorteCaja(state)).toMatchObject({ sales: 10000, settledOrders: 1, balance: 10000, kitchenPending: 1 })
  })
  it('scopes money to the selected shift and keeps a closed shift readable', () => {
    const state = snapshot([financial(), financial('old', 'prior', 10000, 0)])
    expect(construirCorteCaja(state).sales).toBe(3000)
    expect(construirCorteCaja(state, 'prior')).toMatchObject({ sales: 10000, expectedCash: 30000, turno: { id: 'prior', counted: 30000 } })
    expect(() => construirCorteCaja(state, 'missing')).toThrow('turno seleccionado')
  })
  it('adds saved consumption without financial opening to debt without declaring it paid', () => {
    const state = { ...snapshot(), salon_orders: [{ id: 'not-opened', turno_id: 'current', total_cents: 700 }] }
    expect(construirCorteCaja(state)).toMatchObject({ sales: 3000, balance: 7700 })
  })
  it('rejects degraded, incomplete and internally inconsistent data rather than returning zero', () => {
    for (const extra of [{ authoritative: false }, { write_authority: 'legacy' }, { financial_orders: undefined }, { order_snapshot_complete: false }]) {
      expect(() => construirCorteCaja({ ...snapshot(), ...extra })).toThrow()
    }
    expect(() => validarFinanzasReporte({ ...financial(), paid_cents: 10000 })).toThrow()
    expect(() => construirCorteCaja(snapshot([financial(), financial()]))).toThrow()
  })
  it('keeps manual card/transfer and tips separate from sales and expected cash', () => {
    const fin = { ...financial('manual', 'current', 10000, 0), tip_cents: 1000, reserved_tip_cents: 0,
      payments: [{ payment_id: 'manual-paid', account_id: 'manual:full', amount_cents: 10000, tip_cents: 1000, method: 'manual', tender: 'card', status: 'accepted' }] }
    expect(construirCorteCaja({ ...snapshot(), financial_orders: [fin] })).toMatchObject({ sales: 10000, tips: 1000, card: 11000, cash: 0, expectedCash: 50000 })
    fin.payments[0].method = 'cash'
    expect(construirCorteCaja({ ...snapshot(), financial_orders: [fin] })).toMatchObject({ sales: 10000, tips: 1000, cash: 11000, expectedCash: 61000 })
  })
})
describe('cloud reporting projection', () => {
  it('includes partial accepted money on delivered orders without inventing a closed status', () => {
    const [row] = proyectarOrdenReporte(cloud())
    expect(row).toMatchObject({ status: 'entregada', total: 30, report_date_basis: 'payment', pagos: [{ metodo: 'Efectivo', monto: 30 }], items: null })
    expect(row.created_at).toBe('2026-09-08T15:00:00Z')
  })
  it('includes settled orders still cooking and ignores delivered orders with no accepted payment', () => {
    expect(proyectarOrdenReporte(cloud(financial('paid', 'current', 10000, 0), { status: 'preparando' }))[0].total).toBe(100)
    expect(proyectarOrdenReporte(cloud(financial('unpaid', 'current', 0, 0)))).toEqual([])
  })
  it('retains legacy closed orders and rejects paid Caja rows missing or contradicting their snapshot', () => {
    const legacy = cloud(undefined, { caja_stream_id: null, caja_financial_snapshot: null, status: 'cerrada' })
    expect(proyectarOrdenReporte(legacy)).toEqual([legacy])
    expect(() => proyectarOrdenReporte(cloud(undefined, { payment_status: 'pagada' }))).toThrow()
    expect(() => proyectarOrdenReporte(cloud(undefined, { caja_financial_snapshot: null }))).toThrow()
  })
  it('uses historical order dates only when no accepted timestamp exists and marks the fallback', () => {
    const fin = financial()
    delete (fin.payments[0] as { accepted_at?: string }).accepted_at
    expect(proyectarOrdenReporte(cloud(fin))[0]).toMatchObject({ created_at: '2026-09-07T18:00:00Z', report_date_basis: 'order_legacy' })
  })
})
