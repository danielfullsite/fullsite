-- ══════════════════════════════════════════════════════════════════════
-- BLINDAJE B2 — Sellar el aislamiento multi-tenant (RLS)
-- ══════════════════════════════════════════════════════════════════════
--
-- Problema (P0-1, en vivo): muchas tablas con client_id tienen políticas RLS
-- PERMISIVAS para el rol `authenticated` (USING(true) / WITH CHECK(true)) que
-- CONVIVEN con la política tenant-scoped correcta. Postgres combina políticas con
-- OR → la permisiva gana → cualquier usuario autenticado de un restaurante lee y
-- escribe las filas de TODOS los demás (ventas, caja, cortes Z, CFDI, food cost…).
--
-- Modelo de auth (verificado): el app manda el JWT autenticado del usuario a
-- PostgREST (supabase-fetch-patch.ts). Un usuario es miembro de su client_id vía
-- client_users → private.user_has_client_access(client_id) es true para SU tenant.
-- Por eso reemplazar USING(true) por user_has_client_access(client_id) NO rompe las
-- lecturas/escrituras legítimas (siguen pasando para el propio tenant) y bloquea el
-- cross-tenant. Las políticas de service_role (proxy/servidor) quedan INTACTAS.
--
-- Estrategia: para cada tabla objetivo (todas con client_id), dropear SOLO las
-- políticas `authenticated` con qual='true' o with_check='true', y crear políticas
-- tenant-scoped para las 4 operaciones. FORCE RLS para constreñir también al owner.
--
-- Idempotente: DROP IF EXISTS + nombres deterministas. Re-aplicable.
-- Multi-tenant safe: nada global se muta; solo se restringe el acceso por tenant.
--
-- ⚠️  APLICAR PRIMERO EN STAGING Y VALIDAR (ver bloque POSTFLIGHT) ANTES DE PROD.
--     Riesgo: alguna escritura del app que NO setee client_id fallaría el WITH CHECK.
--     La validación confirma que las escrituras legítimas del tenant siguen pasando.
--
-- ══════════════════════════════════════════════════════════════════════
-- PREFLIGHT (correr antes; abortar si user_has_client_access no existe)
-- ══════════════════════════════════════════════════════════════════════
/*
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='private' AND p.proname='user_has_client_access';
-- Esperado: 1 fila.
*/

-- ══════════════════════════════════════════════════════════════════════
-- MIGRATION
-- ══════════════════════════════════════════════════════════════════════
DO $blindaje_b2$
DECLARE
  t text;
  pol record;
  -- Tablas con client_id que hoy tienen políticas `authenticated` permisivas (true).
  target_tables text[] := ARRAY[
    'pos_attendance','pos_audit_log','pos_cash_movements','pos_category_modifiers',
    'pos_cfdi_requests','pos_cierres','pos_combos','pos_customer_notes','pos_gastos',
    'pos_ingredients','pos_inventory_movements','pos_menu_categories','pos_modifier_groups',
    'pos_modifiers','pos_payment_methods','pos_print_jobs','pos_promotions','pos_recipes_old',
    'pos_staff_shifts','pos_suppliers','pos_turnos','push_subscriptions',
    'wansoft_data','wansoft_food_cost','wansoft_inventory','wansoft_labor','wansoft_menu_config',
    'wansoft_persons_hourly','wansoft_pnl','wansoft_recipes','wansoft_shrinkage','wansoft_suppliers',
    'wansoft_hourly','wansoft_tips'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    -- Seguridad: la tabla debe existir y tener client_id (si no, saltar).
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='client_id'
    ) THEN
      RAISE NOTICE 'SKIP % (sin client_id)', t;
      CONTINUE;
    END IF;

    -- 1) Dropear SOLO las políticas `authenticated` permisivas (true). Las de
    --    service_role y las tenant-scoped existentes (user_has_client_access) se dejan.
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename=t
        AND 'authenticated' = ANY(roles)
        AND (qual = 'true' OR with_check = 'true')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- 2) Crear políticas tenant-scoped para las 4 operaciones (idempotente).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'b2_authsel_'||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (private.user_has_client_access(client_id))', 'b2_authsel_'||t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'b2_authins_'||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (private.user_has_client_access(client_id))', 'b2_authins_'||t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'b2_authupd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (private.user_has_client_access(client_id)) WITH CHECK (private.user_has_client_access(client_id))', 'b2_authupd_'||t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'b2_authdel_'||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (private.user_has_client_access(client_id))', 'b2_authdel_'||t, t);

    -- 3) FORCE RLS (constriñe también al owner de la tabla).
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$blindaje_b2$;

