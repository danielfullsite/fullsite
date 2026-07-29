-- =============================================================================
-- SANDBOX-SAFE MIGRATION
-- Source:  000_extensions.sql
-- Branch:  sandbox/second-customer-skeleton
-- Project: fullsite-sandbox (NEVER apply to qjiomlvudfmzuvqvhwpk)
--
-- Transformations applied:
--   [1] No transformations — file is clean
-- =============================================================================

-- ═══════════════════════════════════════════════════════════
-- FULLSITE EXTENSIONS
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "dblink";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "plpgsql";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
