/**
 * Recibos de aprobación OFFLINE firmados por la Caja — lado del servidor (bloque POS, 2026-09-24).
 *
 * La Caja (electron-app/local-server/core/recibo-offline.js) firma, sin red, un recibo con una
 * llave de SU terminal. La llave no viaja nunca en claro por la red salvo una vez, a una sesión
 * de gerente, por /api/pos/terminal-receipt-key; aquí se RE-DERIVA con la raíz del servidor:
 *
 *   K(cid, tid) = HMAC-SHA256(OFFLINE_RECEIPT_ROOT, 'recibo:<kid>|<cid>|<tid>')
 *
 * Así un recibo es una prueba verificable, no una afirmación: ya no basta con mandar
 * `offline_approved: true` para que el servidor acepte una cancelación hecha sin internet.
 *
 * Falla cerrado: sin raíz (o mal formada) ningún recibo verifica; quien consume decide si eso
 * cae al camino legacy (bandera de rollout) o se rechaza (POS_APPROVAL_STRICT).
 */
import { createHmac, timingSafeEqual } from 'crypto'

const PREFIJO = 'rcb1'
const RAIZ_VALIDA = /^[0-9a-fA-F]{64}$/
const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, 'dueño': 5 }

export interface ClaimsDeRecibo {
  v: 1; kid: string; cid: string; tid: string; req: string; sub: string; nam?: string; rol: string; iat: number; exp: number; non: string
}

export function esRecibo(token: unknown): token is string {
  return typeof token === 'string' && token.startsWith(PREFIJO + '.')
}

function raiz(): Buffer | null {
  const r = (process.env.OFFLINE_RECEIPT_ROOT ?? '').trim()
  return RAIZ_VALIDA.test(r) ? Buffer.from(r, 'hex') : null
}

/** Llave de recibos de una terminal. null si el servidor no tiene raíz configurada. */
export function derivarLlaveDeTerminal(clientId: string, terminalId: string, kid = 'v1'): string | null {
  const r = raiz()
  if (!r) return null
  return createHmac('sha256', r).update(`recibo:${kid}|${clientId}|${terminalId}`).digest('hex')
}

export type VeredictoDeRecibo =
  | { ok: true; claims: ClaimsDeRecibo }
  | { ok: false; error: 'RECIBO_NO_VERIFICABLE' | 'RECIBO_INVALIDO' | 'RECIBO_VENCIDO' | 'TERMINAL_DISTINTA' }

export function verificarRecibo(token: string, opts: { clientId: string; minLevel: number; terminalSolicitante?: string; now?: number }): VeredictoDeRecibo {
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== PREFIJO || token.length > 4096) return { ok: false, error: 'RECIBO_INVALIDO' }
  let c: ClaimsDeRecibo
  try { c = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) } catch { return { ok: false, error: 'RECIBO_INVALIDO' } }
  if (!c || c.v !== 1 || typeof c.cid !== 'string' || typeof c.tid !== 'string' || typeof c.sub !== 'string' ||
    typeof c.non !== 'string' || typeof c.kid !== 'string' || !Number.isFinite(c.iat) || !Number.isFinite(c.exp)) {
    return { ok: false, error: 'RECIBO_INVALIDO' }
  }
  const llave = derivarLlaveDeTerminal(c.cid, c.tid, c.kid)
  if (!llave) return { ok: false, error: 'RECIBO_NO_VERIFICABLE' }
  const esperada = createHmac('sha256', Buffer.from(llave, 'hex')).update(`${PREFIJO}.${partes[1]}`).digest()
  const recibida = Buffer.from(partes[2], 'base64url')
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return { ok: false, error: 'RECIBO_INVALIDO' }
  // Firma buena: ahora el contenido. El tenant y el rol salen del recibo FIRMADO, nunca del cuerpo.
  if (c.cid !== opts.clientId || (ROLE_LVL[c.rol] || 0) < opts.minLevel) return { ok: false, error: 'RECIBO_INVALIDO' }
  const now = opts.now ?? Date.now()
  if (c.exp <= now || c.iat > now + 5 * 60_000) return { ok: false, error: 'RECIBO_VENCIDO' }
  // La aprobación se dio frente a UNA terminal (`req`): no se usa desde otra.
  if (c.req && opts.terminalSolicitante && c.req !== opts.terminalSolicitante) return { ok: false, error: 'TERMINAL_DISTINTA' }
  return { ok: true, claims: c }
}
