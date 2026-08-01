# Uber Eats Integration — Overview

## Objetivo

Conectar Fullsite POS con la Uber Eats Marketplace API para que los pedidos de delivery
entren automáticamente al flujo de cocina, sin intervención manual.

## Estado actual

| Etapa | Estado |
|---|---|
| Framework base (types, retry, audit) | Completo |
| OAuth / token management | Completo |
| Webhook handler v2 (dedup, DLQ, correlation) | Completo |
| Order normalizer | Completo |
| Accept / Deny / Cancel / Ready | Completo |
| Menu upload | Completo |
| Mark OOS / Restore | Completo |
| Store status | Completo |
| Reconciliation job | Completo |
| DB migration | Pendiente — aplicar `supabase/migrations/20260731000000_integration_framework.sql` |
| Test store sandbox | Pendiente |
| Uber certification ticket | Pendiente (ticket cerrado por inactividad) |

## Flujo de un pedido

```
Cliente ordena en Uber Eats app
  → Uber envía POST /api/integrations/uber-eats/webhook
  → verifySignature (HMAC-SHA256 / x-uber-signature)
  → upsertWebhookEvent (dedup via UNIQUE(provider, provider_event_id))
  → getOrderDetails (GET /v1/eats/orders/{id})
  → normalizeUberOrder → CanonicalOrder
  → persistOrder (ON CONFLICT ignore-duplicates)
  → acceptOrder → POST /v1/eats/orders/{id}/accept_pos_order
  → auditLog (redacted)
  → 200 OK a Uber

Cocina ve la orden en /pos/delivery
  → "Preparando" → status = preparando (en DB)
  → "Lista para recoger" → status = lista + POST markOrderReady → Uber
  → Repartidor llega → Uber envía orders.ready_for_pickup
```

## Endpoints implementados

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/api/integrations/uber-eats/webhook` | Webhook receiver (reemplaza `/api/webhook/ubereats`) |
| GET | `/api/integrations/uber-eats/webhook` | Health check / URL verification |
| POST | `/api/integrations/uber-eats/order` | Accept / Deny / Cancel / Ready |
| GET | `/api/integrations/uber-eats/store` | Get store status |
| POST | `/api/integrations/uber-eats/store` | Pause / activate store |
| POST | `/api/integrations/uber-eats/menu` | Upload full menu |
| PATCH | `/api/integrations/uber-eats/menu` | Mark OOS / restore items |
| POST | `/api/integrations/uber-eats/reconcile` | Reconciliation job |

## Variables de entorno requeridas

```env
UBER_WEBHOOK_SECRET=...
UBER_CLIENT_ID=...
UBER_CLIENT_SECRET=...
UBER_ENV=production        # o sandbox
UBER_STORE_CLIENT_MAP={}   # transitorio — reemplazado por integration_store_mappings
NEXT_PUBLIC_DEFAULT_CLIENT_ID=amalay
SUPABASE_SERVICE_KEY=...   # para escritura segura desde webhook
```

## Webhook URL a registrar en Uber Developer Console

```
https://app.fullsite.mx/api/integrations/uber-eats/webhook
```

## CF Worker — Deprecado

`cloudflare/delivery-worker/` está deprecado. Razones:
- Sin HMAC verification
- `client_id: 'amalay'` hardcodeado
- Sin dedup
- Duplica lógica del webhook handler

No eliminar hasta migrar cualquier cliente activo al nuevo handler.
