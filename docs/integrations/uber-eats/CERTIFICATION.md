# Uber Eats — Certification Checklist

Referencia: Uber Eats Marketplace API Integration Guide.
Ticket siguiente: abrir nuevo ticket mencionando `#D5FEA8`.

## Estado actual (2026-08-01)

| Capa | Estado |
|---|---|
| DB migration staging | ✓ Aplicada — 5 tablas, 6 índices, RLS confirmado |
| Integration Framework código | ✓ En `main` local — pendiente push a origin |
| **Categoría A** (tests automatizados) | **CERRADA — 67/67 PASS — 3 bugs cerrados** |
| Categoría B (sandbox con Uber real) | BLOQUEADA — requiere B-1..B-5 |
| Deployment público | BLOCKER B-1 — ~28 commits locales sin pushear |
| Env vars Vercel (UBER_*) | BLOCKER B-2 |
| Webhook registrado en Uber | BLOCKER B-4 — depende de B-1 |
| Store mapping test store | BLOCKER B-5 — depende de B-3 |

## Categoría A — CERRADA

**Resultado final: 67/67 PASS — suite `category-a.test.ts` — vitest v4.1.7**

Commits que cierran Categoría A:
- `15f5523` — guards SUPABASE_SERVICE_KEY + suite inicial (63 tests)
- `efbc2dc` — fix P0 fail-closed + 4 tests adicionales (→ 67 tests)

Reporte completo: artifact `e4de3942-ddf5-4a52-8e2e-a4968adfd046` (v2)

### Grupos de tests

| Grupo | IDs | Tests | Estado |
|---|---|---|---|
| Environment Guards | 001–006 | 6 | PASS |
| HMAC Verification | 007–013 | 7 | PASS |
| OAuth / USL | 020–029 | 10 | PASS |
| Order Normalization | 030–037 | 8 | PASS |
| Webhook Processing | 038–043 | 6 | PASS |
| **Store Mapping + Fail-Closed (P0)** | **044–047e** | **8** | **PASS · P0 BUG FIXED** |
| Dead-Letter Queue | 048–050 | 3 | PASS |
| Audit Log | 051–053 | 3 | PASS |
| Webhook Replay Resistance | 054–057 | 4 | PASS |
| Negative / Edge Cases | 058–063 | 6 | PASS |
| Reconciliation | 064–067 | 4 | PASS |
| **Total** | | **67** | **67 / 67 PASS** |

### Bugs cerrados por Categoría A

**BUG-01** — `webhook/route.ts`: guard `SUPABASE_SERVICE_KEY` ausente
`SB_KEY()` a nivel de módulo hacía fallback a `NEXT_PUBLIC_SUPABASE_ANON_KEY` cuando `SUPABASE_SERVICE_KEY` no estaba presente. El handler POST ejecutaba con privilegios anon-key.
FIX: guard 503 en Step 0 (antes de HMAC) — commit `15f5523`

**BUG-02** — `reconcile/route.ts`: guard ausente + JSON parse no capturado
Misma raíz. Sin guard, `fetch(delivery_orders)` retornaba `Response('')`, `await r.json()` lanzaba `SyntaxError` no capturado.
FIX: guard 503 al inicio del POST — commit `15f5523`

**BUG-03 (P0)** — `webhook/route.ts`: gap de aislamiento multi-tenant
`resolveClientId()` hacía fallback a `UBER_STORE_CLIENT_MAP` (env) y luego a `NEXT_PUBLIC_DEFAULT_CLIENT_ID` cuando `provider_store_id` no tenía entrada en `integration_store_mappings`. Cualquier webhook de una tienda no mapeada persistía una `delivery_order` bajo el tenant por defecto — contaminación cross-tenant sin DLQ ni audit trail.
FIX: `resolveClientId()` retorna `string | null`, sin fallback. Tienda no mapeada → `quarantineUnmappedStore()` — commit `efbc2dc`

## Comportamiento oficial: resolución de cliente (Post-BUG-03)

Esta es la especificación que debe mantenerse en todos los módulos:

```
provider_store_id (del payload Uber)
        ↓
integration_store_mappings WHERE provider='ubereats' AND provider_store_id=<id>
        ↓
  ┌─────┴──────────────────────────┐
  │ Mapping encontrado             │ No encontrado
  ↓                                ↓
client_id                    quarantineUnmappedStore():
  ↓                            1. integration_webhook_events (status='failed', client_id=NULL)
Procesar orden                 2. integration_webhook_dlq (failure_reason='unmapped_store:...')
                               3. auditLog (action='webhook.unmapped_store', correlation_id)
                               4. return 200 a Uber (contrato ACK mantenido)
                               NUNCA fallback a ningún tenant
```

