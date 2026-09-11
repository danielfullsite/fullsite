import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { actorDeCaja } from './pedro-actor'
export interface ReporteDeTurno {
  turno_id: string; opening_cash_cents: number; cash_sales_cents: number; total_paid_cents: number
  deposits_cents: number; withdrawals_cents: number; expected_cash_cents: number; reserved_cents: number; balance_cents: number
  settled_orders: number; open_orders: number; payments_by_method: Record<string, number>
}
export async function leerReporteCaja(turnoId?: string, approvalToken?: string): Promise<{
  report: ReporteDeTurno; closed: boolean; close: { counted_cash_cents: number; difference_cents: number } | null
}> {
  const token = approvalToken || actorDeCaja()?.actor_token
  if (!token) throw new Error('Inicia sesión en Caja para consultar el corte.')
  const response = await localNetworkFetch(`${getBridgeUrl()}/reports/turn${turnoId ? `?turno_id=${encodeURIComponent(turnoId)}` : ''}`, {
    headers: { 'x-fullsite-actor': token }, cache: 'no-store', signal: AbortSignal.timeout(5000),
  })
  const body = await response.json()
  if (!response.ok || body.authoritative !== true || !body.report?.turno_id) throw new Error(body.error || 'Caja no confirmó el reporte.')
  for (const key of ['opening_cash_cents','cash_sales_cents','total_paid_cents','expected_cash_cents','deposits_cents','withdrawals_cents','reserved_cents','balance_cents']) {
    if (!Number.isSafeInteger(body.report[key]) || body.report[key]<0) throw new Error('Caja devolvió importes sin confirmar.')
  }
  return body
}
