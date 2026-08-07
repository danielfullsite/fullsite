-- ============================================================================
-- BUG-019 — FIX de aislamiento de tenant a nivel DB (RLS real)
--
-- ESTADO: probado en STAGING (jkcnxfbbuyyfhwfjizgw). NO aplicado a producción
-- (qjiomlvudfmzuvqvhwpk). Requiere autorización explícita de Daniel + deploy
-- coordinado de la app (ver BUG-019-APP-CHANGES.md).
--
-- ROOT CAUSE: RLS estaba "enabled" pero las policies eran permisivas
-- (`using(true)`) para anon/public sin binding de tenant, y anon tenía grants
-- SELECT/INSERT/UPDATE/DELETE. La anon key es pública (va en el bundle) →
-- cualquiera lee/escribe/borra datos POS de cualquier tenant vía PostgREST.
--
-- MODELO NUEVO:
--   - Fuente de tenant CONFIABLE = auth.uid() -> public.client_users membership,
--     vía private.user_has_client_access(client_id). NO se confía en ningún
--     client_id enviado por el navegador (URL/localStorage/body). El atacante
--     no puede forjar auth.uid() (viene de la firma del JWT de Supabase).
--   - anon SIN acceso a tablas POS. El navegador debe usar el JWT de sesión
--     (rol authenticated). Las escrituras del kiosko van por endpoints server
--     (service_role, que bypassa RLS y resuelve el tenant con withPOSAuth).
--   - Menú público (QR sin login) vía RPC SECURITY DEFINER get_public_menu().
--
-- IDEMPOTENTE. Correr en una transacción.
-- ============================================================================

begin;

-- 0. Sanity: la primitiva de membership debe existir (ya existe en prod y staging).
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='private' and p.proname='user_has_client_access') then
    raise exception 'private.user_has_client_access no existe -- abortando';
  end if;
end $$;

-- Helper local: borra TODAS las policies de una tabla (limpia el estado permisivo previo).
create or replace function private._drop_all_policies(p_table text) returns void
language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename=p_table loop
    execute format('drop policy if exists %I on public.%I', r.policyname, p_table);
  end loop;
end $$;

-- ── GRUPO A: tablas SENSIBLES -- authenticated tenant-scoped, sin anon ────────
do $$
declare t text;
begin
  foreach t in array array[
    'pos_orders','pos_turnos','pos_staff','pos_cash_movements','pos_cierres',
    'pos_recipes','pos_payment_methods',
    'pos_menu_categories','pos_menu_items','pos_modifier_groups','pos_modifiers'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      perform private._drop_all_policies(t);

      -- anon fuera por completo (la key pública ya no toca estas tablas).
      execute format('revoke all on public.%I from anon', t);
      -- authenticated conserva grants de tabla; RLS hace el filtrado real.
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);

      -- Policies tenant-scoped por comando (la fila DEBE ser de un tenant del usuario).
      execute format($p$create policy %1$I_sel on public.%1$I for select to authenticated
                       using (private.user_has_client_access(client_id))$p$, t);
      execute format($p$create policy %1$I_ins on public.%1$I for insert to authenticated
                       with check (private.user_has_client_access(client_id))$p$, t);
      execute format($p$create policy %1$I_upd on public.%1$I for update to authenticated
                       using (private.user_has_client_access(client_id))
                       with check (private.user_has_client_access(client_id))$p$, t);
      execute format($p$create policy %1$I_del on public.%1$I for delete to authenticated
                       using (private.user_has_client_access(client_id))$p$, t);

      -- service_role: acceso total explícito (endpoints server con withPOSAuth).
      execute format($p$create policy %1$I_svc on public.%1$I for all to service_role
                       using (true) with check (true)$p$, t);
    end if;
  end loop;
end $$;

-- ── GRUPO B: pos_audit_log -- insert+select por tenant, SIN update/delete ─────
alter table public.pos_audit_log enable row level security;
select private._drop_all_policies('pos_audit_log');
revoke all on public.pos_audit_log from anon;
grant select, insert on public.pos_audit_log to authenticated;
create policy pos_audit_log_sel on public.pos_audit_log for select to authenticated
  using (private.user_has_client_access(client_id));
create policy pos_audit_log_ins on public.pos_audit_log for insert to authenticated
  with check (private.user_has_client_access(client_id));
-- (sin policy UPDATE/DELETE para authenticated -> denegado; audit es inmutable)
create policy pos_audit_log_svc on public.pos_audit_log for all to service_role
  using (true) with check (true);

-- ── Menú público (QR, sin login) -- RPC SECURITY DEFINER, único acceso anon ───
create or replace function public.get_public_menu(p_client_id text)
returns table (
  category_id text, category_name text, category_sort int,
  item_id text, item_name text, item_price numeric, item_active boolean
)
language sql stable security definer set search_path to 'public' as $$
  select c.id::text, c.name, coalesce(c.sort_order,0),
         i.id::text, i.name, i.price, coalesce(i.active, true)
  from public.pos_menu_categories c
  join public.pos_menu_items i on i.category_id = c.id and i.client_id = c.client_id
  where c.client_id = p_client_id and coalesce(c.active,true)
  order by coalesce(c.sort_order,0), i.name
$$;
revoke all on function public.get_public_menu(text) from public;
grant execute on function public.get_public_menu(text) to anon, authenticated;

-- Limpieza del helper.
drop function private._drop_all_policies(text);

commit;
