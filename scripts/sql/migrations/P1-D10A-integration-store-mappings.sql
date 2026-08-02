-- P1-D10A: integration_store_mappings + delivery_dlq
-- Closes D-10A: tenant resolution infrastructure for delivery-worker.
-- No seed data — mappings added per-provider during official onboarding (D-10B).
--
-- Preflight:  SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('integration_store_mappings','delivery_dlq');
-- Postflight: SELECT table_name FROM information_schema.tables WHERE table_name IN ('integration_store_mappings','delivery_dlq');
-- Rollback:   DROP TABLE IF EXISTS delivery_dlq; DROP TABLE IF EXISTS integration_store_mappings;

CREATE TABLE IF NOT EXISTS integration_store_mappings (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  provider          text        NOT NULL,           -- 'rappi' | 'didi' | 'ubereats'
  provider_store_id text        NOT NULL,           -- platform-assigned store ID
  client_id         text        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (provider, provider_store_id)
);

CREATE TABLE IF NOT EXISTS delivery_dlq (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  provider          text        NOT NULL,
  provider_store_id text,
  correlation_id    text,
  raw_payload       jsonb,
  created_at        timestamptz DEFAULT now()
);
