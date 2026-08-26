# Uber Eats — Checklist de certificación (respuesta a GTS)

> Objetivo: que los **11 endpoints** que Uber GTS pide devuelvan 200/204 desde el **test
> client** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq`, y capturar la evidencia. Deadline: 5 días.
> Estado del código tras esta sesión: **11/11 con implementación** (9 ya existían; Promotions
> y Reporting nuevos). El bloqueo era **deploy + scopes**, no código.

## Mapa de los 11 → cómo se prueba

| # | Endpoint Uber | Acción del sandbox runner | Nota |
|---|---|---|---|
| 1 | Activate Integration | `delivery_store_activate` | 200 con scopes vivos |
| 2 | Get Integration Details | `delivery_store_get` | idem |
| 3 | Menu: Update Item/modifier | (ruta `menu.ts`; requiere scope `eats.store`) | ya implementado |
| 4 | Order: Accept (uAPI) | `delivery_order_accept` + `order_id` real | necesita test order |
| 5 | Cancel Notification (webhook) | — | el webhook ya responde **200** siempre |
| 6 | Order: Cancel (uAPI) | `delivery_order_cancel` + `order_id` | orden fresca |
| 7 | Order: Deny (uAPI) | `delivery_order_deny` + `order_id` | orden fresca |
| 8 | Order: Get details (uAPI) | `delivery_order_get` + `order_id` | test order |
| 9 | Order: Mark Ready | `delivery_order_ready` + `order_id` | test order |
| 10 | **Promotions: Create** | `create_promotion` | **nuevo** — `promotions.ts` |
| 11 | **Reporting: Get Report files** | `request_report` → webhook `eats.report.success` → `get_report_file` | **nuevo** — `reporting.ts` |

## Paso 1 — Env vars en Vercel (rama `uber/validation-ready`)

| Var | Valor |
|---|---|
| `UBER_ENV` | `sandbox` |
| `UBER_TEST_CLIENT_ID` | `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq` |
| `UBER_TEST_CLIENT_SECRET` | (del dashboard de Uber, test app) |
| `UBER_WEBHOOK_SECRET` | (el configurado en el webhook de Uber) |
| `INTEGRATION_ADMIN_SECRET` | (string aleatorio; también como secret de GitHub) |
| `UBER_ORDER_FULFILLMENT_SCOPE` | scope que Uber confirmó para `/v1/delivery/order/*` (caso #58972404) |

Opcionales (solo si Uber confirma que la ruta/scope difiere del default):
`UBER_PROMOTIONS_PATH`, `UBER_PROMOTIONS_SCOPE`, `UBER_REPORT_PATH`, `UBER_REPORT_SCOPE`, `UBER_REPORT_TYPE`.

## Paso 2 — Scopes en el Uber Developer Dashboard (test app)

Confirmar que el **test app** tiene aprobados: `eats.order`, `eats.store`, `eats.store.status.write`,
`eats.store.orders.read`, y para los nuevos **`eats.report`** (reporting) + el scope de **promotions**
(confirmar cuál en la referencia de la API — el código usa `eats.store` por default, override por env).

## Paso 3 — Deploy

Mergear/desplegar `uber/validation-ready` a producción (Vercel). Es fail-closed por `UBER_ENV`;
no toca la operación viva. Confirmar el deploy verde.

## Store de prueba (CRÍTICO)

Usar **`a4f298f4-202f-47f5-b375-d2eefec0126c`** ("Fullsite POS Test Store — AMALAY"). Uber lo recreó
el **2026-08-25** (caso #59499952) porque el anterior estaba roto — la explicación más probable
del `401` que veíamos en Menu upload. Mismo test client id.

Stores retirados, **no usar**:
- `0f655507-7337-41e9-b536-5fd6171bb0da` — el que Uber reemplazó por estar roto.
- `633b57d4-237a-5a32-b249-7ceb795f1d35` — de otro client, da `403 user_not_allowed`.

Los workflows default-ean al store vigente (input `store_id`), así que no hay que tocar YAML
la próxima vez que Uber lo recree — se pasa por input.

## Paso 4 — Correr la secuencia y capturar evidencia

Disparar el workflow **`Uber Cert — Sandbox Sequence`** (`.github/workflows/uber-cert-sandbox.yml`):

```
gh workflow run uber-cert-sandbox.yml --repo danielfullsite/fullsite
```

1. **Primera corrida (sin inputs):** valida `scope_probe` (debe dar 200, no 401), Activate, Get Details,
   Store Status, **create_promotion**, **request_report**, y exporta el audit_log. Baja el artifact
   `uber-cert-evidence` → ahí están los JSON con el status de Uber (`.result.status`).
2. **Generar un test order** en el panel sandbox de Uber → llega el webhook (nuestro handler responde 200)
   → toma el `order_id` real.
3. **Segunda corrida con `order_id=<real>`:** get → accept → mark ready. Para Deny/Cancel usar
   `deny_order_id` / `cancel_order_id` con **órdenes frescas** (son terminales).
4. **Reporting:** cuando llegue el webhook `eats.report.success`, tomar su `download_url` (queda en el
   audit_log como `reporting.webhook_success`) y correr el workflow con `download_url=<url>`.

## Paso 5 — Responder a Uber

Adjuntar los JSON del artifact (status 200/204 por endpoint) + el screenshot del webhook devolviendo 200.
Uber pidió screenshots de respuestas exitosas — los JSON del artifact son la evidencia reproducible.

## Notas de contrato (Promotions/Reporting)

Las refs de la API de Uber renderizan client-side y los specs `.yaml` dan 404, así que el path/scope de
Promotions y Reporting quedaron **override-ables por env** con defaults best-known (mismo criterio que
`getOrderFulfillmentScope` para el blocker A2). Si el primer `create_promotion`/`request_report` devuelve
un 4xx de ruta/scope, ajustar el env correspondiente (sin redeploy de código) — el default es:
`POST /v1/eats/stores/{store_id}/promotions` (scope `eats.store`) y `POST /v1/eats/report` (scope `eats.report`).
