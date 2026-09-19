import { ejecutarComandoCaja } from './pedro-comandos'
import { autorizarOperacionConPinEnCaja } from './pedro-actor'
export interface MovimientoDeCaja {
  movement_id: string; turno_id: string; type: 'retiro' | 'deposito'; amount_cents: number
  reason: string; actor: string; approved_by: string; created_at: string
}
/** The journal saves immutable intent before sending. PIN approval is ephemeral;
 * the same uncertain movement is recovered before any new intent is accepted. */
export async function registrarMovimientoCaja(turnoId: string, type: 'retiro' | 'deposito', amount: number, reason: string, pin: string): Promise<{ movement: MovimientoDeCaja; recovered: boolean }> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !reason.trim() || reason.trim().length > 1000) throw new Error('Indica un importe positivo y el motivo del movimiento.')
  const actor = await autorizarOperacionConPinEnCaja(pin)
  const receipt = await ejecutarComandoCaja(`cash:${turnoId}`, 'CASH_MOVEMENT', {
    turno_id: turnoId, movement_id: crypto.randomUUID(), type, amount_cents: amount, reason: reason.trim(),
  }, { actor })
  const movement = receipt.result.cash_movement as MovimientoDeCaja | undefined
  if (!movement || movement.turno_id !== turnoId || !Number.isSafeInteger(movement.amount_cents) || !movement.movement_id ||
    movement.movement_id !== receipt.command.movement_id || movement.amount_cents !== receipt.command.amount_cents || movement.type !== receipt.command.type) throw new Error('Caja no confirmó el movimiento. Consulta su historial antes de registrar otro.')
  return { movement, recovered: receipt.recovered }
}
