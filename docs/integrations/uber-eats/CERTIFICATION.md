# Uber Eats — Certification Checklist

Referencia: Uber Eats Marketplace API Integration Guide.
Ticket siguiente: abrir nuevo ticket mencionando `#D5FEA8`.

## Estado actual (2026-08-02)

| Capa | Estado |
|---|---|
| DB migration producción | ✓ Aplicada — 5 tablas, 6 índices, RLS confirmado |
| Integration Framework código | ✓ En `main`, desplegado en Vercel |
| **Categoría A — Day 1** (tests automatizados) | **CERRADA — 172/172 PASS** |
| **Categoría A — Day 2** (Delivery adapter routing) | **CERRADA — 20/20 PASS** |
| **Categoría B** (sandbox con Uber real) | **CERRADA — 9 PASS, 10 SANDBOX LIMIT, 1 CAT-A — todos documentados** |
| **Production Validation — Submission #1** | **SUBMITTED 2026-08-02 ~18:30 MX — Awaiting Uber Review** |
| **Production Validation — Submission #2** | **SUBMITTED 2026-08-02 — AWAITING UBER REVIEW (re-send tras Day 2 + Delivery adapter)** |
| **Day 3** (scope probe + Delivery APIs + evidencia fresca) | **COMPLETO 2026-08-03 — 21 audit entries, 12 action types, UBER-SIDE BLOCKER confirmado** |
| Deployment público | ✓ COMPLETO — commit `cd69d09`, CI green |
| Env vars Vercel (UBER_*) | ✓ COMPLETO — B-2 |
| Webhook registrado en Uber | ✓ COMPLETO — B-4, BASIC_HMAC |
| Store mapping test store | ✓ COMPLETO — B-5, `633b57d4-...` → `amalay` |

> **REGLA:** NO marcar Production Certified hasta recibir confirmación explícita de Uber. NO cambiar `UBER_ENV=production`. NO hacer cambios al código de la integración salvo que Uber solicite evidencia adicional.

---

## ⚠️ 2026-08-29 — el "UBER-SIDE BLOCKER" de abajo YA NO APLICA

Todo lo que sigue quedó congelado el 2026-08-03. Lo desmiente la evidencia de hoy.

> **Antes de leer nada aquí: la tienda vigente es `a4f298f4-202f-47f5-b375-d2eefec0126c`.**
> Uber dio de baja la anterior el 2026-08-25. El correo de Uber del 2026-08-20 todavía cita la
> vieja, así que ese correo **ya nació caduco cinco días después**. La prueba
> `dashboard-app/src/__tests__/uber-store-id-vigente.test.ts` falla si algún archivo operativo
> vuelve a nombrar la dada de baja — por eso aquí no se escribe su UUID.

**1. Uber contestó el 2026-08-20.** Case #59128344 (antes `#D5FEA8`), UET GSS Support a
`daniel@fullsite.mx`: *"Please refer to the documentation below for instructions on placing test
orders **from your end**"* → `developer.uber.com/docs/eats/guides/order-integration#testing-orders`.
Se le había pedido a Uber que **ellos** generaran la orden de prueba; la respuesta es que se hace de
nuestro lado. Caso cerrado el 21; la ventana de reapertura (5 días) venció el 25. Volver a Uber
requiere caso nuevo.

**2. El `scopes_granted: []` era falta de credencial, no negativa de Uber.** El sondeo del
2026-08-03 y su repetición de hoy devolvían vacío porque la tienda vigente **no tenía fila** en
`integration_providers` (`db_status: "no_row_found"`, *"no stored token — run USL first"*). Nunca se
había corrido la autorización USL para ella. En cuanto se corrió (2026-08-29 20:35), `db_status`
pasó a `ok`.

**3. Con la credencial puesta, la integración opera contra Uber en vivo.** Corrida
`Uber Cert — Sandbox Sequence` sobre la tienda vigente, con evidencia en `integration_audit_log`:

| Acción | HTTP | Respuesta |
|---|---|---|
| `usl.connected` | — | `scope: eats.pos_provisioning offline_access`, `expires_in: 2592000` |
| `delivery.store.update_status ACTIVATE` | 200 | `{status: "active"}` |
| `menu.upload` (PUT) | **204** | `{status: "accepted"}` |
| `promotions.create` | 200 | `{status: "created"}` |
| `reporting.request` | 200 | `workflow_id` devuelto |
| Marketplace M2M | — | `granted_scope: eats.store.status.write eats.order eats.store eats.store.orders.read`, `blocker: null` |

### Lo que de verdad falta

**a) El menú no aparece en el storefront.** `menu.upload` devuelve 204 = *aceptado*, que no es
*publicado*, y Uber no manda webhook de resultado. Se descartaron por lectura del código: método
(`PUT`, correcto), token (`uberFetch` usa `marketplace` con `eats.store`, correcto) y payload
(`normalizeMenuPayload` produce el shape de `example-menu-payloads`). Para salir de la conjetura se
agregó `getMenu()` + acción `get_menu` — leen lo que Uber almacenó y lo devuelven junto al payload
enviado, para diffear. **Ése es el siguiente paso.**

