// Uber Eats — Resolve Fulfillment Issues.
//
// Official documented mechanism (verified developer.uber.com, 2026-08-06):
//   PATCH /v2/eats/orders/{order_id}/cart → 204 No Content, scope eats.order.
//   Body: { fulfillment_issues: FulfillmentIssue[] } — schema below is the
//   documented one verbatim; do not extend it with invented fields.
//
// CAVEAT (BLOCKED_EXTERNAL — VALIDATION-READINESS.md Q2): the public reference
// restricts this endpoint to stores "configured internally with type Grocery
// Store". Uber's partner-gated Marketplace Order API lists a newer
// "ResolveFulfillmentIssues" request for restaurant POS integrations whose
// exact path is not publicly documented. We implement the documented endpoint
// and hold the restaurant-surface path until Uber answers Q2.
//
// Associated webhook: order.fulfillment_issues.resolved — handled in
// webhook/route.ts (the customer confirmed the proposed change; we refresh
// the local order from Get Order Details).

import { uberFetch, SCOPE_ORDER } from './oauth'
import { withRetry } from '../retry'
import { auditLog } from '../audit-logger'

export type FulfillmentIssueType = 'OUT_OF_ITEM' | 'PARTIAL_AVAILABILITY' | 'FOUND_ITEM'
export type FulfillmentActionType = 'REMOVE_ITEM' | 'REPLACE_FOR_ME' | 'ADJUST_ITEM'

export interface FulfillmentModifierGroup {
  id: string
  selected_items: Array<{ id: string; quantity: number }>
}

export interface FulfillmentItemSubstitute {
  id: string
  quantity: number
  selected_modifier_groups?: FulfillmentModifierGroup[]
}

export interface FulfillmentIssue {
  fulfillment_issue_type: FulfillmentIssueType
  fulfillment_action_type?: FulfillmentActionType
  /** The affected cart item — identified by its instance_id from the order payload. */
  root_item: { instance_id: string }
  /** Required for REPLACE_FOR_ME. */
  item_substitute?: FulfillmentItemSubstitute
  /** Required for PARTIAL_AVAILABILITY. */
  item_availability_info?: { items_available: number }
}

export async function resolveFulfillmentIssues(
  orderId: string,
  issues: FulfillmentIssue[],
  correlationId: string
): Promise<{ ok: boolean; error?: string }> {
  const t0 = Date.now()
  try {
    const r = await withRetry(
      () => uberFetch(`/v2/eats/orders/${encodeURIComponent(orderId)}/cart`, {
        method: 'PATCH',
        tokenType: 'marketplace',
        scope: SCOPE_ORDER,
        body: JSON.stringify({ fulfillment_issues: issues }),
      }),
      { maxAttempts: 2, baseDelayMs: 500 }
    )
    const errText = r.ok ? undefined : await r.text()
    await auditLog({
      provider: 'ubereats', correlation_id: correlationId, action: 'order.resolve_fulfillment',
      request: {
        order_id: orderId,
        issues: issues.map(i => ({ type: i.fulfillment_issue_type, action: i.fulfillment_action_type ?? null })),
      },
      response: errText ? { error: errText } : { status: 'resolved' },
      status_code: r.status, duration_ms: Date.now() - t0,
    })
    return r.ok ? { ok: true } : { ok: false, error: errText }
  } catch (e) {
    await auditLog({ provider: 'ubereats', correlation_id: correlationId, action: 'order.resolve_fulfillment', request: { order_id: orderId }, response: { error: String(e) }, duration_ms: Date.now() - t0 })
    return { ok: false, error: String(e) }
  }
}
