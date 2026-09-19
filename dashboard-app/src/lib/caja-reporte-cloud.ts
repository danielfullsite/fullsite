import { ReporteCajaNoDisponible, validarFinanzasReporte } from './caja-reportes'
import { fmtDateMX } from './date-mx'

export interface OrdenParaReporte {
  id?: string; turno_id?: string; mesa: number; mesero: string; personas: number
  total: number; subtotal: number; iva: number; descuento: number; propina: number
  metodo_pago: string; pagos: { metodo: string; monto: number }[] | null
  items: { nombre: string; precio: number; cantidad: number }[] | null
  status: string; created_at: string
  payment_status?: string | null; caja_stream_id?: string | null; caja_financial_snapshot?: unknown; financial_revision?: number
  report_date_basis?: 'payment' | 'order_legacy'; report_caja?: boolean
}
/** Adapt validated committed money to the existing dashboard aggregation, without
 * changing preparation/status. One order/day, even with split or partial payments.
 * Legacy orders keep their existing contract. Product detail is left unavailable
 * for partial money: payments do not identify which dishes have been paid. */
export function proyectarOrdenReporte(row: OrdenParaReporte): OrdenParaReporte[] {
  if (!row.caja_stream_id && !row.caja_financial_snapshot) return row.status === 'cerrada' ? [row] : []
  if (!row.caja_financial_snapshot) {
    if (row.payment_status === 'pagada' || Number(row.financial_revision) > 0) throw new ReporteCajaNoDisponible('La nube todavía no tiene la confirmación financiera completa de Caja.')
    return []
  }
  const finance = validarFinanzasReporte(row.caja_financial_snapshot)
  if (finance.orderId !== row.id || finance.turnoId !== row.turno_id ||
      row.payment_status !== (finance.settled ? 'pagada' : 'pendiente') ||
      (row.financial_revision != null && row.financial_revision !== finance.revision) ||
      !Number.isFinite(Number(row.total)) || Math.abs(Number(row.total) * 100 - finance.total) > 1e-7) throw new ReporteCajaNoDisponible('El detalle de orden y pago de Caja todavía no coincide en la nube.')
  const accepted = finance.payments.filter(p => p.status === 'accepted')
  const groups = new Map<string, { timestamp: string; legacy: boolean; sale: number; tip: number; pagos: { metodo: string; monto: number }[] }>()
  for (const payment of accepted) {
    const timestamp = payment.acceptedAt ?? row.created_at
    if (!Number.isFinite(Date.parse(timestamp))) throw new ReporteCajaNoDisponible('No se pudo confirmar la fecha de un pago.')
    const date = fmtDateMX(new Date(timestamp))
    const group = groups.get(date) ?? { timestamp, legacy: false, sale: 0, tip: 0, pagos: [] }
    group.legacy ||= !payment.acceptedAt
    group.sale += payment.sale; group.tip += payment.tip
    if (!Number.isSafeInteger(group.sale) || !Number.isSafeInteger(group.tip)) throw new ReporteCajaNoDisponible()
    const label = { cash: 'Efectivo', card: 'Tarjeta registrada', transfer: 'Transferencia registrada', external: 'Proveedor externo' }[payment.method]
    group.pagos.push({ metodo: label, monto: (payment.sale + payment.tip) / 100 })
    groups.set(date, group)
  }
  return [...groups.values()].map(group => ({ ...row, total: group.sale / 100,
    subtotal: 0, iva: 0, descuento: 0, propina: group.tip / 100, pagos: group.pagos,
    // This is a report timestamp, never a mutation of the saved order.
    created_at: group.timestamp, report_date_basis: group.legacy ? 'order_legacy' : 'payment', report_caja: true,
    // No item/payment allocation exists yet; reporting all dishes on each
    // partial payment would duplicate quantities and overstate food sales.
    items: null,
  }))
}
