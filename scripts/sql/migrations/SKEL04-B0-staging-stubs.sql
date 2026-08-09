-- ══════════════════════════════════════════════════════════════════════
-- SKEL-04 · Batch 0 — Staging stubs
-- ══════════════════════════════════════════════════════════════════════
-- Creates minimal versions of the 3 tables missing from staging so that
-- SKEL04-B0-critical-security.sql applies cleanly in the sandbox.
-- These tables do NOT need to match production schema exactly — they
-- only need to exist so that ENABLE RLS / REVOKE / DROP POLICY succeed.
-- ══════════════════════════════════════════════════════════════════════

-- delivery_dlq (missing in staging)
CREATE TABLE IF NOT EXISTS delivery_dlq (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE delivery_dlq ENABLE ROW LEVEL SECURITY;

-- pos_bridge_logs (missing in staging)
CREATE TABLE IF NOT EXISTS pos_bridge_logs (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pos_bridge_logs ENABLE ROW LEVEL SECURITY;

-- delivery_platform_payments (missing in staging)
CREATE TABLE IF NOT EXISTS delivery_platform_payments (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE delivery_platform_payments ENABLE ROW LEVEL SECURITY;
