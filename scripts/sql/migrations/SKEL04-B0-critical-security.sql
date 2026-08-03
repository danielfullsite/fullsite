-- ══════════════════════════════════════════════════════════════════════
-- SKEL-04 · Batch 0 — Critical Security (no POS dependency)
-- ══════════════════════════════════════════════════════════════════════
--
-- Scope: tables that are safe to restrict without JWT provisioning.
--        No POS terminal breakage expected.
-- Phase: Run BEFORE Batch 1, 2, 3
-- DoD gate: SKEL-04 Batch 0 only closes once isolation_test.py passes
--
-- Preflight:  Run the SELECT block at the bottom before applying
-- Postflight: Run the postflight block at the bottom to verify
-- Rollback:   See ROLLBACK section at bottom (requires pg_dump snapshot first)
--
-- CRITICAL FINDING in clients table:
--   clients.wansoft_user, clients.wansoft_pass (plaintext), clients.wansoft_cookies
--   are currently readable by anon (USING(true) policy).
--   This batch revokes anon access to clients immediately.
--   wansoft_* columns must be migrated to credentials_vault — tracked as credential-migration.
--
-- ══════════════════════════════════════════════════════════════════════
-- PREFLIGHT — run this first; abort if any assertion fails
-- ══════════════════════════════════════════════════════════════════════

/*
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'credentials_vault', 'chat_logs', 'agent_runs', 'delivery_dlq',
    'integration_audit_log', 'integration_providers',
    'integration_webhook_dlq', 'integration_webhook_events',
    'integration_store_mappings', 'delivery_orders',
    'delivery_platform_payments', 'pos_bridge_logs', 'clients'
  )
ORDER BY tablename;

-- Expected: credentials_vault=false, chat_logs=false, agent_runs=false, delivery_dlq=false
-- All others should be true (RLS already enabled)
*/

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 1 — Private schema + SECURITY DEFINER helpers
-- ══════════════════════════════════════════════════════════════════════
--
-- All RLS policies that do tenant membership checks MUST call these
-- functions instead of inlining the subquery. Reasons:
--   1. Prevents RLS recursion across tables
--   2. Centralizes audit surface to one place
--   3. SET search_path blocks search path injection
--   4. SECURITY DEFINER runs as owner, not caller
--   5. Fail-closed: returns false (not null) on any invalid input
--
-- Owner: the role that creates this migration (postgres / supabase_admin)
-- EXECUTE granted only to 'authenticated' — anon has no access.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;

-- Primary tenant access checker (for P-AUTH policies)
CREATE OR REPLACE FUNCTION private.user_has_client_access(target_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL                 THEN false  -- not authenticated
    WHEN target_client_id IS NULL           THEN false  -- null client_id
    WHEN target_client_id = ''             THEN false  -- empty string
    ELSE EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.user_id    = auth.uid()
        AND cu.client_id  = target_client_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION private.user_has_client_access(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.user_has_client_access(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.user_has_client_access(text) TO authenticated;

-- POS terminal claim extractor (for P-JWT policies — Batch 2)
-- Included here so all policies reference it from day 1, even if
-- Batch 2 tables aren't migrated yet. Returns NULL = fail-closed.
CREATE OR REPLACE FUNCTION private.pos_terminal_client_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL                                                THEN NULL
    WHEN (auth.jwt()->'app_metadata'->>'actor')     IS DISTINCT FROM 'pos_terminal' THEN NULL
    WHEN COALESCE(auth.jwt()->'app_metadata'->>'terminal_id', '') = ''    THEN NULL
    WHEN COALESCE(auth.jwt()->'app_metadata'->>'client_id',   '') = ''    THEN NULL
    ELSE auth.jwt()->'app_metadata'->>'client_id'
  END;
$$;

REVOKE ALL ON FUNCTION private.pos_terminal_client_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.pos_terminal_client_id() FROM anon;
GRANT  EXECUTE ON FUNCTION private.pos_terminal_client_id() TO authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 2 — credentials_vault  (RLS OFF → P-SRO + FORCE)
-- ══════════════════════════════════════════════════════════════════════
--
-- Contains API keys and third-party secrets. service_role bypasses RLS.
-- FORCE RLS applied: even the table owner cannot read rows without
-- explicitly connecting as service_role.
-- Application layer must encrypt values at rest (AES-256-GCM) before insert.
-- Reads must be audited; never return full secret in API responses.

ALTER TABLE credentials_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials_vault FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE credentials_vault FROM anon;
REVOKE ALL ON TABLE credentials_vault FROM authenticated;
-- service_role accesses via bypassrls; no explicit policy needed.

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 3 — chat_logs  (RLS OFF → P-USR)
-- ══════════════════════════════════════════════════════════════════════
--
-- AI conversation history. Scoped to: user owns row AND user belongs
-- to the client. Double check prevents cross-tenant read even if
-- user_id somehow points to a user in another tenant.

ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE chat_logs FROM anon;

DROP POLICY IF EXISTS "chat_read"   ON chat_logs;
DROP POLICY IF EXISTS "chat_write"  ON chat_logs;
DROP POLICY IF EXISTS "chat_select" ON chat_logs;
DROP POLICY IF EXISTS "chat_insert" ON chat_logs;
DROP POLICY IF EXISTS "chat_update" ON chat_logs;

-- chat_logs.user_id is text; auth.uid() returns uuid — explicit cast required
CREATE POLICY "chat_select" ON chat_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()::text
    AND private.user_has_client_access(client_id)
  );

CREATE POLICY "chat_insert" ON chat_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()::text
    AND private.user_has_client_access(client_id)
  );

CREATE POLICY "chat_update" ON chat_logs
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()::text
    AND private.user_has_client_access(client_id)
  )
  WITH CHECK (
    user_id = auth.uid()::text
    AND private.user_has_client_access(client_id)
  );
