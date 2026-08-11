-- Control Plane · Fase 1 (seguridad): is_platform_admin SOLO callable server-side (service_role).
--
-- Contexto: hoy la ACL de is_platform_admin(text, uuid) incluye PUBLIC (=X) y anon → cualquier
-- cliente puede enumerar quién es admin vía RPC con la anon key. El super-admin es el objetivo #1
-- de un atacante; su verificación debe vivir SOLO en el servidor.
--
-- Seguro de revocar: ninguna policy RLS referencia la función (verificado en pg_policies →
-- 0 filas), así que quitar EXECUTE a PUBLIC/anon/authenticated NO rompe el aislamiento por tenant.
-- La función se invoca únicamente desde endpoints server /api/platform/* con la service_role key,
-- tras verificar la sesión. RLS por tenant (BUG-019) se mantiene intacto.
--
-- Validar en staging (jkcnxfbb) antes de considerar prod. NO aplicar DDL a prod desde aquí.

revoke execute on function public.is_platform_admin(text, uuid) from public;
revoke execute on function public.is_platform_admin(text, uuid) from anon;
revoke execute on function public.is_platform_admin(text, uuid) from authenticated;
grant  execute on function public.is_platform_admin(text, uuid) to service_role;

-- Rollback (referencia):
--   grant execute on function public.is_platform_admin(text, uuid) to public;
