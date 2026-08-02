# Ticket #D5FEA8 — Response Draft

> Borrador para revisión antes de enviar. No enviar directamente desde este archivo.
> Destinatario: Uber Eats Technical Integration Team
> Asunto: Re: Basic Production Validation — Fullsite POS (ticket #D5FEA8)

---

## Mensaje a enviar

```
Subject: Re: Basic Production Validation — Fullsite POS [#D5FEA8]

Hi Uber Eats Integrations Team,

Thank you for reviewing our Basic Production Validation submission (ticket #D5FEA8,
submitted 2026-08-02). We are writing to provide a full status update and clarify
the scope of our integration.

---

INTEGRATION SUMMARY

Integration Name: Fullsite POS
Webhook URL: https://app.fullsite.mx/api/integrations/uber-eats/webhook
Product: Uber Eats + Delivery API (Dual-Channel)

---

TEST COVERAGE — CATEGORY A (INTERNAL, NO UBER API REQUIRED)

We have a fully automated internal test suite covering all integration surfaces:

  • 172 Category A tests — core framework (webhook, dedup, store mapping,
    audit logging, retry, DLQ, reconciliation, OAuth/USL, order lifecycle)
  • 20 Day 2 tests — Delivery API channel routing (adapter-factory.ts:
    detectChannel, EatsLegacyAdapter vs DeliveryV1Adapter dispatch,
    URL path verification, minutesToReady passthrough)

Total: 192/192 PASS (vitest v4.1.7). Zero failures.

---

CATEGORY B — SANDBOX RESULTS

Endpoints tested against Uber sandbox (test store: 633b57d4-...):

  PASS (9):
  ✓ UBER-001 — OAuth/USL flow (M2M + authorization code)
  ✓ UBER-002 — Store mapping DB lookup (provider_store_id → client_id)
  ✓ UBER-007 — Store activate/pause (POST /v1/eats/stores/{id}/status)
  ✓ UBER-009 — Order notification webhook (HMAC-SHA256 verified)
  ✓ UBER-011 — Exactly-once delivery (integration_webhook_events UNIQUE)
  ✓ UBER-016 — Duplicate webhook rejection
  ✓ UBER-017 — Invalid signature rejection (401)
  ✓ UBER-019 — DLQ on internal failure (webhook always returns 200)
  ✓ UBER-020 — Reconciliation endpoint

  SANDBOX LIMIT (9) — Implementation complete; blocked by sandbox scope:
  ✗ UBER-003..006 — Menu management (upload/update/OOS/restore)
      Error: 403 "insufficient_scope" for eats.menu.write in sandbox
  ✗ UBER-008 — Get store status details
  ✗ UBER-010 — Get order details (GET /v1/eats/orders/{id})
  ✗ UBER-012..015 — Accept/deny/cancel/ready via Uber API

  For all SANDBOX LIMIT items: the request reaches the Uber endpoint and returns
  a scope or routing error — not an implementation error on our side.

---

DELIVERY API CHANNEL SUPPORT (DAY 2)

We have completed Delivery API integration (2026-08-02):

  • Adapter factory (adapter-factory.ts) routes order lifecycle operations
    based on the webhook payload's `channel` field:
      — channel='eats'     → EatsLegacyAdapter  (/v1/eats/orders/{id}/...)
      — channel='delivery' → DeliveryV1Adapter  (/v1/delivery/order/{id}/...)
  • All 5 DeliveryV1 operations implemented:
      POST /v1/delivery/order/{id}/accept
      POST /v1/delivery/order/{id}/deny
      POST /v1/delivery/order/{id}/cancel
      POST /v1/delivery/order/{id}/ready
      GET  /v1/delivery/order/{id}
  • Fallback: orders without a channel field default to 'eats' — backward
    compatible with all existing Eats Marketplace webhooks.

---

SECURITY POSTURE

  • All tokens stored server-side; no NEXT_PUBLIC_ prefix on any UBER_* var
  • Multi-tenant isolation: provider_store_id → integration_store_mappings → client_id
    (fail-closed: unmapped store → DLQ + audit log, never fallback to any tenant)
  • Audit log with sensitive field redaction on every Uber API call
  • HMAC-SHA256 with sha256= prefix on all webhook verifications
  • Correlation IDs on every request for post-incident traceability

---

QUESTIONS / NEXT STEPS

1. To unblock the 9 SANDBOX LIMIT items, we would appreciate:
   a. Confirmation of which sandbox test store supports eats.menu.write scope
   b. Access to GET /v1/eats/orders/{id} and order lifecycle endpoints in sandbox

2. Is there anything specific from our Category A or Day 2 evidence you would
   like us to provide in a different format (logs, screenshots, HAR files)?

3. What is the typical turnaround for Basic Production Validation once the form
   is reviewed?

We are ready to proceed to production as soon as we receive confirmation.
UBER_ENV=production will NOT be activated until we receive official approval.

Thank you,
Daniel Ramonfaur
Fullsite POS — daniel@fullsite.mx
```

---

## Checklist antes de enviar

- [ ] Verificar que el test store ID `633b57d4-...` es correcto y coincide con el mapeado en `integration_store_mappings`
- [ ] Adjuntar output de `npx vitest run src/__tests__/integrations/` (192/192 PASS)
- [ ] Confirmar que webhook URL sigue activo: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
- [ ] Confirmar que `UBER_ENV` sigue en `sandbox` en Vercel
- [ ] Responder desde el email registrado como Integration Owner en el form de Uber