-- DELETE: intentionally omitted — soft-delete via status field only.

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 4 — agent_runs, delivery_dlq  (RLS OFF → P-SRO)
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_agent_runs" ON agent_runs;
DROP POLICY IF EXISTS "authenticated_read"   ON agent_runs;
REVOKE ALL ON TABLE agent_runs FROM anon;
REVOKE ALL ON TABLE agent_runs FROM authenticated;

ALTER TABLE delivery_dlq ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE delivery_dlq FROM anon;
REVOKE ALL ON TABLE delivery_dlq FROM authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 5 — Integration infrastructure  (→ P-SRO)
-- ══════════════════════════════════════════════════════════════════════

-- integration_audit_log
DROP POLICY IF EXISTS "service_all" ON integration_audit_log;
CREATE POLICY "sro_only" ON integration_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE integration_audit_log FROM anon;
REVOKE ALL ON TABLE integration_audit_log FROM authenticated;

-- integration_providers
DROP POLICY IF EXISTS "service_all" ON integration_providers;
CREATE POLICY "sro_only" ON integration_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE integration_providers FROM anon;
REVOKE ALL ON TABLE integration_providers FROM authenticated;

-- integration_webhook_dlq
DROP POLICY IF EXISTS "service_all" ON integration_webhook_dlq;
CREATE POLICY "sro_only" ON integration_webhook_dlq
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE integration_webhook_dlq FROM anon;
REVOKE ALL ON TABLE integration_webhook_dlq FROM authenticated;

-- integration_webhook_events
DROP POLICY IF EXISTS "service_all" ON integration_webhook_events;
CREATE POLICY "sro_only" ON integration_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE integration_webhook_events FROM anon;
REVOKE ALL ON TABLE integration_webhook_events FROM authenticated;

