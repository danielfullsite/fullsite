# Uber Basic Production Validation — Execution Evidence (2026-08-09)

**Environment:** sandbox ONLY · Test client `k2DPoUeX…` · Test store `633b57d4-237a-5a32-b249-7ceb795f1d35` · API `test-api.uber.com`
**Not touched:** production client `6bHtSqLJ…`, `api.uber.com`, AMALAY prod writes (beyond reading pre-existing audit rows).
**Case:** #58972404 (prev. #D5FEA8). Scope-enablement email sent 2026-08-07; **no Uber reply as of run**.
**DB check:** `integration_audit_log` shows **0 new Uber activity since 2026-08-03** — nothing changed; the root cause is unchanged and external.

---

## Root cause of the universal BLOCK (single, external, unchanged)

Uber has **not granted any client_credentials (M2M) scopes** to the test application. Proven by a real Uber HTTP response at the **token layer** — the request never even reaches an endpoint:

```
POST sandbox-login.uber.com/oauth/v2/token   (grant_type=client_credentials, scope=eats.store…)
→ HTTP 400  {"error":"invalid_scope","error_description":"scope(s) are invalid"}
   correlation_id 2503096e-ab21-46f6-9faa-915b6d2adc0a   2026-08-01T20:06:07Z
```

Consequently every scoped endpoint returns `401 unauthorized — requires scope X`.
**Second, independent blocker:** Uber sandbox does **not** generate Delivery orders on the integrator side, so the order-lifecycle endpoints have **no `order_id` to act on** even if scopes were granted. Neither blocker is resolvable from our side.

---

## PASS / BLOCKED matrix (grounded in real HTTP responses)

| # | Capability | Endpoint (current) | Real result | Evidence (sanitized) |
|---|---|---|---|---|
| 1a | OAuth USL (authorization_code) | `sandbox-login/oauth/v2/token` | **PASS** | `usl.connected` 2026-08-01T19:55:46Z; granted `[eats.pos_provisioning, offline_access]`; token stored |
| 1b | OAuth M2M (marketplace scopes) | `sandbox-login/oauth/v2/token` | **BLOCKED (A2)** | `400 invalid_scope` corr `2503096e` — app raised RetryExhaustedError, logged, returned `{ok:false}`, no crash |
| 1c | Store discovery / mapping | `integration_store_mappings` | **PASS** | `633b57d4…` → `sandbox-client` (staging) mapped, fail-closed for unmapped |
| 2 | Store online/offline | `POST /v2/eats/stores/{id}/status` | **BLOCKED (A2)** | needs `eats.store.status.write`; token unobtainable → `UberScopeError` fail-closed |
| 3 | Menu upload / Update Item / OOS | `PUT /v2/.../menus`, `POST /v2/.../menus/items/{id}` | **BLOCKED (A2)** | `menu.upload` real: `400 invalid_scope` (corr `2503096e`) + `404` legacy path (corr `23e211c7`, `d233dea4`, `29cf7469`); app logged + returned error |
| 4 | Get order + lifecycle | `GET /v1/delivery/order/{id}` | **BLOCKED ×2** | (a) needs order-fulfillment scope (A2, fail-closed guard); (b) no Uber-generated test order exists |
| 5a | Accept | `POST /v1/delivery/order/{id}/accept` | **BLOCKED (A2)** | `eats.order` not granted; new code fail-closed on scope |
| 5b | Deny | `POST /v1/delivery/order/{id}/deny` | **BLOCKED (A2)** | real `401 requires eats.order` corr `0587db1b` 2026-08-02T00:20:03Z |
| 5c | Cancel | `POST /v1/delivery/order/{id}/cancel` | **BLOCKED (A2)** | real `401 requires eats.store.orders.cancel, eats.order, eats.deliveries` corr `14f4fc6b` |
| 5d | Mark ready | `POST /v1/delivery/order/{id}/ready` | **BLOCKED (A2)** | legacy `ready_for_pickup` real `404` corr `b6916116`; **corrected** to `/ready`, now fail-closed on `UBER_ORDER_FULFILLMENT_SCOPE` |
| 5e | Resolve fulfillment (restaurant) | `POST /v1/delivery/order/{id}/resolve-fulfillment-issues` | **BLOCKED (A2)** | corrected to restaurant schema; fail-closed on scope; not previously mis-attempted |
| 5f | `orders.failure` / `order.failed` webhook | webhook handler | **PASS (mechanism)** | handler implemented + unit-verified (GAP-WH-003/009) |
| 6 | Webhook receive + HMAC + 200 + audit | `/api/integrations/uber-eats/webhook` | **PASS (mechanism, self-signed only)** | UBER-009 (200, corr `d5b852d3`), UBER-011 (exactly-once), UBER-017 (bad sig → 401), UBER-019 (DLQ). **CAVEAT: self-signed test events — NO real Uber-originated webhook has ever been received.** |
| 7 | Isolation + no plaintext tokens | — | **PASS (code)** | 0 `.env` tracked; 0 token/secret material in logs (messages only); 0 hardcoded secrets; synthetic-tenant RLS PASS. **CAVEAT SEC-UBER-01:** tokens sealed only when `INTEGRATION_TOKEN_KEY` set. |

**Integrity note:** items marked PASS(mechanism) are Cat A — code correctness proven internally, **not** real Uber traffic. No capability is declared "Uber validated." No orders were invented.

---

## Next concrete action per blocker

| Blocker | Owner | Action |
|---|---|---|
| **A2 — M2M scopes not granted** (root cause of all BLOCKED) | **Uber** | Whitelist `eats.order`, `eats.store`, `eats.store.orders.read`, `eats.store.status.write` for the test app + confirm the scope for `/v1/delivery/order/*`. Requested in case #58972404. Chase the case — nothing on our side unblocks it. |
| **No sandbox order generation** | **Uber** | Uber must generate a sandbox Delivery order (or state the mechanism). Asked in A1/A3. |
| **Isolation-safe rerun** (so evidence never touches AMALAY) | **Daniel** | Provision a separate sandbox Vercel project → staging DB + Test Client. Set 3 secrets: `UBER_TEST_CLIENT_SECRET`, staging `SUPABASE_SERVICE_KEY`, `UBER_ORDER_FULFILLMENT_SCOPE` (once A2 confirms it). |
| **SEC-UBER-01 tokens at rest** | **Daniel** | Set `INTEGRATION_TOKEN_KEY` before any production USL. |

---

## Short reply to attach to Uber case #58972404

> Following up on our 2026-08-07 message. We attempted the full validation flow in sandbox against test store `633b57d4-237a-5a32-b249-7ceb795f1d35`. Every order/store/menu call fails at the **token layer**: a `client_credentials` request for `eats.store`/`eats.order` returns `400 invalid_scope`, and the endpoints return `401 "requires scope …"` (e.g. deny → "requires eats.order"; cancel → "requires eats.store.orders.cancel, eats.order, eats.deliveries"). This confirms the scopes are **not whitelisted for our test application**. We have not been able to obtain a sandbox test order to exercise the `/v1/delivery/order/{order_id}/...` lifecycle. Could you please (1) enable those client_credentials scopes for the app monitored by validation, (2) confirm the scope authorizing `/v1/delivery/order/{order_id}/ready` and `/resolve-fulfillment-issues`, and (3) advise how to generate a sandbox test order? Our HMAC webhook endpoint is live and returns 200. Correlation IDs available on request.
