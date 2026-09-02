# Rappi — cierre técnico DEV

> Última validación: **2026-08-24**. La integración está desplegada en producción de
> Fullsite, conectada al ambiente DEV de Rappi y lista para recibir una orden de certificación.
> No guardar credenciales, tokens ni secretos en este documento, Git o chats.

## Estado comprobado

| Capacidad | Estado | Evidencia |
|---|---|---|
| Health Fullsite | ✅ | `GET /api/integrations/rappi/health` → HTTP 200 |
| OAuth DEV | ✅ | token emitido por `api.dev.rappi.com` |
| Store DEV configurado | ✅ | `store_id_configured: true` |
| Menú mínimo | ✅ | upload Rappi DEV → HTTP 200 |
| Lectura de menú enviado | ✅ | submitted menu → HTTP 200 |
| Polling de órdenes | ✅ | HTTP 200; última corrida `checked: 0` |
| Firma HMAC webhook | ✅ código/pruebas | `Rappi-Signature`, anti-replay y comparación constante |
| Payload Orders v1 | ✅ código/pruebas | soporta el sobre oficial `order_detail` |
| Deduplicación y tenant mapping | ✅ código | `platform + platform_order_id`; store → `client_id` |
| POS → servidor local → KDS/impresión | ✅ campo/simulación | puente Electron 1.3.8 |
| Accept / Reject / Ready reales | ⏳ orden DEV | requieren un `order_id` vigente emitido por Rappi |

Evidencia automatizada: workflow **Rappi Cert — DEV Readiness**, corrida
`32776461555` sobre commit de main `a754eb4d`.

## Endpoints Fullsite

- Webhook firmado: `https://app.fullsite.mx/api/integrations/rappi/webhook`
- Callback self-onboarding: `https://app.fullsite.mx/api/integrations/rappi/onboarding/callback`
- Health: `https://app.fullsite.mx/api/integrations/rappi/health`
- Estado/OAuth: `/api/integrations/rappi/status?probe=oauth` (admin)
- Menú DEV: `/api/integrations/rappi/menu` (admin)
- Poller: `/api/integrations/rappi/poller` (admin)
- Acciones de orden: `/api/integrations/rappi/order` (sesión POS)

## Contrato implementado

- API Orders v1: `https://api.dev.rappi.com/restaurants/orders/v1`.
- Autorización: `x-authorization: Bearer <token>`.
- Consultar por integración: `GET /orders`.
- Consultar por tienda: `GET /stores/{storeId}/orders`.
- Aceptar: `PUT /stores/{storeId}/orders/{orderId}/cooking_time/{minutes}/take`.
- Rechazar: `PUT /stores/{storeId}/orders/{orderId}/cancel_type/{cancelType}/reject`.
- Lista: `POST /stores/{storeId}/orders/{orderId}/ready-for-pickup`.

El normalizador acepta tanto payload plano de webhook como el sobre oficial del REST API:

```json
{
  "order_detail": { "order_id": "...", "totals": {}, "items": [] },
  "customer": {},
  "store": { "internal_id": "..." }
}
```

Los importes de Rappi se convierten de centavos a moneda. `cooking_time` son minutos y
**nunca** se persiste como timestamp.

## Único bloqueo externo restante

Rappi debe generar una orden en la tienda DEV. La corrida actual devuelve `checked: 0`, por
lo que no existe un `order_id` válido sobre el cual ejercer legalmente las transiciones.

Procedimiento cuando aparezca:

1. Confirmar que webhook/poller crea exactamente una fila `delivery_orders` para AMALAY.
2. Confirmar aparición en POS, servidor local, KDS y comandas por estación.
3. Aceptar una orden DEV y guardar HTTP/status/correlation ID.
4. Generar otra orden DEV y rechazarla con un cancel type oficial.
5. Generar o aceptar otra orden y marcarla lista si la tienda está configurada en modo manual.
6. Confirmar deduplicación repitiendo polling sin duplicar orden ni impresión.
7. Adjuntar respuestas sanitizadas como evidencia de certificación.

## Cómo generar la orden

La documentación oficial indica que las órdenes nacen desde la aplicación/infraestructura de
Rappi; el API de integración solo las consulta y transiciona. Para DEV se debe usar el POS Tester
de Integrations Manager o solicitar al contacto técnico de Rappi que coloque una orden en la
tienda configurada. No fabricar un `order_id` ni llamar acciones contra producción.

## Paso a producción

No cambiar `RAPPI_ENV=prod` hasta completar el ciclo DEV anterior y acordar el cutover. Antes de
producción se debe validar el mapping de la tienda real, la suscripción del webhook, modo de
`READY_FOR_PICKUP`, impresoras/KDS en sitio y que Wansoft no consuma simultáneamente las órdenes.

## Callback requerido para self-onboarding

El callback que desbloquea el aprovisionamiento de PROD es distinto al webhook `NEW_ORDER`.
Rappi envía el evento de integración `STORE_PROVISIONING_STATUS` cuando termina un lote de
provisioning o deprovisioning.

Fullsite implementa el receptor en:

`https://app.fullsite.mx/api/integrations/rappi/onboarding/callback`

Configuración requerida antes del deploy:

```text
RAPPI_ONBOARDING_WEBHOOK_SECRET=<secreto aleatorio dedicado, mínimo 32 bytes>
```

No reutilizar `RAPPI_CLIENT_SECRET` ni `RAPPI_WEBHOOK_SECRET`. El mismo valor se envía una sola
vez a Rappi al registrar el callback y se guarda de forma segura como variable de entorno.

Registro en DEV, usando el token M2M de Fullsite_DEV:

