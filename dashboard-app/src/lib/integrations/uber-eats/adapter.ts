// UberEatsAdapter v1.0.0 — canonical entry point for all order lifecycle operations.
// Every function: retries with backoff, logs to integration_audit_log (redacted).
// Type A operations (affect Uber state externally) → callers must use RecoverableOperation.
//
// Token strategy (per Uber's grant type model):
//   provisioning (authorization_code / USL) — accept_pos_order, ready_for_pickup
//   marketplace  (client_credentials, eats.order) — getOrderDetails, deny, cancel

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'
import {
  toLegacyCancelPayload,
  toLegacyDenyPayload,
  type UberDenyReason,
  type UberCancelReason,
} from './reasons'

export const ADAPTER_VERSION = '1.0.0'

export async function getOrderDetails(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; order?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      // Uber "Basic Production validation" spec: GET /v2/eats/order/{id} (singular).
      () => uberFetch(`/v2/eats/order/${orderId}`, { method: 'GET', tokenType: 'marketplace' }),
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
      () => uberFetch(`/v1/eats/orders/${orderId}/accept_pos_order`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Accepted by Fullsite POS',
          pickup_time: Math.floor(Date.now() / 1000) + minutesToReady * 60,
        }),
        tokenType: 'provisioning',
        storeId,
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
        body: JSON.stringify(toLegacyDenyPayload(reason)),
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
        body: JSON.stringify(toLegacyCancelPayload(reason)),
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
      () => uberFetch(`/v1/eats/orders/${orderId}/ready_for_pickup`, {
        method: 'POST',
        body: JSON.stringify({}),
        tokenType: 'provisioning',
        storeId,
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
