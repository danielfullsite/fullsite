# Rappi — checklist de cierre (DEV)

> Estado 2026-08-19: el **receptor v2 está desplegado en main** (commit `53764ff2`). Faltan solo
> config + el signing secret (self-serve, sin Rodrigo). Fuente: dev-portal.rappi.com/en/api-reference/webhooks.
> NUNCA pegar secretos en chat/git — van como env var en Vercel.

## URL del webhook (v2, ya en prod)
`https://app.fullsite.mx/api/integrations/rappi/webhook` — verifica HMAC; devuelve **503 si falta
`RAPPI_WEBHOOK_SECRET`** (inerte hasta configurar), manda a DLQ si el store no está mapeado.

## Paso 1 — obtener el signing secret (self-serve, NO depende de Rodrigo)
Rappi expone la config del webhook por API. Con el `client_id/secret` DEV:

```bash
# 1) token (rellena tus credenciales DEV)
TOKEN=$(curl -s -X POST https://api.dev.rappi.com/restaurants/auth/v1/token/login/integrations \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"<RAPPI_CLIENT_ID>","client_secret":"<RAPPI_CLIENT_SECRET>"}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("token") or d.get("access_token") or "")')

# 2) leer la config del webhook NEW_ORDER → trae el campo "secret"
curl -s https://api.dev.rappi.com/api/v2/restaurants-integrations-public-api/webhook/NEW_ORDER \
  -H "x-authorization: Bearer $TOKEN"
```
El campo **`"secret"`** de la respuesta ES el signing secret. (Si no aparece, **resetéalo**:
`PUT .../webhook/NEW_ORDER/reset-secret` con el mismo header → devuelve `"secret":"NEW_SECRET"`.
Ojo: resetear invalida el secret viejo — no pasa nada porque nunca lo tuvimos.)

## Paso 2 — env vars en Vercel (proyecto raíz `fullsite`, Production) + redeploy
```
RAPPI_ENV=dev
RAPPI_CLIENT_ID=<dev client_id>
RAPPI_CLIENT_SECRET=<dev client_secret>
RAPPI_STORE_ID=900173586
RAPPI_WEBHOOK_SECRET=<el secret del paso 1>
```

## Paso 3 — mapear el store de pruebas → tenant AMALAY (SQL en Supabase)
```sql
insert into integration_store_mappings (provider, provider_store_id, client_id, store_open)
values ('rappi', '900173586', 'amalay', true)
on conflict (provider, provider_store_id) do update set client_id = excluded.client_id, store_open = true;
```

## Paso 4 — apuntar la suscripción `Fullsite_DEV` al receptor v2
En la UI de Suscripciones de Rappi, cambiar la URL del webhook `NEW_ORDER` a
`https://app.fullsite.mx/api/integrations/rappi/webhook` (hoy apunta al worker legacy de Cloudflare,
que NO valida firma). O re-registrar por API (`POST .../webhook` con `event`, `url`, `data.stores`).

## Paso 5 — probar
Disparar una orden de prueba desde el POS Tester (`integrations-manager.rappi.com/pos-tester/menu`).
Esperado: webhook responde **200**, firma válida. En DEV el código auto-descubre el formato firmado
y loguea `matchedFormat` (debe ser `t.body` = `<timestamp>.<body crudo>`). La orden entra a
`delivery_orders` (status `nueva`) → cocina.

## Pendientes post-cierre
- Retirar/blindar el `cloudflare/delivery-worker` (recibe Rappi/Didi **sin firma**).
- Para producción: mapear el store real (`MX1930030014`) + `RAPPI_ENV=prod`.

Ver `docs/integrations/rappi/DESIGN.md`, memoria [[project_rappi_integration_state]].
