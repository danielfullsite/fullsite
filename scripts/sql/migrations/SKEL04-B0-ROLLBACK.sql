-- ══════════════════════════════════════════════════════════════════════
-- SKEL-04 · Batch 0 — ROLLBACK
-- ══════════════════════════════════════════════════════════════════════
--
-- Purpose  : Restore production to the exact state BEFORE
--            SKEL04-B0-critical-security.sql was applied.
-- Scope    : Undoes Sections 1–9 in reverse order.
-- Requires : pg_dump snapshot taken BEFORE applying Batch 0.
-- Safety   : Non-destructive — no data is removed.
--
-- WARNING  : After this rollback runs, the following security holes
--            are re-opened (intentionally, to restore pre-B0 state):
--              • anon can read clients (including wansoft credentials)
--              • anon can read agent_runs, chat_logs, credentials_vault
--              • authenticated can read all clients (no tenant scope)
--            Re-apply SKEL04-B0-critical-security.sql immediately.
--
-- Validation sequence
-- -------------------
--   1. Apply this rollback.
--   2. Run isolation_test.py → expected to FAIL (security weaker).
--   3. Re-apply SKEL04-B0-critical-security.sql.
--   4. Run isolation_test.py → must return 19/19 PASS.
--   5. Declare Batch 0 CERTIFIED.
--
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── SECTION 9 RESTORE — re-grant table-level privileges ─────────────
--
-- The global REVOKE ALL FROM PUBLIC / anon / authenticated sweep removed
-- all DML privileges from these tables. Restore Supabase's typical
-- defaults (SELECT to anon; SELECT+DML to authenticated).
--
-- Note: REFERENCES, TRIGGER, TRUNCATE are not restored here — they were
-- inherited metadata grants, not meaningful for application access.

GRANT SELECT ON TABLE credentials_vault          TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE credentials_vault          TO authenticated;

GRANT SELECT ON TABLE chat_logs                  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chat_logs                  TO authenticated;

GRANT SELECT ON TABLE agent_runs                 TO anon;
GRANT SELECT ON TABLE agent_runs                 TO authenticated;

GRANT SELECT ON TABLE delivery_dlq               TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE delivery_dlq               TO authenticated;

GRANT SELECT ON TABLE integration_audit_log      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integration_audit_log      TO authenticated;

GRANT SELECT ON TABLE integration_providers      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integration_providers      TO authenticated;

GRANT SELECT ON TABLE integration_webhook_dlq    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integration_webhook_dlq    TO authenticated;

GRANT SELECT ON TABLE integration_webhook_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integration_webhook_events TO authenticated;

GRANT SELECT ON TABLE delivery_orders            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE delivery_orders            TO authenticated;

GRANT SELECT ON TABLE delivery_platform_payments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE delivery_platform_payments TO authenticated;

GRANT SELECT ON TABLE pos_bridge_logs            TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pos_bridge_logs            TO authenticated;


-- ─── SECTION 8 RESTORE — clients ─────────────────────────────────────

DROP POLICY IF EXISTS "clients_tenant_read" ON clients;

-- Restore pre-B0 permissive policies
CREATE POLICY "authenticated_all" ON clients
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read" ON clients
  FOR SELECT TO anon USING (true);

-- Restore write access for authenticated
GRANT INSERT, UPDATE, DELETE ON TABLE clients TO authenticated;
GRANT SELECT ON TABLE clients TO anon;


-- ─── SECTION 7 RESTORE — pos_bridge_logs ─────────────────────────────

DROP POLICY IF EXISTS "sro_only" ON pos_bridge_logs;

CREATE POLICY "anon_all" ON pos_bridge_logs
  FOR ALL TO anon USING (true) WITH CHECK (true);


-- ─── SECTION 6 RESTORE — delivery tables ─────────────────────────────

-- delivery_orders
DROP POLICY IF EXISTS "sro_only" ON delivery_orders;

CREATE POLICY "anon insert" ON delivery_orders
  FOR INSERT TO PUBLIC WITH CHECK (true);

