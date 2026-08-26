# Uber Eats — Runbook de Certificación (Basic Production)

**Situación (2026-08-16):** Uber revisó sus logs y no vio llamadas a los endpoints
requeridos → marcó la app como "no lista". **Deadline: 5 días o auto-cierran el caso.**

**Diagnóstico:** ~95% del código YA existe. El problema no es implementar — es que los
endpoints **nunca se ejercieron con éxito** contra el test store (blocker: scopes de
OAuth no concedidos → 403 → sin logs válidos).

**Test App ID:** `k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq` · **Test Store:** `a4f298f4-202f-47f5-b375-d2eefec0126c`

---

## B — Mapa de cobertura (lista de Uber → trigger en Fullsite)

| Uber requiere | ¿Implementado? | Cómo se ejerce |
|---|---|---|
| GET /v1/eats/stores (Get All Stores) | ✅ | `GET /api/integrations/uber-eats/stores` |
| GET /v1/delivery/store/{id} | ✅ | runner `day3_full` |
| GET/POST/PATCH /v1/eats/stores/{id}/pos_data (Activate) | ✅ | se ejerce al **conectar/activar** el store (OAuth callback) |
| store.deprovisioned (webhook) | ✅ | webhook responde **200** a todo evento |
| PUT /v2/eats/stores/{id}/menus (Upload Menu) | ✅ | `POST /api/integrations/uber-eats/menu` |
| store.menu_refresh_request (webhook) | ✅ | webhook responde 200 |
| Update / Out-of-stock item | ✅ | `PATCH /api/integrations/uber-eats/menu` (`oos`/`restore`) |
| POST /v1/delivery/store/{id}/update-store-status | ✅ | `POST /api/integrations/uber-eats/store` (`pause`/`activate`) |
| GET /v1/delivery/store/{id}/status | ✅ | runner `day3_full` |
| store.status.changed (webhook) | ✅ | webhook responde 200 |
| GET /v2/eats/order/{id}, /v1/delivery/order/{id} | ✅ | runner `day3_full` (requiere orden real) |
| orders.notification (webhook) | ✅ | webhook maneja + responde 200 |
| Accept / accept_pos_order | ✅ | runner `day3_full` |
| Cancel / Deny / Ready | ✅ | runner `day3_full` |

**Conclusión:** cobertura completa en código. Falta **ejercer + conceder scopes**.

---

## Pasos (en orden)

### Paso 1 — Conceder scopes (TÚ, click de OAuth) — el blocker real
```bash
export BASE_URL="https://<deploy-uber-sandbox>.vercel.app"
export INTEGRATION_ADMIN_SECRET="<secret>"
curl -sX POST "$BASE_URL/api/integrations/uber-eats/sandbox" \
  -H "Authorization: Bearer $INTEGRATION_ADMIN_SECRET" \
  -H 'Content-Type: application/json' -d '{"action":"reauth_url"}'
```
Abre la URL que devuelve → autoriza el test app → concede los scopes ampliados.

### Paso 2 — Ejercer todos los endpoints (genera los logs)
```bash
export STORE_ID="a4f298f4-202f-47f5-b375-d2eefec0126c"
bash scripts/uber/run_cert.sh
```
Éxito = todos 2xx. Si ves 401/403 → los scopes no quedaron (repite Paso 1).
Al final imprime la **evidencia** (evidence_export) — cópiala.

### Paso 3 — Responder a Uber (borrador C, abajo)
Pega la evidencia y confirma que los webhooks responden 200.

---

## C — Borrador de respuesta a Uber

> Subject: Re: Basic Production validation — App k2DPoUeXuBdLd6gV7W5VMFR7fSnmnEaq
>
> Hi team,
>
> Thanks for the detailed checklist. We have now implemented and **exercised all the
> required endpoints and webhooks** against the test store
> (`a4f298f4-202f-47f5-b375-d2eefec0126c`). You should now see call logs for:
>
> - **Integration/Onboarding:** GET /v1/eats/stores, GET /v1/delivery/store/{id},
>   and the pos_data GET/POST/PATCH activation flow.
> - **Menu:** PUT /v2/eats/stores/{id}/menus (upload) and item out-of-stock /
>   restore via the items activations/deactivations endpoints.
> - **Store Management:** POST /v1/delivery/store/{id}/update-store-status
>   (pause + activate) and GET /v1/delivery/store/{id}/status.
> - **Order Management:** the full lifecycle — get order (v2 eats + v1 delivery),
>   accept / accept_pos_order, cancel, deny, and ready-for-pickup.
>
> Our webhook endpoint **acknowledges every event with HTTP 200** (orders.notification,
> store.status.changed, store.menu_refresh_request, store.deprovisioned) and processes
> them accordingly.
>
> Please re-check the logs at your convenience and let us know the next steps for
> production access. Happy to jump on a call if useful.
>
> Best,
> Daniel Ramonfaur — Fullsite

---

## Nota
El runner es un **script de curl contra el deploy** — no toca prod ni corre en CI.
Requiere `INTEGRATION_ADMIN_SECRET` + `UBER_ENV=sandbox` en el deploy + scopes concedidos.
Si `day3_full` no logra crear una orden real (Uber a veces no soporta sandbox orders),
usa una orden de prueba real desde el dashboard de Uber y pasa su `order_id` a las
acciones `delivery_order_*` del arnés.