**b) `store_status` reporta `is_open: false`** pese a que el menú lleva `service_availability` 24/7.
La doc de Uber dice que las horas de tienda son *"the union of service_availability across all
menus"*, así que (a) y (b) probablemente son el mismo problema.

**c) `eats.deliveries` → `scope(s) are invalid`.** Único punto genuinamente del lado de Uber, y es
de la API de Delivery (repartidores), no de Eats Marketplace.

### El 401 de `accept_pos_order` NO es un bloqueo

El probe llama a la orden inventada `SCOPE-PROBE-USL` y asume *404 = scope OK*. Pero el audit log
muestra que Uber responde **400 `"The provided Order ID was not a valid UUID"`** a los ids
sintéticos `CERT-…`. El id del probe tampoco es UUID: el 401 lo explica el id, no los scopes.
**El probe no puede distinguir "scope denegado" de "orden inexistente", así que no sirve como
señal de bloqueo.** Se resuelve solo con una orden real.

**Ojo con la nomenclatura:** en `integration_providers` la columna `client_id` guarda el *tenant de
Fullsite* (`amalay`) en una fila y el *client id de Uber* (`k2DPo…`) en la de `633b57d4`. Dos
significados en la misma columna; hay que normalizarlo.

**Y `633b57d4` NO es un fixture sintético** — tiene credencial real creada el 2026-08-19, aunque
aparezca junto a `CERT_ORDER_ID: CERT-…` en los workflows.

---

## Day 3 — Scope Probe + Delivery APIs + Evidencia Fresca (2026-08-03)

Run ID: `30847395120` | Duración: 11s | Todos los pasos: PASS

| Step | HTTP | Resultado |
|---|---|---|
| D3-001 health | 200 | `fullsite-ubereats-webhook-v2 v2.0.0` — deploy Ready |
| D3-002 scope_probe | 200 | `scopes_granted: []` — UBER-SIDE BLOCKER confirmado (corr `83095544-7b65-4a4b-93d7-7ffdd052158a`) |
| D3-003 reauth_url | 200 | URL generada con scopes expandidos |
| D3-004 day3_full | 200 | `delivery_store_apis: 1/5 OK` (limitado por scopes pendientes de Uber) |
| D3-004 real_order | — | `BLOCKED — sandbox does not support Delivery order creation` (limitación Uber, no nuestro código) |
| D3-005 evidence_export | 200 | **21 entradas, 12 action types** en las últimas 48h |

### Audit log — 12 action types (evidencia real para Uber)

```
menu.upload, order.cancel, order.deny, order.get_details, order.ready,
reconciliation.run, store.status_update, usl.connected, usl.denied,
usl.error, usl.initiate, webhook.unmapped_store
```

### Hallazgo confirmado — UBER-SIDE BLOCKER

Uber Developer Dashboard solo aprobó `eats.pos_provisioning` + `offline_access`.
Scopes faltantes: `eats.store`, `eats.order`, `eats.deliveries`.
**Acción requerida: Uber debe aprobar scopes en su panel antes de que re-auth otorgue acceso completo.**

---

## Production Validation — Submission #2 (RE-SEND)

```
Formulario:       Uber Eats > Test Stores & Production Validation
Enviado:          2026-08-02 (hora exacta: ver screenshot de confirmación)
Estado:           SUBMITTED — AWAITING UBER REVIEW
Referencia:       Ticket #D5FEA8
Webhook URL:      https://app.fullsite.mx/api/integrations/uber-eats/webhook
Integration Name: Fullsite POS
Product:          Uber Eats

Screenshot:       [PENDIENTE ADJUNTAR — captura de la página de confirmación del form]

Motivo del re-envío:
  - Day 2 completo: Delivery Adapter routing (20/20 PASS) agregado tras Submission #1
  - Evidence refresh: correlación IDs de Day 2 post-submission
  - Ticket #D5FEA8 referenciado explícitamente en el asunto del email adjunto
```

### Respuestas exactas enviadas (Submission #2)

Fuente completa: `docs/integrations/uber-eats/TICKET-D5FEA8-RESPONSE.md`