-- integration_store_mappings: keep service_all, revoke anon read only
DROP POLICY IF EXISTS "anon_read_store_mappings" ON integration_store_mappings;
REVOKE SELECT ON TABLE integration_store_mappings FROM anon;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 6 — Delivery tables  (→ P-SRO)
-- ══════════════════════════════════════════════════════════════════════
--
-- delivery-worker inserts via service_role; no legitimate anon/auth
-- direct access. Dashboard routes query via /api/* with service_role.
-- If dashboard queries delivery_orders via authenticated client:
--   → add P-AUTH read policy in Batch 1 before deploying dashboard.

-- delivery_orders
DROP POLICY IF EXISTS "anon insert"      ON delivery_orders;
DROP POLICY IF EXISTS "delivery_select"  ON delivery_orders;
DROP POLICY IF EXISTS "anon update"      ON delivery_orders;
REVOKE ALL ON TABLE delivery_orders FROM anon;
REVOKE ALL ON TABLE delivery_orders FROM authenticated;

-- delivery_platform_payments
DROP POLICY IF EXISTS "service_all" ON delivery_platform_payments;
REVOKE ALL ON TABLE delivery_platform_payments FROM anon;
REVOKE ALL ON TABLE delivery_platform_payments FROM authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 7 — pos_bridge_logs  (→ P-SRO)
-- ══════════════════════════════════════════════════════════════════════
--
-- local-server writes via service_role; no direct client access needed.

DROP POLICY IF EXISTS "anon_all" ON pos_bridge_logs;
REVOKE ALL ON TABLE pos_bridge_logs FROM anon;
REVOKE ALL ON TABLE pos_bridge_logs FROM authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 8 — clients table  (credential exposure patch)
-- ══════════════════════════════════════════════════════════════════════
--
-- CRITICAL: clients.wansoft_user, clients.wansoft_pass (PLAINTEXT),
--   clients.wansoft_cookies (live session tokens) are currently
--   readable by ANON via the "anon_read" policy USING(true).
--
-- This section:
--   1. Revokes anon read immediately (blocks unauthenticated access)
--   2. Replaces authenticated_all USING(true) with tenant-scoped read
--   3. Revokes write access from authenticated (service_role only)
--
-- Credential migration (tracked separately, NOT in this file):
--   -- Copy to credentials_vault before nulling columns:
--   INSERT INTO credentials_vault (client_id, credential_type, credential_key, credential_value)
--   SELECT id, 'wansoft', 'username', wansoft_user FROM clients WHERE wansoft_user IS NOT NULL;
--   INSERT INTO credentials_vault (client_id, credential_type, credential_key, credential_value)
--   SELECT id, 'wansoft', 'password', wansoft_pass FROM clients WHERE wansoft_pass IS NOT NULL;
--   INSERT INTO credentials_vault (client_id, credential_type, credential_key, credential_value)
--   SELECT id, 'wansoft', 'cookies',  wansoft_cookies::text FROM clients WHERE wansoft_cookies IS NOT NULL;
--   -- After verifying agents read from credentials_vault:
--   UPDATE clients SET wansoft_user = NULL, wansoft_pass = NULL, wansoft_cookies = NULL;
--   -- After stable: ALTER TABLE clients DROP COLUMN wansoft_user, DROP COLUMN wansoft_pass, DROP COLUMN wansoft_cookies;
--
-- WARNING: After applying this patch, verify that:
--   a) Dashboard login flow does NOT use the anon key to read clients (expected: uses service_role via /api/)
--   b) All GitHub Actions scripts that read wansoft_user/pass/cookies still use service_role key
--   If either breaks, add a temporary anon-read-limited policy and escalate to Batch 1.

DROP POLICY IF EXISTS "anon_read"       ON clients;
DROP POLICY IF EXISTS "authenticated_all" ON clients;

-- Authenticated users may only SELECT their own client record(s)
CREATE POLICY "clients_tenant_read" ON clients
  FOR SELECT TO authenticated
  USING (private.user_has_client_access(id));

-- Writes are service_role only
REVOKE INSERT, UPDATE, DELETE ON TABLE clients FROM authenticated;
REVOKE ALL ON TABLE clients FROM anon;

-- ══════════════════════════════════════════════════════════════════════
-- SECTION 9 — Global REVOKE sweep for P-SRO tables
-- ══════════════════════════════════════════════════════════════════════
--
-- Belt-and-suspenders: even if a table has RLS ON with no policies
-- (deny-by-default), explicitly revoking eliminates accidental GRANT
-- inheritance from role hierarchy or future role changes.

REVOKE ALL ON TABLE credentials_vault          FROM PUBLIC;
REVOKE ALL ON TABLE chat_logs                  FROM anon;
REVOKE ALL ON TABLE agent_runs                 FROM PUBLIC;
REVOKE ALL ON TABLE delivery_dlq               FROM PUBLIC;
REVOKE ALL ON TABLE integration_audit_log      FROM PUBLIC;
REVOKE ALL ON TABLE integration_providers      FROM PUBLIC;
REVOKE ALL ON TABLE integration_webhook_dlq    FROM PUBLIC;
REVOKE ALL ON TABLE integration_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE delivery_orders            FROM PUBLIC;
REVOKE ALL ON TABLE delivery_platform_payments FROM PUBLIC;
REVOKE ALL ON TABLE pos_bridge_logs            FROM PUBLIC;

-- ══════════════════════════════════════════════════════════════════════
-- OUT OF SCOPE FOR BATCH 0 (tracked for Batch 1 / Batch 2)
-- ══════════════════════════════════════════════════════════════════════
--
-- Batch 1 (no POS dependency, dashboard-facing):
--   ops_daily, agent_insights, agent_results, agent_events,
--   pos_billing_clients, pos_bridge_logs (already done above),
--   push_subscriptions, delivery_platform_payments (done above),
--   pos_staff_audit, wansoft_* analytics tables,
--   client_locations, pos_audit_log (dedup + tighten)
--
-- Batch 2 (requires POS JWT provisioning):
--   pos_item_inventory_policy, pos_menu_item_recipes, pos_mutation_authority,
--   pos_recipe_lines, pos_recipe_versions (all RLS OFF, POS-accessed)
--   All Tier 2 Group 2A tables
--
-- Batch 3 (global/legacy cleanup):
--   wansoft_daily, wansoft_kpis, tasks, parity_reports, events,
--   pos_survey, amalay_reservaciones (Tier 3 reclassification)
--
-- Credential migration (parallel, not blocking Batch 0):
--   Move clients.wansoft_user/.wansoft_pass/.wansoft_cookies → credentials_vault
--   Update all GitHub Actions scripts to read from credentials_vault via service_role

-- ══════════════════════════════════════════════════════════════════════
-- POSTFLIGHT — run after applying; verify before closing Batch 0
-- ══════════════════════════════════════════════════════════════════════

/*
-- 1. Confirm RLS is now ON for all Batch 0 tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'credentials_vault', 'chat_logs', 'agent_runs', 'delivery_dlq'
  )
ORDER BY tablename;
-- Expected: all rowsecurity = true

-- 2. Confirm private schema exists and functions are accessible
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'private'
ORDER BY routine_name;
-- Expected: pos_terminal_client_id, user_has_client_access — both DEFINER

-- 3. Confirm anon cannot read credentials_vault
-- (run as anon via Supabase JS client with anon key)
-- SELECT * FROM credentials_vault LIMIT 1;
-- Expected: empty result set (RLS deny)

-- 4. Confirm anon cannot read clients.wansoft_pass
-- SELECT wansoft_pass FROM clients LIMIT 1;
-- Expected: empty result set (anon policy revoked)

-- 5. Confirm authenticated user can read own client (not others)
-- Context: amalay user. Should see amalay client, not nomada.
-- SELECT id FROM clients;
-- Expected: only rows where user is in client_users for that client

-- 6. Confirm private.user_has_client_access returns false for anon
-- SELECT private.user_has_client_access('amalay');
-- Expected: ERROR — anon has no EXECUTE grant (not false, but permission denied)
-- This is correct and intentional.

-- 7. Verify no policy leaks remain on integration tables
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'integration_audit_log', 'integration_providers',
    'integration_webhook_dlq', 'integration_webhook_events'
  )
ORDER BY tablename, cmd;
-- Expected: only service_role / sro_only policies remain
*/

