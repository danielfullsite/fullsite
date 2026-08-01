# Uber Eats — Certification Checklist

Referencia: Uber Eats Marketplace API Integration Guide.
Ticket siguiente: abrir nuevo ticket mencionando `#D5FEA8`.

## Pre-requisitos

- [ ] DB migration aplicada: `supabase/migrations/20260731000000_integration_framework.sql`
- [ ] `UBER_WEBHOOK_SECRET` seteado en Vercel env
- [ ] `UBER_CLIENT_ID` + `UBER_CLIENT_SECRET` (sandbox) seteados
- [ ] `UBER_ENV=sandbox` para test store
- [ ] Webhook URL registrada en Uber Developer Console: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
- [ ] Test store configurado en Uber Developer Console

## Orden de ejecución en test store

| ID | Capability | Paso | Evidencia requerida |
|---|---|---|---|
| UBER-001 | OAuth/USL | Completar USL flow en Uber Console | access_token válido, log en integration_providers |
| UBER-002 | Store Mapping | Insertar fila en integration_store_mappings | store_id → client_id mapeado |
| UBER-003 | Upload Menu | POST /api/integrations/uber-eats/menu con menú de AMALAY | 200 OK, menú visible en Uber app test |
| UBER-005 | Mark OOS | PATCH /api/integrations/uber-eats/menu {action:"oos"} | Item no disponible en app |
| UBER-006 | Restore Item | PATCH /api/integrations/uber-eats/menu {action:"restore"} | Item disponible de nuevo |
| UBER-008 | Get Store Status | GET /api/integrations/uber-eats/store?store_id=... | is_open = true |
| UBER-009 | Order Notification | Uber envía webhook de nueva orden | Entrada en integration_webhook_events status=processed |
| UBER-010 | Get Order Details | Automático en webhook handler | auditLog action=order.get_details |
| UBER-011 | Exactly-once | Reenviar mismo webhook 2x | Solo 1 fila en delivery_orders |
| UBER-012 | Accept | Automático tras nuevo pedido | auditLog action=order.accept, status 200 |
| UBER-016 | Dup Webhook | Reenviar webhook | 200 sin duplicados en DB |
| UBER-017 | Invalid Signature | POST con sig inválida | 401 |
| UBER-013 | Deny | POST /order {action:"deny",reason:"ITEM_UNAVAILABLE"} | Deny enviado a Uber |
| UBER-014 | Cancel | POST /order {action:"cancel",reason:"CUSTOMER_CALLED_TO_CANCEL"} | Cancel enviado |
| UBER-015 | Mark Ready | Click "Lista para recoger" en /pos/delivery | markOrderReady llamado, auditLog |
| UBER-007 | Store Status Webhook | Uber envía store.status event | integration_store_mappings.store_open actualizado |
| UBER-018 | Retry | Simular fallo transitorio | Retry en logs, éxito en intento N |
| UBER-019 | DLQ | Simular fallo persistente | Fila en integration_webhook_dlq |
| UBER-020 | Reconciliation | POST /reconcile con órdenes stuck | Órdenes cerradas correctamente |

## Definition of Done por capability

Una capability está CERTIFICADA cuando:
1. Implementada en código
2. Test unitario pasa (vitest)
3. Log correlacionable en integration_audit_log con correlation_id
4. Evidencia en test store (screenshot o response body)
5. No hay duplicados bajo retry
6. Commit atómico en rama `integrations/uber-eats`
7. Actualización en CAPABILITY-MATRIX.md

## Smoke test pre-producción

Antes de activar en producción (UBER_ENV=production):
1. Verificar que UBER_WEBHOOK_SECRET está rotado (no el mismo que sandbox)
2. Verificar integration_store_mappings tiene el store_id de producción
3. Correr reconciliation con client_id de AMALAY
4. Verificar que delivery/page.tsx recibe órdenes de test store correctamente

## Ticket Uber

Al completar todas las capabilities con test store:
```
Asunto: POS Integration Certification Request
Cuerpo: Fullsite POS integration ready for certification.
        Reference ticket: #D5FEA8
        Webhook URL: https://app.fullsite.mx/api/integrations/uber-eats/webhook
        All capabilities implemented and tested with test store.
```