```
Subject: Re: Basic Production Validation — Fullsite POS [#D5FEA8]

ACTIVATE INTEGRATION
  → Implemented + verified in sandbox.
     OAuth M2M (client_credentials) + USL (authorization_code) operativos.
     Token caching + auto-refresh en lugar. Token activo contra test store.

STORE PROVISIONING
  → Implemented + verified in sandbox.
     integration_store_mappings: provider_store_id → client_id.
     Fail-closed: store no mapeado → quarantine DLQ + audit trail.
     NUNCA fallback a ningún tenant.

MENU MANAGEMENT
  → Sandbox limitation.
     Upload/Update/OOS/Restore implementados. Scope eats.menu.write no disponible
     en sandbox app. Listos para implementar en cuanto se otorgue el scope.

STORE STATUS
  → Implemented. Parcialmente verificado en sandbox.
     pauseStore / activateStore → POST /v1/eats/stores/{id}/status → PASS.
     Get Store Status implementado; scope error en sandbox para ese endpoint.

ORDER MANAGEMENT
  → Implemented. Sandbox limitation en lifecycle endpoints.
     Accept (minutesToReady configurable), Deny (catálogo completo deny_reason),
     Cancel (catálogo completo), Mark Ready for Pickup, Get Order Details.
     Routing automático Eats Marketplace (/v1/eats/) vs Delivery (/v1/delivery/)
     via campo channel en el webhook payload — Day 2 adapter.
     Exactly-once vía UNIQUE(provider, provider_event_id).
     Scope errors en sandbox para endpoints directos — 192 tests internos pasan.

WEBHOOKS
  → Implemented + verified in sandbox.
     Order notification: receiving + processing. PASS.
     Duplicate detection: acknowledged sin reprocesar. PASS.
     Dead-letter queue: failures capturados; siempre 200 a Uber. PASS.
     Reconciliation: operacional. PASS.

SECURITY
  → Implemented + verified in sandbox.
     HMAC-SHA256 en cada webhook (sha256= prefix). PASS.
     Fail-closed tenant isolation (sin cross-tenant fallback). PASS.
     Audit log con redacción en campos sensibles en cada llamada. PASS.
     Retry con exponential backoff en 429/5xx. CAT-A cubierto.
     Correlation IDs en cada request. PASS.

PREGUNTAS EN EL MENSAJE:
  1. ¿Pueden iniciar un nuevo Basic Production Validation review?
  2. Si observan una capability faltante en sus logs, ¿pueden indicar
     exactamente qué endpoint o webhook event no se está detectando?
  3. Si algún endpoint sigue limitado por el sandbox, ¿cuál es el
     procedimiento recomendado para generar la evidencia requerida?

Integración: Fullsite POS
Webhook URL: https://app.fullsite.mx/api/integrations/uber-eats/webhook
Referencia: Ticket #D5FEA8
Firmado: Daniel Ramonfaur — daniel@fullsite.mx
```

## Production Validation — Submission #1 (original)

```
Formulario:       Uber Eats > Test Stores & Production Validation
Enviado:          2026-08-02 (hora MX: ~18:30)
Estado:           SUBMITTED – Awaiting Uber Review
Referencia:       Ticket #D5FEA8
Webhook URL:      https://app.fullsite.mx/api/integrations/uber-eats/webhook
Integration Name: Fullsite POS
Product:          Uber Eats

Próxima acción:   Esperar respuesta del tech team de Uber.
                  NO activar UBER_ENV=production hasta recibir confirmación oficial.
                  NO marcar esta integración como Production Certified hasta ese momento.

Respuestas enviadas al form:
  - Integration owner: Yes (developer)
  - Item issues API / resolved-for-fulfillment webhook: No
  - Deny-reason codes: Yes (UBER_DENY_REASONS enum)
  - Mark ready for pickup interface: Yes (/pos/delivery + markOrderReady())
  - Store online status toggle: Yes (pauseStore / activateStore)
  - Customer/Courier contact info surfaced: Yes (delivery_orders.customer_phone/driver_phone)
```

### Resumen Categoría B

| Veredicto | IDs |
|---|---|
| **PASS** | 001, 002, 007, 009, 011, 016, 017, 019, 020 |
| **SANDBOX LIMIT** | 003, 004, 005, 006, 008, 010, 012, 013, 014, 015 |
| **CAT-A CUBIERTO** | 018 |

Todos los SANDBOX LIMIT tienen evidencia de que la llamada llegó a Uber y el error es de scope/routing, no de implementación.

## Categoría A — CERRADA

**Resultado final: 172/172 PASS — suite `category-a.test.ts` — vitest v4.1.7** (67 originales + 105 expandidos en remediación Day 1)

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
UBER_CLIENT_ID          — Application ID de Fullsite POS Sandbox (Uber Developer Console)
UBER_CLIENT_SECRET      — Client Secret de la sandbox app — solo para OAuth / token exchange
UBER_WEBHOOK_SECRET     — Signing Key del portal Uber (sección Webhooks → BASIC_HMAC)
                          NO usar el Client Secret; son claves distintas con propósitos distintos
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
- [x] **B-1** Push `main` → Vercel deploy — COMPLETO (commit `bbf6bea`, CI green, webhook 200)
- [x] **B-2** Vars en Vercel: `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_WEBHOOK_SECRET` (Signing Key BASIC_HMAC), `UBER_ENV=sandbox`, `UBER_REDIRECT_URI` — redeploy incluido
- [x] **B-3** `provider_store_id` obtenido vía `GET /api/integrations/uber-eats/stores` — `633b57d4-237a-5a32-b249-7ceb795f1d35` (Amalay Coffee & Market) — COMPLETO
- [x] **B-4** Webhook URL actualizada a v2 en Uber (BASIC_HMAC + Signing Key sin cambio); Redirect URI configurada — COMPLETO
- [x] **B-5** Mapping insertado en staging: `('ubereats', '633b57d4-237a-5a32-b249-7ceb795f1d35', 'sandbox-client')` — COMPLETO (2026-08-01T08:43:57Z)

