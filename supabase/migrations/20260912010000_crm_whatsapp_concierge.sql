-- CRM WhatsApp Concierge: explicit consent and delivery attribution.
-- Secrets stay in server environment variables; no credentials are stored here.

CREATE TABLE IF NOT EXISTS crm_marketing_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  customer_id bigint NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  status text NOT NULL CHECK (status IN ('granted', 'revoked')),
  source text NOT NULL,
  evidence text,
  captured_by text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, customer_id, channel, captured_at)
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  customer_id bigint,
  campaign_id uuid,
  provider text NOT NULL CHECK (provider IN ('twilio', 'meta')),
  provider_message_id text NOT NULL UNIQUE,
  template_key text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  status text NOT NULL,
  normalized_phone text,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  sent_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_consent_customer
  ON crm_marketing_consents (client_id, customer_id, channel, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_wa_client_created
  ON crm_whatsapp_messages (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_whatsapp_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  name text NOT NULL DEFAULT 'Reactivación cenas',
  segment text NOT NULL DEFAULT 'inactive',
  template_key text NOT NULL DEFAULT 'amalay_cena_vino_375',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'paused')),
  timezone text NOT NULL DEFAULT 'America/Monterrey',
  send_days smallint[] NOT NULL DEFAULT ARRAY[2,3,4]::smallint[],
  window_start time NOT NULL DEFAULT '11:00',
  window_end time NOT NULL DEFAULT '18:00',
  daily_limit integer NOT NULL DEFAULT 80 CHECK (daily_limit BETWEEN 1 AND 1000),
  batch_size integer NOT NULL DEFAULT 20 CHECK (batch_size BETWEEN 1 AND 250),
  cooldown_days integer NOT NULL DEFAULT 30 CHECK (cooldown_days BETWEEN 1 AND 365),
  frequency_days integer NOT NULL DEFAULT 7 CHECK (frequency_days BETWEEN 1 AND 90),
  minute_limit integer NOT NULL DEFAULT 5 CHECK (minute_limit BETWEEN 1 AND 20),
  monthly_limit integer NOT NULL DEFAULT 1500 CHECK (monthly_limit BETWEEN 1 AND 5000),
  ai_status text NOT NULL DEFAULT 'draft' CHECK (ai_status IN ('draft', 'pending_review', 'approved', 'paused')),
  ai_mode text NOT NULL DEFAULT 'assist' CHECK (ai_mode IN ('assist', 'auto')),
  ai_confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.820 CHECK (ai_confidence_threshold BETWEEN 0.5 AND 1),
  last_run_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

-- Idempotent upgrades for installations that created the first version.
ALTER TABLE crm_whatsapp_messages ADD COLUMN IF NOT EXISTS normalized_phone text;
ALTER TABLE crm_whatsapp_messages ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE crm_whatsapp_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_whatsapp_automations ADD COLUMN IF NOT EXISTS minute_limit integer NOT NULL DEFAULT 5 CHECK (minute_limit BETWEEN 1 AND 20);
ALTER TABLE crm_whatsapp_automations ADD COLUMN IF NOT EXISTS monthly_limit integer NOT NULL DEFAULT 1500 CHECK (monthly_limit BETWEEN 1 AND 5000);
ALTER TABLE crm_whatsapp_automations ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'draft' CHECK (ai_status IN ('draft', 'pending_review', 'approved', 'paused'));
ALTER TABLE crm_whatsapp_automations ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'assist' CHECK (ai_mode IN ('assist', 'auto'));
ALTER TABLE crm_whatsapp_automations ADD COLUMN IF NOT EXISTS ai_confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.820 CHECK (ai_confidence_threshold BETWEEN 0.5 AND 1);

