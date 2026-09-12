import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'

const LEASE_MS = 30_000

export class MesaLockError extends Error {
  constructor(message: string, readonly code: string, readonly incierto = false) {
    super(message)
  }
}

type Resultado = {
  error?: unknown
  code?: unknown
  duplicate?: boolean
  event?: { payload?: { command_id?: unknown } }
  receipt?: { command_id?: unknown; sequence?: unknown }
}

async function enviar(commandType: 'MESA_LOCK' | 'MESA_UNLOCK', mesa: number): Promise<void> {
  if (!Number.isInteger(mesa) || mesa <= 0) throw new MesaLockError('Mesa inválida', 'INVALID_MESA')
  const commandId = crypto.randomUUID()
  const command = {
    command_id: commandId,
    command_type: commandType,
    mesa,
    ...(commandType === 'MESA_LOCK' ? { expires_ms: Date.now() + LEASE_MS } : {}),
  }

  let response: Response
  let body: { results?: Resultado[]; error?: unknown }
  try {
    response = await localNetworkFetch(`${getBridgeUrl()}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5_000),
    })
    body = await response.json()
  } catch {
    throw new MesaLockError('Caja no confirmó el bloqueo de la mesa', 'ACK_UNKNOWN', true)
  }

  const result = body.results?.length === 1 ? body.results[0] : undefined
  if (result?.error) {
    throw new MesaLockError(String(result.error), typeof result.code === 'string' ? result.code : 'MESA_LOCK_REJECTED')
  }
  const confirmedId = result?.event?.payload?.command_id ?? result?.receipt?.command_id
  const durableDuplicate = result?.duplicate === true && Number.isSafeInteger(result.receipt?.sequence)
  if (!response.ok || confirmedId !== commandId || (!result?.event && !durableDuplicate)) {
    throw new MesaLockError('Caja no confirmó el bloqueo de la mesa', 'ACK_UNKNOWN', true)
  }
}

export function adquirirMesa(mesa: number): Promise<void> {
  return enviar('MESA_LOCK', mesa)
}

export function liberarMesa(mesa: number): Promise<void> {
  return enviar('MESA_UNLOCK', mesa)
}

export const MESA_LOCK_RENEW_MS = 10_000
