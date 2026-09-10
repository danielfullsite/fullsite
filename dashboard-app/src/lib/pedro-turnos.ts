import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { ejecutarComandoCaja } from './pedro-comandos'
export interface TurnoDeCaja { id: string; opened_at: string; opened_by: string; opening_cash_cents: number }
export interface CierreDeCaja extends TurnoDeCaja {
  closed_at: string; closed_by: string; cash_sales_cents: number; total_paid_cents: number
  expected_cash_cents: number; counted_cash_cents: number; difference_cents: number; notes?: string
}
export async function leerTurnosCaja(): Promise<{ turno: TurnoDeCaja | null; cierres: CierreDeCaja[] }> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
  const state = await response.json()
  if (!response.ok || state.authoritative !== true || state.write_authority !== 'caja' || !Array.isArray(state.turn_summaries)) throw new Error('No se pudo confirmar el turno con Caja.')
  return { turno: state.turno, cierres: state.turn_summaries }
}
export async function cerrarTurnoCaja(turnoId: string, counted: number, notes: string): Promise<CierreDeCaja> {
  const receipt = await ejecutarComandoCaja(`turn:close:${turnoId}`, 'TURN_CLOSE', { turno_id: turnoId, counted_cash_cents: counted, notes })
  const close = receipt.result.closed_turno as CierreDeCaja | undefined
  if (!close || close.id !== turnoId || !close.closed_at || !Number.isSafeInteger(close.expected_cash_cents) || !Number.isSafeInteger(close.difference_cents)) throw new Error('Caja no confirmó el resumen del cierre.')
  return close
}

export interface MovimientoDeCaja {
  id: string; turno_id: string; type: 'retiro' | 'deposito'; amount_cents: number
  reason: string; actor: string; approved_by: string; created_at: string
}
export async function registrarMovimientoCaja(turnoId: string, type: MovimientoDeCaja['type'], amount: number,
  reason: string, actor: import('./pedro-actor').SesionDeCaja): Promise<{ movement: MovimientoDeCaja; recovered: boolean }> {
  const receipt = await ejecutarComandoCaja(`cash:movement:${turnoId}`, 'CASH_MOVEMENT', {
    turno_id: turnoId, movement_id: crypto.randomUUID(), type, amount_cents: amount, reason,
  }, { actor })
  const movement = receipt.result.cash_movement as MovimientoDeCaja | undefined
  if (!movement || movement.turno_id !== turnoId || !Number.isSafeInteger(movement.amount_cents)) throw new Error('Caja no confirmó el movimiento.')
  return { movement, recovered: receipt.recovered }
}
