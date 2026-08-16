# ACCIÓN Uber — ejercer los endpoints contra el test store (validación por logs)

> Instrucción para quien trabaja `uber/validation-ready`. Fecha: 2026-08-15.
> Origen: correo de Uber GTS (case #58949479).

## El hallazgo que cambia el enfoque

Uber respondió textualmente:

> *"We checked the available API call logs and were unable to find any logs for the required endpoints."*

**Uber valida mirando SUS logs de llamadas API.** No es que falte código — el código de todos los endpoints ya está en esta rama. Es que **nunca disparamos las llamadas contra el sandbox de Uber**, así que su log está vacío. Uber **no valida pasivamente**: necesita ver tráfico real desde nuestra app hacia sus endpoints, contra el test store.

## La acción (no es más código)

**Ejecutar el validation runner** (`.github/workflows/uber-cert-*.yml`) contra el test store para generar tráfico real en los logs de Uber:

- **Test Store UUID:** `0f655507-7337-41e9-b536-5fd6171bb0da`
- **Test App ID:** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq`
- **Deployment sandbox:** proyecto Vercel `fullsite-uber-sandbox`

Endpoints que Uber quiere ver en sus logs (llamados por NOSOTROS):
- `GET /v1/eats/stores`, `GET /v1/delivery/store/{id}`
- `GET/POST/PATCH /v1/eats/stores/{id}/pos_data` (activate)
- `PUT /v2/eats/stores/{id}/menus` + `POST /v2/eats/stores/{id}/menus/items/{id}`
- `POST /v1/delivery/store/{id}/update-store-status`, `GET .../status`
- `GET /v2/eats/order/{id}`, y accept/deny/cancel/ready del ciclo de orden
- Webhooks (store.deprovisioned, menu_refresh, status.changed, orders.notification) → ack 200

## Bloqueo dependiente: scopes (A2)

Las llamadas `client_credentials` hoy regresan **sin scopes otorgados** (probe corr 83095544, 2026-08-03). Dos escenarios al correr el runner:
1. Llamadas fallan por scopes → **al menos quedan en el log de Uber**, y da evidencia concreta para exigir A2 (que otorguen `eats.order`, `eats.store`, `eats.store.orders.read`, `eats.store.status.write` + el scope de `/v1/delivery/order/*`).
2. Scopes ya otorgados → llamadas 2xx → validación pasa.

**De cualquier forma, el desbloqueo es CORRER las flows.** Hoy el log está en cero porque no se ha ejecutado nada (gates G3/G4 estaban esperando autorización de Daniel — **autorizado**).

## Respuesta a Uber (después de correr las flows)

> We have now exercised all the listed endpoints and webhooks against test store 0f655507-7337-41e9-b536-5fd6171bb0da from application k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq. Please re-check your API call logs. Note: our client_credentials token currently returns no granted scopes — if the calls appear as scope-denied, please enable eats.order, eats.store, eats.store.orders.read, eats.store.status.write, and confirm the scope for the /v1/delivery/order/* fulfillment family.
