# Uber Eats — Validation Readiness (branch `uber/validation-ready`)

> Estado: **CÓDIGO LISTO — SIN DESPLEGAR**. Ninguna llamada real a Uber ni deploy a
> producción se ejecuta desde esta rama hasta autorización explícita de Daniel.
> Base: commit desplegado `e104e19` (producción actual). Cero commits ajenos.

## 1. Identidad Test / Prod (implementado en `env.ts`)

| UBER_ENV | Cliente | Variables | Dominios |
|---|---|---|---|
| `sandbox` | **Test Client** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq` | `UBER_TEST_CLIENT_ID` / `UBER_TEST_CLIENT_SECRET` | `sandbox-login.uber.com` + `test-api.uber.com` |
| `production` | **Production Client** `6bHtSqLJsdTZxWvFRt0f1jjv-BzbE92T` | `UBER_PROD_CLIENT_ID` / `UBER_PROD_CLIENT_SECRET` | `auth.uber.com` + `api.uber.com` |

Garantías fail-closed (con tests GAP-ENV-001..009):
- `UBER_ENV` ausente o inválido → `UberConfigError`.
- Producción **nunca** acepta el par legacy `UBER_CLIENT_ID/SECRET` ni el par TEST.
- Sandbox **nunca** usa el par PROD.
- IDs test y prod idénticos → error de configuración.
- Par a medias (ID sin SECRET) → error.
- Logs solo muestran `env=<env> client=<alias>` — jamás IDs ni secretos.
- Compat temporal: `UBER_CLIENT_ID` legacy solo funciona en sandbox, reportado
  como `legacy-as-test` con warning (retirar al configurar `UBER_TEST_*`).

## 2. Variables a configurar en Vercel (PENDIENTE — no tocar aún)

### Preview / validación sandbox (environment Preview, branch `uber/validation-ready`)

```
UBER_ENV                 = sandbox
UBER_TEST_CLIENT_ID      = k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq
UBER_TEST_CLIENT_SECRET  = <secreto — Uber Developer Dashboard (app de test)>
UBER_WEBHOOK_SECRET      = <Signing Key de la app de TEST — no el client secret>
UBER_REDIRECT_URI        = <URL preview>/api/integrations/uber-eats/auth/callback
NEXT_PUBLIC_SUPABASE_URL = https://jkcnxfbbuyyfhwfjizgw.supabase.co   (STAGING)
SUPABASE_SERVICE_KEY     = <service key del proyecto STAGING>
INTEGRATION_TOKEN_KEY    = <base64 de 32 bytes aleatorios — openssl rand -base64 32>
INTEGRATION_ADMIN_SECRET = <ya existe; reutilizar>
```

### Production (solo tras certificación de Uber + autorización)

```
UBER_ENV                 = production
UBER_PROD_CLIENT_ID      = 6bHtSqLJsdTZxWvFRt0f1jjv-BzbE92T
UBER_PROD_CLIENT_SECRET  = <secreto — app de producción>
UBER_WEBHOOK_SECRET      = <Signing Key de PRODUCCIÓN — rotado, distinto al de test>
UBER_REDIRECT_URI        = https://app.fullsite.mx/api/integrations/uber-eats/auth/callback
INTEGRATION_TOKEN_KEY    = <mismo formato; clave propia de producción>
(eliminar UBER_CLIENT_ID / UBER_CLIENT_SECRET legacy)
```

## 3. Modelo de auth/tokens (implementado)

| Operación | Grant | Scope | Endpoint |
|---|---|---|---|
| Activación / USL | authorization_code | `eats.pos_provisioning offline_access` | `/oauth/v2/authorize` + token |
| Get Integration Details | client_credentials | `eats.store` | `GET /v1/eats/stores/{id}/pos_data` |
| Menu upload / Update Item | client_credentials | `eats.store` | `PUT /v2/.../menus` · `POST /v2/.../menus/items/{item}` |
| Accept | client_credentials | `eats.order` | `POST /v1/eats/orders/{id}/accept_pos_order` |
| Deny / Cancel | client_credentials | `eats.order` (set marketplace) | `.../deny_pos_order` · `.../cancel` |
| Get Order Details | client_credentials | `eats.order` ∨ `eats.store.orders.read` | `GET /v2/eats/order/{id}` |
| Resolve Fulfillment | client_credentials | `eats.order` | `PATCH /v2/eats/orders/{id}/cart` (ver Q2) |
| Mark Ready | — | — | **BLOCKED_EXTERNAL** (ver Q3) |

- `getUberAccessToken` valida el scope otorgado vs solicitado → `UberScopeError` (fail closed).
- `uberFetch` ya honra `scope` explícito (bug de auditoría cerrado).
- Refresh token: USL ahora pide `offline_access`; el callback y el refresh persisten
  rotación de refresh_token. **Requiere re-auth USL** — el token actual de AMALAY
  (expira 2026-08-31) no tiene refresh token.

## 4. Aislamiento de datos test/prod (Fase 5 — diseño, sin migración aún)

**Principio: el aislamiento es por deployment, no por columna.** Cada deployment
apunta su `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_KEY` a un proyecto entero.

| Dato | Producción (AMALAY DB) | Staging (jkcnxfbbuyyfhwfjizgw) |
|---|---|---|
| `integration_providers` (tokens USL reales) | ✔ merchants reales | tokens del test store |
| `integration_store_mappings` | ✔ stores reales | test store `633b57d4…` |
| `integration_webhook_events` / `_dlq` / `_audit_log` | solo tráfico real | **toda la evidencia de validación** |
| `delivery_orders` | solo órdenes reales | órdenes de test (requiere migración staging) |
| `integration_menu_cache` | migración pendiente | migración pendiente |

Plan (cuando se autorice):
1. Migración en **staging**: `delivery_orders` (si falta) + `integration_menu_cache`.
2. Deploy Preview de `uber/validation-ready` con las vars de la sección 2.
3. Registrar el webhook de la app de TEST hacia la URL del preview (no `app.fullsite.mx`).
4. Toda la validación sandbox corre contra staging — **cero escrituras en AMALAY**.
5. Limpieza posterior en prod: 2 filas `CERT-*` en `delivery_orders` + 5 eventos de
   webhook autofirmados (conservar hasta cerrar la certificación; luego purgar).
6. Producción se activa después con su propio deployment/env — nunca comparte
   webhook secret, client ni DB con test.

## 5. Almacenamiento de tokens (SEC-UBER-01)

`token-vault.ts`: AES-256-GCM (`enc:v1:iv:ct:tag`) con `INTEGRATION_TOKEN_KEY`.
- Con clave → tokens cifrados en reposo (callback USL + refresh los sellan).
- Sin clave → passthrough plaintext con warning único. **Blocker pre-producción:**
  configurar la clave ANTES de cualquier USL de producción.
- Filas legacy plaintext se leen transparente; se re-sellan al siguiente refresh.
- Ningún log/test/audit imprime material de token (test GAP-WH-008).

## 6. Preguntas exactas para Uber (BLOCKED_EXTERNAL)

> Enviar citando ticket `#D5FEA8`.

