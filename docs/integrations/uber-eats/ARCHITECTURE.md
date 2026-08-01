# Uber Eats — Architecture

## Componentes

```
src/lib/integrations/
├── types.ts                    CanonicalOrder, CanonicalOrderItem, WebhookEvent
├── retry.ts                    withRetry() — exponential backoff + full jitter
├── audit-logger.ts             auditLog() — redacted, writes to integration_audit_log
└── uber-eats/
    ├── oauth.ts                getUberAccessToken(), uberFetch() — in-process token cache
    ├── adapter.ts v1.0.0       getOrderDetails, accept, deny, cancel, markReady
    ├── order-adapter.ts        normalizeUberOrder() → CanonicalOrder
    ├── menu.ts                 uploadMenu(), markItemsOOS(), restoreItems()
    ├── store.ts                pauseStore(), activateStore(), getStoreStatus()
    └── reasons.ts              UBER_DENY_REASONS, UBER_CANCEL_REASONS + labels

src/app/api/integrations/uber-eats/
├── webhook/route.ts            POST (handler) + GET (health)
├── order/route.ts              POST {action: accept|deny|cancel|ready}
├── menu/route.ts               POST (upload) + PATCH (oos|restore)
├── store/route.ts              GET (status) + POST (pause|activate)
└── reconcile/route.ts          POST (reconciliation job)
```

## Tablas en DB

```
integration_providers          OAuth credentials per client+provider
integration_store_mappings     Uber store_id → Fullsite client_id (replaces env var)
integration_webhook_events     Inbox: dedup + correlation + status tracking
integration_webhook_dlq        Dead-letter queue for failed events
integration_audit_log          Redacted request/response trail
```

## Deduplicación de webhooks

Uber puede enviar el mismo evento múltiples veces (red, retries). El sistema garantiza
procesamiento exactly-once así:

1. Se extrae `provider_event_id` del payload (body.event_id, body.uuid, o sintético `type:order_id`)
2. Se inserta en `integration_webhook_events` con `Prefer: resolution=ignore-duplicates`
3. Si la inserción no devuelve filas → evento duplicado → return 200 sin procesar
4. La persistencia de `delivery_orders` usa `Prefer: resolution=ignore-duplicates` también
5. La llamada a `acceptOrder` usa retry pero el endpoint de Uber es idempotente

## Token cache

`getUberAccessToken()` cachea tokens en memoria (Map) hasta 60s antes de expirar.
Scope `eats.order` para accept/deny/cancel/ready. Scope `eats.store` para menu/store.

## Retry policy

`withRetry(fn, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 })`
- Backoff: `min(baseDelay × 2^(attempt-1), maxDelay) + jitter(25%)`
- No retries en accept/deny/cancel después de 2 intentos (evitar doble-accept)

## Type A — RecoverableOperation

Uber Eats order confirm es Type A: Uber confirma el pedido ANTES de que Fullsite
escriba internamente. Implicaciones:

- Si `acceptOrder` falla tras persistir → orden en DB status=nueva pero Uber no sabe
- El `delivery/page.tsx` mostrará la orden → operador puede reintentar desde UI
- La reconciliación (`/reconcile`) detecta órdenes stuck en nueva >30min y las cruza con Uber

## Correlation IDs

Cada webhook genera un `correlation_id` (uuid) que viaja en:
- `integration_webhook_events.correlation_id`
- `integration_audit_log.correlation_id`
- Headers de respuesta de la API (futura)

Permite trazar un pedido completo en audit_log filtrando por correlation_id.
