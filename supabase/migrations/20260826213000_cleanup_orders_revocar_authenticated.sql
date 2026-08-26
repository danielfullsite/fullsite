-- Cerrar un agujero que abrió la migración anterior (20260826200000).
--
-- QUÉ PASÓ
--
-- Esa migración hizo `REVOKE ALL ... FROM PUBLIC, anon` y dio por hecho que con eso la
-- función quedaba sólo para `service_role`. **Falso.** Supabase tiene un
-- `ALTER DEFAULT PRIVILEGES` que otorga EXECUTE a `authenticated` sobre las funciones
-- nuevas de `public`, y lo hace como grant DIRECTO — que un REVOKE a PUBLIC no toca:
--
--   proacl: postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- CONSECUENCIA, que no era teórica
--
-- Cualquier usuario con sesión iniciada —de cualquier restaurante, con cualquier rol—
-- podía llamar directamente:
--
--   POST /rest/v1/rpc/r1_cleanup_orders  { "p_client_id": "<otro tenant>", … }
--
-- y borrar TODAS las órdenes de ese tenant. Saltándose el guardián de la ruta
-- (`canCleanupAllOrders`: tenant + nombre), el rol mínimo `gerente`, el texto literal de
-- confirmación y la verificación del digest. Es decir: **peor que el defecto que la
-- migración anterior venía a corregir.**
--
-- CÓMO SE DETECTÓ
--
-- El linter de Supabase (regla 0029) al revisar DESPUÉS de aplicar. No lo habría
-- encontrado leyendo el SQL: el `REVOKE` se ve correcto. Sólo se ve consultando `proacl`.
--
-- La lección, para la próxima función `SECURITY DEFINER`: **revocar explícitamente a
-- `authenticated`, no sólo a `PUBLIC` y `anon`**, y comprobarlo con
-- `has_function_privilege` en vez de suponerlo.
--
-- La ruta llama con SUPABASE_SERVICE_KEY, así que esto no la afecta. Verificado con una
-- prueba de humo posterior: borrado (deleted:2) y restauración (restored:2) siguen
-- funcionando bajo `service_role`.
--
-- Reversión: GRANT EXECUTE … TO authenticated — no hacerlo, reabre el agujero.

REVOKE ALL ON FUNCTION public.r1_cleanup_orders(text,text,text,text,text,text,integer,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.r1_cleanup_restore(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.r1_cleanup_orders(text,text,text,text,text,text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.r1_cleanup_restore(text) TO service_role;
