# Integrations Platform

Fullsite Integration Framework — canónico para conectar plataformas de delivery y terceros.

## Proveedores

| Proveedor | Estado | Docs |
|---|---|---|
| Uber Eats | En construcción | [uber-eats/](uber-eats/) |
| Rappi | Planned | — |
| Didi Food | Planned | — |

## Arquitectura del Framework

Todos los proveedores siguen el mismo flujo canónico:

```
Proveedor webhook
  → Webhook Inbox (HMAC validation, dedup, correlation_id)
  → Get Order Details (fetch completo del proveedor)
  → Normalize → Fullsite Order (canonical adapter)
  → Exactly-once persistence (idempotency_key ON CONFLICT)
  → POS / KDS / Print
  → Status callback al proveedor
  → Audit log + reconciliation
```

## Componentes del Framework

| Componente | Archivo | Propósito |
|---|---|---|
| Tipos canónicos | `src/lib/integrations/types.ts` | Interfaces compartidas |
| Audit logger | `src/lib/integrations/audit-logger.ts` | Logs redactados correlacionados |
| Retry / backoff | `src/lib/integrations/retry.ts` | Exponential backoff con jitter |
| Uber Eats adapter | `src/lib/integrations/uber-eats/adapter.ts` | Versioned adapter v1 |
| OAuth / tokens | `src/lib/integrations/uber-eats/oauth.ts` | Token management |
| Menu adapter | `src/lib/integrations/uber-eats/menu.ts` | Upload / update / OOS |
| Order adapter | `src/lib/integrations/uber-eats/order-adapter.ts` | Normalización canónica |
| Store status | `src/lib/integrations/uber-eats/store.ts` | Pause / activate |
| Reasons catalog | `src/lib/integrations/uber-eats/reasons.ts` | Deny / Cancel catalogs |

## Tablas en DB

| Tabla | Propósito |
|---|---|
| `integration_providers` | Credenciales y estado OAuth por cliente |
| `integration_store_mappings` | Uber store_id → Fullsite client_id |
| `integration_webhook_events` | Inbox de webhooks con dedup |
| `integration_webhook_dlq` | Dead-letter queue |
| `integration_audit_log` | Audit trail redactado |

## Clasificación Type A

Uber Eats es **Type A** (External Side Effect): el driver de Uber recoge el pedido
ANTES de que Fullsite confirme internamente. Por esto:
- Toda operación de accept/deny/cancel/ready usa `RecoverableOperation<T>`
- Toda escritura a DB usa idempotency_key (ON CONFLICT DO NOTHING)
- Toda falla va al DLQ y se notifica al equipo

## CF Worker (Deprecado)

`cloudflare/delivery-worker/` está deprecado en favor de este framework.
Razones: sin HMAC, hardcodea `client_id: 'amalay'`, sin dedup, sin audit.
