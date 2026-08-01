# Uber Eats — Certification Checklist

Referencia: Uber Eats Marketplace API Integration Guide.
Ticket siguiente: abrir nuevo ticket mencionando `#D5FEA8`.

## Estado actual (2026-07-31)

| Capa | Estado |
|---|---|
| DB migration staging | ✓ Aplicada y verificada — 5 tablas, 6 índices, RLS confirmado |
| Integration Framework código | ✓ En `main` local (commit `d17c7ad` + `4119d69`) — pendiente push a origin |
| Tests automatizados (37) | ✓ Todos pasan |
| USL / OAuth callback | ✓ Implementado (`/auth/initiate` + `/auth/callback`) |
| Deployment público | BLOCKER — 22 commits locales en `main` sin pushear, endpoint no accesible |
| Env vars Vercel (UBER_*) | BLOCKER — requiere credenciales de Uber Developer Console |
| Webhook registrado en Uber | BLOCKER — depende de deployment |
| Store mapping test store | BLOCKER — requiere provider_store_id de Uber Developer Console |

## Blockers antes de sandbox validation

### B-1 (DEPLOY): Push `main` a `origin/main`

Los 22 commits locales (incluyendo Integration Framework) no se han pusheado.
El endpoint `https://app.fullsite.mx/api/integrations/uber-eats/webhook` NO está activo.

**Acción**: Confirmar push de `main` → Vercel deploya automáticamente.

### B-2 (CREDENTIALS): Variables de entorno en Vercel

Las siguientes variables NO están configuradas en el proyecto Vercel `fullsite`:

```
UBER_CLIENT_ID          — de Uber Developer Console → sandbox app
UBER_CLIENT_SECRET      — de Uber Developer Console → sandbox app
UBER_WEBHOOK_SECRET     — string aleatorio generado por Fullsite (no Uber)
UBER_ENV                — valor: sandbox
UBER_REDIRECT_URI       — https://app.fullsite.mx/api/integrations/uber-eats/auth/callback
```

**Nota**: `SUPABASE_SERVICE_KEY` ya existe en Vercel (Production + Preview). No tocar.
**Acción**: Daniel setea las 5 variables en Vercel Dashboard → Settings → Environment Variables.
No usar `NEXT_PUBLIC_` prefix para ninguna de estas.

### B-3 (STORE MAPPING): Test store ID

Necesitamos el `provider_store_id` que Uber asigna al test store en Developer Console.
Una vez obtenido, insertar en staging:

```sql
INSERT INTO integration_store_mappings (provider, provider_store_id, client_id)
VALUES ('ubereats', '<UBER_TEST_STORE_ID>', 'sandbox-client');
```

### B-4 (WEBHOOK): Registrar URL en Uber Developer Console

URL del webhook: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
Requiere que B-1 esté resuelto primero (endpoint debe responder 200 al GET).

## Pre-requisitos — Sandbox

- [x] DB migration aplicada en staging: `supabase/migrations/20260731000000_integration_framework.sql`
- [x] USL implementado: `/api/integrations/uber-eats/auth/initiate` + `/auth/callback`
- [x] Tests automatizados: 37/37 pasan
- [ ] **B-1** Push `main` → Vercel deploy
- [ ] **B-2** `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_WEBHOOK_SECRET`, `UBER_ENV=sandbox`, `UBER_REDIRECT_URI`
- [ ] **B-3** Test store configurado en Uber Developer Console, store_id conocido
- [ ] **B-4** Webhook URL registrada: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
- [ ] **B-5** Store mapping insertado con test store ID real

## Pre-requisitos adicionales — Producción (NO ejecutar hasta sandbox completo)

- [ ] **USL end-to-end**: Ejecutar `/auth/initiate` con merchant real → confirmar tokens en `integration_providers`
      Rutas implementadas: `/api/integrations/uber-eats/auth/initiate` + `/auth/callback`
      Storage: `integration_providers.access_token_enc` (⚠ sin cifrado en reposo aún)
- [ ] `UBER_ENV=production` + credenciales de producción
- [ ] Webhook URL definitiva registrada
- [ ] `integration_store_mappings` poblada con store_id de producción
- [ ] Rotación de `UBER_WEBHOOK_SECRET` (sandbox ≠ producción)
- [ ] Implementar cifrado en reposo para tokens en `integration_providers._enc` columns

## Orden de ejecución en test store

### Categoría A: Automatización interna (sin Uber Developer Console)