CREATE TABLE IF NOT EXISTS crm_whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('twilio', 'meta')),
  address text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, address)
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  customer_id bigint,
  normalized_phone text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting_human', 'closed', 'opted_out')),
  handled_by text NOT NULL DEFAULT 'ai' CHECK (handled_by IN ('ai', 'human')),
  unread_count integer NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handoff_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, normalized_phone)
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  conversation_id uuid REFERENCES crm_whatsapp_conversations(id),
  inbound_message_id uuid REFERENCES crm_whatsapp_messages(id),
  model text NOT NULL,
  action text NOT NULL CHECK (action IN ('reply', 'handoff', 'ignore')),
  intent text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  reply text,
  handoff_reason text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_reservation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES crm_whatsapp_conversations(id),
  customer_id bigint,
  requested_name text,
  requested_date date,
  requested_time time,
  party_size integer CHECK (party_size BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'needs_details' CHECK (status IN ('needs_details', 'pending_confirmation', 'confirmed', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_events (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_whatsapp_quota_buckets (
  client_id text NOT NULL,
  bucket_kind text NOT NULL CHECK (bucket_kind IN ('minute', 'day', 'month')),
  bucket_start timestamptz NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  hard_limit integer NOT NULL CHECK (hard_limit > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, bucket_kind, bucket_start)
);

CREATE OR REPLACE FUNCTION claim_whatsapp_quota(
  p_client_id text,
  p_requested integer,
  p_minute_limit integer,
  p_daily_limit integer,
  p_monthly_limit integer,
  p_timezone text DEFAULT 'America/Monterrey'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day timestamptz := date_trunc('day', v_now AT TIME ZONE p_timezone) AT TIME ZONE p_timezone;
  v_month timestamptz := date_trunc('month', v_now AT TIME ZONE p_timezone) AT TIME ZONE p_timezone;
  v_minute_limit integer := LEAST(GREATEST(p_minute_limit, 1), 20);
  v_daily_limit integer := LEAST(GREATEST(p_daily_limit, 1), 250);
  v_monthly_limit integer := LEAST(GREATEST(p_monthly_limit, 1), 5000);
  v_minute_used integer := 0;
  v_day_used integer := 0;
  v_month_used integer := 0;
  v_granted integer := 0;
BEGIN
  IF p_client_id IS NULL OR p_requested <= 0 THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wa_quota:' || p_client_id));
  SELECT used INTO v_minute_used FROM crm_whatsapp_quota_buckets WHERE client_id=p_client_id AND bucket_kind='minute' AND bucket_start=v_minute;
  SELECT used INTO v_day_used FROM crm_whatsapp_quota_buckets WHERE client_id=p_client_id AND bucket_kind='day' AND bucket_start=v_day;
  SELECT used INTO v_month_used FROM crm_whatsapp_quota_buckets WHERE client_id=p_client_id AND bucket_kind='month' AND bucket_start=v_month;
  v_minute_used := COALESCE(v_minute_used, 0); v_day_used := COALESCE(v_day_used, 0); v_month_used := COALESCE(v_month_used, 0);
  v_granted := GREATEST(0, LEAST(p_requested, v_minute_limit-v_minute_used, v_daily_limit-v_day_used, v_monthly_limit-v_month_used));
  IF v_granted = 0 THEN RETURN 0; END IF;
  INSERT INTO crm_whatsapp_quota_buckets(client_id,bucket_kind,bucket_start,used,hard_limit) VALUES
    (p_client_id,'minute',v_minute,v_granted,v_minute_limit),
    (p_client_id,'day',v_day,v_granted,v_daily_limit),
    (p_client_id,'month',v_month,v_granted,v_monthly_limit)
  ON CONFLICT (client_id,bucket_kind,bucket_start) DO UPDATE SET
    used=crm_whatsapp_quota_buckets.used + EXCLUDED.used,
    hard_limit=EXCLUDED.hard_limit,
    updated_at=now();
  RETURN v_granted;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_wa_automation_due
  ON crm_whatsapp_automations (status, last_run_at);
CREATE INDEX IF NOT EXISTS idx_crm_wa_phone_created
  ON crm_whatsapp_messages (client_id, normalized_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_wa_conversation_status
  ON crm_whatsapp_conversations (client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_wa_events_created
  ON crm_whatsapp_events (client_id, severity, created_at DESC);

ALTER TABLE crm_marketing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_reservation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_whatsapp_quota_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON crm_marketing_consents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_automations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_channels FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_ai_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_reservation_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON crm_whatsapp_quota_buckets FOR ALL TO service_role USING (true) WITH CHECK (true);
