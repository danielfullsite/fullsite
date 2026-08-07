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
| Accept / Deny / Cancel | client_credentials | `eats.order` | `/v1/eats/orders/{id}/...` (Previous Version — pendiente A3) |
| Get Order Details | client_credentials | `eats.order` ∨ `eats.store.orders.read` | `GET /v2/eats/order/{id}` |
| **Mark Ready** (canónico) | client_credentials | **`UBER_ORDER_FULFILLMENT_SCOPE` (A2)** | `POST /v1/delivery/order/{id}/ready` body `{}` |
| **Resolve Fulfillment** (canónico restaurant) | client_credentials | **`UBER_ORDER_FULFILLMENT_SCOPE` (A2)** | `POST /v1/delivery/order/{id}/resolve-fulfillment-issues` |

- `getUberAccessToken` valida scope otorgado vs solicitado → `UberScopeError` (fail closed).
- La familia `/v1/delivery/order/*` usa `tokenType: 'order-fulfillment'`: **sin
  `UBER_ORDER_FULFILLMENT_SCOPE` la adquisición de token falla cerrado citando A2** —
  el hardcode previo `eats.deliveries` era no verificado y fue retirado del path.
- Refresh token: USL pide `offline_access`; callback/refresh persisten rotación sellada.
  El token actual de AMALAY (expira 2026-08-31) no tiene refresh → requiere re-auth USL.

## 4. Requirements 8 y 9 — estado reconciliado

| Req | Estado | Detalle |
|---|---|---|
| **8 Mark Ready** | **CODE READY — external scope validation pending (A2)** | Default restaurante (ambos canales) → `POST /v1/delivery/order/{id}/ready` body `{}`. `ready_for_pickup` (extinto) solo existe como `markOrderReadyLegacy`, sin routing default. Tests GAP-READY-001..003. |
| **9 Resolve Fulfillment** | **CODE READY — external scope validation pending (A2)** | Contrato RESTAURANT canónico: `POST .../resolve-fulfillment-issues` con `{issue_type, action_type, item{id,name}, suspend_until, store_response}`; respuesta `should_wait_for_customer_response` propagada. El PATCH cart grocery-only fue **eliminado** (sin caso de uso grocery). Webhooks: `order(s).fulfillment_issues.resolved` + `order.failed` → cancelación local. Tests GAP-FULFILL-001..004, GAP-WH-004/005/009. |

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

## 7. Preguntas externas — reconciliadas 2026-08-07

### MUST ASK UBER NOW (citando ticket #D5FEA8)

- **A1 — Identidad de validación:** *"Which application do the Basic Production
  Validation checks monitor — our Test Client (`k2DPoUeX…`) or the Production
  Client (`6bHtSqLJ…`)? And against which host: `test-api.uber.com`, or
  `api.uber.com` with an Uber-provisioned test store?"* (mecánica de detección
  no publicada; bloquea los 10).
- **A2 — Scopes:** *"Please enable the client_credentials scopes `eats.order`,
  `eats.store`, `eats.store.orders.read`, `eats.store.status.write` for the app
  from A1 (token requests currently return no granted scopes — probe corr
  `83095544…`, 2026-08-03). Also: which scope authorizes the Order Fulfillment
  family `/v1/delivery/order/*` (ready / resolve-fulfillment-issues)?"* —
  la parte del scope de esa familia mantiene ready/resolve en fail-closed
  (`UBER_ORDER_FULFILLMENT_SCOPE` sin valor).
- **A3 — Generación de API + configuración del store:** *"Should our validation
  target the current Order Fulfillment API (`/v1/delivery/order/...`) or the
  Previous Version (`/v1/eats/orders/...`) for accept/deny/cancel? How is
  webhooks_version configured for our app/test store (orders.cancel vs
  orders.failure era), and is scheduled-orders enabled on test store
  `633b57d4-237a-5a32-b249-7ceb795f1d35`?"* (ninguno de estos datos aparece en
  GET/POST `pos_data` públicos).
- **A4 — Scheduled lifecycle:** *"For `orders.scheduled.notification`, must the
  POS accept at notification time or upon release, and which behavior does
  validation expect?"* (el guide documenta el evento, no la obligación del POS).

### CAN VERIFY OURSELVES AFTER SCOPES

- `integration_enabled`, `order_manager_client_id`, `order_release_enabled`,
  `online_status` → `GET pos_data` (schema público; ruta admin `/pos-data` lista).
- Scope efectivo de `/v1/delivery/order/*` → probe empírico de tokens contra el
  test store si A2 no lo responde explícitamente (el 401 de Uber nombra el scope).
- `orders.cancel` vs `orders.failure` → observable en el primer cancel real
  (ambos manejados).

### RESOLVED BY PUBLIC DOCS (preguntas eliminadas)

- Mark Ready = `POST /v1/delivery/order/{id}/ready`, body `{}` (order_suite
  `#tag/OrderReady`).
- Resolve Fulfillment restaurant = `POST /v1/delivery/order/{id}/resolve-fulfillment-issues`
  con schema restaurant; `PATCH /v2/eats/orders/{id}/cart` es Grocery-only.
- Scopes de `pos_data`: GET=`eats.store`, POST=`eats.pos_provisioning`.
- Webhooks del ciclo de resolución: `order.fulfillment_issues.resolved` /
  `order.failed`.

## 8. Gates de ejecución

| Gate | Condición | Estado |
|---|---|---|
| G1 Código interno | 251 tests Cat A + tsc + build | ✔ CERRADO |
| G2 Config Uber | Respuestas A1–A4 + scopes otorgados | ⏳ UBER |
| G3 Deploy validación + staging | Autorización de Daniel | ⏳ BLOQUEADO |
| G4 Tráfico real (test orders) | Autorización de Daniel + G2 + G3 | ⏳ BLOQUEADO |
| G5 Producción (Prod Client) | Certificación oficial de Uber | ⏳ BLOQUEADO |