CREATE POLICY "delivery_select" ON delivery_orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon update" ON delivery_orders
  FOR UPDATE TO PUBLIC USING (true);

-- delivery_platform_payments
-- Note: the original "service_all" policy was named service_all but granted
-- to {authenticated} — a pre-existing naming bug. Restored as-was.
DROP POLICY IF EXISTS "sro_only" ON delivery_platform_payments;

CREATE POLICY "service_all" ON delivery_platform_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ─── SECTION 5 RESTORE — integration tables ──────────────────────────

-- integration_audit_log
DROP POLICY IF EXISTS "sro_only" ON integration_audit_log;
CREATE POLICY "service_all" ON integration_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- integration_providers
DROP POLICY IF EXISTS "sro_only" ON integration_providers;
CREATE POLICY "service_all" ON integration_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- integration_webhook_dlq
DROP POLICY IF EXISTS "sro_only" ON integration_webhook_dlq;
CREATE POLICY "service_all" ON integration_webhook_dlq
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- integration_webhook_events
DROP POLICY IF EXISTS "sro_only" ON integration_webhook_events;
CREATE POLICY "service_all" ON integration_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- integration_store_mappings: restore anon read
CREATE POLICY "anon_read_store_mappings" ON integration_store_mappings
  FOR SELECT TO anon USING (true);

GRANT SELECT ON TABLE integration_store_mappings TO anon;


-- ─── SECTION 4 RESTORE — agent_runs, delivery_dlq ────────────────────

-- agent_runs: disable RLS (was OFF before B0) + restore pre-existing policies
ALTER TABLE agent_runs DISABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_agent_runs" ON agent_runs
  FOR SELECT TO anon USING (true);

CREATE POLICY "authenticated_read" ON agent_runs
  FOR SELECT TO authenticated USING (true);

-- delivery_dlq: disable RLS (was OFF before B0)
ALTER TABLE delivery_dlq DISABLE ROW LEVEL SECURITY;


-- ─── SECTION 3 RESTORE — chat_logs ───────────────────────────────────

DROP POLICY IF EXISTS "chat_select" ON chat_logs;
DROP POLICY IF EXISTS "chat_insert" ON chat_logs;
DROP POLICY IF EXISTS "chat_update" ON chat_logs;

-- Disable RLS (was OFF before B0)
ALTER TABLE chat_logs DISABLE ROW LEVEL SECURITY;


-- ─── SECTION 2 RESTORE — credentials_vault ───────────────────────────

ALTER TABLE credentials_vault NO FORCE ROW LEVEL SECURITY;
ALTER TABLE credentials_vault DISABLE ROW LEVEL SECURITY;


-- ─── SECTION 1 RESTORE — private schema ──────────────────────────────
--
-- CASCADE removes both functions:
--   private.user_has_client_access(text)
--   private.pos_terminal_client_id()
-- Any policy referencing these functions will error if called after DROP —
-- which is intentional: re-applying B0 is required immediately.

DROP SCHEMA IF EXISTS private CASCADE;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- POST-ROLLBACK VERIFICATION
-- Run these queries after applying rollback to confirm pre-B0 state
-- ══════════════════════════════════════════════════════════════════════

/*
-- 1. Confirm private schema is gone
SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'private';
-- Expected: 0 rows

-- 2. Confirm RLS disabled on tables that were OFF before B0
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('credentials_vault', 'chat_logs', 'agent_runs', 'delivery_dlq');
-- Expected: all false

-- 3. Confirm clients_tenant_read is gone; anon_read + authenticated_all exist
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clients'
ORDER BY policyname;
-- Expected: anon_read (SELECT, anon), authenticated_all (ALL, authenticated)
-- NOT expected: clients_tenant_read

-- 4. Confirm B0 policies are gone from chat_logs
SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chat_logs';
-- Expected: 0 rows (RLS disabled, policies unenforced)

-- 5. Confirm integration tables have service_all (not sro_only)
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'integration_audit_log','integration_providers',
    'integration_webhook_dlq','integration_webhook_events'
  )
ORDER BY tablename;
-- Expected: service_all on each table (not sro_only)
*/
