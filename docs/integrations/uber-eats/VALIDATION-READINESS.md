# Uber Eats — Validation Readiness (branch `uber/validation-ready`)

> Estado: **CÓDIGO LISTO — SIN DESPLEGAR**. Ninguna llamada real a Uber ni deploy a
> producción se ejecuta desde esta rama hasta autorización explícita de Daniel.
> Base: commit desplegado `e104e19` (producción actual). Cero commits ajenos.
> Reconciliación Req 8/9 contra docs públicos actuales: 2026-08-07.

## 1. Identidad Test / Prod (implementado en `env.ts`)

| UBER_ENV | Cliente | Variables | Dominios |
|---|---|---|---|
| `sandbox` | **Test Client** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq` | `UBER_TEST_CLIENT_ID` / `UBER_TEST_CLIENT_SECRET` | `sandbox-login.uber.com` + `test-api.uber.com` |
| `production` | **Production Client** `6bHtSqLJsdTZxWvFRt0f1jjv-BzbE92T` | `UBER_PROD_CLIENT_ID` / `UBER_PROD_CLIENT_SECRET` | `auth.uber.com` + `api.uber.com` |

Garantías fail-closed (tests GAP-ENV-001..009): `UBER_ENV` inválido → error;
producción nunca acepta par test/legacy; sandbox nunca usa el par prod; IDs
idénticos → error; par a medias → error; logs solo `env=<env> client=<alias>`.
Legacy `UBER_CLIENT_ID` solo en sandbox como `legacy-as-test` (deprecado).

## 2. Variables a configurar en Vercel (PENDIENTE — no tocar aún)

> Nota routing (auditado 2026-08-07): el proyecto Vercel `fullsite`
> (`prj_py3xf0ABQCTfLmvfCjYwFTzH4hUZ`) NO tiene Git integration — deploys son
> manuales via CLI; `git push` no dispara nada. Las env vars de Preview aplican
> a todos los previews del proyecto → para la validación sandbox se recomienda
> un proyecto Vercel separado (`fullsite-uber-sandbox`) con deploy manual CLI.

### Sandbox validation (proyecto separado o Preview dedicado)

```
UBER_ENV                     = sandbox
UBER_TEST_CLIENT_ID          = k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq
UBER_TEST_CLIENT_SECRET      = <secreto — Uber Developer Dashboard (app de test)>
UBER_WEBHOOK_SECRET          = <Signing Key de la app de TEST — no el client secret>
UBER_REDIRECT_URI            = <URL del deployment>/api/integrations/uber-eats/auth/callback
UBER_ORDER_FULFILLMENT_SCOPE = <scope confirmado por Uber para /v1/delivery/order/* — A2;
                                sin este valor, ready/resolve fallan cerrado a propósito>
NEXT_PUBLIC_SUPABASE_URL     = https://jkcnxfbbuyyfhwfjizgw.supabase.co   (STAGING)
SUPABASE_SERVICE_KEY         = <service key del proyecto STAGING>
INTEGRATION_TOKEN_KEY        = <base64 de 32 bytes — openssl rand -base64 32>
INTEGRATION_ADMIN_SECRET     = <ya existe; reutilizar>
```

### Production (solo tras certificación de Uber + autorización)

```
UBER_ENV                     = production
UBER_PROD_CLIENT_ID          = 6bHtSqLJsdTZxWvFRt0f1jjv-BzbE92T
UBER_PROD_CLIENT_SECRET      = <secreto — app de producción>
UBER_WEBHOOK_SECRET          = <Signing Key de PRODUCCIÓN — rotado, distinto al de test>
UBER_ORDER_FULFILLMENT_SCOPE = <mismo scope confirmado>
INTEGRATION_TOKEN_KEY        = <clave propia de producción>
(eliminar UBER_CLIENT_ID / UBER_CLIENT_SECRET legacy)
```

## 3. Modelo de auth/tokens (implementado)

| Operación | Grant | Scope | Endpoint |
|---|---|---|---|
| Activación / USL | authorization_code | `eats.pos_provisioning offline_access` | `/oauth/v2/authorize` + token |
| Get Integration Details | client_credentials | `eats.store` | `GET /v1/eats/stores/{id}/pos_data` |
| Menu upload / Update Item | client_credentials | `eats.store` | `PUT /v2/.../menus` · `POST /v2/.../menus/items/{item}` |
| **Get / Accept / Deny / Cancel** | client_credentials | `eats.order` | `GET·POST /v1/delivery/order/{id}[/accept\|/deny\|/cancel]` (Order Fulfillment family — **default**) |
| **Mark Ready** | client_credentials | `eats.order` | `POST /v1/delivery/order/{id}/ready` body `{}` |
| **Resolve Fulfillment** (restaurant) | client_credentials | `eats.order` | `POST /v1/delivery/order/{id}/resolve-fulfillment-issues` |

- **CONFIRMADO por Uber (case #58972404, 2026-08-09):** todo el ciclo de orden
  (get/accept/deny/cancel/ready/resolve) va por `/v1/delivery/order/*` y lo
  autoriza **`eats.order`** — **no hay scope separado**. El default del adapter
  es ahora `delivery`; el legacy `/v1/eats/orders/*` queda solo como escape hatch
  explícito (`channel='eats'`). El guard fail-closed A2 se retiró; el scope de la
  familia default es `eats.order` (override `UBER_ORDER_FULFILLMENT_SCOPE` sigue por compat).
- `getUberAccessToken` valida scope otorgado vs solicitado → `UberScopeError` (fail closed).
- Refresh token: USL pide `offline_access`; callback/refresh persisten rotación sellada.
  El token actual de AMALAY (expira 2026-08-31) no tiene refresh → requiere re-auth USL.

## 4. Requirements 8 y 9 — estado reconciliado (Uber-confirmado)

| Req | Estado | Detalle |
|---|---|---|
| **8 Mark Ready** | **CODE READY — pendiente tráfico real** | `POST /v1/delivery/order/{id}/ready` body `{}`, scope `eats.order` (Uber-confirmado). `ready_for_pickup` (extinto) solo como `markOrderReadyLegacy`, sin routing default. Tests GAP-READY-001..003. |
| **9 Resolve Fulfillment** | **CODE READY — pendiente tráfico real** | `POST /v1/delivery/order/{id}/resolve-fulfillment-issues`, schema RESTAURANT `{issue_type, action_type, item{id,name}, suspend_until, store_response}`, scope `eats.order`; `should_wait_for_customer_response` propagado. PATCH cart grocery **eliminado**. Webhooks `order(s).fulfillment_issues.resolved` + `order.failed` → cancelación. Tests GAP-FULFILL-001..004, GAP-WH-004/005/009. |

**Ninguno se declara REAL UBER VALIDATED hasta ver tráfico real 2xx de Uber en
`integration_audit_log` del entorno correcto.** Un fixture interno es Cat A.

## 5. Aislamiento de datos test/prod (diseño, sin migración aún)

Aislamiento por deployment: validación sandbox → deployment dedicado apuntando a
Supabase **staging** (`jkcnxfbbuyyfhwfjizgw`); producción → AMALAY DB. Pendiente
cuando se autorice G3: migración staging (`delivery_orders` + `integration_menu_cache`),
registrar webhook de la app TEST hacia la URL del deployment de validación,
limpieza posterior de las 2 filas `CERT-*` y 5 eventos autofirmados en prod.

## 6. Almacenamiento de tokens (SEC-UBER-01)

`token-vault.ts`: AES-256-GCM (`enc:v1:iv:ct:tag`) con `INTEGRATION_TOKEN_KEY`.
Sin clave → passthrough plaintext con warning único. **Blocker pre-producción:**
configurar la clave ANTES de cualquier USL de producción. Filas legacy se leen
transparente y se re-sellan al siguiente refresh. Ningún log imprime tokens
(test GAP-WH-008).

## 7. Preguntas externas — RESUELTAS por Uber (case #58972404, 2026-08-09)

| # | Pregunta | Respuesta de Uber | Encodeado en código |
|---|---|---|---|
| **A1** | ¿Qué app/host monitorea la validación? | **Test Client `k2DPoUeX…`** en **`test-api.uber.com`** con el test store provisto. Prod solo tras completar la validación. | `UBER_ENV=sandbox` → Test Client + `test-api.uber.com` (env.ts) |
| **A2** | Habilitar scopes M2M + scope de `/v1/delivery/order/*` | **Scopes ya concedidos al Test Client.** La familia Order Fulfillment (ready/resolve + get/accept/deny/cancel) la autoriza **`eats.order`** — **sin scope separado**. | `getOrderFulfillmentScope()` → `eats.order`; guard fail-closed retirado |
| **A3a** | ¿Qué generación de API para get/accept/deny/cancel? | **`/v1/delivery/order/{id}/...`** (Order Fulfillment). Legacy `/v1/eats/orders/...` **no** se usa en validación. | default del adapter = `delivery` (adapter-factory) |
| **A3b** | ¿Evento de cancelación? | **`orders.failure`** (contrato actual), no `orders.cancel`. | handler acepta `orders.failure` + `order.failed` |
| **A3c** | ¿Scheduled requerido? | **No bloqueante** — se puede completar Basic con órdenes on-demand. | scheduled implementado pero no requerido |
| **A4** | ¿Timing de accept en scheduled? | `orders.scheduled.notification` = **informativo**; aceptar en el `orders.notification` de release (15–30 min antes). Validación busca 200-ack del scheduled + accept sobre la orden liberada. | persiste `programada`, sin auto-accept; release llega como `orders.notification` → handleNewOrder |

**Verificable por nosotros tras el deploy sandbox:** `integration_enabled`,
`order_manager_client_id`, `order_release_enabled`, `online_status` → `GET pos_data`
(ruta admin `/pos-data`). El scope efectivo se re-confirma con un probe fresco.

## 7b. Punto abierto crítico — reconciliar credenciales

Nuestros probes 08-01/08-03 dieron `400 invalid_scope` / `granted:[]`, pero Uber
dice que los scopes **ya están concedidos** al Test Client. Explicación probable:
Uber los habilitó tras el email del 08-07. **Antes de correr tráfico hay que
confirmar con un probe fresco** que las credenciales del deployment sandbox son
las del Test Client `k2DPoUeX…` (no otra app), y que el token ahora trae `eats.order`.

## 8. Gates de ejecución

| Gate | Condición | Estado |
|---|---|---|
| G1 Código interno | 251 tests Cat A + tsc + build | ✔ CERRADO (código reconciliado con respuestas Uber) |
| G2 Config Uber | Respuestas A1–A4 + scopes otorgados | ✔ CERRADO (case #58972404, 2026-08-09; scopes concedidos al Test Client) |
| G3 Deploy validación + staging | Proyecto Vercel sandbox + Test Client secret + staging DB (acción de Daniel) | ⏳ SIGUIENTE |
| G4 Tráfico real (test orders) | G3 + probe fresco confirma `eats.order` + Uber genera test order | ⏳ BLOQUEADO por G3 |
| G5 Producción (Prod Client) | Basic Production Validation completada → Uber concede scopes a prod app | ⏳ BLOQUEADO |
