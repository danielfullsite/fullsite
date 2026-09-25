/**
 * F4 de docs/security/PLAN-PIN-HASH.md — de quién es la AUTORIDAD sobre un PIN (bloque POS,
 * 2026-09-24).
 *
 * Hasta F4, tres lectores buscaban a la persona por el PIN en claro (`pos_staff?pin=eq.<pin>`):
 * /api/pos/pin (V1), /api/pos/time-clock (V2) y pinTaken de /api/owner/staff (V3). Aquí vive la
 * única búsqueda, con una bandera:
 *
 *   POS_PIN_AUTHORITY=plain  (default)  busca por `pin`, como siempre.
 *   POS_PIN_AUTHORITY=hash              busca por `pin_hash` = HMAC(pimienta, client_id:pin).
 *                                       NUNCA cae a `pin`: un fallback reabriría el texto plano
 *                                       y escondería un backfill roto.
 *   cualquier otro valor                falla CERRADO (503): una bandera mal escrita no puede
 *                                       decidir en silencio a quién se deja entrar.
 *
 * Falla cerrado también ante ESTADO INCIERTO: en modo hash, si en el restaurante hay alguien
 * ACTIVO sin `pin_hash` (o con otra versión de pimienta), el backfill no terminó y un «no
 * encontrado» podría ser mentira. Se responde «no disponible» (503) — no «PIN incorrecto»
 * (401), que la Caja interpretaría como revocación y borraría la credencial de esa persona.
 *
 * Nunca registra ni devuelve el PIN ni el hash.
 */
import { hashPinParaBD, VERSION_DE_PIMIENTA, esPimientaNoConfigurada } from './pos-pin-hash'

export type ModoAutoridadPin = 'plain' | 'hash' | 'invalido'

export function modoAutoridadPin(): ModoAutoridadPin {
  const v = (process.env.POS_PIN_AUTHORITY ?? '').trim()
  if (v === '' || v === 'plain') return 'plain'
  if (v === 'hash') return 'hash'
  return 'invalido'
}

export type Busqueda<T> =
  | { tipo: 'encontrado'; fila: T }
  | { tipo: 'no-encontrado' }
  | { tipo: 'no-disponible'; motivo: 'modo_invalido' | 'sin_pimienta' | 'backfill_incompleto' | 'base_no_disponible' }

/** Cobertura del backfill por restaurante; se recuerda sólo el SÍ, 60 s. Un NO se re-pregunta. */
const coberturaOk = new Map<string, number>()
const COBERTURA_TTL_MS = 60_000

export function _olvidarCobertura(): void { coberturaOk.clear() }

async function coberturaCompleta(sbUrl: string, H: Record<string, string>, clientId: string): Promise<boolean | null> {
  const t = coberturaOk.get(clientId)
  if (t && Date.now() - t < COBERTURA_TTL_MS) return true
  try {
    // Alguien ACTIVO sin hash, o con un hash de otra versión de pimienta.
    const r = await fetch(
      `${sbUrl}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true` +
      `&or=(pin_hash.is.null,pin_hash_v.is.null,pin_hash_v.neq.${VERSION_DE_PIMIENTA})&select=id&limit=1`,
      { headers: H, cache: 'no-store', signal: AbortSignal.timeout(4000) },
    )
    if (!r.ok) return null
    const filas = await r.json().catch(() => null)
    if (!Array.isArray(filas)) return null
    if (filas.length === 0) { coberturaOk.set(clientId, Date.now()); return true }
    return false
  } catch { return null }
}

/**
 * Busca a la persona de `clientId` cuyo PIN es `pin`.
 *
 * @param filtro  query adicional ya codificada (p. ej. `&active=eq.true&role=in.(…)`).
 * @param select  columnas a traer (nunca pin/pin_hash).
 */
export async function buscarPorPin<T>(opts: {
  sbUrl: string; sbKey: string; clientId: string; pin: string; filtro?: string; select: string
}): Promise<Busqueda<T>> {
  const modo = modoAutoridadPin()
  if (modo === 'invalido') return { tipo: 'no-disponible', motivo: 'modo_invalido' }
  const H = { apikey: opts.sbKey, Authorization: `Bearer ${opts.sbKey}` }
  let condicion: string
  if (modo === 'plain') {
    condicion = `pin=eq.${encodeURIComponent(opts.pin)}`
  } else {
    let hash: string
    try { hash = await hashPinParaBD(opts.clientId, opts.pin) }
    catch (e) {
      if (esPimientaNoConfigurada(e)) return { tipo: 'no-disponible', motivo: 'sin_pimienta' }
      throw e
    }
    const cobertura = await coberturaCompleta(opts.sbUrl, H, opts.clientId)
    if (cobertura === null) return { tipo: 'no-disponible', motivo: 'base_no_disponible' }
    if (cobertura === false) return { tipo: 'no-disponible', motivo: 'backfill_incompleto' }
    condicion = `pin_hash=eq.${hash}&pin_hash_v=eq.${VERSION_DE_PIMIENTA}`
  }
  try {
    const r = await fetch(
      `${opts.sbUrl}/rest/v1/pos_staff?${condicion}&client_id=eq.${encodeURIComponent(opts.clientId)}${opts.filtro ?? ''}&select=${opts.select}&limit=1`,
      { headers: H, cache: 'no-store' },
    )
    if (!r.ok) return { tipo: 'no-disponible', motivo: 'base_no_disponible' }
    const filas = await r.json().catch(() => null)
    if (!Array.isArray(filas)) return { tipo: 'no-disponible', motivo: 'base_no_disponible' }
    return filas.length > 0 ? { tipo: 'encontrado', fila: filas[0] as T } : { tipo: 'no-encontrado' }
  } catch {
    return { tipo: 'no-disponible', motivo: 'base_no_disponible' }
  }
}

/**
 * ¿Los PINs de emergencia de entorno (POS_FALLBACK_PIN, MANAGER_PINS) pueden decidir?
 * Son PINs en CLARO en una variable: con la autoridad en hash, dejarlos vivos mantendría
 * un PIN en texto plano como autoridad. Sólo en modo `plain`.
 */
export function fallbacksDeEntornoPermitidos(): boolean {
  return modoAutoridadPin() === 'plain'
}