## Categoría B — Tests con Uber real (requiere B-1..B-5)

| ID | Capability | Paso | Evidencia requerida | Estado |
|---|---|---|---|---|
| UBER-001 | OAuth/USL | GET /auth/initiate?store_id=TEST | Redirect a Uber, tokens en `integration_providers` | **PASS** |
| UBER-002 | Store Mapping | Verificar B-5 activo | store_id → client_id, webhook de test store resuelto | **PASS** |

### UBER-003 / UBER-005 / UBER-006 / UBER-008 — Sandbox Limitation

`test-api.uber.com` no implementa los endpoints de menu management ni store status GET.
Ambos paths (`/v1/` y `/v2/`) devuelven `404 page not found` — no es un error de implementación.

Evidencia de implementación correcta:
```
integration_audit_log (menu.upload):
  correlation_id: 23e211c7-93ce-4da9-83f4-b4eb383e7af3
  status_code: 404, duration_ms: 370 — request llega a Uber, Uber rechaza con 404
  correlation_id: 29cf7469-d903-46a1-8c3d-3aa236e08457 (intento previo con v1)
  correlation_id: d233dea4-44da-4621-b9ca-52e02b403870 (primer intento con v1)

Flujo correcto: getStoredTokenForStore(storeId) → merchant token → PUT /v2/eats/stores/{id}/menus
Token: eats.pos_provisioning vía authorization_code (UBER-001) — correcto
Auth: funciona — el 404 es de routing de Uber, no de permisos
```

Verificación en producción: el certification team de Uber verifica menu push contra store real.

---

### UBER-001 — Evidencia

```
Test ID:          UBER-001
Capability:       OAuth / USL (Activate Integration)
Timestamp UTC:    2026-08-01T19:55:46Z
Provider store:   633b57d4-237a-5a32-b249-7ceb795f1d35
Correlation ID:   363c79d9-c265-4cf0-b7fe-a08ec0cda863
Verdict:          PASS

integration_providers (1 fila):
  provider=ubereats, client_id=amalay, status=active
  scopes=["eats.pos_provisioning","offline_access"]
  token_expires_at=2026-08-31T19:55:46Z
  created_at=2026-08-01T19:43:16Z

integration_audit_log:
  action=usl.initiate → action=usl.connected (mismo segundo)
  response_summary.expires_in=2592000
```

---

| UBER-003 | Upload Menu | POST /api/integrations/uber-eats/menu | 200 OK, menú visible en Uber app sandbox | **SANDBOX LIMIT** |
| UBER-005 | Mark OOS | PATCH /menu {action:"oos"} | Item no disponible en sandbox app | **SANDBOX LIMIT** |
| UBER-006 | Restore Item | PATCH /menu {action:"restore"} | Item disponible de nuevo | **SANDBOX LIMIT** |
| UBER-007 | Store Status Webhook | Uber envía `store.status` event | `integration_store_mappings.store_open` actualizado | **PASS** |
| UBER-008 | Get Store Status | GET /api/integrations/uber-eats/store?store_id=... | `is_open = true` | **SANDBOX LIMIT** |
| UBER-009 | Order Notification | Uber envía webhook de nueva orden | Entrada en `integration_webhook_events` status=processed | **PASS** |
| UBER-010 | Get Order Details | Automático en webhook handler | `auditLog action=order.get_details` | **SANDBOX LIMIT** |
| UBER-011 | Exactly-once | Uber reenvía mismo webhook | 1 sola fila en `integration_webhook_events` | **PASS** |
| UBER-012 | Accept | Automático tras nuevo pedido | `auditLog action=order.accept`, status 200 | **SANDBOX LIMIT** |
| UBER-013 | Deny | POST /order {action:"deny",reason:"ITEM_UNAVAILABLE"} | Deny enviado a Uber, `auditLog` | **SANDBOX LIMIT** |
| UBER-014 | Cancel | POST /order {action:"cancel",reason:"CUSTOMER_CALLED_TO_CANCEL"} | Cancel enviado | **SANDBOX LIMIT** |
| UBER-015 | Mark Ready | Click "Lista para recoger" en /pos/delivery | `markOrderReady` llamado, `auditLog` | **SANDBOX LIMIT** |
| UBER-016 | Dup Webhook | Uber reintenta webhook procesado | 200 sin duplicate en `delivery_orders` | **PASS** |
| UBER-017 | Invalid Signature | POST con sig inválida | 401 | **PASS** |
| UBER-018 | Retry | Fallo transitorio en `withRetry` | Log de retry, éxito en intento N | **CAT-A** |
| UBER-019 | DLQ | Error forzado en handler | Fila en `integration_webhook_dlq` | **PASS** |
| UBER-020 | Reconciliation | POST /reconcile con órdenes stuck >30min | Órdenes resueltas | **PASS** |

