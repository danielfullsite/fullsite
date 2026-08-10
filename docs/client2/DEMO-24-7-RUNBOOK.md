# Café Nómada — Demo sintético vivo 24/7 (staging)

Tenant **`nomada`** ("Café Nómada — DEMO / DATOS SINTÉTICOS") en el proyecto dedicado Supabase
`jkcnxfbbuyyfhwfjizgw` (separado de AMALAY). Todo dato nace del **flujo canónico** (mismos RPC que
un restaurante real): NO se insertan números en dashboards ni se mutan inventario/ventas/alertas por
tablas paralelas.

## Acceso (staging)
- Owner login: `owner@nomada.staging` / `CafeNomada#2026` (credencial demo sintética).
- Login + lectura autenticada + aislamiento **comprobados por JWT real** (`scripts/client2/nomada_verify.mjs`):
  ve solo `nomada`, 0 cross a AMALAY/otros tenants, cross-insert bloqueado por RLS.
- **URL de navegador:** pendiente — ver "Bloqueo de prod" abajo. `app.fullsite.mx` corre sobre el
  proyecto de PRODUCCIÓN de AMALAY (`qjiomlvudfmzuvqvhwpk`), no sobre este proyecto.

## Flujo canónico del generador
`demo_generate_tick('nomada')` (migración `demo_generator_canonical_v2`):
1. Corte por **business date** (America/Monterrey, boundary 05:00) → `demo_close_turno` (cierre sellado con totales).
2. Cobro canónico de las órdenes previas en KDS: `enviada → cobrada` vía **`r1_save_order`** + `r1_reconcile_order` (inventario canónico) + ticket impreso `meta.simulated=true`.
3. Órdenes nuevas → `enviada` (vivas en KDS) vía **`r1_save_order`**, mezcla de mesas/productos, descuento ocasional.
4. Cancelación ocasional (status canónico `cancelada`).
- **Cobertura de recetas/inventario: PARTIAL** — `nomada` no tiene recetas (`pos_recipes=0`), así que
  `r1_reconcile_order` es no-op; NO se finge food cost exacto.

## Scheduler 24/7 supervisado
- **pg_cron** `nomada-generator` cada 5 min (`cron.job`) — proceso durable en servidor, no localhost/manual.
- **Heartbeat/estado:** tabla `demo_generator_state` (`status`, `last_run_at`, `last_success_at`, `runs`,
  `orders_generated`, `last_error`, `cursor`, `updated_at`).
- **Idempotencia:** ids de orden por slot de 5 min → reintentos/reinicios no duplican.
- **Reintentos/alerta de fallo:** cada tick captura excepción → `status='error'` + `last_error` (visible para alertar); el siguiente tick reintenta.
- **Kill switch:** `update demo_generator_state set kill_switch=true where client_id='nomada';` → el tick corta en frío.
- **Parar el scheduler:** `select cron.unschedule('nomada-generator');`

## Aislamiento / seguridad
- AMALAY no existe en este proyecto → cero acceso a AMALAY por construcción. RLS por `client_id` para el resto.
- `service_role` nunca en browser/bundle/localStorage (auditado en el deploy; solo anon key en cliente).

## Bloqueo de prod (para el criterio "abrir desde app.fullsite.mx")
`app.fullsite.mx` sirve el proyecto de PRODUCCIÓN de AMALAY (`qjiomlvudfmzuvqvhwpk`), al que solo tengo
acceso **READ-ONLY** (regla del proyecto). Para que la demo abra desde ese URL habría que **escribir el
tenant + correr el generador 24/7 dentro de la base de AMALAY** (blast radius sobre sus agentes/reportes),
o servir la demo desde un **URL prod-style dedicado** (p.ej. `demo.fullsite.mx`) apuntando a este proyecto.
Decisión pendiente del fundador; la parte de staging (login+lectura+aislamiento) ya está comprobada.
