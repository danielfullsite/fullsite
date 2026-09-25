// POS Shift Token — cryptographically signed, issued by /api/pos/pin.
// Replaces btoa(pin) PIN cache (P0-E) and provides authenticated identity
// for all POS kiosk API calls without a Supabase session (P0-N).
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
// Requires SHIFT_TOKEN_SECRET env var (≥32 chars), server-side only.
// TTL: 8 hours (one full shift). No refresh — staff re-enters PIN next shift.

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' }
const TTL_MS = 8 * 60 * 60 * 1000

export interface ShiftTokenPayload {
  sub: string   // staffId
  cid: string   // clientId
  rol: string   // role
  nam: string   // staffName
  iat: number   // issued at (unix ms)
  exp: number   // expires at (unix ms)
  /** Terminal que pidió el token (device_id). Ausente en tokens emitidos antes del 2026-09-24. */
  tid?: string
  /** Propósito. Ausente = sesión de turno. 'aprobacion' = token de aprobación de gerente. */
  pur?: 'aprobacion'
  /** Identificador único, sólo en tokens de aprobación: permite registrar su uso. */
  jti?: string
}

/**
 * Vida de un token de APROBACIÓN. Corta a propósito: antes la aprobación era el shiftToken
 * del gerente (8 h), así que una aprobación capturada autorizaba cancelaciones toda la noche.
 * No es de 2 min porque la resolución de conflictos (pos-offline-db.ts) guarda el token en la
 * cola y lo reproduce al drenar, que puede tardar unos minutos.
 */
export const APROBACION_TTL_MS = 15 * 60 * 1000

import { terminalIdValido } from './terminal-id'
export { terminalIdValido }

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.SHIFT_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SHIFT_TOKEN_SECRET must be set and ≥32 characters')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify']
  )
}

async function firmar(payload: ShiftTokenPayload): Promise<string> {
  const key = await getKey()
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const sig = await crypto.subtle.sign(ALGORITHM.name, key, data)
  return `${Buffer.from(data).toString('base64url')}.${Buffer.from(sig).toString('base64url')}`
}

export async function issueShiftToken(
  staffId: string,
  clientId: string,
  role: string,
  staffName: string,
  terminalId?: string,
): Promise<string> {
  const now = Date.now()
  const payload: ShiftTokenPayload = {
    sub: staffId,
    cid: clientId,
    rol: role,
    nam: staffName,
    iat: now,
    exp: now + TTL_MS,
  }
  if (terminalIdValido(terminalId)) payload.tid = terminalId
  return firmar(payload)
}

/**
 * Token de APROBACIÓN de gerente: distinto del de sesión, corto, con `jti` y amarrado a la
 * terminal donde se tecleó el PIN. `verifyShiftToken` lo RECHAZA como sesión — sin eso, una
 * aprobación de 15 min serviría de login.
 */
export async function issueApprovalToken(
  staffId: string,
  clientId: string,
  role: string,
  staffName: string,
  terminalId?: string,
): Promise<string> {
  const now = Date.now()
  const payload: ShiftTokenPayload = {
    sub: staffId, cid: clientId, rol: role, nam: staffName, iat: now,
    exp: now + APROBACION_TTL_MS, pur: 'aprobacion', jti: crypto.randomUUID(),
  }
  if (terminalIdValido(terminalId)) payload.tid = terminalId
  return firmar(payload)
}

/** Verifica firma y vigencia, sin mirar el propósito. Uso interno. */
async function verificarFirma(token: string): Promise<ShiftTokenPayload | null> {
  try {
    const dot = token.indexOf('.')
    if (dot < 0) return null
    const dataB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    if (!dataB64 || !sigB64) return null

    const key = await getKey()
    const data = Buffer.from(dataB64, 'base64url')
    const sig = Buffer.from(sigB64, 'base64url')
    const valid = await crypto.subtle.verify(ALGORITHM.name, key, sig, data)
    if (!valid) return null

    const payload = JSON.parse(new TextDecoder().decode(data)) as ShiftTokenPayload
    if (!payload.sub || !payload.cid || !payload.rol || !payload.exp) return null
    if (Date.now() > payload.exp) return null

    return payload
  } catch {
    return null
  }
}

/** Token de SESIÓN de turno. Un token de aprobación no es sesión: se rechaza. */
export async function verifyShiftToken(token: string): Promise<ShiftTokenPayload | null> {
  const p = await verificarFirma(token)
  if (!p || p.pur !== undefined) return null
  return p
}

/**
 * Token presentado como APROBACIÓN. Acepta el de aprobación y, por compatibilidad con
 * clientes que aún mandan el shiftToken del gerente, el de sesión. Quien consume decide si
 * el de sesión todavía vale (ver manager-approval.ts, POS_APROBACION_V2_ESTRICTA).
 */
export async function verifyApprovalCredential(token: string): Promise<ShiftTokenPayload | null> {
  const p = await verificarFirma(token)
  if (!p) return null
  if (p.pur !== undefined && p.pur !== 'aprobacion') return null
  if (p.pur === 'aprobacion' && !p.jti) return null
  return p
}
