-- Integration Framework — tables for Uber Eats and future providers.
-- Apply via: supabase db push OR Supabase Dashboard → SQL Editor
--
-- ROLLBACK (execute in dependency order):
--   ALTER TABLE delivery_orders DROP COLUMN IF EXISTS webhook_event_id;
--   DROP TABLE IF EXISTS integration_webhook_dlq;
--   DROP TABLE IF EXISTS integration_audit_log;
--   DROP TABLE IF EXISTS integration_webhook_events;
--   DROP TABLE IF EXISTS integration_store_mappings;
--   DROP TABLE IF EXISTS integration_providers;

-- ─── Provider accounts (OAuth credentials per client + provider) ─────────────
-- IMPORTANT: oauth_client_secret_enc and access_token_enc are named _enc for
-- future use but are NOT currently encrypted at rest. Today credentials live in
-- environment variables (UBER_CLIENT_ID, UBER_CLIENT_SECRET etc.) and this table
-- exists to support multi-tenant credential storage in a future phase.
-- Do NOT store real secrets here until an encryption layer is in place.
--
-- provider_version: tracks which adapter version is active for each integration.
-- Increment when a breaking change is made to the adapter (e.g. "1.0.0" → "2.0.0").
CREATE TABLE IF NOT EXISTS integration_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('ubereats', 'rappi', 'didi', 'clip', 'mercadopago')),
  provider_version text NOT NULL DEFAULT '1.0.0',
  provider_account_id text,
  oauth_client_id text,
  oauth_client_secret_enc text,
  access_token_enc text,
  token_expires_at timestamptz,
  scopes text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'error')),
  certification_state text NOT NULL DEFAULT 'uncertified'
    CHECK (certification_state IN ('uncertified', 'sandbox_passed', 'production_certified')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (client_id, provider)
);

-- ─── Store mappings (Uber store_id → Fullsite client_id) ─────────────────────
CREATE TABLE IF NOT EXISTS integration_store_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_store_id text NOT NULL,
  client_id text NOT NULL,
  menu_sync_enabled boolean DEFAULT true,
  oos_sync_enabled boolean DEFAULT true,
  store_open boolean DEFAULT true,
  last_menu_sync timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (provider, provider_store_id)
);

-- ─── Webhook event inbox (dedup + correlation) ────────────────────────────────
-- provider_event_id: stable ID from Uber (body.event_id, body.uuid, or synthetic "type:order_id")
-- UNIQUE(provider, provider_event_id) is the dedup gate — duplicate webhooks ignore-on-conflict.
CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id text,
  store_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'dlq')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- ─── Dead-letter queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_webhook_dlq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id uuid REFERENCES integration_webhook_events(id) ON DELETE SET NULL,
  provider text NOT NULL,
  event_type text NOT NULL,
  client_id text,
  payload jsonb NOT NULL,
  failure_reason text,
  created_at timestamptz DEFAULT now()
);

-- ─── Audit log (redacted request/response) ───────────────────────────────────
-- Secrets are redacted in audit-logger.ts before insert.
CREATE TABLE IF NOT EXISTS integration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  client_id text,
  correlation_id uuid,
  action text NOT NULL,
  request_summary jsonb,
  response_summary jsonb,
  status_code int,
  duration_ms int,
  created_at timestamptz DEFAULT now()
);

-- Add webhook_event_id to delivery_orders for full traceability
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'delivery_orders' AND column_name = 'webhook_event_id'
  ) THEN
    ALTER TABLE delivery_orders ADD COLUMN webhook_event_id uuid
      REFERENCES integration_webhook_events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── TTL policy (implement as scheduled job — not automated here) ────────────
-- These tables grow without bound. Recommended retention when volume justifies it:
--
--   integration_webhook_events (processed events only — keep failed/dlq indefinitely):
--     DELETE FROM integration_webhook_events
--       WHERE status = 'processed' AND created_at < now() - interval '30 days';
--
--   integration_audit_log:
--     DELETE FROM integration_audit_log
--       WHERE created_at < now() - interval '90 days';
--
-- Run as a Supabase scheduled function or GitHub Actions cron.
-- Do NOT delete 'failed' or 'dlq' rows automatically — they require manual review.

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_iwh_events_status
  ON integration_webhook_events (provider, status, created_at);
CREATE INDEX IF NOT EXISTS idx_iwh_events_correlation
  ON integration_webhook_events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_iaudit_correlation
  ON integration_audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS idx_iaudit_provider
  ON integration_audit_log (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iaudit_action
  ON integration_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_provider
  ON integration_webhook_dlq (provider, created_at DESC);

-- ─── RLS policies ─────────────────────────────────────────────────────────────
ALTER TABLE integration_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_store_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_webhook_dlq ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_log ENABLE ROW LEVEL SECURITY;

-- Webhook handler uses service_role key (bypasses RLS)
-- Authenticated dashboard users can read their own data
CREATE POLICY "service_all" ON integration_providers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON integration_store_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON integration_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON integration_webhook_dlq
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON integration_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon read on store_mappings — allows the dashboard UI to resolve store names
-- without service role. Webhook handler uses service_role (bypasses RLS).
-- No anon INSERT on any integration table: all writes go through server-side
-- routes that require SUPABASE_SERVICE_KEY. This prevents external actors from
-- contaminating integration_webhook_events with fake event IDs.
CREATE POLICY "anon_read_store_mappings" ON integration_store_mappings
  FOR SELECT TO anon USING (true);
