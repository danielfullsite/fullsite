// UberEatsAdapter — canonical entry point for all order lifecycle operations.
// Every function: retries with backoff, logs to integration_audit_log (redacted).
// Type A operations (affect Uber state externally) → callers must use RecoverableOperation.
//
// Token strategy (verified against developer.uber.com, 2026-08-06):
//   ALL order lifecycle endpoints use client_credentials:
//     accept_pos_order / deny_pos_order / cancel  → eats.order
//     GET /v2/eats/order/{id}                     → eats.order OR eats.store.orders.read
//   The USL (provisioning) token is only for integration-activation flows —
//   the previous use of it for accept/ready was the audit's PARTIAL finding #3.
//
// markOrderReady: /v1/eats/orders/{id}/ready_for_pickup no longer appears in
// Uber's public reference (sandbox returns "404 page not found"). Kept as the
// legacy path until Uber confirms the current endpoint — BLOCKED_EXTERNAL,
// see docs/integrations/uber-eats/VALIDATION-READINESS.md (question Q3).

import { uberFetch, SCOPE_ORDER } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'
import type { UberDenyReason, UberCancelReason } from './reasons'

export const ADAPTER_VERSION = '1.1.0'

export async function getOrderDetails(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; order?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      // v2 is the current active version (v1 GET is legacy). Note singular 'order'.
      () => uberFetch(`/v2/eats/order/${encodeURIComponent(orderId)}`, { method: 'GET', tokenType: 'marketplace' }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    if (!r.ok) {
      const err = await r.text()
      await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.get_details', request: { order_id: orderId }, response: { error: err }, status_code: r.status, duration_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const order = await r.json()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.get_details', request: { order_id: orderId }, response: { id: orderId, status: (order as { status?: string }).status }, status_code: r.status, duration_ms: Date.now() - t0 })
    return { ok: true, order }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function acceptOrder(
  orderId: string,
  correlationId: string,
  minutesToReady = 20,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      // eats.order via client_credentials — NOT the USL token (audit finding #3).
      () => uberFetch(`/v1/eats/orders/${orderId}/accept_pos_order`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Accepted by Fullsite POS', minutes_to_ready: minutesToReady }),
        tokenType: 'marketplace',
        scope: SCOPE_ORDER,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.accept', request: { order_id: orderId, minutes_to_ready: minutesToReady }, response: errText ? { error: errText } : { status: 'accepted' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function denyOrder(
  orderId: string,
  reason: UberDenyReason,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/orders/${orderId}/deny_pos_order`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        tokenType: 'marketplace',
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.deny', request: { order_id: orderId, reason }, response: errText ? { error: errText } : { status: 'denied' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function cancelOrder(
  orderId: string,
  reason: UberCancelReason,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/eats/orders/${orderId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        tokenType: 'marketplace',
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.cancel', request: { order_id: orderId, reason }, response: errText ? { error: errText } : { status: 'cancelled' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function markOrderReady(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      // LEGACY PATH — BLOCKED_EXTERNAL: not in current public reference; kept
      // until Uber confirms the replacement (see VALIDATION-READINESS.md Q3).
      () => uberFetch(`/v1/eats/orders/${orderId}/ready_for_pickup`, {
        method: 'POST',
        body: JSON.stringify({}),
        tokenType: 'marketplace',
        scope: SCOPE_ORDER,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.ready', request: { order_id: orderId }, response: errText ? { error: errText } : { status: 'ready' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
