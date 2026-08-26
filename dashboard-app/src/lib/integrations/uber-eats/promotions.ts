// Uber Eats — Promotions: create a store promotion.
//
// El contrato de Promotions no esta publicado en una spec descargable
// (developer.uber.com renderiza en cliente; los *.yaml dan 404). Se descubrio
// empiricamente contra el sandbox el 2026-08-26 — ver el detalle abajo:
//
//   POST /v1/delivery/stores/{store_id}/promotion   (scope eats.store.promotion.write)
//
// Ambos siguen siendo override-ables por entorno (UBER_PROMOTIONS_PATH /
// UBER_PROMOTIONS_SCOPE) por si Uber los mueve.
//
// All calls log to integration_audit_log with redacted payloads.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

// Ruta CONFIRMADA empíricamente el 2026-08-26 probando candidatos contra el
// sandbox: sólo `/v1/delivery/stores/{store_id}/promotion` existe — "stores" en
// plural, "promotion" en singular. Las otras cinco variantes devuelven 404.
// El default anterior (`/v1/eats/stores/{store_id}/promotions`) no existe.
const promotionsPath = (storeId: string): string =>
  (process.env.UBER_PROMOTIONS_PATH || '/v1/delivery/stores/{store_id}/promotion')
    .trim()
    .replace('{store_id}', encodeURIComponent(storeId))

// Scope dicho por el propio Uber al llamar la ruta correcta:
//   "This endpoint requires at least one of the following scopes:
//    eats.store.promotion.write"
// Ya no es una suposición: es la respuesta del endpoint.
const promotionsScope = (): string =>
  (process.env.UBER_PROMOTIONS_SCOPE || 'eats.store.promotion.write').trim()

export interface UberPromotion {
  title?: Record<string, string>
  /** e.g. 'BUY_ONE_GET_ONE' | 'PERCENT_OFF' | 'AMOUNT_OFF' — per Uber PromotionConfiguration. */
  offer_type?: string
  [k: string]: unknown
}

/** A minimal, schedule-bounded promotion for certification testing. */
export function buildSamplePromotion(): UberPromotion {
  const start = new Date()
  const end = new Date(Date.now() + 7 * 86400000)
  return {
    title: { en: 'Fullsite cert promo' },
    offer_type: process.env.UBER_PROMOTION_OFFER_TYPE || 'PERCENT_OFF',
    percent_off: 10,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  }
}

export async function createPromotion(
  storeId: string,
  promo: UberPromotion,
  correlationId: string,
  /**
   * Override de ruta por llamada, sólo para descubrir el contrato desde la ruta
   * sandbox. La ruta por defecto devuelve 404, y probar candidatos vía variable
   * de entorno cuesta un deploy por intento. No lo usa ningún camino productivo.
   */
  pathOverride?: string
): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
  const t0 = Date.now()
  const path = pathOverride
    ? pathOverride.trim().replace('{store_id}', encodeURIComponent(storeId))
    : promotionsPath(storeId)
  try {
    const r = await withRetry(
      () => uberFetch(path, {
        method: 'POST',
        tokenType: 'marketplace',
        scope: promotionsScope(),
        body: JSON.stringify(promo),
      }),
      { maxAttempts: 3, baseDelayMs: 800 }
    )
    const text = await r.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : undefined } catch { /* keep raw text */ }
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'promotions.create',
      request: { store_id: storeId, offer_type: promo.offer_type },
      response: r.ok ? { status: 'created' } : { error: text?.slice(0, 500) },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return { ok: r.ok, status: r.status, body: parsed, error: r.ok ? undefined : text?.slice(0, 500) }
  } catch (e) {
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'promotions.create',
      request: { store_id: storeId }, response: { error: String(e) }, duration_ms: Date.now() - t0,
    })
    return { ok: false, status: 0, error: String(e) }
  }
}
