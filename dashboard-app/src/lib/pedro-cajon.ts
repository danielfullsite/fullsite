import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { comandoPendienteCaja, ejecutarComandoCaja } from './pedro-comandos'
import type { SesionDeCaja } from './pedro-actor'
import type { ImpresionInciertaCaja } from './pedro-impresion'

export interface AperturaDeCaja { operation_id: string; kind: 'payment' | 'manual'; turno_id: string; order_id?: string; payment_id?: string; reason: string; job_id: string; printer_id: string }
export async function leerAperturasCaja(): Promise<AperturaDeCaja[]> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
  const state = await response.json()
  if (!response.ok || state.authoritative !== true || state.write_authority !== 'caja' || !Array.isArray(state.drawer_operations)) throw new Error('Caja no confirmó las solicitudes del cajón.')
  return state.drawer_operations
}
function validarApertura(result: Record<string, unknown>, command: Readonly<Record<string, unknown>>) {
  const opening = result.drawer_operation as AperturaDeCaja | undefined
  if (!opening || opening.operation_id !== command.command_id || opening.turno_id !== command.turno_id ||
    !opening.job_id || !opening.printer_id || (command.command_type === 'PAYMENT_DRAWER_OPEN'
      ? opening.kind !== 'payment' || opening.order_id !== command.order_id || opening.payment_id !== command.payment_id
      : opening.kind !== 'manual' || opening.reason !== command.reason)) throw new Error('Apertura sin confirmar')
}
function validarResolucion(result: Record<string, unknown>, command: Readonly<Record<string, unknown>>) {
  const resolution = result.drawer_resolution as Record<string, unknown> | undefined
  if (!resolution || resolution.job_id !== command.job_id || resolution.uncertain_episode_id !== command.uncertain_episode_id ||
    resolution.resolution !== command.resolution || resolution.reason !== command.reason) throw new Error('Verificación del cajón sin confirmar')
}
export function abrirCajonPorPagoCaja(orderId: string, paymentId: string, turnoId: string) {
  return ejecutarComandoCaja(`drawer-payment:${orderId}:${paymentId}`, 'PAYMENT_DRAWER_OPEN', {
    order_id: orderId, payment_id: paymentId, turno_id: turnoId,
  }, { validateResult: validarApertura })
}
export function abrirCajonManualCaja(turnoId: string, reason: string, actor: SesionDeCaja) {
  if (!reason.trim()) throw new Error('Escribe el motivo de la apertura.')
  return ejecutarComandoCaja(`drawer-manual:${turnoId}`, 'DRAWER_OPEN', { turno_id: turnoId, reason: reason.trim() }, { actor, validateResult: validarApertura })
}
export function resolverCajonCaja(job: ImpresionInciertaCaja, resolution: 'opened' | 'retry_pulse', reason: string, actor: SesionDeCaja) {
  if (!reason.trim()) throw new Error('Describe qué verificaste en el cajón.')
  return ejecutarComandoCaja(`drawer-resolve:${job.job_id}:${job.uncertain_episode_id}`, 'DRAWER_UNCERTAIN_RESOLVE', {
    job_id: job.job_id, uncertain_episode_id: job.uncertain_episode_id, resolution, reason: reason.trim(),
  }, { actor, validateResult: validarResolucion })
}
export function recuperarCajonCaja(operation: string, actor?: SesionDeCaja) {
  const command = comandoPendienteCaja(operation)
  const expected = command?.command_type === 'PAYMENT_DRAWER_OPEN' ? `drawer-payment:${command.order_id}:${command.payment_id}`
    : command?.command_type === 'DRAWER_OPEN' ? `drawer-manual:${command.turno_id}`
      : command?.command_type === 'DRAWER_UNCERTAIN_RESOLVE' ? `drawer-resolve:${command.job_id}:${command.uncertain_episode_id}` : null
  if (!command || operation !== expected) throw new Error('No hay una solicitud pendiente del cajón.')
  return ejecutarComandoCaja(operation, command.command_type, command, { ...(actor ? { actor } : {}),
    validateResult: command.command_type === 'DRAWER_UNCERTAIN_RESOLVE' ? validarResolucion : validarApertura })
}