-- ── REVOKE de GRANTs anon DML latentes en tablas sensibles (P1-1) ──────────────
-- Hoy RLS los bloquea (0 políticas anon), pero son un arma cargada: si alguien
-- apaga RLS un momento en una migración, un anon podría insertarse en platform_admins.
DO $revokes$
BEGIN
  IF to_regclass('public.pos_orders') IS NOT NULL THEN REVOKE INSERT, UPDATE, DELETE ON public.pos_orders FROM anon; END IF;
  IF to_regclass('public.pos_staff') IS NOT NULL THEN REVOKE INSERT, UPDATE, DELETE ON public.pos_staff FROM anon; END IF;
  IF to_regclass('public.provisioning_tokens') IS NOT NULL THEN REVOKE INSERT, UPDATE, DELETE, SELECT ON public.provisioning_tokens FROM anon; END IF;
  IF to_regclass('public.platform_admins') IS NOT NULL THEN REVOKE INSERT, UPDATE, DELETE, SELECT ON public.platform_admins FROM anon; END IF;
END
$revokes$;

-- VALIDADO EN STAGING (2026-08-17): 0 políticas permisivas restantes; usuario de un
-- tenant ve solo sus filas (0 cross-tenant); escritura propia pasa; escritura
-- cross-tenant bloqueada por WITH CHECK ("new row violates row-level security policy").
-- Nota: staging tenía menos políticas permisivas que prod (~3 vs ~40); la LÓGICA está
-- probada. Antes de prod: validar los flujos reales del app (dashboard+POS de AMALAY)
-- sobre staging o canary — el riesgo residual es una escritura que no setee client_id.

-- ══════════════════════════════════════════════════════════════════════
-- POSTFLIGHT — validar tras aplicar (simula el rol authenticated de un tenant)
-- ══════════════════════════════════════════════════════════════════════
/*
-- (A) Confirmar que NO quedan políticas authenticated permisivas en las target.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND 'authenticated'=ANY(roles)
  AND (qual='true' OR with_check='true')
  AND tablename = ANY(ARRAY['pos_cierres','pos_turnos','pos_cash_movements','wansoft_data','pos_recipes_old']);
-- Esperado: 0 filas.

-- (B) Simular un usuario del tenant A y probar aislamiento. Reemplazar <userA> por
--     un user_id miembro del client 'A' y verificar:
--   BEGIN;
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<userA>","role":"authenticated"}';
--   SELECT count(*) FROM pos_cierres;                    -- solo filas del tenant A
--   SELECT count(*) FROM pos_cierres WHERE client_id='<otro-tenant>';  -- debe ser 0
--   INSERT INTO pos_gastos (client_id, ...) VALUES ('<A>', ...);       -- pasa
--   INSERT INTO pos_gastos (client_id, ...) VALUES ('<otro>', ...);    -- WITH CHECK falla
--   ROLLBACK;
*/

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK (reinstala el acceso permisivo — solo si algo se rompe)
-- ══════════════════════════════════════════════════════════════════════
/*
-- Por tabla: DROP las b2_* y recrear un ALL true para authenticated. Ejemplo:
-- DROP POLICY IF EXISTS b2_authsel_pos_cierres ON public.pos_cierres; (…ins/upd/del)
-- CREATE POLICY auth_all_cierres ON public.pos_cierres FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- ALTER TABLE public.pos_cierres NO FORCE ROW LEVEL SECURITY;
-- (Tomar snapshot de pg_policies ANTES de aplicar para un rollback exacto.)
*/
