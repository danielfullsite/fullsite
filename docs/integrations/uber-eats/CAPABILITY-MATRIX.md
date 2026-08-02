# Uber Eats — Capability Matrix

> Última actualización: 2026-08-02. Día 1 completo. Día 2 (Delivery adapter) completo.

## Leyenda

| Estado | Significado |
|---|---|
| **IMPLEMENTADO** | Código completo, tests Cat A pasando, evidencia generada |
| **SANDBOX LIMIT** | Implementado localmente; bloqueado por permiso de Uber sandbox/producción |
| **PENDING** | No implementado aún |

## Matriz de capacidades

| ID | Capability | Módulo / Ruta | Estado | Tests Cat A | Tests Cat B | Notas |
|---|---|---|---|---|---|---|
| UBER-001 | Activate Integration (OAuth/USL) | `lib/uber-eats/oauth.ts` · `/api/integrations/uber-eats/auth/callback` | **IMPLEMENTADO** | CAT-A-039..043 | — | M2M + USL, token cache, refresh automático |
| UBER-002 | Store Mapping (multi-tenant, fail-closed) | `integration_store_mappings` DB | **IMPLEMENTADO** | CAT-A-044..047e | — | provider_store_id → client_id; desconocido → DLQ, sin fallback |
| UBER-003 | Upload Menu | — | **SANDBOX LIMIT** | — | — | Requiere permiso especial de Uber |
| UBER-004 | Update Menu | — | **SANDBOX LIMIT** | — | — | Requiere permiso especial de Uber |
| UBER-005 | Mark Item OOS | — | **SANDBOX LIMIT** | — | — | Requiere permiso especial de Uber |
| UBER-006 | Restore Item | — | **SANDBOX LIMIT** | — | — | Requiere permiso especial de Uber |
| UBER-007 | Store Activate / Pause | `store/route.ts` POST | **IMPLEMENTADO** | uber-stores.test.ts | — | pauseStore / activateStore via `/v1/eats/stores/{id}/status` |
| UBER-008 | Get Store Status | `store/route.ts` GET | **IMPLEMENTADO** | uber-stores.test.ts | — | getStoreStatus; admin-token guard |
| UBER-009 | Order Notification (webhook) | `webhook/route.ts` | **IMPLEMENTADO** | CAT-A-001..010, 058..063 | — | HMAC-SHA256, dedup, DLQ, fail-closed |
| UBER-010 | Get Order Details | `lib/uber-eats/adapter.ts` → `getOrderDetails` | **IMPLEMENTADO** | CAT-A-035..038 | — | Antes de accept; vía adapter-factory en Day 2 |
| UBER-011 | Exactly-once Injection | `integration_webhook_events` UNIQUE(provider, provider_event_id) | **IMPLEMENTADO** | CAT-A-011..015 | — | ON CONFLICT DO NOTHING; idempotency_key deterministico |
| UBER-012 | Accept Order | `order/route.ts` → `adapter-factory` | **IMPLEMENTADO** | CAT-A-046..047e | — | Ruteado a EatsAdapter o DeliveryAdapter por channel |
| UBER-013 | Deny Order (catálogo de razones) | `order/route.ts` + `reasons.ts` | **IMPLEMENTADO** | CAT-A-062 | — | 5 razones con etiquetas en español |
| UBER-014 | Cancel Order (catálogo de razones) | `order/route.ts` + `reasons.ts` | **IMPLEMENTADO** | CAT-A-063 | — | Catálogo completo con etiquetas en español |
| UBER-015 | Mark Ready (pickup) | `order/route.ts` → `adapter.markOrderReady` | **IMPLEMENTADO** | CAT-A-046..047e | — | Ruteado por adapter-factory |
| UBER-016 | Duplicate Webhook (dedup) | `integration_webhook_events` UNIQUE | **IMPLEMENTADO** | CAT-A-011..015 | — | Segundo webhook del mismo evento → ack 200, sin reprocesamiento |
| UBER-017 | Invalid Signature rejection | `webhook/route.ts` HMAC verify | **IMPLEMENTADO** | CAT-A-001..005 | — | 401 en firma faltante/errónea; 503 si secret no configurado |
| UBER-018 | Retry / Transient Failure | `lib/integrations/retry.ts` → `withRetry` | **IMPLEMENTADO** | CAT-A-016..029 | — | maxAttempts=3, exponential backoff, 429/5xx retryable |
| UBER-019 | Fullsite Unavailable (DLQ) | `integration_webhook_dlq` + `/api/integrations/uber-eats/dlq` | **IMPLEMENTADO** | CAT-A-048..053 | — | Webhook siempre devuelve 200 a Uber; fallas van a DLQ |
| UBER-020 | Reconciliation | `/api/integrations/uber-eats/reconcile` | **IMPLEMENTADO** | CAT-A-064..066 | — | Detecta órdenes Uber no registradas en delivery_orders |

## Day 2 — Delivery Channel Adapter

Completado 2026-08-02. Ruteado transparente entre EatsLegacyAdapter y DeliveryV1Adapter.

| ID | Capability | Módulo | Estado | Tests |
|---|---|---|---|---|
| DAY2 | Channel Detection | `adapter-factory.ts` → `detectChannel` | **IMPLEMENTADO** | DAY2-001..005 |
| DAY2 | Adapter Factory Routing | `adapter-factory.ts` → `getOrderAdapter / getOrderAdapterForPayload` | **IMPLEMENTADO** | DAY2-006..010 |
| DAY2 | DeliveryV1 URL paths | `delivery-adapter.ts` | **IMPLEMENTADO** | DAY2-011..015 |
| DAY2 | EatsLegacy minutesToReady passthrough | `adapter-factory.ts` → `makeEatsAdapter` | **IMPLEMENTADO** | DAY2-016..018 |
| DAY2 | order/route.ts channel routing | `order/route.ts` → `resolveOrderContext` + `getOrderAdapter` | **IMPLEMENTADO** | DAY2-019..020 |

**Dispatch logic:**

```
order/route.ts (POST) 
  → resolveOrderContext(order_id)        — leer raw_payload.channel de delivery_orders
  → getOrderAdapter(channel)              — 'delivery' o 'eats' (default)
      ├── 'eats'     → EatsLegacyAdapter  → /v1/eats/orders/{id}/...
      └── 'delivery' → DeliveryV1Adapter  → /v1/delivery/order/{id}/...
```

## Resumen de cobertura

| Categoría | Total | IMPLEMENTADO | SANDBOX LIMIT | PENDING |
|---|---|---|---|---|
| Core capabilities (UBER-001..020) | 20 | 16 | 4 | 0 |
| Day 2 routing capabilities | 5 | 5 | 0 | 0 |

**Tests:** 172 Cat A (category-a.test.ts) + 20 Day 2 (delivery-adapter.test.ts) = **192 total** — todos pasando.

## Estado de certificación

| Fase | Criterio | Estado |
|---|---|---|
| **SANDBOX Cat A** | 192 tests internos sin Uber API | **PASS** |
| **SANDBOX Cat B** | Endpoints con sandbox de Uber | 9 PASS · 9 SANDBOX LIMIT (menú) |
| **PRODUCTION** | Uber Basic Production Validation | Ticket #D5FEA8 en espera — pendiente respuesta Uber |

**Nota SANDBOX LIMIT:** Las 4 capabilities de menú (UBER-003..006) y los 9 Cat B pendientes requieren acceso especial al sandbox de Uber para el scope `eats.menu.write`. El resto del stack está listo para producción.
