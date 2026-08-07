-- ============================================================================
-- BUG-019 — FIX INTEGRAL de aislamiento de tenant a nivel DB (RLS real)
--
-- ESTADO: probado en STAGING (jkcnxfbbuyyfhwfjizgw). NO aplicado a producción
-- (qjiomlvudfmzuvqvhwpk). Requiere autorización de Daniel + deploy coordinado
-- de la app (ver BUG-019-APP-CHANGES.md).
--
-- ALCANCE REAL (auditoría de schema 2026-08-07): NO son 12 tablas — producción
-- tiene ~93 tablas con columna client_id, la mayoría con policies permisivas
-- anon `using(true)` + grants anon CRUD; 6 con RLS DESACTIVADA; 6 views que
-- bypassan RLS (security_invoker off, anon-readable); y funciones SECURITY
-- DEFINER con EXECUTE para anon (r1_save_order, r1_observation_sample) que
-- permiten escribir/leer datos de cualquier tenant vía RPC directo con la
-- anon key pública.
--
-- MODELO NUEVO:
--   - Fuente de tenant CONFIABLE = auth.uid() -> public.client_users membership,
--     vía private.user_has_client_access(client_id). No se confía en ningún
--     client_id del cliente.
--   - anon SIN acceso a tablas/views/funciones tenant. El navegador usa el JWT
--     de sesión (authenticated). Las escrituras del kiosko van por endpoints
--     server (service_role, bypassa RLS, resuelve tenant con withPOSAuth).
--   - Menú público (QR) vía RPC SECURITY DEFINER get_public_menu().
--
-- IDEMPOTENTE. Transaccional. DINÁMICO (se adapta a las tablas que existan).
-- ============================================================================

begin;

-- 0. Sanity.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='private' and p.proname='user_has_client_access') then
    raise exception 'private.user_has_client_access no existe';
  end if;
end $$;

create or replace function private._drop_all_policies(p_table text) returns void
language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename=p_table loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table);
  end loop;
end $$;

-- ── 1. TODAS las tablas base con client_id, EXCEPTO client_users y clients ────
--    (client_users se scope por user_id; clients por id — casos especiales abajo)
do $$
declare t text;
begin
  for t in
    select tbl.table_name
    from information_schema.tables tbl
    where tbl.table_schema='public' and tbl.table_type='BASE TABLE'
      and tbl.table_name not in ('client_users','clients')
      and exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name=tbl.table_name and c.column_name='client_id')
  loop
    execute format('alter table public.%I enable row level security', t);
    perform private._drop_all_policies(t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %1$I_sel on public.%1$I for select to authenticated using (private.user_has_client_access(client_id))$p$, t);
    execute format($p$create policy %1$I_ins on public.%1$I for insert to authenticated with check (private.user_has_client_access(client_id))$p$, t);
    execute format($p$create policy %1$I_upd on public.%1$I for update to authenticated using (private.user_has_client_access(client_id)) with check (private.user_has_client_access(client_id))$p$, t);
    execute format($p$create policy %1$I_del on public.%1$I for delete to authenticated using (private.user_has_client_access(client_id))$p$, t);
    execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, t);
  end loop;
end $$;

-- ── 2. pos_audit_log INMUTABLE (override): sin update/delete ──────────────────
drop policy if exists pos_audit_log_upd on public.pos_audit_log;
drop policy if exists pos_audit_log_del on public.pos_audit_log;
revoke update, delete on public.pos_audit_log from authenticated;

-- ── 3. client_users — membership: SOLO lectura de las filas propias ───────────
--    Escrituras (alta/cambio/baja de membership) solo por service_role (path
--    administrativo server). Bloquea auto-escalación de tenant/rol.
alter table public.client_users enable row level security;
select private._drop_all_policies('client_users');
revoke all on public.client_users from anon;
grant select on public.client_users to authenticated;   -- sin insert/update/delete
create policy client_users_read_own on public.client_users for select to authenticated
  using (user_id = auth.uid());
create policy client_users_svc on public.client_users for all to service_role
  using (true) with check (true);
-- (sin policies insert/update/delete para authenticated -> denegado por default)

-- ── 4. VIEWS tenant — respetar RLS del caller (security_invoker) + sin anon ────
do $$
declare v text;
begin
  for v in select table_name from information_schema.views where table_schema='public' loop
    begin
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on public.%I from anon', v);
    exception when others then
      raise notice 'view % no ajustada: %', v, sqlerrm;
    end;
  end loop;
end $$;

-- ── 5. Funciones SECURITY DEFINER: anon SOLO puede ejecutar get_public_menu ────
--    El resto (r1_save_order, r1_merge_orders, r1_reconcile_*, r1_adjust_market_
--    stock, r1_legacy_sale_deduction, auth_client_id, rls_auto_enable, etc.)
--    bypassan RLS (SECURITY DEFINER) y varias toman client_id como parámetro →
--    anon podía escribir/leer datos de cualquier tenant vía RPC directo. Se
--    revoca EXECUTE a public+anon y se concede solo a authenticated+service_role.
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.prosecdef and p.proname <> 'get_public_menu'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
  end loop;
end $$;

-- ── 6. Menú público (QR, sin login) — RPC SECURITY DEFINER, único acceso anon ─
create or replace function public.get_public_menu(p_client_id text)
returns table (category_id text, category_name text, category_sort int, item_id text, item_name text, item_price numeric, item_active boolean)
language sql stable security definer set search_path to 'public' as $$
  select c.id::text, c.name, coalesce(c.sort_order,0), i.id::text, i.name, i.price, coalesce(i.active, true)
  from public.pos_menu_categories c
  join public.pos_menu_items i on i.category_id = c.id and i.client_id = c.client_id
  where c.client_id = p_client_id and coalesce(c.active,true)
  order by coalesce(c.sort_order,0), i.name
$$;
revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;

drop function private._drop_all_policies(text);

commit;