| ID | Capability | Paso | Evidencia requerida |
|---|---|---|---|
| UBER-017 | Invalid Signature | POST con sig inválida al webhook | 401 |
| UBER-011 | Exactly-once | Insertar mismo evento 2x vía DB directo | 1 sola fila en integration_webhook_events |
| UBER-016 | Dup Webhook | Simular doble POST al webhook | 200 sin duplicate en delivery_orders |
| UBER-019 | DLQ | Forzar error en handler | Fila en integration_webhook_dlq con failure_reason |
| UBER-018 | Retry | Simular fallo transitorio en withRetry | Log de retry, éxito en intento N |
| UBER-020 | Reconciliation | POST /reconcile con órdenes stuck > 30min | Órdenes resueltas |

### Categoría B: Evidencia real Uber (requiere B-1..B-5 completos)

| ID | Capability | Paso | Evidencia requerida |
|---|---|---|---|
| UBER-001 | OAuth/USL | GET /auth/initiate?store_id=TEST | Redirect a Uber, tokens en integration_providers |
| UBER-002 | Store Mapping | Insertar fila en integration_store_mappings | store_id → client_id, DB-first routing funciona |
| UBER-003 | Upload Menu | POST /api/integrations/uber-eats/menu | 200 OK, menú visible en Uber app sandbox |
| UBER-005 | Mark OOS | POST /menu {action:"oos"} | Item no disponible en sandbox app |
| UBER-006 | Restore Item | POST /menu {action:"restore"} | Item disponible de nuevo |
| UBER-008 | Get Store Status | GET /api/integrations/uber-eats/store?store_id=... | is_open = true |
| UBER-009 | Order Notification | Uber envía webhook de nueva orden | Entrada en integration_webhook_events status=processed |
| UBER-010 | Get Order Details | Automático en webhook handler | auditLog action=order.get_details |
| UBER-012 | Accept | Automático tras nuevo pedido | auditLog action=order.accept, status 200 |
| UBER-007 | Store Status Webhook | Uber envía store.status event | integration_store_mappings.store_open actualizado |
| UBER-013 | Deny | POST /order {action:"deny",reason:"ITEM_UNAVAILABLE"} | Deny enviado a Uber, auditLog |
| UBER-014 | Cancel | POST /order {action:"cancel",reason:"CUSTOMER_CALLED_TO_CANCEL"} | Cancel enviado |
| UBER-015 | Mark Ready | Click "Lista para recoger" en /pos/delivery | markOrderReady llamado, auditLog |

## Plantilla de evidencia por capability

```
Test ID:          UBER-XXX
Capability:       [nombre]
Timestamp UTC:    YYYY-MM-DDTHH:MM:SSZ
Provider store:   [UBER_TEST_STORE_ID]
Uber order/event: [id desde Uber]
Fullsite order:   [id en delivery_orders]
Correlation ID:   [uuid de integration_audit_log]
HTTP result:      [código y body]
Webhook result:   [status en integration_webhook_events]
UI/KDS result:    [visible en /pos/delivery]
Evidence:         [screenshot path o log snippet]
Verdict:          PASS / FAIL
```

## Definition of Done por capability

Una capability está CERTIFICADA cuando:
1. Implementada en código
2. Test unitario pasa (vitest)
3. Log correlacionable en `integration_audit_log` con `correlation_id`
4. Evidencia externa verificable (Uber Developer Console o test store response)
5. No hay duplicados bajo retry
6. Actualización en `CAPABILITY-MATRIX.md`

## Gate antes del Google Form

No llenar el formulario hasta que:
- [ ] Todos los flujos Categoría B ejecutados con evidencia
- [ ] Actividad verificable en logs de Uber Developer Console
- [ ] USL end-to-end completado con merchant real
- [ ] No hay casos FAIL
- [ ] Timestamps y correlation IDs documentados
- [ ] Daniel revisa demo en /pos/delivery con orden de test store

## Smoke test pre-producción

Antes de activar `UBER_ENV=production`:
1. Verificar `UBER_WEBHOOK_SECRET` rotado (sandbox ≠ producción)
2. Verificar `integration_store_mappings` tiene store_id de producción
3. Correr reconciliation con client_id de AMALAY
4. Verificar delivery/page.tsx recibe órdenes del test store

## Ticket Uber

Al completar todas las capabilities con test store:
```
Asunto: POS Integration Certification Request
Cuerpo: Fullsite POS integration ready for certification.
        Reference ticket: #D5FEA8
        Webhook URL: https://app.fullsite.mx/api/integrations/uber-eats/webhook
        All capabilities implemented and tested with test store.
```
