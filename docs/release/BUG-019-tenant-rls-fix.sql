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
--   - Menú público (QR) server-side vía /api/public/menu (service_role, token de
--     mesa) — SIN RPC anon (BUG-019-B). Cero superficie anon en DB.
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
      -- security_invoker=true: la view aplica la RLS del usuario que consulta
      -- (tenant-scoped), no la del owner. revoke anon + grant authenticated para
      -- que los usuarios logueados sigan leyendo (con su RLS), anon no.
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on public.%I from anon', v);
      execute format('grant select on public.%I to authenticated', v);
    exception when others then
      raise notice 'view % no ajustada: %', v, sqlerrm;
    end;
  end loop;
end $$;

-- ── 5. Funciones SECURITY DEFINER: NINGUNA ejecutable por anon ─────────────────
--    r1_save_order, r1_merge_orders, r1_reconcile_*, r1_adjust_market_stock,
--    r1_legacy_sale_deduction, auth_client_id, rls_auto_enable, etc. bypassan RLS
--    (SECURITY DEFINER) y varias toman client_id como parámetro → anon podía
--    escribir/leer datos de cualquier tenant vía RPC directo. Se revoca EXECUTE a
--    public+anon y se concede solo a authenticated+service_role. Sin excepciones:
--    el menú público ya NO se sirve por RPC anon (BUG-019-B lo sirve server-side
--    con service_role; no existe función de menú ejecutable por anon).
do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
    where p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
  end loop;
end $$;

-- ── 6. Menú público (QR, sin login) — SIN RPC anon ────────────────────────────
--    BUG-019-B: el menú público se sirve exclusivamente server-side vía
--    /api/public/menu (service_role, tenant resuelto por token de mesa). NO se
--    crea get_public_menu ni ninguna función de menú ejecutable por anon: la
--    superficie anon en DB queda en cero. Si get_public_menu existía de un ensayo
--    previo (p.ej. staging), la sección 5 ya le revocó EXECUTE a anon; aquí se
--    elimina para no dejar SECURITY DEFINER muerto.
drop function if exists public.get_public_menu(text);

-- ── 7a. Deuda permisiva histórica: tablas legacy SIN client_id NI padre ────────
--    BUG-019-CD: base tables sin client_id (sección 1 no las tocó) que exponían datos
--    PRIVADos a anon vía policies `public`/`anon`: finanzas (wansoft_daily/kpis) y PII
--    (amalay_reservaciones). Son AMALAY-legacy single-tenant sin relación a un padre.
--    Se revoca anon; lectura solo authenticated + service_role. wansoft_* además queda
--    detrás del ownership gate server-side de voice/coach (WANSOFT_LEGACY_CLIENT_ID).
--    content y reviews se dejan públicas a propósito (las lee el sitio de marketing).
do $$
declare t text;
begin
  foreach t in array array['wansoft_daily','wansoft_kpis','amalay_reservaciones'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      perform private._drop_all_policies(t);
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon', t);
      execute format('grant select on public.%I to authenticated, service_role', t);
      execute format($p$create policy %1$I_auth_read on public.%1$I for select to authenticated using (true)$p$, t);
      execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, t);
    end if;
  end loop;
end $$;

-- ── 7b. Tablas HIJAS sin client_id: scope por tenant vía la relación real al PADRE ─
--    pos_purchase_order_items.order_id      -> pos_purchase_orders.id      (client_id)
--    pos_sub_recipe_ingredients.sub_recipe_id -> pos_sub_recipes.id        (client_id)
--    (Sin FK formal en el schema; el join usa la columna de enlace real verificada.)
--    Un usuario accede a un hijo SOLO si tiene acceso al tenant del padre. USING (lectura/
--    update/delete) y WITH CHECK (insert/update) impiden leer, insertar o MOVER cross-tenant.
--    No basta revocar anon ni dejar authenticated general.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('pos_purchase_order_items','order_id','pos_purchase_orders'),
      ('pos_sub_recipe_ingredients','sub_recipe_id','pos_sub_recipes')
    ) as v(child, fk_col, parent)
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=r.child)
       and exists (select 1 from information_schema.tables where table_schema='public' and table_name=r.parent) then
      perform private._drop_all_policies(r.child);
      execute format('alter table public.%I enable row level security', r.child);
      execute format('revoke all on public.%I from anon', r.child);
      execute format('grant select, insert, update, delete on public.%I to authenticated', r.child);
      execute format('grant all on public.%I to service_role', r.child);
      -- parent-access predicate reused across the 4 authenticated policies
      execute format(
        $p$create policy %1$I_sel on public.%1$I for select to authenticated
             using (exists (select 1 from public.%3$I p where p.id = %1$I.%2$I and private.user_has_client_access(p.client_id)))$p$,
        r.child, r.fk_col, r.parent);
      execute format(
        $p$create policy %1$I_ins on public.%1$I for insert to authenticated
             with check (exists (select 1 from public.%3$I p where p.id = %1$I.%2$I and private.user_has_client_access(p.client_id)))$p$,
        r.child, r.fk_col, r.parent);
      execute format(
        $p$create policy %1$I_upd on public.%1$I for update to authenticated
             using (exists (select 1 from public.%3$I p where p.id = %1$I.%2$I and private.user_has_client_access(p.client_id)))
             with check (exists (select 1 from public.%3$I p where p.id = %1$I.%2$I and private.user_has_client_access(p.client_id)))$p$,
        r.child, r.fk_col, r.parent);
      execute format(
        $p$create policy %1$I_del on public.%1$I for delete to authenticated
             using (exists (select 1 from public.%3$I p where p.id = %1$I.%2$I and private.user_has_client_access(p.client_id)))$p$,
        r.child, r.fk_col, r.parent);
      execute format($p$create policy %1$I_svc on public.%1$I for all to service_role using (true) with check (true)$p$, r.child);
    end if;
  end loop;
end $$;

drop function private._drop_all_policies(text);

commit;
