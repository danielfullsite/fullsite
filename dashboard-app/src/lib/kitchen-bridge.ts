// ── Envío a cocina (bridge local → Pedro) ────────────────────────────────────
//
// POR QUE EXISTE ESTE MODULO
//
// Antes, la comanda se mandaba con un `retryFetch(...).catch(() => {})` que
// devolvia `Promise<void>` y estaba documentado como "NUNCA rechaza
// (best-effort)". Reintentaba 4 veces y, si las cuatro fallaban, se rendia en
// silencio: quien llamaba no podia saber el resultado ni queriendo.
//
// En la CAJA ese envio es redundante — Pedro corre en la misma maquina y el KDS
// ademas consulta Supabase. En un POS SECUNDARIO (rol 'pos', p.ej. Entrada) es
// el UNICO camino a la cocina: su pagina https postea a su Pedro local en
// 127.0.0.1:7717 y ese Pedro reenvia a la caja. Un mecanismo best-effort quedo
// cargando peso estructural, y no se noto porque solo se probo donde es
// redundante.
//
// Campo AMALAY 2026-08-30: Entrada guardaba la orden en Supabase pero la comanda
// no imprimia ni salia en el KDS, sin un solo mensaje al mesero. Verificado ese
// mismo dia que la cadena Entrada -> Pedro local -> caja SI funciona cuando
// alguien hace el POST (orden de diagnostico mesa 999 llego a la caja).
//
// QUE GARANTIZA ESTE MODULO
//   - Un solo punto de envio, esperable con await.
//   - Valida `response.ok` — un 4xx/5xx cuenta como fallo, no como exito.
//   - Registra url, status y error de cada intento con un prefijo estable.
//   - Devuelve un resultado tipado; NUNCA lanza. El que llama decide que mostrar.
//   - Presupuesto de tiempo acotado: un POS no puede quedarse colgado.
//
// NO cambia el contrato de /events ni toca a Pedro (ver
// docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4).

import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'

/** Presupuesto total del envio. Mas alla de esto el mesero se queda esperando. */
const DEADLINE_MS = 6_000
/** Timeout de cada intento individual. */
const ATTEMPT_TIMEOUT_MS = 2_500
/** Backoff entre intentos (ms). La longitud define el numero maximo de reintentos. */
const BACKOFF_MS = [300, 700, 1_200]

export interface KitchenAttempt {
  attempt: number
  status: number | null
  error: string | null
}

export type KitchenSendResult =
  | { ok: true; url: string; attempts: KitchenAttempt[] }
  | { ok: false; url: string; attempts: KitchenAttempt[]; reason: 'network' | 'http' | 'deadline' }

const LOG = '[cocina]'

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

/**
 * Manda un comando a la cocina por el bridge local y ESPERA la confirmacion.
 *
 * Nunca lanza: devuelve un resultado tipado para que el call site decida si
 * bloquea al mesero. Un fallo aqui significa que la comanda NO esta en cocina,
 * aunque la orden si se haya guardado.
 */
export async function sendOrderToKitchen(
  payload: Record<string, unknown>,
  opts: { deadlineMs?: number; now?: () => number } = {},
): Promise<KitchenSendResult> {
  const url = `${getBridgeUrl()}/events`
  // navigator.onLine=false can mean WAN is down while the restaurant LAN still
  // works. Keep one short attempt so Entrada can reach Caja locally, but do not
  // burn the full retry budget when the cable/LAN is gone too.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const backoffs = offline ? [] : BACKOFF_MS
  const attemptTimeoutMs = offline ? 800 : ATTEMPT_TIMEOUT_MS
  const now = opts.now ?? (() => Date.now())
  const deadline = now() + (opts.deadlineMs ?? DEADLINE_MS)
  const attempts: KitchenAttempt[] = []

  for (let i = 0; i <= backoffs.length; i++) {
    if (now() >= deadline) {
      console.warn(`${LOG} sin tiempo — la comanda NO llego a cocina`, { url, attempts })
      return { ok: false, url, attempts, reason: 'deadline' }
    }

    let status: number | null = null
    let error: string | null = null

    try {
      const res = await localNetworkFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(attemptTimeoutMs),
      })
      status = res.status
      if (res.ok) {
        attempts.push({ attempt: i, status, error: null })
        if (i > 0) console.warn(`${LOG} confirmada tras ${i + 1} intentos`, { url })
        return { ok: true, url, attempts }
      }
      error = `HTTP ${res.status}`
    } catch (e) {
      error = describe(e)
    }

    attempts.push({ attempt: i, status, error })
    console.warn(`${LOG} intento ${i + 1} fallo`, { url, status, error })

    const backoff = backoffs[i]
    if (backoff == null) break
    const remaining = deadline - now()
    if (remaining <= 0) break
    await new Promise((r) => setTimeout(r, Math.min(backoff, remaining)))
  }

  const last = attempts[attempts.length - 1]
  const reason: 'network' | 'http' = last && last.status != null ? 'http' : 'network'
  console.error(`${LOG} la comanda NO llego a cocina`, { url, reason, attempts })
  return { ok: false, url, attempts, reason }
}

/** Mensaje para el mesero. Dice que pasó y qué hacer — no un código de error. */
export function kitchenFailureMessage(r: Extract<KitchenSendResult, { ok: false }>): string {
  const base = 'La orden se guardó, pero NO llegó a cocina'
  if (r.reason === 'network') return `${base} — no hay conexión con la caja. Avisa a cocina.`
  if (r.reason === 'deadline') return `${base} — la caja no respondió a tiempo. Avisa a cocina.`
  const status = r.attempts[r.attempts.length - 1]?.status
  return `${base} — la caja respondió ${status ?? 'error'}. Avisa a cocina.`
}
