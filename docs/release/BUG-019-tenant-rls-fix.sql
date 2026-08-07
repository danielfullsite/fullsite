-- ============================================================================
-- BUG-019 — FIX PROPUESTO (NO APLICADO A PRODUCCIÓN)
-- Tenant isolation a nivel DB para las tablas POS.
--
-- ESTADO: PROPUESTA. Requiere autorización explícita de Daniel para aplicar a
-- producción (qjiomlvudfmzuvqvhwpk) Y un cambio de app coordinado (ver NOTA APP).
-- Validar primero en staging (jkcnxfbbuyyfhwfjizgw).
--
-- Contexto: hoy las tablas POS tienen RLS "enabled" pero con policies
-- permisivas `using(true)` para anon/public, y grants completos a anon. La
-- anon key es pública (va en el bundle del navegador) → cualquiera lee/escribe
-- datos POS de todos los tenants directo contra PostgREST. Ver BUG-019.
--
-- Patrón reutilizado: private.user_has_client_access(text) — ya existe y lo
-- usa la tabla `clients`. Ata target_client_id a auth.uid() vía client_users.
--
-- NOTA APP (imprescindible antes/junto con esta migración):
--   1. Las lecturas directas del navegador (pos_orders/pos_turnos/pos_staff/
--      pos_menu_* etc.) deben usar el JWT de sesión del usuario (rol
--      `authenticated`), NO la anon key.
--   2. El kiosko POS (login por PIN → shift-token, sin sesión Supabase) debe
--      leer/escribir SOLO a través de endpoints server con withPOSAuth
--      (service_role + client_id resuelto en servidor). El kiosko no debe
--      hablar con PostgREST usando anon.
--   Sin (1) y (2), aplicar esta migración ROMPE el POS (lecturas denegadas).
-- ============================================================================

begin;

-- Tablas operativas con columna client_id → scoping por tenant.
do $$
declare t text;
begin
  foreach t in array array[
    'pos_orders','pos_turnos','pos_staff','pos_cash_movements','pos_cierres',
    'pos_menu_categories','pos_menu_items','pos_modifier_groups','pos_modifiers',
    'pos_recipes','pos_audit_log'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      -- 1. Quitar acceso directo de anon (la key pública ya no toca estas tablas).
      execute format('revoke all on public.%I from anon', t);

      -- 2. Borrar las policies permisivas conocidas (idempotente).
      execute format('drop policy if exists anon_read on public.%I', t);
      execute format('drop policy if exists anon_read_staff on public.%I', t);
      execute format('drop policy if exists anon_read_turnos on public.%I', t);
      execute format('drop policy if exists anon_insert_orders on public.%I', t);
      execute format('drop policy if exists anon_update_orders on public.%I', t);
      execute format('drop policy if exists anon_all_turnos on public.%I', t);
      execute format('drop policy if exists anon_insert_turnos on public.%I', t);
      execute format('drop policy if exists anon_update_turnos on public.%I', t);
      execute format('drop policy if exists anon_insert on public.%I', t);
      execute format('drop policy if exists anon_write_cierres on public.%I', t);
      execute format('drop policy if exists anon_read_cierres on public.%I', t);
      execute format('drop policy if exists anon_read_audit on public.%I', t);
      execute format('drop policy if exists anon_insert_audit on public.%I', t);
      execute format('drop policy if exists "anon read" on public.%I', t);
      execute format('drop policy if exists anon_read_menu_items on public.%I', t);
      execute format('drop policy if exists anon_write_menu_items on public.%I', t);
      execute format('drop policy if exists anon_update_menu_items on public.%I', t);
      execute format('drop policy if exists anon_read_menu_categories on public.%I', t);
      execute format('drop policy if exists anon_write_menu_categories on public.%I', t);
      execute format('drop policy if exists anon_update_menu_categories on public.%I', t);
      execute format('drop policy if exists authenticated_all on public.%I', t);
      execute format('drop policy if exists auth_all on public.%I', t);
      execute format('drop policy if exists authenticated_read on public.%I', t);
      execute format('drop policy if exists authenticated_write on public.%I', t);

      -- 3. Policy tenant-scoped para authenticated (sesión de usuario real).
      execute format($f$
        create policy %1$I_tenant_rw on public.%1$I
        for all to authenticated
        using (private.user_has_client_access(client_id))
        with check (private.user_has_client_access(client_id))
      $f$, t);
    end if;
  end loop;
end $$;

-- Audit log: nunca UPDATE/DELETE desde el cliente, sólo INSERT + SELECT del propio tenant.
drop policy if exists pos_audit_log_tenant_rw on public.pos_audit_log;
create policy pos_audit_log_tenant_read on public.pos_audit_log
  for select to authenticated using (private.user_has_client_access(client_id));
create policy pos_audit_log_tenant_insert on public.pos_audit_log
  for insert to authenticated with check (private.user_has_client_access(client_id));
-- (sin policy UPDATE/DELETE → denegado por default; el service_role sigue teniendo su policy ALL)

commit;

-- ============================================================================
-- TEST DE ISOLATION (ejecutar como authenticated de un tenant; esperar 0 filas
-- al pedir otro tenant). Pseudocódigo REST:
--   GET /rest/v1/pos_orders?client_id=eq.<OTRO_TENANT>  (Bearer = JWT de usuario del tenant A)
--   → esperado: [] (RLS filtra), NO las filas del otro tenant.
-- Automatizable en tests/ con dos usuarios de client_users distintos.
-- ============================================================================
