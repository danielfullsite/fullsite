-- ─────────────────────────────────────────────────────────────────────────────
-- La mitad que faltaba del guardián: mirar la base, no los archivos
--
-- POR QUÉ
--   `.github/scripts/test_migraciones_no_exponen_a_anon.py` ya fija esta propiedad
--   en cada PR, y su propio encabezado dice dónde termina su alcance:
--       "Sólo leen los archivos de `supabase/migrations/`. Un `grant` hecho a mano
--        en el SQL Editor no pasa por aqui."
--
--   La fuga de `ocm_daily` cayó exactamente en ese hueco. La migración que la abrió
--   (`ocm_daily_no_materializar`, 2026-09-09 03:53:05 UTC) se aplicó directo a
--   producción y NUNCA existió como archivo: hoy `supabase/migrations/` tiene 44
--   entradas en `main` y ninguna es ésa. El guardián de archivos no podía verla —
--   no porque esté mal escrito, sino porque el archivo no existe.
--
--   Un guardián cuyo alcance no cubre la ruta por la que entró el bug no es un
--   guardián; es un documento que se ejecuta. Éste mira la verdad viva.
--
-- CÓMO
--   SECURITY DEFINER para poder leer `pg_class`/`pg_namespace` con detalle, y
--   EXECUTE sólo para `service_role`: el resultado es un mapa de dónde tocar, así
--   que no se le entrega a `anon` ni a `authenticated`.
--
-- ROLLBACK
--   drop function if exists public.vistas_expuestas_sin_security_invoker();
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.vistas_expuestas_sin_security_invoker()
returns table (vista text, rol text, tiene_client_id boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select c.relname::text,
         a.grantee::regrole::text,
         exists (
           select 1 from pg_attribute at
           where at.attrelid = c.oid and at.attname = 'client_id' and at.attnum > 0
         )
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'public'
     and c.relkind in ('v', 'm')
     and a.privilege_type = 'SELECT'
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
     -- El candado vive en reloptions, y `CREATE OR REPLACE VIEW` los reemplaza:
     -- lo que no se vuelve a declarar, se pierde en silencio. Ésa es la puerta.
     and (c.reloptions is null
          or not ('security_invoker=on' = any (c.reloptions)))
   order by c.relname, a.grantee::regrole::text;
$function$;

revoke all     on function public.vistas_expuestas_sin_security_invoker() from public;
revoke all     on function public.vistas_expuestas_sin_security_invoker() from anon;
revoke all     on function public.vistas_expuestas_sin_security_invoker() from authenticated;
grant  execute on function public.vistas_expuestas_sin_security_invoker() to service_role;
