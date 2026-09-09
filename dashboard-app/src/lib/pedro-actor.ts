import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'

const KEY = 'pos_actor_session'
export interface SesionDeCaja {
  staff: { id: string; name: string; role: string }
  actor_token: string
  expires_at: number
  offline: boolean
  shiftToken?: string
}
/** A UI cache is convenience only. Caja verifies signature, scope, expiry and
 * revocation for every command; no browser role is an authorization. */
export function actorDeCaja(): SesionDeCaja | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return session?.staff?.id && typeof session.actor_token === 'string' && session.expires_at > Date.now() ? session : null
  } catch { return null }
}
export function cerrarActorDeCaja(): void {
  try { sessionStorage.removeItem(KEY) } catch {}
}
async function solicitarSesionCaja(pin: string, minRole?: string): Promise<SesionDeCaja> {
  const res = await localNetworkFetch(`${getBridgeUrl()}/auth/pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, ...(minRole ? { min_role: minRole } : {}) }),
    signal: AbortSignal.timeout(6000),
  })
  const data = await res.json()
  if (!res.ok || !data.staff?.id || typeof data.actor_token !== 'string' || !(data.expires_at > Date.now())) {
    throw Object.assign(new Error(data.error || 'Caja no confirmó la sesión'), { code: data.code, status: res.status })
  }
  return data
}
export async function ingresarConPinEnCaja(pin: string, minRole?: string): Promise<SesionDeCaja> {
  const session = await solicitarSesionCaja(pin, minRole)
  if (!minRole) sessionStorage.setItem(KEY, JSON.stringify(session))
  return session
}
/** An approval belongs to the immediate command only. It does not replace the
 * operator, enter browser storage, or authorize by a role supplied by the UI.
 * Caja checks the signer's canonical permission on the command itself. */
export async function autorizarOperacionConPinEnCaja(pin: string): Promise<SesionDeCaja> {
  return solicitarSesionCaja(pin)
}
