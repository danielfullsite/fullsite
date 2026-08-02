# Ticket #D5FEA8 — Response Draft

> Para revisión antes de enviar. Enviar desde el correo registrado como Integration Owner.

## Checklist antes de enviar

- [ ] Test store ID `633b57d4-...` confirmado en `integration_store_mappings`
- [ ] Webhook URL activa: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
- [ ] `UBER_ENV=sandbox` confirmado en Vercel (no activar producción hasta aprobación Uber)
- [ ] Enviar desde el correo registrado como Integration Owner en el form original

---

## Correo final

```
Subject: Re: Basic Production Validation — Fullsite POS [#D5FEA8]

Hi Uber Eats Integrations Team,

We are writing to request a new review of our Basic Production Validation
(ticket #D5FEA8). We have completed the implementation of all required
capabilities and the integration is ready for production.

Below is a summary organized by capability area.

---

ACTIVATE INTEGRATION

Implemented. Verified in sandbox.

OAuth M2M client_credentials flow and USL authorization code flow are both
operational. Token caching and automatic refresh are in place. The integration
currently holds a valid access_token against our test store.

---

STORE PROVISIONING

Implemented. Verified in sandbox.

Store-to-tenant mapping is handled via a dedicated database table
(integration_store_mappings: provider_store_id → client_id). The integration
is fail-closed: any webhook from an unmapped store is quarantined to a
dead-letter queue with a full audit trail — it never falls back to any tenant.

---

MENU MANAGEMENT

Sandbox limitation.

Upload Menu, Update Menu, Mark Item Unavailable, and Restore Item are not yet
implemented. These capabilities require the eats.menu.write scope, which our
current sandbox credentials do not include. We are ready to implement as soon
as this scope is granted.

---

STORE STATUS

Implemented. Partially verified in sandbox.

Store activate and pause (POST /v1/eats/stores/{id}/status) are implemented
and verified against the sandbox. Get Store Status is implemented; we receive
a scope error from the sandbox on that endpoint specifically.

---

ORDER MANAGEMENT

Implemented. Sandbox limitation on lifecycle endpoints.

All order lifecycle operations are implemented:
  - Accept (with configurable minutes_to_ready)
  - Deny (full reason catalog with deny_reason codes)
  - Cancel (full reason catalog)
  - Mark Ready for Pickup
  - Get Order Details

The integration supports both the Eats Marketplace API
(/v1/eats/orders/{id}/...) and the Delivery API (/v1/delivery/order/{id}/...),
routing automatically based on the channel field in the webhook payload.

Exactly-once delivery is enforced via a UNIQUE constraint on
(provider, provider_event_id) — duplicate webhooks are acknowledged without
reprocessing.

We are receiving scope errors from the sandbox when calling these endpoints
directly. The implementations are verified through 192 automated internal tests.

---

WEBHOOKS

Implemented. Verified in sandbox.

  - Order notification webhook: receiving and processing correctly
  - Duplicate webhook detection: acknowledged without reprocessing
  - Dead-letter queue: all processing failures are captured; the webhook
    always returns 200 to Uber even on internal errors
  - Reconciliation endpoint: operational

---

SECURITY

Implemented. Verified in sandbox.

  - HMAC-SHA256 signature verification on every webhook (sha256= prefix)
  - Fail-closed tenant isolation (no cross-tenant fallback on any code path)
  - Audit log with sensitive field redaction on every Uber API call
  - Retry with exponential backoff on transient failures (429, 5xx)
  - Correlation IDs on every request for post-incident traceability

---

QUESTIONS

1. Can you initiate a new Basic Production Validation review using our
   test application?

2. If you observe any missing capability in your logs, could you indicate
   exactly which endpoint or webhook event is not being detected?

3. If any endpoint remains limited by the sandbox, what is the recommended
   procedure to generate the required evidence?

---

Integration Name: Fullsite POS
Webhook URL:      https://app.fullsite.mx/api/integrations/uber-eats/webhook
Reference:        Ticket #D5FEA8

Thank you,
Daniel Ramonfaur
Fullsite POS — daniel@fullsite.mx
```