-- ══════════════════════════════════════════════════════════════════════
-- ROLLBACK — requires pg_dump snapshot taken BEFORE applying
-- ══════════════════════════════════════════════════════════════════════

/*
-- If needed, undo in reverse order:

-- Section 9 (revokes): cannot be reliably rolled back without snapshot.
-- Restore from pg_dump or manually re-grant:
GRANT SELECT ON TABLE clients TO anon;  -- re-exposes wansoft_pass; do not use in production

-- Section 8 (clients):
DROP POLICY IF EXISTS "clients_tenant_read" ON clients;
CREATE POLICY "authenticated_all" ON clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_read" ON clients FOR SELECT TO anon USING (true);
GRANT INSERT, UPDATE, DELETE ON TABLE clients TO authenticated;

-- Section 7 (pos_bridge_logs):
CREATE POLICY "anon_all" ON pos_bridge_logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- Section 6 (delivery):
CREATE POLICY "anon insert" ON delivery_orders FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "delivery_select" ON delivery_orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon update" ON delivery_orders FOR UPDATE TO public USING (true);

-- Section 5 (integration):
-- Restore original service_all policies (names vary — check pg_dump)

-- Section 4 (agent_runs, delivery_dlq):
ALTER TABLE agent_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_dlq DISABLE ROW LEVEL SECURITY;
-- Re-create original policies from pg_dump

-- Section 3 (chat_logs):
ALTER TABLE chat_logs DISABLE ROW LEVEL SECURITY;

-- Section 2 (credentials_vault):
ALTER TABLE credentials_vault NO FORCE ROW LEVEL SECURITY;
ALTER TABLE credentials_vault DISABLE ROW LEVEL SECURITY;

-- Section 1 (private schema):
-- DROP FUNCTION private.user_has_client_access(text);
-- DROP FUNCTION private.pos_terminal_client_id();
-- DROP SCHEMA private;
-- Note: dropping private schema removes all helpers — do last
*/
