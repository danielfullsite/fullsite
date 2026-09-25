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
/** Resultado de una APROBACIÓN de gerente por la Caja (bloque POS, 2026-09-24). */
export interface AprobacionDeCaja {
  staff: { id: string; name: string; role: string }
  offline: boolean
  /** Con red: token de aprobación de la nube (15 min, jti, terminal). */
  approvalToken?: string
  /** Sin red: recibo firmado por la Caja con la llave de su terminal (recibo-offline). */
  recibo?: string
}

/**
 * Aprobación de gerente contra la Caja. La Caja valida con la nube si hay red y, si no, con su
 * almacén SELLADO por el SO; nunca con nada del navegador. No crea sesión en la página.
 * Errores: lanza con `status` y `code` de la Caja (401/403/429/503).
 */
export async function aprobarConPinEnCaja(pin: string, minRole: string): Promise<AprobacionDeCaja> {
  const res = await localNetworkFetch(`${getBridgeUrl()}/auth/pin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, min_role: minRole, aprobacion: true }),
    signal: AbortSignal.timeout(6000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.staff?.id) {
    throw Object.assign(new Error(data.error || 'Caja no confirmó la aprobación'), { code: data.code, status: res.status })
  }
  return { staff: data.staff, offline: data.offline === true,
    approvalToken: typeof data.approvalToken === 'string' ? data.approvalToken : undefined,
    recibo: typeof data.recibo === 'string' ? data.recibo : undefined }
}

/** An approval belongs to the immediate command only. It does not replace the
 * operator, enter browser storage, or authorize by a role supplied by the UI.
 * Caja checks the signer's canonical permission on the command itself. */
export async function autorizarOperacionConPinEnCaja(pin: string): Promise<SesionDeCaja> {
  return solicitarSesionCaja(pin)
}
