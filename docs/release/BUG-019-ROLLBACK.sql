-- ============================================================================
-- BUG-019 — FORWARD-ONLY SECURITY MIGRATION · COMPENSATING FAIL-CLOSED LOCKDOWN
--
-- CLASIFICACIÓN: `BUG-019-tenant-rls-fix.sql` es una MIGRACIÓN DE SEGURIDAD
-- FORWARD-ONLY. El baseline anterior era inseguro (anon CRUD + acceso cross-tenant
-- entre autenticados + lecturas públicas de datos privados). NO existe una reversión
-- "segura" a ese baseline: restaurar `authenticated USING(true)` reabriría acceso
-- cross-tenant entre usuarios autenticados; restaurar anon reabriría el acceso anónimo.
-- Por eso este archivo NO restaura el estado previo.
--
-- RECUPERACIÓN NORMAL = FORWARD-FIX: si la migración estricta causa 401/403 en rutas
-- legítimas (p.ej. `client_users` mal poblado o `private.user_has_client_access`
-- defectuosa), se CORRIGE hacia adelante (poblar client_users / corregir la función)
-- y se RE-APLICA la migración idempotente. Ese es el camino primario.
--
-- ESTE SCRIPT = LOCKDOWN COMPENSATORIO FAIL-CLOSED, solo como último recurso de
-- emergencia mientras se hace el forward-fix. NO abre acceso: BLOQUEA. Deja las
-- tablas tenant accesibles ÚNICAMENTE por `service_role` (las rutas server-mediated
-- documentadas siguen funcionando); `anon` y `authenticated` quedan SIN acceso
-- (fail closed). No crea NINGUNA policy `USING(true)`/`WITH CHECK(true)` para
-- authenticated ni ninguna condición cross-tenant. La app cliente-directa queda
-- degradada a server-mediated hasta el forward-fix — es el trade-off deliberado
-- (roto-pero-seguro por encima de operativo-pero-cross-tenant).
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

-- Todas las tablas base con client_id + las tablas legacy/hijas cerradas por la migración:
-- lockdown a SOLO service_role. anon Y authenticated quedan revocados; sin policy permisiva.
do $$
declare t text;
begin
  for t in
    select tbl.table_name from information_schema.tables tbl
    where tbl.table_schema='public' and tbl.table_type='BASE TABLE'
      and (
        exists (select 1 from information_schema.columns c
                where c.table_schema='public' and c.table_name=tbl.table_name and c.column_name='client_id')
        or tbl.table_name in ('wansoft_daily','wansoft_kpis','amalay_reservaciones',
                              'pos_purchase_order_items','pos_sub_recipe_ingredients')
      )
  loop
    perform private._drop_all_policies(t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- fail closed: sin acceso cliente
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, t);
    -- NO se crea ninguna policy para authenticated -> RLS on + sin grant = denegado (0 acceso, no cross-tenant).
  end loop;
end $$;

-- Views: revocar anon Y authenticated (sin acceso cliente-directo). service_role lee de las bases.
do $$
declare v text;
begin
  for v in select table_name from information_schema.views where table_schema='public' loop
    begin
      execute format('revoke all on public.%I from anon, authenticated', v);
    exception when others then null;
    end;
  end loop;
end $$;

-- Funciones SECURITY DEFINER: se MANTIENE anon revocado (no se reabre nada).

drop function private._drop_all_policies(text);
commit;
