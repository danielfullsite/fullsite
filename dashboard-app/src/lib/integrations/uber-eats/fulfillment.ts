// Uber Eats — Resolve Fulfillment Issues (RESTAURANT canonical contract).
//
// Endpoint (Order Fulfillment API Suite, developer.uber.com order_suite
// #tag/ResolveOrderFulfillmentIssue; reconciled 2026-08-07):
//   POST /v1/delivery/order/{order_id}/resolve-fulfillment-issues
//   Body:     { "fulfillment_issues": [RestaurantFulfillmentIssue, ...] }
//   Response: 200 { "should_wait_for_customer_response": boolean }
//   Lifecycle webhooks: order.fulfillment_issues.resolved (customer confirmed)
//                       or order.failed — both handled in webhook/route.ts.
//
// Restaurant vs Retail: the retail variant adds item_availability and
// item_substitute. AMALAY and all current tenants are restaurants — the
// restaurant shape is canonical here and no grocery/retail fields are used.
// The former PATCH /v2/eats/orders/{id}/cart implementation was removed: that
// endpoint is documented as Grocery-store-only and can never validate the
// restaurant requirement.
//
// Auth: client_credentials via tokenType 'order-fulfillment'. The exact scope
// for this family is NOT publicly documented (blocker A2) — token acquisition
// fails closed until UBER_ORDER_FULFILLMENT_SCOPE is configured.
//
// issue_type / action_type: typed as string with documented examples
// (OUT_OF_STOCK / REMOVE_ITEM) — the full enum is not public; we do not
// invent values.

import { uberFetch } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export interface RestaurantFulfillmentIssue {
  /** Documented example: 'OUT_OF_STOCK'. Full enum not public — pass Uber-documented values only. */
  issue_type: string
  /** Documented example: 'REMOVE_ITEM'. */
  action_type: string
  /** Affected item — id required; name recommended when available. */
  item: { id: string; name?: string }
  /** ISO 8601 — how long the item stays unavailable. */
  suspend_until?: string
  /** Merchant note shown in the resolution flow. */
  store_response?: string
}

export interface ResolveFulfillmentResult {
  ok: boolean
  /** True → Uber is waiting for the customer to confirm; expect
   *  order.fulfillment_issues.resolved (or order.failed) webhook next. */
  should_wait_for_customer_response?: boolean
  error?: string
}

export async function resolveFulfillmentIssues(
  orderId: string,
  issues: RestaurantFulfillmentIssue[],
  correlationId: string
): Promise<ResolveFulfillmentResult> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v1/delivery/order/${encodeURIComponent(orderId)}/resolve-fulfillment-issues`, {
        method: 'POST',
        tokenType: 'order-fulfillment',
        body: JSON.stringify({ fulfillment_issues: issues }),
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    if (!r.ok) {
      const errText = await r.text()
      await auditLog({
        provider: 'ubereats', correlation_id: correlationId, action: 'order.resolve_fulfillment',
        request: { order_id: orderId, issues: issues.map(i => ({ type: i.issue_type, action: i.action_type, item_id: i.item.id })) },
        response: { error: errText },
        status_code: r.status, duration_ms: Date.now() - t0,
      })
      return { ok: false, error: errText }
    }
    const body = await r.json().catch(() => ({})) as { should_wait_for_customer_response?: boolean }
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'order.resolve_fulfillment',
      request: { order_id: orderId, issues: issues.map(i => ({ type: i.issue_type, action: i.action_type, item_id: i.item.id })) },
      response: { status: 'resolved', should_wait_for_customer_response: body.should_wait_for_customer_response ?? null },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return { ok: true, should_wait_for_customer_response: body.should_wait_for_customer_response }
  } catch (e) {
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.resolve_fulfillment', request: { order_id: orderId }, response: { error: String(e) }, duration_ms: Date.now() - t0 })
    return { ok: false, error: String(e) }
  }
}
