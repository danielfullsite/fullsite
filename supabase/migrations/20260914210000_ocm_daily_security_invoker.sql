-- ─────────────────────────────────────────────────────────────────────────────
-- ocm_daily vuelve a correr con los privilegios de quien pregunta
--
-- QUÉ PASÓ, CON FECHAS
--   2026-08-26 07:01:15 UTC · migración `cerrar_vistas_ocm_fuga_cross_tenant`
--       ALTER VIEW public.ocm_daily SET (security_invoker = on);
--       REVOKE SELECT ON public.ocm_daily FROM anon;
--     Cerró la fuga. Las otras 9 vistas del mismo lote siguen cerradas hoy.
--
--   2026-09-09 03:53:05 UTC · migración `ocm_daily_no_materializar`
--       CREATE OR REPLACE VIEW public.ocm_daily AS WITH live AS NOT MATERIALIZED (...)
--     Cambió el plan de ejecución (un `NOT MATERIALIZED` por desempeño) y, sin
--     mencionarlo, borró el candado: `CREATE OR REPLACE VIEW` REEMPLAZA los
--     reloptions de la vista. Lo que no se vuelve a declarar en el WITH, se pierde.
--     El REVOKE a `anon` sí sobrevivió (es ACL, no reloption) — por eso el agujero
--     quedó abierto sólo para `authenticated`, y por eso nadie lo vio.
--
-- POR QUÉ ESO EXPONE TODO
--   `ocm_daily` la posee `postgres`, y `postgres` tiene `rolbypassrls = true`.
--   Sin `security_invoker`, la vista corre como su dueño: el RLS de `pos_orders`
--   y `ops_daily` (ambos con `private.user_has_client_access(client_id)`) NO se
--   evalúa. Cualquier usuario logueado leía los 9 tenants.
--
-- POR QUÉ NO SE AGREGA UN WHERE EXPLÍCITO
--   Porque la autoridad correcta ya existe y es más rica que un filtro: un usuario
--   puede pertenecer a VARIOS restaurantes (hoy hay uno con 6). `client_users` es
--   quien sabe cuáles; un WHERE en la vista tendría que reimplementar eso y podría
--   divergir. Con `security_invoker = on` el RLS de las tablas base manda, que es
--   exactamente el diseño de las otras tres vistas OCM.
--
-- QUE NO ROMPE
--   · Único consumidor en el repo: `.github/scripts/agent_daily_source.py`, que usa
--     SUPABASE_SERVICE_KEY (línea 23) → `service_role` tiene `rolbypassrls = true`
--     y sigue viendo todo. Además ya filtra `client_id=eq.{client_id}`.
--   · `authenticated` ya tiene SELECT sobre `pos_orders` y `ops_daily`, que es lo
--     que `security_invoker` le va a exigir. Verificado con has_table_privilege.
--
-- ROLLBACK
--   alter view public.ocm_daily reset (security_invoker);
--   (reabre la fuga — sólo como maniobra de emergencia si un consumidor no
--    identificado se cae, y con el incidente abierto.)
-- ─────────────────────────────────────────────────────────────────────────────

alter view public.ocm_daily set (security_invoker = on);

-- Idempotente: hoy `anon` ya no tiene SELECT (lo quitó la migración de 08-26 y el
-- CREATE OR REPLACE no lo devolvió). Se repite para que este archivo deje la vista
-- en el estado correcto aunque se aplique sobre una base que no traiga aquel lote.
revoke select on public.ocm_daily from anon;
grant  select on public.ocm_daily to authenticated;
