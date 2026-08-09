-- ============================================================================
-- BUG-019 — SECURE ROLLBACK (emergency)
--
-- USO: solo si BUG-019-tenant-rls-fix.sql causa 401/403 en rutas legítimas en prod.
--
-- Este rollback REVIERTE EL AISLAMIENTO ESTRICTO por tenant (para que la app
-- autenticada vuelva a funcionar) PERO **NO restaura acceso anónimo ni ninguna
-- policy pública insegura**. En concreto:
--   • anon permanece REVOCADO en todas las tablas, views y funciones (no se re-expone).
--   • las tablas tenant vuelven a permisivo-para-AUTHENTICATED (using(true)) — estado
--     operativo de emergencia (cross-tenant entre usuarios autenticados), NO público.
--   • NO se recrean las policies `public_read_*` / `anon_read_*` que la migración cerró
--     (wansoft_daily/kpis, amalay_reservaciones, pos_staff, tablas hijas, etc.).
--   • service_role conserva su acceso.
-- Recuperar el estado SEGURO = re-aplicar la migración (idempotente).
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

-- Tablas tenant (con client_id): emergencia → permisivo AUTHENTICATED, anon SIGUE fuera.
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
    execute format('revoke all on public.%I from anon', t);              -- anon NO se restaura
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$I_auth_all on public.%1$I for all to authenticated using (true) with check (true)$p$, t);
    execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, t);
  end loop;
end $$;

-- Views: acceso solo authenticated (anon NO se restaura). security_invoker se deja intacto.
do $$
declare v text;
begin
  for v in select table_name from information_schema.views where table_schema='public' loop
    begin
      execute format('revoke all on public.%I from anon', v);
      execute format('grant select on public.%I to authenticated', v);
    exception when others then null;
    end;
  end loop;
end $$;

-- Funciones SECURITY DEFINER: NO se re-concede execute a anon (se mantiene el cierre).
-- Las tablas legacy sin client_id (wansoft_daily/kpis, amalay_reservaciones) y las tablas
-- hijas conservan sus policies authenticated/parent-join — NO se recrea lectura pública.

drop function private._drop_all_policies(text);
commit;
