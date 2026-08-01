# Uber Eats — Capability Matrix

> Auditoría: 2026-07-31. Branch: `integrations/uber-eats`.

## Matriz de capacidades

| ID | Capability | Código existente | Endpoints/Rutas | Estado real | Gap | Riesgo | Idempotencia | Observabilidad | Tests | Evidencia Uber | Acción |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UBER-001 | Activate Integration (OAuth/USL) | Ninguno | — | **MISSING** | 100% | Crítico | N/A | Ninguna | 0 | USL completado, access_token válido | IMPLEMENTAR |
| UBER-002 | Store Mapping | `UBER_STORE_CLIENT_MAP` env var | — | **ROTO** | 90% | Alto | N/A | Ninguna | 0 | store_id → client_id verificado | IMPLEMENTAR tabla DB |
| UBER-003 | Upload Menu | Ninguno | — | **MISSING** | 100% | Medio | N/A | Ninguna | 0 | Menú visible en app Uber | IMPLEMENTAR |
| UBER-004 | Update Menu | Ninguno | — | **MISSING** | 100% | Medio | N/A | Ninguna | 0 | Cambio de precio/nombre visible | IMPLEMENTAR |
| UBER-005 | Mark Item OOS | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Item no disponible en plataforma | IMPLEMENTAR |
| UBER-006 | Restore Item | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Item disponible de nuevo | IMPLEMENTAR |
| UBER-007 | Store Status Webhook | Ninguno | — | **MISSING** | 100% | Crítico | N/A | Ninguna | 0 | Store activa/pausa desde Uber | IMPLEMENTAR |
| UBER-008 | Get Store Status | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Estado de tienda consultable | IMPLEMENTAR |
| UBER-009 | Order Notification | `api/webhook/ubereats/route.ts` | POST `/api/webhook/ubereats` | **ROTO** | 60% | Crítico | Parcial (`merge-duplicates`) | `console.log` solo | 0 | Webhook recibido y procesado | REFACTORIZAR |
| UBER-010 | Get Order Details | Ninguno | — | **MISSING** | 100% | Crítico | N/A | Ninguna | 0 | Order detallada antes de accept | IMPLEMENTAR |
| UBER-011 | Exactly-once Injection | Parcial (merge-duplicates PK) | — | **ROTO** | 70% | Crítico | Sin tabla de dedup | Ninguna | 0 | Orden no duplicada en retry | IMPLEMENTAR tabla |
| UBER-012 | Accept | Parcial (inline en webhook) | POST `accept_pos_order` | **ROTO** | 50% | Crítico | Sin retry, sin RecoverableOp | Ninguna | 0 | Accept con timer confirmado | REFACTORIZAR |
| UBER-013 | Deny (catálogo de razones) | Ninguno | — | **MISSING** | 100% | Crítico | N/A | Ninguna | 0 | Deny con razón enviado | IMPLEMENTAR |
| UBER-014 | Cancel (catálogo de razones) | Solo PATCH status en DB | — | **ROTO** | 80% | Crítico | N/A | Ninguna | 0 | Cancel con razón enviado a Uber | IMPLEMENTAR |
| UBER-015 | Mark Ready (KDS-connected) | UI button en delivery page | — | **ROTO** | 70% | Alto | N/A | Ninguna | 0 | Ready sincronizado con KDS | IMPLEMENTAR |
| UBER-016 | Duplicate Webhook | Parcial (`merge-duplicates`) | — | **ROTO** | 70% | Alto | Sin tabla de eventos | Ninguna | 0 | 2do webhook ignorado | IMPLEMENTAR event table |
| UBER-017 | Invalid Signature | `verifyUberSignature()` | — | **FUNCIONA** | 0% | — | N/A | `console.warn` | 0 | 401 devuelto | MANTENER + test |
| UBER-018 | Retry / Timeout | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Retry exitoso tras fallo transitorio | IMPLEMENTAR |
| UBER-019 | Fullsite Unavailable (DLQ) | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Evento en DLQ, reenviado | IMPLEMENTAR |
| UBER-020 | Reconciliation | Ninguno | — | **MISSING** | 100% | Alto | N/A | Ninguna | 0 | Órdenes reconciliadas con Uber | IMPLEMENTAR |

## Problemas críticos encontrados

1. **Dos sistemas paralelos**: `cloudflare/delivery-worker/` duplica la lógica del webhook con sin HMAC y `client_id: 'amalay'` hardcodeado → **deprecar CF Worker**.
2. **Sin tabla de dedup de webhooks**: `merge-duplicates` solo protege contra PK duplicada, no contra el mismo evento procesado dos veces con IDs distintos.
3. **Accept sin RecoverableOperation**: Uber Eats confirm es Type A (efecto externo antes de confirmación interna). La falla silenciosa actual es un gap de certificación.
4. **Sin Get Order Details antes de Accept**: Uber requiere que el POS llame a GET `/v1/eats/orders/{order_id}` antes de aceptar.
5. **Store mapping via env var**: No multi-tenant. Un nuevo cliente requiere redeploy.
6. **Header HMAC incorrecto**: El código usa `x-uber-signature`; verificar contra documentación v1 de Uber.
7. **Sin retry/backoff en llamadas a Uber API**.
8. **Sin DLQ**: Fallas de procesamiento se pierden.
9. **Sin reconciliation**: Órdenes que Uber marca como pendientes pero Fullsite no tiene pasan desapercibidas.
10. **Sin audit trail redactado**: Solo `console.log` — no hay trazabilidad para debugging post-incidente.

## Estado de certificación

| Fase | Criterio | Estado |
|---|---|---|
| SANDBOX | Todas las capabilities con test_store | No iniciado |
| PRODUCTION | Uber review + ticket activo | No iniciado (ticket cerrado por inactividad) |

**Próximo ticket a abrir**: mencionar `#D5FEA8` al completar test suite con test store.
