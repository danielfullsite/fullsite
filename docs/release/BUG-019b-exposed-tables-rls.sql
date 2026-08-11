-- ============================================================================
-- BUG-019b — Cerrar las 6 tablas POS PÚBLICAS con RLS DESACTIVADA + endurecer
--
-- ESTADO: PROPUESTA — **NO APLICADA A PRODUCCIÓN**. Requiere:
--   1. Autorización explícita de Daniel.
--   2. Validar primero en STAGING (jkcnxfbbuyyfhwfjizgw) con la matriz de 2 tenants.
--   3. Ventana de mantenimiento (es DDL sobre la base en vivo).
--
-- Origen: get_advisors(security) 2026-08-11 encontró estas 6 tablas con
--   `rls_disabled_in_public` (RLS OFF + expuestas a PostgREST) — cualquiera con
--   la anon key (pública) puede leer recetas/inventario/autoridad de mutación
--   de TODOS los tenants. Son NUEVAS respecto a BUG-019 (no estaban en él).
--
-- Depende de: private.user_has_client_access(text) — helper de BUG-019 base.
--   Si BUG-019 base no está aplicado, este script aborta (guard abajo).
--
-- ⚠️ MISMA ADVERTENCIA QUE BUG-019 (leer):
--   Si el APP lee alguna de estas tablas con la ANON key, aplicar esto rompe
--   esa feature (lecturas denegadas). Estas 6 son recetas/inventario/reconciliación
--   → las consume el DASHBOARD (rol authenticated) o endpoints server (service_role),
--   NO el kiosko POS offline (recetas/inventario no están en el prefetch Phase 1).
--   Muy probablemente seguro, pero **VALIDAR EN STAGING antes de prod.**
-- ============================================================================

begin;

-- Guard: la helper de BUG-019 debe existir. Si no, no aplicar nada.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'user_has_client_access'
  ) then
    raise exception 'Falta private.user_has_client_access() — aplicar BUG-019 base primero (docs/release/BUG-019-tenant-rls-fix.sql).';
  end if;
end $$;

-- ── 1. Las 6 tablas expuestas: RLS ON + quitar anon + policy tenant-scoped ──────
do $$
declare t text;
begin
  foreach t in array array[
    'pos_reconciliation_results',
    'pos_item_inventory_policy',
    'pos_recipe_lines',
    'pos_recipe_versions',
    'pos_mutation_authority',
    'pos_menu_item_recipes'
  ]
  loop
    -- Defensivo: saltar tablas que no existen en este entorno (staging vs prod).
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skip (no existe): %', t;
      continue;
    end if;
    -- Enciende RLS (default deny) — service_role la salta por diseño. Idempotente.
    execute format('alter table public.%I enable row level security', t);
    -- La anon key (pública) deja de tocar la tabla.
    execute format('revoke all on public.%I from anon', t);
    -- Policy única tenant-scoped para sesiones de usuario reales (authenticated).
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$
      create policy tenant_isolation on public.%I
        for all to authenticated
        using       (private.user_has_client_access(client_id::text))
        with check  (private.user_has_client_access(client_id::text))
    $p$, t);
  end loop;
end $$;

-- ── 2. is_platform_admin: NO debe ser callable sin autorización ────────────────
--     GOTCHA (detectado en staging): las funciones se otorgan a PUBLIC por
--     default → revocar solo de `anon` NO basta. Hay que revocar de PUBLIC.
--     Verificado en staging: is_platform_admin NO la usa ninguna policy, función
--     ni el cliente → seguro revocarla de PUBLIC (nada interno depende de ella).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_platform_admin'
  loop
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon',   f.sig);
  end loop;
end $$;

-- ── 3. Fijar search_path de funciones (endurecimiento anti-inyección) ───────────
--     No cambia comportamiento; solo evita hijacking del search_path.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'set_updated_at','cancel_stale_pending_reservations','gen_codigo_reserva',
      'convert_recipe_to_stock','set_pos_order_number','reject_mutation',
      'reconcile_order_inventory','activate_recipe_version','r1_save_order'
    )
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

commit;

-- ============================================================================
-- PENDIENTES QUE **NO** VAN EN ESTE SCRIPT (requieren decisión / más cuidado):
--
--  A. Views SECURITY DEFINER (reviews_pending, reservaciones_activas,
--     reservaciones_hoy, ops_daily_history, ops_daily_live, pos_recipes_canonical):
--     cambiar a security_invoker=on PUEDE denegar lecturas si el rol que consulta
--     no tiene permisos sobre las tablas base. Revisar caso por caso en staging.
--
--  B. r1_save_order / r1_observation_sample ejecutables por anon:
--     r1_save_order es PROBABLEMENTE intencional (el POS guarda órdenes por RPC).
--     **NO revocar sin confirmar** — revocaría el guardado de órdenes. Revisar.
--
--  C. is_platform_admin para `authenticated`: ver nota arriba.
--
--  D. dblink en schema public → mover a otro schema (bajo riesgo, hacer aparte).
--
--  E. Leaked Password Protection (HaveIBeenPwned) — NO es SQL: activar en
--     Supabase Dashboard → Auth → Password protection.
--
--  F. Las ~28 tablas con RLS enabled-no-policy: revisar cuáles necesitan policy
--     por client_id y cuáles son lockdown intencional (credentials_vault = OK).
-- ============================================================================