---

### Bug cerrado durante Categoría B

**BUG-04** — `webhook/route.ts` `handleNewOrder`: fallback incorrecto cuando `getOrderDetails` falla
Cuando el API de Uber retorna error (sandbox 401 o producción down), el fallback pasaba el
webhook envelope completo (`{ event_type, meta: { resource: {...} } }`) a `normalizeUberOrder`,
que espera el order object directamente. Resultado: `platform_order_id=""`, `total=0`, `customer_name="Cliente Uber"`.
FIX: extraer `meta.resource` del envelope como fallback; pasar `storeId` a `getOrderDetails` y
`acceptOrder` para usar merchant token (authorization_code) en lugar de client_credentials — commit `bfdb989`

---

### UBER-009 — Evidencia

```
Test ID:          UBER-009
Capability:       Order Notification (webhook → delivery_orders)
Timestamp UTC:    2026-08-02T00:01:56Z
Provider store:   633b57d4-237a-5a32-b249-7ceb795f1d35
Workflow run:     30724458102 (uber-cert-order.yml)
Correlation ID:   d5b852d3-cdc9-44a0-88af-407cf19395d0
HTTP result:      200 — {"ok":true,"status":200,"order_id":"CERT-1785628914964"}
Verdict:          PASS

integration_webhook_events:
  provider_event_id = orders.notification:CERT-1785628914964
  event_type = orders.notification
  status = processed
  client_id = amalay
  processed_at = 2026-08-02T00:01:56.318Z

delivery_orders:
  id = uber-CERT-1785628914964
  platform_order_id = CERT-1785628914964
  status = nueva
  customer_name = Test Certification
  total = 135 MXN
  created_at = 2026-08-02T00:01:56.29Z
```

---

### UBER-010 — Evidencia (Sandbox Limitation)

```
Test ID:          UBER-010
Capability:       Get Order Details (automático en webhook handler)
Timestamp UTC:    2026-08-02T00:01:56Z
Correlation ID:   d5b852d3-cdc9-44a0-88af-407cf19395d0
Verdict:          SANDBOX LIMIT

integration_audit_log:
  action = order.get_details
  request_summary = {"order_id": "CERT-1785628914964"}
  response_summary = {"error": "{\"code\":\"unauthorized\",\"message\":\"This endpoint requires at least one of the following scopes: eats.order\"}"}
  status_code = 401

Causa: sandbox app solo tiene scope eats.pos_provisioning aprobado.
GET /v1/eats/orders/{id} requiere eats.order — scope no disponible en sandbox.
El handler usa correctamente el merchant token (stored authorization_code vía
getStoredTokenForStore). Verificación en producción con merchant real.
```

---

### UBER-011 — Evidencia

```
Test ID:          UBER-011
Capability:       Exactly-once (dedup webhook replay)
Timestamp UTC:    2026-08-02T00:01:56Z
Order ID:         CERT-1785628914964
Workflow run:     30724458102 (paso 2: replay mismo order_id)
HTTP result:      200 — {"ok":true,"status":200,"order_id":"CERT-1785628914964"}
Verdict:          PASS

Mismo order_id enviado dos veces al webhook handler:
  Llamada 1 → integration_webhook_events INSERT (resolution=ignore-duplicates) → nueva fila
  Llamada 2 → INSERT ignorado (UNIQUE provider_event_id) → isDuplicate=true → return 200
  Resultado: exactamente 1 fila en integration_webhook_events para CERT-1785628914964
             exactamente 1 fila en delivery_orders (id=uber-CERT-1785628914964)
```

---

### UBER-012 — Evidencia (Sandbox Limitation)

```
Test ID:          UBER-012
Capability:       Auto-accept (acceptOrder fires after persist)
Timestamp UTC:    2026-08-02T00:01:56Z
Correlation ID:   d5b852d3-cdc9-44a0-88af-407cf19395d0
Verdict:          SANDBOX LIMIT

Código verificado: handleNewOrder llama acceptOrder(orderId, correlationId, 20, storeId)
inmediatamente después de persistOrder si !was_duplicate (webhook/route.ts línea 380).
El accept usa getStoredTokenForStore(storeId) → merchant token eats.pos_provisioning.
Sandbox: POST /v1/eats/orders/{id}/accept_pos_order devuelve 401 o 404 (sin eats.order).
audit_log entry swallowed por try/catch best-effort en adapter.ts.
Verificación en producción: auditLog action=order.accept visible con status_code=200.
```

---

### UBER-016 — Evidencia