- **Q1 (identidad):** Which application do the Basic Production Validation checks
  monitor — our Test Client (`k2DPoUeX…`) or the Production Client (`6bHtSqLJ…`)?
  And against which host: `test-api.uber.com`, or `api.uber.com` with an
  Uber-provisioned test store?
- **Q2 (fulfillment):** For restaurant (non-grocery) stores, what is the exact
  current endpoint for Resolve Fulfillment Issues? The public reference documents
  `PATCH /v2/eats/orders/{order_id}/cart` as Grocery-only; the partner Postman
  collection references `POST /v1/delivery/order/{order_id}/resolve-fulfillment-issues`.
- **Q3 (mark ready):** `POST /v1/eats/orders/{order_id}/ready_for_pickup` returns
  404 and no longer appears in the public reference. What is the current Mark
  Order as Ready endpoint and its required scope?
- **Q4 (scheduled):** For `orders.scheduled.notification`, must the POS accept at
  notification time, or upon release? Which behavior does validation expect?
- **Q5 (scopes):** Please enable client_credentials scopes `eats.order`,
  `eats.store`, `eats.store.orders.read`, `eats.store.status.write` for the app
  from Q1 — token requests currently return no granted scopes.
- **Q6 (cancel webhook):** Is our test store configured on API v1.0.0
  (`orders.failure`) or newer (`orders.cancel`)?

## 7. Gates de ejecución

| Gate | Condición | Estado |
|---|---|---|
| G1 Código interno | 244 tests Cat A + tsc + build | ✔ CERRADO |
| G2 Config Uber | Respuestas Q1–Q6 + scopes otorgados | ⏳ UBER |
| G3 Deploy preview + staging | Autorización de Daniel | ⏳ BLOQUEADO |
| G4 Tráfico real (test orders) | Autorización de Daniel + G2 + G3 | ⏳ BLOQUEADO |
| G5 Producción (Prod Client) | Certificación oficial de Uber | ⏳ BLOQUEADO |

**Regla:** un fixture interno es Cat A. Nada se declara "Uber validated" hasta ver
el webhook/llamada real con 2xx en `integration_audit_log` del entorno correcto.
