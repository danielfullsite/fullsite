-- CRM Recovery System — replaces Bernardo ($18/client WhatsApp campaigns)
-- Run manually in Supabase SQL Editor

-- CRM Clients table (imported from OpenTable/Reserve)
CREATE TABLE IF NOT EXISTS crm_clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text DEFAULT 'amalay',
  name text NOT NULL,
  phone text,
  email text,
  source text DEFAULT 'opentable', -- opentable, reserve, manual, walk-in
  first_visit date,
  last_visit date,
  total_visits integer DEFAULT 1,
  avg_ticket numeric DEFAULT 0,
  tags text[] DEFAULT '{}', -- vip, regular, inactive, recovered
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Recovery campaigns
CREATE TABLE IF NOT EXISTS crm_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text DEFAULT 'amalay',
  name text NOT NULL, -- "Recovery Mayo 2026"
  status text DEFAULT 'draft', -- draft, active, paused, completed
  target_days_inactive integer DEFAULT 60, -- clients inactive for X days
  incentive text, -- "Pan dulce gratis"
  message_template text, -- "Hola {name}, te habla el conserje digital..."
  total_sent integer DEFAULT 0,
  total_responded integer DEFAULT 0,
  total_confirmed integer DEFAULT 0, -- actually showed up
  total_recovered_revenue numeric DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Individual recovery messages sent
CREATE TABLE IF NOT EXISTS crm_recovery_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid REFERENCES crm_campaigns(id),
  crm_client_id uuid REFERENCES crm_clients(id),
  phone text NOT NULL,
  message_sent text,
  status text DEFAULT 'pending', -- pending, sent, delivered, read, responded, reserved, confirmed, no_show
  sent_at timestamptz,
  responded_at timestamptz,
  response_text text,
  reservation_date date,
  reservation_time time,
  reservation_guests integer,
  confirmed_arrival boolean DEFAULT false,
  ticket_amount numeric, -- how much they spent when they came
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_clients_last_visit ON crm_clients(last_visit);
CREATE INDEX IF NOT EXISTS idx_crm_clients_phone ON crm_clients(phone);
CREATE INDEX IF NOT EXISTS idx_crm_recovery_status ON crm_recovery_messages(status);
CREATE INDEX IF NOT EXISTS idx_crm_recovery_campaign ON crm_recovery_messages(campaign_id);
