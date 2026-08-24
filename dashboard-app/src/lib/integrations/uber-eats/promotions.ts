// Uber Eats — Promotions: create a store promotion.
//
// Contract: Uber Eats Marketplace Promotions API.
//
//   POST /v1/delivery/stores/{store_id}/promotion
//
// All calls log to integration_audit_log with redacted payloads.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

const promotionsPath = (storeId: string): string =>
  (process.env.UBER_PROMOTIONS_PATH || '/v1/delivery/stores/{store_id}/promotion')
    .trim()
    .replace('{store_id}', encodeURIComponent(storeId))

const promotionsScope = (): string =>
  (process.env.UBER_PROMOTIONS_SCOPE || 'eats.store.promotion.write').trim()

export interface UberPromotion {
  start_time: string
  end_time: string
  external_promotion_id: string
  user_group: 'ALL_CUSTOMERS' | 'FIRST_TIME_CUSTOMER'
  allow_unlimited_apply: boolean
  currency_code: string
  budget: { unlimited_budget: boolean }
  promo_type: 'FLATOFF'
  promotion_discount: {
    flat_off_discount: {
      min_basket_constraint: { min_spend: { amount: number } }
      discount_value: { amount: number }
    }
  }
  [k: string]: unknown
}

/** A minimal, schedule-bounded promotion for certification testing. */
export function buildSamplePromotion(): UberPromotion {
  const start = new Date()
  const end = new Date(Date.now() + 7 * 86400000)
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    external_promotion_id: `fullsite-cert-${Date.now()}`,
    user_group: 'ALL_CUSTOMERS',
    allow_unlimited_apply: true,
    currency_code: 'MXN',
    budget: { unlimited_budget: true },
    promo_type: 'FLATOFF',
    promotion_discount: {
      flat_off_discount: {
        min_basket_constraint: { min_spend: { amount: 10000 } },
        discount_value: { amount: 1000 },
      },
    },
  }
}

export async function createPromotion(
  storeId: string,
  promo: UberPromotion,
  correlationId: string
): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(promotionsPath(storeId), {
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
      request: { store_id: storeId, promo_type: promo.promo_type, external_promotion_id: promo.external_promotion_id },
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