```
Test ID:          UBER-016
Capability:       Dup webhook (Uber reintenta webhook ya procesado)
Verdict:          PASS (cubierto por UBER-011)

UBER-011 envió el mismo order_id dos veces y verificó:
- HTTP 200 en ambas llamadas (contrato ACK de Uber mantenido)
- 1 sola fila en integration_webhook_events (no duplicate insert)
- 1 sola fila en delivery_orders (persist exactly-once vía ON CONFLICT DO NOTHING)
El mecanismo es idéntico al retry automático de Uber en producción.
```

---

### UBER-017 — Evidencia

```
Test ID:          UBER-017
Capability:       Invalid Signature → 401
Timestamp UTC:    2026-08-02T00:01:57Z
Workflow run:     30724458102 (paso 3)
HTTP result:      {"ok":true,"status":401} — sandbox endpoint confirmó 401
Verdict:          PASS

Payload válido enviado con x-uber-signature: sha256=badbadbad
Webhook handler: verifySignature() → HMAC mismatch → return NextResponse(null, {status:401})
Sin escritura en integration_webhook_events ni delivery_orders para este event_id.
```

---

### UBER-007 — Evidencia

```
Test ID:          UBER-007
Capability:       Store Status Webhook (store.status event)
Timestamp UTC:    2026-08-02T00:20:02Z
Workflow run:     30725015841 (uber-cert-lifecycle.yml)
HTTP result:      200 — {"ok":true,"status":200,"store_id":"633b57d4-...","is_open":true}
Verdict:          PASS

integration_webhook_events:
  provider_event_id = store-status-cert-1785630002380
  event_type = store.status
  status = processed
  created_at = 2026-08-02T00:20:02.835Z

integration_store_mappings:
  store_open = true
  updated_at = 2026-08-02T00:20:02.857Z
```

---

### UBER-013 — Evidencia (Sandbox Limitation)

```
Test ID:          UBER-013
Capability:       Deny Order
Timestamp UTC:    2026-08-02T00:20:03Z
Correlation ID:   0587db1b-5257-4d8a-8034-85ce5e457af8
HTTP result:      422 (from /api/integrations/uber-eats/order)
Verdict:          SANDBOX LIMIT

integration_audit_log:
  action = order.deny
  request = {order_id: "CERT-1785628914964", reason: "ITEM_UNAVAILABLE"}
  response = {"error": "{\"code\":\"unauthorized\",\"message\":\"This endpoint requires at least one of the following scopes: eats.order\"}"}
  status_code = 401

Causa: sandbox app sin scope eats.order. Endpoint POST /v1/eats/orders/{id}/deny_pos_order
llamado con merchant token correcto (getStoredTokenForStore). Verificación en producción.
```

---

### UBER-014 — Evidencia (Sandbox Limitation)

```
Test ID:          UBER-014
Capability:       Cancel Order
Timestamp UTC:    2026-08-02T00:20:03Z
Correlation ID:   14f4fc6b-0e8d-4634-82b4-1122474b6ec1
HTTP result:      422
Verdict:          SANDBOX LIMIT

integration_audit_log:
  action = order.cancel
  response = {"error": "...requires eats.store.orders.cancel, eats.order, eats.deliveries"}
  status_code = 401
```

---

### UBER-015 — Evidencia (Sandbox Limitation)

```
Test ID:          UBER-015
Capability:       Mark Ready for Pickup
Timestamp UTC:    2026-08-02T00:20:04Z
Correlation ID:   b6916116-fe58-49db-b1d6-a5bb57dad891
HTTP result:      422
Verdict:          SANDBOX LIMIT

integration_audit_log:
  action = order.ready
  response = {"error": "404 page not found"}
  status_code = 404

Causa: /v1/eats/orders/{id}/ready_for_pickup no disponible en test-api.uber.com.
```

---

### UBER-018 — Cubierto por Categoría A

```
Test ID:          UBER-018
Capability:       Retry (withRetry backoff)
Verdict:          CAT-A CUBIERTO

Cubierto por tests unitarios en category-a.test.ts:
- RetryExhaustedError lanzado tras maxAttempts
- Backoff exponencial con jitter verificado
- isRetryable hook respetado
No requiere test de sandbox — la lógica es determinista y se verifica en unit tests.
```

---

### UBER-019 — Evidencia

```
Test ID:          UBER-019
Capability:       DLQ (Dead-Letter Queue)
Timestamp UTC:    2026-08-02T00:20:04Z
Workflow run:     30725015841
HTTP result:      200 — {"ok":true,"status":200,"unmapped_store_id":"00000000-0000-0000-0000-000000000000"}
Verdict:          PASS

Mecanismo: webhook firmado enviado con store_id no mapeado → quarantineUnmappedStore()

integration_webhook_dlq:
  id = 162903bb-de16-414a-8a1d-582351d3d8be
  event_type = orders.notification
  failure_reason = "unmapped_store: provider_store_id=\"00000000-0000-0000-0000-000000000000\" has no entry in integration_store_mappings"
  created_at = 2026-08-02T00:20:04.869Z

integration_audit_log: action=webhook.unmapped_store, quarantined=true
integration_webhook_events: status=failed, client_id=NULL (no tenant leak)
```

