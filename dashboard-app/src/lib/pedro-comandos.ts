import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { actorDeCaja, type SesionDeCaja } from './pedro-actor'

export class ErrorDeCaja extends Error {
  constructor(message: string, readonly code: string, readonly incierto = false) { super(message) }
}
type Command = Record<string, unknown> & { command_id: string; command_type: string }
export interface ReciboDeCaja {
  command_id: string
  result: Record<string, unknown>
  duplicate: boolean
  recovered: boolean
  command: Readonly<Command>
}

function claveDeIntento(operation: string): string {
  return `pos_comando_pendiente:${JSON.stringify([getBridgeUrl(), localStorage.getItem('fullsite_client_id'),
    localStorage.getItem('FULLSITE_LOCATION_ID'), localStorage.getItem('FULLSITE_TERMINAL_ID'), operation])}`
}

export function comandoPendienteCaja(operation: string): Readonly<Command> | null {
  try { const value = localStorage.getItem(claveDeIntento(operation)); return value ? JSON.parse(value) : null } catch { return null }
}

export function operacionesConsumoPendientesCaja(): Array<{ operation: string; command: Readonly<Command> }> {
  const pending: Array<{ operation: string; command: Readonly<Command> }> = []
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('pos_comando_pendiente:')) continue
    try {
      const scope = JSON.parse(key.slice('pos_comando_pendiente:'.length))
      const operation = scope.at(-1)
      if (typeof operation !== 'string' || key !== claveDeIntento(operation)) continue
      const command = comandoPendienteCaja(operation)
      if (command && typeof command.order_id === 'string' &&
        ((command.command_type === 'ORDER_SAVE' && operation === `save:${command.order_id}`) ||
         (command.command_type === 'ORDER_SEND' && operation === `send:${command.order_id}`))) pending.push({ operation, command })
    } catch {}
  }
  return pending
}
function actualizarIntentosCaja() {
  // Rendering notifications are best effort; the persisted journal remains the
  // authority even when no browser event target is available.
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event('pos:comandos-pendientes'))
}

/** This is a retry journal, never an order/payment replica. Persist the immutable
 * command before sending; a lost ACK is retried with the same ID and body after
 * reload. Only Caja's durable receipt confirms success. No cloud fallback. */
export async function ejecutarComandoCaja(operation: string, type: string, fields: Record<string, unknown>, options?: { actor?: SesionDeCaja; validateResult?: (result: Record<string, unknown>, command: Readonly<Command>) => void }): Promise<ReciboDeCaja> {
  // A manager approval applies only to this call. It never changes the active
  // employee or enters the durable retry journal; Caja verifies it on every try.
  const actor = options?.actor ?? actorDeCaja()
  if (!actor?.staff?.id || typeof actor.actor_token !== 'string' || !(actor.expires_at > Date.now())) throw new ErrorDeCaja('Ingresa con PIN para confirmar la operación en Caja.', 'ACTOR_REQUIRED')
  const key = claveDeIntento(operation)
  let command: Command
  let recovered = false
  try {
    const saved = localStorage.getItem(key)
    recovered = saved !== null
    command = saved ? JSON.parse(saved) : { ...fields, command_id: crypto.randomUUID(), command_type: type }
    if (command.command_type !== type || typeof command.command_id !== 'string') throw new Error('Invalid retry')
    localStorage.setItem(key, JSON.stringify(command))
  } catch { throw new ErrorDeCaja('No se pudo conservar la operación. Revisa el almacenamiento de esta terminal.', 'RETRY_STORAGE_UNAVAILABLE') }
  actualizarIntentosCaja()
  let response: Response
  let body: { results?: Array<Record<string, unknown>>; error?: string }
  try {
    response = await localNetworkFetch(`${getBridgeUrl()}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fullsite-actor': actor.actor_token },
      body: JSON.stringify(command), signal: AbortSignal.timeout(6000),
    })
    body = await response.json()
  } catch {
    throw new ErrorDeCaja('Caja no confirmó la operación. Vuelve a intentar para recuperar su resultado; conservamos el mismo intento.', 'ACK_UNKNOWN', true)
  }
  const receipt = body.results?.length === 1 ? body.results[0] : undefined
  if (receipt?.error && typeof receipt.code === 'string') {
    localStorage.removeItem(key)
    actualizarIntentosCaja()
    throw new ErrorDeCaja(String(receipt.error), receipt.code)
  }
  const event = receipt?.event as { command_id?: string; payload?: { command_id?: string }; result?: Record<string, unknown> } | undefined
  const durableReceipt = receipt?.receipt as { command_id?: string; sequence?: number } | undefined
  const confirmedId = event?.command_id ?? event?.payload?.command_id ?? durableReceipt?.command_id
  const result = (receipt?.result ?? event?.result) as Record<string, unknown> | undefined
  if (!response.ok || (!event && !(receipt?.duplicate === true && Number.isSafeInteger(durableReceipt?.sequence))) || confirmedId !== command.command_id || !result || receipt?.error) {
    throw new ErrorDeCaja('No se recibió una confirmación válida de Caja. Conservamos el intento para verificarlo al reconectar.', 'ACK_UNKNOWN', true)
  }
  try { options?.validateResult?.(result, command) } catch {
    throw new ErrorDeCaja('Caja no confirmó el resultado completo. Conservamos el intento para verificarlo al reconectar.', 'ACK_UNKNOWN', true)
  }
  localStorage.removeItem(key)
  actualizarIntentosCaja()
  return { command_id: command.command_id, result, duplicate: receipt?.duplicate === true, recovered, command }
}