**Prohibido en cualquier punto del stack:**
- Leer `NEXT_PUBLIC_DEFAULT_CLIENT_ID` para resolver tenant en webhooks
- Leer `UBER_STORE_CLIENT_MAP` como fallback de store mapping
- Persistir `delivery_order` con `client_id` hardcodeado cuando el store no está mapeado
- Ignorar silenciosamente un store no mapeado (sin DLQ, sin audit)

**Estado de compliance por módulo:**

| Módulo | Estado |
|---|---|
| `webhook/route.ts` (v2) | ✓ Fail-closed — `resolveClientId()` returns `string \| null` |
| `webhook/ubereats/route.ts` (legacy) | ✓ Fail-closed + deprecation notice — cae silencioso con 200 |
| `cloudflare/delivery-worker/src/index.ts` | ⚠ Deprecated — hardcodea `client_id='amalay'` — solo Rappi/Didi hasta que tengan adapter |
| `order-adapter.ts` | ✓ Limpio — toma `clientId` como parámetro, sin fallback interno |
| `reconcile/route.ts` | ✓ No resuelve store → client; no aplica |
| `handleStoreStatus` | ✓ Solo alcanzable tras resolución exitosa de clientId — inalcanzable para stores no mapeados |

## Blockers para Categoría B

### B-1 (DEPLOY): Push `main` a `origin/main`

~28 commits locales (Integration Framework v1 completo) no pusheados.
El endpoint `https://app.fullsite.mx/api/integrations/uber-eats/webhook` NO está activo.

**Acción**: `git push origin main` → Vercel deploya automáticamente.

### B-2 (CREDENTIALS): Variables de entorno en Vercel

Las siguientes variables NO están configuradas en el proyecto Vercel `fullsite`:

```
UBER_CLIENT_ID          — de Uber Developer Console → sandbox app
UBER_CLIENT_SECRET      — de Uber Developer Console → sandbox app
UBER_WEBHOOK_SECRET     — string aleatorio generado por Fullsite (no por Uber)
UBER_ENV                — valor: sandbox
UBER_REDIRECT_URI       — https://app.fullsite.mx/api/integrations/uber-eats/auth/callback
```

**Nota**: `SUPABASE_SERVICE_KEY` ya existe en Vercel. No tocar.
**Regla**: nunca usar prefijo `NEXT_PUBLIC_` para estas variables — son secretos server-side.
**Acción**: Daniel setea en Vercel Dashboard → Settings → Environment Variables.

### B-3 (STORE ID): Obtener `provider_store_id` del test store

Uber Developer Console asigna un `store_id` al test store de la sandbox app.
Necesitamos ese valor antes de poder insertar el mapping (B-5).

**Acción**: Daniel obtiene el `provider_store_id` desde Uber Developer Console.

### B-4 (WEBHOOK): Registrar URL en Uber Developer Console

URL del webhook: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`

Requiere B-1 resuelto primero — Uber hace un GET al registrar el webhook para verificar que responde 200.

**Acción**: Daniel registra la URL en Uber Developer Console una vez B-1 esté completo.

### B-5 (STORE MAPPING): Insertar mapping con store_id real

Una vez obtenido el `provider_store_id` (B-3), insertar en staging:

```sql
INSERT INTO integration_store_mappings (provider, provider_store_id, client_id)
VALUES ('ubereats', '<UBER_TEST_STORE_ID>', 'sandbox-client');
```

## Pre-requisitos — Sandbox

- [x] DB migration aplicada en staging: `supabase/migrations/20260731000000_integration_framework.sql`
- [x] USL implementado: `/api/integrations/uber-eats/auth/initiate` + `/auth/callback`
- [x] **Categoría A cerrada: 67/67 tests PASS — commits `15f5523` + `efbc2dc`**
- [ ] **B-1** Push `main` → Vercel deploy
- [ ] **B-2** `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_WEBHOOK_SECRET`, `UBER_ENV=sandbox`, `UBER_REDIRECT_URI`
- [ ] **B-3** `provider_store_id` del test store obtenido de Uber Developer Console
- [ ] **B-4** Webhook URL registrada: `https://app.fullsite.mx/api/integrations/uber-eats/webhook`
- [ ] **B-5** Store mapping insertado: `('ubereats', '<UBER_TEST_STORE_ID>', 'sandbox-client')`

## Categoría B — Tests con Uber real (requiere B-1..B-5)

