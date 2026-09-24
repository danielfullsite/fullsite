-- ROLLBACK de PENDIENTE_20260925020000_revocar_truncate_anon_authenticated.sql. NO aplicado.
-- Aplicar con `psql -v ON_ERROR_STOP=1 -f <archivo>`.
--
-- Vuelve a otorgar TRUNCATE a anon y authenticated en las tablas de public y restaura el
-- privilegio por defecto, EXCEPTO en pos_staff y pos_staff_audit: esas dos las gobierna
-- PENDIENTE_20260925010000_pos_staff_endurecimiento.sql, que ya les quitó TRUNCATE antes que esta
-- migración. Re-otorgarlo aquí desharía parte de aquel endurecimiento. (Si también se quiere
-- revertir el endurecimiento, se usa SU rollback, en orden inverso de aplicación.)
--
-- El baseline otorgaba TRUNCATE a anon y authenticated en prácticamente todas las tablas. Si
-- alguna no lo tenía, este rollback se lo da: es la única imprecisión posible. Para restaurar
-- exacto, la foto M-00 previa a la migración debe guardar
--   select c.relname, pg_get_userbyid(a.grantee) from pg_class c, aclexplode(c.relacl) a
--   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
--     and a.privilege_type = 'TRUNCATE' and pg_get_userbyid(a.grantee) in ('anon','authenticated');

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname not in ('pos_staff', 'pos_staff_audit')
  loop
    execute format('grant truncate on table public.%I to anon, authenticated', t.relname);
  end loop;
end
$$;

alter default privileges for role postgres in schema public
  grant truncate on tables to anon, authenticated;

commit;
