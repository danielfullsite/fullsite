-- ============================================================
-- FASE 1: Create fullsite_readonly role
-- ADITIVO — no modifica roles ni permisos existentes
-- Reversible: DROP ROLE fullsite_readonly;
-- ============================================================

-- 1. Create the role (login-capable for API key auth)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_readonly') THEN
    CREATE ROLE fullsite_readonly NOINHERIT LOGIN;
    RAISE NOTICE 'Created role fullsite_readonly';
  ELSE
    RAISE NOTICE 'Role fullsite_readonly already exists';
  END IF;
END
$$;

-- 2. Grant USAGE on public schema
GRANT USAGE ON SCHEMA public TO fullsite_readonly;

-- 3. Grant SELECT on ALL existing tables in public
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fullsite_readonly;

-- 4. Default privileges: auto-grant SELECT on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO fullsite_readonly;

-- 5. EXPLICITLY DENY write operations (belt + suspenders)
-- Not strictly needed since we only granted SELECT, but makes intent clear
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM fullsite_readonly;

-- 6. Allow read on sequences (needed for some SELECT queries)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fullsite_readonly;

-- ============================================================
-- WRITE-LIMITED ROLE: fullsite_agent
-- For agents that need SELECT on everything + INSERT on agent_runs/agent_results
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fullsite_agent') THEN
    CREATE ROLE fullsite_agent NOINHERIT LOGIN;
    RAISE NOTICE 'Created role fullsite_agent';
  ELSE
    RAISE NOTICE 'Role fullsite_agent already exists';
  END IF;
END
$$;

-- Read everything
GRANT USAGE ON SCHEMA public TO fullsite_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fullsite_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO fullsite_agent;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fullsite_agent;

-- Write ONLY to agent_runs and agent_results
GRANT INSERT, UPDATE ON agent_runs TO fullsite_agent;
GRANT INSERT, UPDATE ON agent_results TO fullsite_agent;

-- ============================================================
-- VERIFICATION (run after applying)
-- ============================================================
-- SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'fullsite%';
-- SELECT grantee, table_name, privilege_type
--   FROM information_schema.table_privileges
--   WHERE grantee IN ('fullsite_readonly', 'fullsite_agent')
--   ORDER BY grantee, table_name;