| ID | Capability | Paso | Evidencia requerida |
|---|---|---|---|
| UBER-001 | OAuth/USL | GET /auth/initiate?store_id=TEST | Redirect a Uber, tokens en `integration_providers` |
| UBER-002 | Store Mapping | Verificar B-5 activo | store_id → client_id, webhook de test store resuelto |
| UBER-003 | Upload Menu | POST /api/integrations/uber-eats/menu | 200 OK, menú visible en Uber app sandbox |
| UBER-005 | Mark OOS | POST /menu {action:"oos"} | Item no disponible en sandbox app |
| UBER-006 | Restore Item | POST /menu {action:"restore"} | Item disponible de nuevo |
| UBER-008 | Get Store Status | GET /api/integrations/uber-eats/store?store_id=... | `is_open = true` |
| UBER-009 | Order Notification | Uber envía webhook de nueva orden | Entrada en `integration_webhook_events` status=processed |
| UBER-010 | Get Order Details | Automático en webhook handler | `auditLog action=order.get_details` |
| UBER-011 | Exactly-once | Uber reenvía mismo webhook | 1 sola fila en `integration_webhook_events` |
| UBER-012 | Accept | Automático tras nuevo pedido | `auditLog action=order.accept`, status 200 |
| UBER-007 | Store Status Webhook | Uber envía `store.status` event | `integration_store_mappings.store_open` actualizado |
| UBER-013 | Deny | POST /order {action:"deny",reason:"ITEM_UNAVAILABLE"} | Deny enviado a Uber, `auditLog` |
| UBER-014 | Cancel | POST /order {action:"cancel",reason:"CUSTOMER_CALLED_TO_CANCEL"} | Cancel enviado |
| UBER-015 | Mark Ready | Click "Lista para recoger" en /pos/delivery | `markOrderReady` llamado, `auditLog` |
| UBER-016 | Dup Webhook | Uber reintenta webhook procesado | 200 sin duplicate en `delivery_orders` |
| UBER-017 | Invalid Signature | POST con sig inválida | 401 |
| UBER-018 | Retry | Fallo transitorio en `withRetry` | Log de retry, éxito en intento N |
| UBER-019 | DLQ | Error forzado en handler | Fila en `integration_webhook_dlq` |
| UBER-020 | Reconciliation | POST /reconcile con órdenes stuck >30min | Órdenes resueltas |

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

## Pre-requisitos adicionales — Producción (NO ejecutar hasta sandbox completo)

- [ ] **USL end-to-end** con merchant real → tokens en `integration_providers`
- [ ] `UBER_ENV=production` + credenciales de producción
- [ ] Webhook URL definitiva registrada en producción
- [ ] `integration_store_mappings` con store_id de producción real
- [ ] `UBER_WEBHOOK_SECRET` rotado (sandbox ≠ producción)
- [ ] Cifrado en reposo para `integration_providers._enc` columns (pre-producción blocker)

## Risk Register (pre-producción, no sandbox-blocking)

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Tokens sin cifrado en reposo (`integration_providers._enc`) | MEDIUM | Implementar envelope encryption antes de activar producción |
| `SB_KEY()` fallback a anon key aún existe en código | LOW | Guards en Step 0 garantizan 503 antes de cualquier operación privilegiada |
| Reconcile: `LIMIT 50` sin paginación | LOW | Aceptable para sandbox; cursorizar antes de producción con volumen alto |
| `sha256=` prefix handling (CAT-A-057) | LOW | Uber spec exige el prefijo; comportamiento edge aceptado — nunca 500 |

## Gate antes del Google Form (Uber Certification)

No llenar el formulario hasta que:
- [ ] Categoría B completa — todos los UBER-001..UBER-020 con evidencia real
- [ ] Actividad verificable en logs de Uber Developer Console
- [ ] USL end-to-end completado con merchant real
- [ ] Cero casos FAIL
- [ ] Timestamps y correlation IDs documentados
- [ ] Daniel revisa demo en /pos/delivery con orden del test store

## Smoke test pre-producción

Antes de activar `UBER_ENV=production`:
1. Verificar `UBER_WEBHOOK_SECRET` rotado (sandbox ≠ producción)
2. Verificar `integration_store_mappings` tiene store_id de producción
3. Correr reconciliation con client_id de AMALAY
4. Verificar `/pos/delivery` recibe órdenes del test store
5. Confirmar que ningún store no mapeado resulta en delivery_order — ejecutar CAT-A-047 contra staging

## Ticket Uber (al completar Categoría B)

```
Asunto: POS Integration Certification Request
Cuerpo: Fullsite POS integration ready for certification.
        Reference ticket: #D5FEA8
        Webhook URL: https://app.fullsite.mx/api/integrations/uber-eats/webhook
        All capabilities implemented and tested with test store.
```
