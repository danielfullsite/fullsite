-- ============================================================
-- RLS Policy Tightening — SOC 2 Compliance
-- Date: 2026-05-25
--
-- Problem: Many tables have "allow_all" policies on public role
-- with qual=true, meaning unauthenticated users can read/write.
--
-- Fix: Replace overly permissive policies with proper access:
--   - POS tables: authenticated users only (read + write)
--   - Wansoft/agent tables: service_role only (no policy needed,
--     RLS enabled + no policy = blocked for non-service_role)
--   - Public-facing tables: anon read, authenticated write
-- ============================================================

-- ============================================================
-- 1. POS TABLES — drop "allow_all public" → authenticated only
-- ============================================================

-- pos_menu_categories
DROP POLICY IF EXISTS "allow_all" ON pos_menu_categories;
CREATE POLICY "authenticated_read" ON pos_menu_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_menu_categories FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_menu_items
DROP POLICY IF EXISTS "allow_all" ON pos_menu_items;
CREATE POLICY "authenticated_read" ON pos_menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_menu_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_modifier_groups
DROP POLICY IF EXISTS "allow_all" ON pos_modifier_groups;
CREATE POLICY "authenticated_read" ON pos_modifier_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_modifier_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_modifiers
DROP POLICY IF EXISTS "allow_all" ON pos_modifiers;
CREATE POLICY "authenticated_read" ON pos_modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_modifiers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_category_modifiers
DROP POLICY IF EXISTS "allow_all" ON pos_category_modifiers;
CREATE POLICY "authenticated_read" ON pos_category_modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_category_modifiers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_payment_methods
DROP POLICY IF EXISTS "allow_all" ON pos_payment_methods;
CREATE POLICY "authenticated_read" ON pos_payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_payment_methods FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_customers
DROP POLICY IF EXISTS "allow_all" ON pos_customers;
CREATE POLICY "authenticated_read" ON pos_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- pos_cfdi_requests
DROP POLICY IF EXISTS "cfdi_all_authenticated" ON pos_cfdi_requests;
CREATE POLICY "authenticated_read" ON pos_cfdi_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON pos_cfdi_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- push_subscriptions
DROP POLICY IF EXISTS "push_all" ON push_subscriptions;
CREATE POLICY "authenticated_all" ON push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 2. WANSOFT TABLES — drop overly permissive policies
--    (RLS enabled + no policy = only service_role can access)
-- ============================================================

-- wansoft_daily: currently anon ALL — agents write via service_role, dashboard reads via authenticated
DROP POLICY IF EXISTS "anon_all" ON wansoft_daily;
CREATE POLICY "authenticated_read" ON wansoft_daily FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 3. AGENT TABLES — tighten agent_runs from public ALL
-- ============================================================

DROP POLICY IF EXISTS "allow_all_agent_runs" ON agent_runs;
CREATE POLICY "authenticated_read" ON agent_runs FOR SELECT TO authenticated USING (true);
-- Agents write via service_role, no policy needed for writes
