// UberOrderAdapter factory — routes order lifecycle operations to the correct
// adapter based on the webhook payload's channel field.
//
//   EatsLegacyAdapter  → /v1/eats/orders/{id}/...        (Eats Marketplace)
//   DeliveryV1Adapter  → /v1/delivery/order/{id}/...     (Delivery API)
//
// Channel detection priority:
//   1. payload.channel field ('eats' | 'delivery')
//   2. payload.event_type prefix ('delivery.' prefix → delivery)
//   3. Default: 'eats' (backward compatible with all existing webhooks)
//
// Both adapters implement OrderAdapter. All Eats legacy routes are kept intact
// until Uber confirms which combination passes Basic Production Validation.

import {
  getOrderDetails as eatsGetOrderDetails,
  acceptOrder as eatsAcceptOrder,
  denyOrder as eatsDenyOrder,
  cancelOrder as eatsCancelOrder,
  markOrderReady as eatsMarkOrderReady,
} from './adapter'

import {
  getDeliveryOrderDetails,
  acceptDeliveryOrder,
  denyDeliveryOrder,
  cancelDeliveryOrder,
  markDeliveryOrderReady,
} from './delivery-adapter'

import type { UberDenyReason, UberCancelReason } from './reasons'

export type UberChannel = 'eats' | 'delivery' | 'unknown'

export interface OrderAdapter {
  readonly channel: UberChannel
  getOrderDetails(orderId: string, correlationId: string, storeId?: string): Promise<{ ok: boolean; order?: unknown; error?: string }>
  // minutesToReady only applies to the Eats channel; Delivery adapter ignores it
  acceptOrder(orderId: string, correlationId: string, storeId?: string, minutesToReady?: number): Promise<{ ok: boolean; error?: string }>
  denyOrder(orderId: string, reason: UberDenyReason, correlationId: string, storeId?: string): Promise<{ ok: boolean; error?: string }>
  cancelOrder(orderId: string, reason: UberCancelReason, correlationId: string, storeId?: string): Promise<{ ok: boolean; error?: string }>
  markOrderReady(orderId: string, correlationId: string, storeId?: string): Promise<{ ok: boolean; error?: string }>
}

/** Inspect the webhook payload to determine which API channel the order belongs to. */
export function detectChannel(payload: Record<string, unknown>): UberChannel {
  const channel = ((payload.channel ?? '') as string).toLowerCase()
  if (channel === 'delivery') return 'delivery'
  if (channel === 'eats') return 'eats'

  const eventType = ((payload.event_type ?? payload.type ?? '') as string).toLowerCase()
  if (eventType.startsWith('delivery.')) return 'delivery'

  return 'eats'
}

function makeEatsAdapter(): OrderAdapter {
  return {
    channel: 'eats',
    getOrderDetails: (orderId, correlationId, storeId) =>
      eatsGetOrderDetails(orderId, correlationId, storeId),
    // eatsAcceptOrder takes minutesToReady as 3rd positional arg; default to 20
    acceptOrder: (orderId, correlationId, storeId) =>
      eatsAcceptOrder(orderId, correlationId, 20, storeId),
    denyOrder: (orderId, reason, correlationId, storeId) =>
      eatsDenyOrder(orderId, reason, correlationId, storeId),
    cancelOrder: (orderId, reason, correlationId, storeId) =>
      eatsCancelOrder(orderId, reason, correlationId, storeId),
    markOrderReady: (orderId, correlationId, storeId) =>
      eatsMarkOrderReady(orderId, correlationId, storeId),
  }
}

function makeDeliveryAdapter(): OrderAdapter {
  return {
    channel: 'delivery',
    getOrderDetails: (orderId, correlationId, storeId) =>
      getDeliveryOrderDetails(orderId, correlationId, storeId),
    acceptOrder: (orderId, correlationId, storeId) =>
      acceptDeliveryOrder(orderId, correlationId, storeId),
    denyOrder: (orderId, reason, correlationId, storeId) =>
      denyDeliveryOrder(orderId, reason, correlationId, storeId),
    cancelOrder: (orderId, reason, correlationId, storeId) =>
      cancelDeliveryOrder(orderId, reason, correlationId, storeId),
    markOrderReady: (orderId, correlationId, storeId) =>
      markDeliveryOrderReady(orderId, correlationId, storeId),
  }
}

/** Return the canonical order adapter for an explicit channel. */
export function getOrderAdapter(channel: UberChannel): OrderAdapter {
  return channel === 'delivery' ? makeDeliveryAdapter() : makeEatsAdapter()
}

/** Detect channel from the webhook payload, then return the correct adapter. */
export function getOrderAdapterForPayload(payload: Record<string, unknown>): OrderAdapter {
  return getOrderAdapter(detectChannel(payload))
}
