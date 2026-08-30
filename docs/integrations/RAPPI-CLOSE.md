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
