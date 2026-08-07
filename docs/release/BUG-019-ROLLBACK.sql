-- ============================================================================
-- BUG-019 — ROLLBACK (restaura el estado permisivo pre-migración)
--
-- USO: solo si la migración BUG-019-tenant-rls-fix.sql causa problemas en prod.
-- Restaura acceso anon + policies permisivas → la app vuelve a funcionar como
-- ANTES del fix (VULNERABLE, pero operativa). Es un rollback de EMERGENCIA;
-- el estado seguro se recupera re-aplicando la migración.
--
-- MEJOR PRÁCTICA: antes de aplicar la migración a prod, capturar un snapshot
-- exacto de pg_policies + grants (pg_dump --section=pre-data o un dump de
-- políticas) y restaurar ESE snapshot. Este script es el fallback genérico.
--
-- IDEMPOTENTE. Transaccional.
-- ============================================================================

begin;

create or replace function private._drop_all_policies(p_table text) returns void
language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename=p_table loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table);
  end loop;
end $$;

-- Restaurar acceso permisivo anon en todas las tablas tenant (estado pre-fix).
do $$
declare t text;
begin
  for t in
    select tbl.table_name from information_schema.tables tbl
    where tbl.table_schema='public' and tbl.table_type='BASE TABLE'
      and exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name=tbl.table_name and c.column_name='client_id')
  loop
    perform private._drop_all_policies(t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    execute format($p$create policy %1$I_anon_all on public.%1$I for all to anon, authenticated using (true) with check (true)$p$, t);
    execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, t);
  end loop;
end $$;

-- Views: quitar security_invoker + re-grant anon.
do $$
declare v text;
begin
  for v in select table_name from information_schema.views where table_schema='public' loop
    begin
      execute format('alter view public.%I reset (security_invoker)', v);
      execute format('grant select on public.%I to anon, authenticated', v);
    exception when others then null;
    end;
  end loop;
end $$;

-- Funciones: re-conceder execute a anon (estado pre-fix).
do $$
declare r record;
begin
  for r in select p.proname, pg_get_function_identity_arguments(p.oid) as args
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
           where p.prosecdef
  loop
    execute format('grant execute on function public.%I(%s) to anon', r.proname, r.args);
  end loop;
end $$;

drop function private._drop_all_policies(text);
commit;