```http
POST https://api.dev.rappi.com/api/v2/restaurants-integrations-public-api/clients/{clientId}/webhooks
X-Authorization: Bearer <integrator JWT>
Content-Type: application/json

{
  "event": "STORE_PROVISIONING_STATUS",
  "url": "https://app.fullsite.mx/api/integrations/rappi/onboarding/callback",
  "secret": "<mismo valor de RAPPI_ONBOARDING_WEBHOOK_SECRET>"
}
```

Rappi debe responder `201 Created` al crear o `200 OK` al actualizar. Después se valida con un
evento real o prueba oficial: Fullsite exige `Rappi-Signature`, verifica HMAC-SHA256 sobre
`<timestamp>.<body crudo>`, rechaza replay y devuelve `200 {"ok":true,"accepted":true,...}`.

Además del callback, el flujo completo de self-onboarding requiere que Rodrigo registre para
Fullsite_DEV el `redirect_uri` OAuth2 + PKCE. Ese redirect corresponde a la siguiente fase del
portal de autoservicio; no es necesario para que Rappi pruebe este callback.

Referencias: `docs/integrations/rappi/DESIGN.md` y
`docs/integrations/rappi/RAPPI-ONBOARDING-REQUEST.md`.

---

## Activación PROD — el "botón" (ejecutar el día que Rappi rutee la tienda)

> Verificado **2026-09-02**: el código Rappi es **100% env-driven** (`RAPPI_ENV`, base URL,
> store, credenciales y secretos vienen de env; `auth.ts` resuelve prod→`services.mxgrability.rappi.com`,
> dev→`api.dev.rappi.com`). Pasar a producción es **solo configuración**, sin cambios de código.
> No guardar credenciales/secretos aquí — solo nombres de variables.

### Datos de la tienda productiva (AMALAY)
- Store ID numérico: `1930030014` · **provider store id que espera el webhook (`store.internal_id`): `MX1930030014`**
- RappiAliado: `245858` · Merchant: `amalay334@rappi.com` · Café Amalay – Plaza Duendes, Monterrey
- Login del portal Integrations Manager: `daniel@fullsite.mx` (POS Fullsite mx/138 ya existe; integración `FullSite` de PROD existe, **sin tiendas asociadas**).

### Estado NUESTRO al 2026-09-02 (verificado en prod Supabase)
- `integration_store_mappings` rappi: solo `900173586` (DEV). **Falta el mapeo PROD.**
- `delivery_orders` rappi: 1 fila histórica = prueba DEV `SAMPLE-ORDER-0001`. Cero órdenes reales.
- Deploy en `RAPPI_ENV=dev`.

### Bloqueo externo (pedido a Rodrigo el 2026-09-02)
Rappi debe **asociar/rutear la tienda `1930030014` (aliado `245858`) a la integración FullSite de PROD**
y entregar **credenciales productivas**. Sin eso no fluyen órdenes reales.

### Paso 1 — Mapeo de tienda (idempotente; aplicar en la activación)
```sql
INSERT INTO public.integration_store_mappings
  (id, provider, provider_store_id, client_id, menu_sync_enabled, oos_sync_enabled, store_open, created_at, updated_at)
VALUES
  (gen_random_uuid()::text, 'rappi', 'MX1930030014', 'amalay', true, true, true, now(), now())
ON CONFLICT (provider, provider_store_id) DO NOTHING;
```
> Si la primera orden real cae a `integration_webhook_dlq` como `RAPPI_STORE_ID_MISSING`, leer el
> `store.internal_id` real del payload y ajustar `provider_store_id` (podría venir sin prefijo `MX`).

### Paso 2 — Env vars en Vercel (proyecto prod `fullsite`)
| Var | Valor |
|---|---|
| `RAPPI_ENV` | `prod` |
| `RAPPI_CLIENT_ID` | prod (de Rodrigo) |
| `RAPPI_CLIENT_SECRET` | prod (de Rodrigo, canal seguro) |
| `RAPPI_STORE_ID` | `MX1930030014` |
| `RAPPI_WEBHOOK_SECRET` | del registro del webhook prod (Paso 3) |
| `RAPPI_API_BASE_URL` | dejar SIN setear → auto `services.mxgrability.rappi.com` |

Redeploy tras setear. Tratar las credenciales DEV como quemadas (viajaron en texto plano); no reusarlas.

### Paso 3 — Suscribir webhook `NEW_ORDER` en PROD
Repuntar la URL del webhook de la integración FullSite PROD a
`https://app.fullsite.mx/api/integrations/rappi/webhook` y capturar el `secret` del registro →
`RAPPI_WEBHOOK_SECRET`. Mismo flujo que DEV (`change-url` + `reset-secret`) pero sobre
`services.mxgrability.rappi.com`.

### Paso 4 — Validar en PROD (mismo ciclo probado en DEV)
1. `GET /api/integrations/rappi/health` → 200 tras redeploy.
2. Rappi coloca una orden de prueba en la tienda prod (o esperar la primera real).
3. Confirmar UNA fila en `delivery_orders` (client_id=amalay, platform=rappi) + firma HMAC verificada.
4. Confirmar POS → servidor local → KDS/comandas.
5. Ejercer accept/reject/ready con el `order_id` real; guardar evidencia sanitizada.
6. Confirmar deduplicación (re-polling sin duplicar).

### Checklist "listo para activar"
- [x] Código env-driven, sin hardcode DEV — verificado 2026-09-02
- [x] Mapeo PROD redactado (Paso 1) y constraint confirmado (`UNIQUE (provider, provider_store_id)`)
- [ ] Rappi rutea `1930030014`/`MX1930030014` a FullSite PROD ← **bloqueo (Rodrigo)**
- [ ] Credenciales prod recibidas
- [ ] Env vars puestas + redeploy
- [ ] Webhook `NEW_ORDER` prod suscrito + secret capturado
- [ ] Ciclo de orden validado en prod
