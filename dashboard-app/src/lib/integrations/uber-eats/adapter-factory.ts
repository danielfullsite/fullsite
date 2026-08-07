// UberOrderAdapter factory — routes order lifecycle operations to the correct
// adapter based on the webhook payload's channel field.
//
//   EatsLegacyAdapter        → /v1/eats/orders/{id}/...      (Order API, Previous Version)
//   OrderFulfillmentAdapter  → /v1/delivery/order/{id}/...   (current Order Fulfillment API)
//
// Channel detection priority:
//   1. payload.channel field ('eats' | 'delivery')
//   2. payload.event_type prefix ('delivery.' prefix → delivery)
//   3. Default: 'eats' (backward compatible with all existing webhooks)
//
// Reconciliation 2026-08-07: markOrderReady and resolveFulfillmentIssues are
// restaurant-canonical on the current family and route there on BOTH channels —
// the extinct ready_for_pickup and the grocery-only cart PATCH are never the
// default. accept/deny/cancel/get keep per-channel routing until Uber answers
// the generation-selection question (blocker A3).

import {
  getOrderDetails as eatsGetOrderDetails,
  acceptOrder as eatsAcceptOrder,
  denyOrder as eatsDenyOrder,
  cancelOrder as eatsCancelOrder,
} from './adapter'

import {
  getDeliveryOrderDetails,
  acceptDeliveryOrder,
  denyDeliveryOrder,
  cancelDeliveryOrder,
  markDeliveryOrderReady,
} from './delivery-adapter'

import { resolveFulfillmentIssues, type RestaurantFulfillmentIssue } from './fulfillment'
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
  resolveFulfillmentIssues(orderId: string, issues: RestaurantFulfillmentIssue[], correlationId: string): Promise<{ ok: boolean; should_wait_for_customer_response?: boolean; error?: string }>
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
    // eatsAcceptOrder takes minutesToReady as 3rd positional arg
    acceptOrder: (orderId, correlationId, storeId, minutesToReady) =>
      eatsAcceptOrder(orderId, correlationId, minutesToReady ?? 20, storeId),
    denyOrder: (orderId, reason, correlationId, storeId) =>
      eatsDenyOrder(orderId, reason, correlationId, storeId),
    cancelOrder: (orderId, reason, correlationId, storeId) =>
      eatsCancelOrder(orderId, reason, correlationId, storeId),
    // Restaurant default: current POST /v1/delivery/order/{id}/ready — NOT
    // the extinct ready_for_pickup (markOrderReadyLegacy stays unwired).
    markOrderReady: (orderId, correlationId, storeId) =>
      markDeliveryOrderReady(orderId, correlationId, storeId),
    resolveFulfillmentIssues: (orderId, issues, correlationId) =>
      resolveFulfillmentIssues(orderId, issues, correlationId),
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
    resolveFulfillmentIssues: (orderId, issues, correlationId) =>
      resolveFulfillmentIssues(orderId, issues, correlationId),
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