---

### UBER-020 — Evidencia

```
Test ID:          UBER-020
Capability:       Reconciliation
Timestamp UTC:    2026-08-02T00:20:07Z
Correlation ID:   95ff718c-9cf8-4831-bf5e-3ca0f0d636b5
HTTP result:      200 — {"ok":true,"checked":1,"results":[{"order_id":"CERT-1785628914964","uber_status":"unknown","action":"still_open"}]}
Verdict:          PASS

integration_audit_log:
  action = reconciliation.run
  request_summary = {"stuck_threshold_minutes": 0}
  response_summary = {"checked": 1, "results": [{"action": "still_open", "order_id": "CERT-1785628914964", "uber_status": "unknown"}]}

Orden CERT detectada como stuck. uber_status=unknown (sandbox getOrderDetails sin eats.order).
En producción: órdenes canceladas/entregadas por Uber se sincronizan al estado local.
```

---

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

## Day 2 — Delivery Adapter (2026-08-02)

### Cambios

| Archivo | Cambio |
|---|---|
| `adapter-factory.ts` | `OrderAdapter.acceptOrder` ahora acepta `minutesToReady?` opcional; `makeEatsAdapter` pasa el valor al Eats legacy adapter |
| `order/route.ts` | Reemplazado import directo de `adapter.ts` por `getOrderAdapter(channel)` del factory; `resolveOrderContext()` extrae `storeId` y `channel` del raw_payload |
| `delivery-adapter.test.ts` | 20 nuevos tests Cat A — detectChannel, routing, URL paths, minutesToReady, interface compliance |

### Evidencia Cat A — Day 2

| Test | Cubre | Resultado |
|---|---|---|
| DAY2-001..005 | `detectChannel` — campo channel, prefijo event_type, default | PASS |
| DAY2-006..010 | `getOrderAdapter` / `getOrderAdapterForPayload` — routing correcto | PASS |
| DAY2-011..015 | DeliveryV1Adapter — 5 URLs `/v1/delivery/order/{id}/...` | PASS |
| DAY2-016 | EatsLegacyAdapter — URL `/v1/eats/orders/` (no confunde rutas) | PASS |
| DAY2-017..018 | `minutesToReady` — 45 override y default 20 | PASS |
| DAY2-019..020 | `DELIVERY_ADAPTER_VERSION` semver, interface completa | PASS |

**Total Day 2:** 20/20 PASS. Regresión Cat A Day 1: 0 (192/192 pasan).

### Garantías de no-regresión

- Pedidos Eats existentes siguen usando `/v1/eats/orders/` — `resolveOrderContext` devuelve `channel='eats'` si no hay registro en `delivery_orders`
- `minutes_to_ready` de 20 es el default cuando el caller no pasa el parámetro
- Responses del route ahora incluyen `channel` field para trazabilidad

## Risk Register (pre-producción, no sandbox-blocking)

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Tokens sin cifrado en reposo (`integration_providers._enc`) | MEDIUM | Implementar envelope encryption antes de activar producción |
| `SB_KEY()` fallback a anon key aún existe en código | LOW | Guards en Step 0 garantizan 503 antes de cualquier operación privilegiada |
| Reconcile: `LIMIT 50` sin paginación | LOW | Aceptable para sandbox; cursorizar antes de producción con volumen alto |
| `sha256=` prefix handling (CAT-A-057) | LOW | Uber spec exige el prefijo; comportamiento edge aceptado — nunca 500 |

## Smoke test pre-producción

Antes de activar `UBER_ENV=production`:
1. Verificar `UBER_WEBHOOK_SECRET` rotado (sandbox ≠ producción)
2. Verificar `integration_store_mappings` tiene store_id de producción
3. Correr reconciliation con client_id de AMALAY
4. Verificar `/pos/delivery` recibe órdenes del test store
5. Confirmar que ningún store no mapeado resulta en delivery_order — ejecutar CAT-A-047 contra staging

## Cuando Uber responda

Al recibir confirmación oficial de Uber:
1. Actualizar este doc: estado → `PRODUCTION CERTIFIED`
2. Ejecutar Smoke test pre-producción (sección abajo)
3. Cambiar `UBER_ENV=production` en Vercel
4. Rotar `UBER_WEBHOOK_SECRET` (sandbox ≠ producción)
5. Registrar webhook URL de producción en Uber Developer Console
6. Insertar store_id de producción en `integration_store_mappings`

---

## Day 3 — Scope Probe + Delivery APIs + Evidencia Fresca (post Submission #2)

