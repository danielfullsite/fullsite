// Uber Delivery V1 Adapter — order lifecycle operations via the Delivery API.
// Parallel to EatsLegacyAdapter (adapter.ts); same interface, different URL paths.
//
//   GET  /v1/delivery/order/{id}         — fetch order details
//   POST /v1/delivery/order/{id}/accept  — accept order
//   POST /v1/delivery/order/{id}/deny    — deny order
//   POST /v1/delivery/order/{id}/cancel  — cancel order
//   POST /v1/delivery/order/{id}/ready   — mark ready for pickup
//
// All operations use the stored USL token (storeId param routes to
// getStoredTokenForStore in uberFetch). eats.pos_provisioning is the approved
// scope for Delivery API order operations during Basic Production Validation.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'
import type { UberDenyReason, UberCancelReason } from './reasons'

export const DELIVERY_ADAPTER_VERSION = '1.0.0'

export async function getDeliveryOrderDetails(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; order?: unknown; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}`, { method: 'GET', storeId }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    if (!r.ok) {
      const err = await r.text()
      await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.get_details', request: { order_id: orderId }, response: { error: err }, status_code: r.status, duration_ms: Date.now() - t0 })
      return { ok: false, error: err }
    }
    const order = await r.json()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.get_details', request: { order_id: orderId }, response: { id: orderId, status: (order as { status?: string }).status }, status_code: r.status, duration_ms: Date.now() - t0 })
    return { ok: true, order }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function acceptDeliveryOrder(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}/accept`, {
        method: 'POST',
        body: JSON.stringify({}),
        storeId,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.accept', request: { order_id: orderId }, response: errText ? { error: errText } : { status: 'accepted' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function denyDeliveryOrder(
  orderId: string,
  reason: UberDenyReason,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}/deny`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        storeId,
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.deny', request: { order_id: orderId, reason }, response: errText ? { error: errText } : { status: 'denied' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function cancelDeliveryOrder(
  orderId: string,
  reason: UberCancelReason,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        storeId,
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.cancel', request: { order_id: orderId, reason }, response: errText ? { error: errText } : { status: 'cancelled' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function markDeliveryOrderReady(
  orderId: string,
  correlationId: string,
  storeId?: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}/ready`, {
        method: 'POST',
        body: JSON.stringify({}),
        storeId,
      }),
      { maxAttempts: 3, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'delivery.order.ready', request: { order_id: orderId }, response: errText ? { error: errText } : { status: 'ready' }, status_code: r.status, duration_ms: Date.now() - t0 })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
