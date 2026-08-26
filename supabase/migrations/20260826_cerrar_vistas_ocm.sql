-- Cierra la fuga entre restaurantes de las 10 vistas de negocio.
--
-- PENDIENTE DE AUTORIZACIÓN DE DANIEL. Es DDL sobre producción.
--
-- EL PROBLEMA
-- -----------
-- Las 10 vistas de abajo tienen `security_invoker` SIN SETEAR. En Postgres eso
-- significa que corren con los permisos de su DUEÑO (postgres), no con los de
-- quien consulta — así que SALTAN la RLS de sus tablas base. Y encima tienen
-- GRANT SELECT a `anon`.
--
-- Verificado simulando un usuario real del segundo restaurante a nivel Postgres
-- (SET LOCAL ROLE authenticated + request.jwt.claims del dueño de boruca) y
-- consultando SIN ningún filtro:
--
--     ocm_daily ............ 1,414 filas de 5 restaurantes
--                            (incluidos 915 días de ventas de AMALAY)
--     ocm_waiter_rankings .. 896 filas de 4 restaurantes, con NOMBRES de meseros
--
-- Las tablas base están bien: 132 tablas en `public`, CERO sin RLS, 350
-- políticas ancladas en private.user_has_client_access(), y ni una sola política
-- para el rol `anon`. La fuga entra exclusivamente por las vistas.
--
-- QUÉ HACE ESTE ARCHIVO
-- ---------------------
-- 1. `security_invoker = on`: la vista pasa a ejecutarse con los permisos de
--    quien consulta, así que la RLS de las tablas base vuelve a aplicar.
-- 2. `REVOKE SELECT FROM anon`: sin sesión no se lee nada. `authenticated`
--    conserva el acceso y queda filtrado por RLS.
--
-- RIESGO Y REVERSA
-- ----------------
-- El riesgo real es que alguna pantalla dependa de leer estas vistas SIN sesión.
-- Antes de aplicar hay que confirmarlo — el menú por QR (/menu/[mesa]) es el
-- candidato, aunque hoy AppShell ya lo manda a /login.
--
-- Reversa exacta, si algo se rompe:
--     ALTER VIEW public.<vista> SET (security_invoker = off);
--     GRANT SELECT ON public.<vista> TO anon;
--
-- CÓMO SE COMPRUEBA QUE FUNCIONÓ
-- -------------------------------
-- Correr el bloque de verificación del final. Debe devolver CERO filas de otros
-- restaurantes. Ese bloque es la "prueba de aislamiento de dos tenants" que hoy
-- no existe y que conviene dejar corriendo en CI.

BEGIN;

ALTER VIEW public.ocm_daily             SET (security_invoker = on);
ALTER VIEW public.ocm_menu_groups       SET (security_invoker = on);
ALTER VIEW public.ocm_menu_items        SET (security_invoker = on);
ALTER VIEW public.ocm_waiter_rankings   SET (security_invoker = on);
ALTER VIEW public.ops_daily_history     SET (security_invoker = on);
ALTER VIEW public.ops_daily_live        SET (security_invoker = on);
ALTER VIEW public.pos_recipes_canonical SET (security_invoker = on);
ALTER VIEW public.reservaciones_activas SET (security_invoker = on);
ALTER VIEW public.reservaciones_hoy     SET (security_invoker = on);
ALTER VIEW public.reviews_pending       SET (security_invoker = on);

REVOKE SELECT ON public.ocm_daily             FROM anon;
REVOKE SELECT ON public.ocm_menu_groups       FROM anon;
REVOKE SELECT ON public.ocm_menu_items        FROM anon;
REVOKE SELECT ON public.ocm_waiter_rankings   FROM anon;
REVOKE SELECT ON public.ops_daily_history     FROM anon;
REVOKE SELECT ON public.ops_daily_live        FROM anon;
REVOKE SELECT ON public.pos_recipes_canonical FROM anon;
REVOKE SELECT ON public.reservaciones_activas FROM anon;
REVOKE SELECT ON public.reservaciones_hoy     FROM anon;
REVOKE SELECT ON public.reviews_pending       FROM anon;

COMMIT;

-- ── Verificación: ninguna vista debe quedar abierta ────────────────────────
-- Esperado: cero filas.
SELECT c.relname AS vista_todavia_abierta,
       COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                 WHERE option_name = 'security_invoker'), 'SIN SETEAR') AS security_invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_puede_leer
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'v'
  AND (has_table_privilege('anon', c.oid, 'SELECT')
       OR COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'off') <> 'on')
  AND c.relname IN ('ocm_daily','ocm_menu_groups','ocm_menu_items','ocm_waiter_rankings',
                    'ops_daily_history','ops_daily_live','pos_recipes_canonical',
                    'reservaciones_activas','reservaciones_hoy','reviews_pending');