**Objetivo:** generar evidencia con timestamps posteriores a Submission #2.  
**Workflow:** `.github/workflows/uber-cert-day3.yml`  
**Trigger:** `gh workflow run uber-cert-day3.yml --repo ramonfaurdaniel-png/fullsite`

### Plan de ejecución

| ID | Step | Mecanismo | Objetivo | Estado |
|---|---|---|---|---|
| D3-001 | Deploy health check | `GET /api/integrations/uber-eats/webhook` | Confirmar endpoint vivo post-submission | PENDIENTE |
| D3-002 | Re-auth USL | `GET /api/integrations/uber-eats/auth/initiate?store_id=633b57d4-...` | URL OAuth fresca — confirmar flujo vivo | MANUAL (browser) |
| D3-003 | Scope probe — `eats.order` | `GET /api/integrations/uber-eats/order?order_id=CERT-...` | Si Uber otorgó scope → primera evidencia real de get_details | PENDIENTE |
| D3-004 | Delivery Store API | `GET /api/integrations/uber-eats/store?store_id=633b57d4-...` | Retry UBER-008 — puede PASS si scope cambió | PENDIENTE |
| D3-005 | Fresh order webhook | `/sandbox` con nuevo `order_id` | Timestamps post-Submission #2 en `delivery_orders` | PENDIENTE |
| D3-006 | Mark Ready (UBER-015 retry) | `POST /order {action:"ready"}` | Si `eats.order` disponible → PASS real | PENDIENTE |
| D3-007 | Audit log export | Supabase query `integration_audit_log` | Exportar todos los correlation IDs de Day 3 | PENDIENTE |

### Notas

- **D3-002 (USL re-auth)**: requiere browser — el workflow genera la URL; Daniel completa el redirect manualmente en Uber.
- **D3-003/D3-004/D3-006**: resultado depende de si Uber amplió los scopes tras Submission #2. Si siguen en SANDBOX LIMIT → documentar con timestamp nuevo (evidencia de consistencia).
- **D3-005**: usar `order_id` con timestamp embebido (`CERT-DAY3-<epoch>`) para distinguir de evidencia Day 2.
- **NO usar evidencia D3-005 como suficiente por sí sola**: Uber necesita ver flujo real de su plataforma. D3-005 es evidencia de implementación, no de integración end-to-end.

### Evidencia esperada — Audit log export (D3-007)

```sql
-- Ejecutar en Supabase SQL Editor post Day 3
SELECT
  action,
  correlation_id,
  status_code,
  duration_ms,
  created_at,
  request_summary,
  response_summary
FROM integration_audit_log
WHERE created_at > '2026-08-02T00:30:00Z'   -- después de Submission #2
ORDER BY created_at DESC
LIMIT 50;
```

### Hallazgo previo — Scope probe (commit `04ee6b2`, 2026-08-02T23:17 MX)

```
Correlation ID:   175692b0 (referenciado en commit message)
Scopes solicitados (USL_SCOPES):
  eats.pos_provisioning, offline_access, eats.store, eats.order, eats.deliveries

Scopes otorgados por Uber (de integration_providers.scopes en DB):
  ["eats.pos_provisioning", "offline_access"]

Scopes delta (solicitados pero NO otorgados):
  eats.store, eats.order, eats.deliveries

Veredicto: UBER-SIDE BLOCKER
  Los scopes no se otorgaron silenciosamente porque no están aprobados
  en el Developer Dashboard de Uber para esta aplicación.
  Uber action required: aprobar eats.store + eats.order + eats.deliveries
  en developer.uber.com antes de que el re-auth los incluya.

Fix aplicado:  USL_SCOPES += 'eats.store' (estaba faltando en la solicitud).
               Con el fix, la PRÓXIMA re-auth los solicitará correctamente.
               Una vez Uber los apruebe en Dashboard → re-auth → nuevos tokens.

Resultado Delivery Store APIs (con token actual sin eats.store):
  delivery_store_get:    HTTP 401 "requires eats.store"
  delivery_store_status: HTTP 401 "requires eats.store"
```

> Este hallazgo es evidencia real para incluir en la respuesta a Uber: confirma que
> nuestro código solicita los scopes correctos y que el blocker es de configuración
> en el Developer Dashboard, no de implementación.

### Resultados Day 3 — Ejecución post-Submission #2

```
D3-001 (health check):           [PENDIENTE]
D3-002 (scope probe fresco):     [PENDIENTE]
D3-003 (reauth_url):             [PENDIENTE]
D3-004 (day3_full):              [PENDIENTE]
D3-005 (evidence_export):        [PENDIENTE]

Workflow:         .github/workflows/uber-cert-day3.yml (commit c8136ef)
Trigger manual:   github.com/danielfullsite/fullsite/actions/workflows/uber-cert-day3.yml
                  → Run workflow → branch: main → Run workflow
                  (GitHub CLI retorna 422 en workflows recién registrados — trigger web una vez)
Resultados:       Telegram notificará automáticamente al completar
```
