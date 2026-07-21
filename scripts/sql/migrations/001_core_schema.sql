-- ═══════════════════════════════════════════════════════════
-- FULLSITE CORE SCHEMA — Auto-generated migrations
-- Generated: 2026-07-21 from production schema export
-- Tables: 29 (Core + Infrastructure + CRM)
-- ═══════════════════════════════════════════════════════════

-- Group: INFRASTRUCTURE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS clients (
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  city TEXT,
  timezone TEXT DEFAULT 'America/Mexico_City'::text,
  wansoft_subsidiary_id TEXT,
  wansoft_user TEXT,
  wansoft_pass TEXT,
  telegram_chat_ids JSONB,
  staff_exclude_meseros JSONB,
  staff_market JSONB,
  menu_categories JSONB,
  bebida_groups JSONB,
  reservaciones_table TEXT,
  kpis_row_id TEXT,
  business_context TEXT,
  report_recipients JSONB,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  default_theme TEXT DEFAULT 'light'::text,
  accent_color TEXT DEFAULT 'emerald'::text,
  mesas INTEGER DEFAULT 16,
  meseros JSONB DEFAULT '[]'::jsonb,
  features JSONB DEFAULT '{}'::jsonb,
  iva_rate NUMERIC DEFAULT 0.16,
  logo_url TEXT,
  type TEXT,
  data_source TEXT DEFAULT 'supabase'::text,
  rfc TEXT,
  razon_social TEXT,
  regimen_fiscal TEXT,
  codigo_postal TEXT,
  domicilio_fiscal JSONB,
  staff_supervisors JSONB,
  address TEXT,
  phone TEXT,
  receipt_footer TEXT DEFAULT 'Gracias por tu visita!'::text,
  business_day_start_local TIME,
  wansoft_cookies JSONB
);

-- Group: INFRASTRUCTURE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS client_users (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  user_id UUID,
  client_id TEXT,
  role TEXT DEFAULT 'viewer'::text,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: INFRASTRUCTURE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS client_locations (
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: INFRASTRUCTURE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS prospects (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  nombre TEXT,
  restaurante TEXT,
  email TEXT,
  telefono TEXT,
  pos TEXT,
  status TEXT DEFAULT 'nuevo'::text,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_staff (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  role TEXT DEFAULT 'mesero'::text NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  hourly_rate NUMERIC DEFAULT 0,
  weekly_salary NUMERIC DEFAULT 0,
  role_display TEXT DEFAULT 'mesero'::text
);

-- Unique constraint: unique_pin_per_client
ALTER TABLE pos_staff ADD CONSTRAINT IF NOT EXISTS unique_pin_per_client UNIQUE (pin, client_id);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_staff_audit (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  staff_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_fields JSONB,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_attendance (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  type TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now(),
  method TEXT DEFAULT 'pin'::text,
  device_id TEXT,
  notes TEXT
);

-- Index
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.pos_attendance USING btree (client_id, staff_id, registered_at DESC);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_fingerprint_templates (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  template TEXT
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_turnos (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  opened_by TEXT NOT NULL,
  fondo_inicial NUMERIC DEFAULT 0 NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_by TEXT,
  fondo_final NUMERIC,
  efectivo_sistema NUMERIC,
  diferencia NUMERIC,
  closed_at TIMESTAMPTZ,
  notas TEXT
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  turno_id TEXT,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS agent_runs (
  id BIGSERIAL,
  agent_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  output_summary TEXT,
  error_message TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  tentacle TEXT,
  input_freshness TIMESTAMPTZ,
  rows_processed INTEGER DEFAULT 0,
  skip_reason TEXT,
  data_status TEXT DEFAULT 'ok'::text
);

-- Index
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created ON public.agent_runs USING btree (agent_id, created_at DESC);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS agent_results (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  agent_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  summary TEXT,
  priority TEXT DEFAULT 'info'::text,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: agent_results_client_id_agent_id_fecha_key
ALTER TABLE agent_results ADD CONSTRAINT IF NOT EXISTS agent_results_client_id_agent_id_fecha_key UNIQUE (fecha, agent_id, client_id);
-- Index
CREATE INDEX IF NOT EXISTS idx_agent_results_agent ON public.agent_results USING btree (client_id, agent_id, fecha DESC);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_item_modifier_groups (
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  item_id TEXT NOT NULL,
  group_id TEXT NOT NULL
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_inventory_alerts (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  message TEXT NOT NULL,
  order_id TEXT,
  actor TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_recipes (
  id BIGINT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  nombre TEXT NOT NULL,
  precio_venta NUMERIC DEFAULT 0,
  costo_total NUMERIC DEFAULT 0,
  pct_costo NUMERIC DEFAULT 0,
  ingredientes JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'excel'::text,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_insumos (
  id BIGINT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  nombre TEXT NOT NULL,
  categoria TEXT,
  merma_pct NUMERIC DEFAULT 0,
  rendimiento_pct NUMERIC DEFAULT 0,
  proveedor TEXT,
  um TEXT,
  precio_presentacion NUMERIC DEFAULT 0,
  precio_limpio NUMERIC DEFAULT 0,
  source TEXT DEFAULT 'excel'::text,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_cfdi_requests (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  order_id TEXT,
  rfc TEXT NOT NULL,
  razon_social TEXT NOT NULL,
  regimen_fiscal TEXT NOT NULL,
  uso_cfdi TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  email TEXT NOT NULL,
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pendiente'::text,
  folio_fiscal TEXT,
  pdf_url TEXT,
  xml_url TEXT,
  error_msg TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_cfdi_created ON public.pos_cfdi_requests USING btree (created_at DESC);
-- Index
CREATE INDEX IF NOT EXISTS idx_cfdi_rfc ON public.pos_cfdi_requests USING btree (rfc);
-- Index
CREATE INDEX IF NOT EXISTS idx_cfdi_status ON public.pos_cfdi_requests USING btree (status);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS pos_gastos (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  tipo TEXT DEFAULT 'factura'::text NOT NULL,
  proveedor TEXT NOT NULL,
  concepto TEXT,
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  fecha DATE DEFAULT CURRENT_DATE NOT NULL,
  fecha_pago DATE,
  status TEXT DEFAULT 'pendiente'::text NOT NULL,
  categoria TEXT DEFAULT 'Otros'::text,
  notas TEXT,
  xml_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS credentials_vault (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'fullsite'::text NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT,
  password_encrypted TEXT,
  url TEXT,
  notes TEXT,
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_vault_client ON public.credentials_vault USING btree (client_id, category);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS ops_daily (
  id BIGSERIAL,
  client_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  record_type TEXT NOT NULL,
  bucket_start TIMESTAMPTZ,
  ventas_dia NUMERIC,
  ventas_brutas NUMERIC,
  descuentos NUMERIC,
  devoluciones NUMERIC,
  efectivo NUMERIC,
  tarjeta NUMERIC,
  tickets_count INTEGER,
  mesas_atendidas INTEGER,
  personas_restaurant INTEGER,
  ticket_promedio_restaurant NUMERIC,
  propinas_total NUMERIC,
  meseros JSONB,
  platillos_top JSONB,
  ventas_por_grupo JSONB,
  pago_metodos JSONB,
  source_system TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  data_freshness TIMESTAMPTZ,
  rows_aggregated INTEGER DEFAULT 0
);

-- Index
CREATE INDEX IF NOT EXISTS idx_ops_daily_fecha ON public.ops_daily USING btree (client_id, fecha DESC);
-- Index
CREATE INDEX IF NOT EXISTS idx_ops_daily_latest ON public.ops_daily USING btree (client_id, fecha DESC, record_type);
-- Index
CREATE UNIQUE INDEX uq_ops_daily_close ON public.ops_daily USING btree (client_id, fecha, record_type) WHERE (record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text]));
-- Index
CREATE UNIQUE INDEX uq_ops_daily_snapshot ON public.ops_daily USING btree (client_id, fecha, bucket_start) WHERE (record_type = 'snapshot'::text);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS events (
  sequence BIGINT NOT NULL,
  id UUID NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  actor JSONB NOT NULL,
  payload JSONB NOT NULL,
  audit JSONB
);

-- Unique constraint: events_id_key
ALTER TABLE events ADD CONSTRAINT IF NOT EXISTS events_id_key UNIQUE (id);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS chat_logs (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  user_id TEXT,
  user_message TEXT NOT NULL,
  ai_response TEXT NOT NULL,
  model TEXT DEFAULT 'groq'::text,
  tokens_used INTEGER,
  latency_ms INTEGER,
  had_error BOOLEAN DEFAULT false,
  error_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_chat_logs_client ON public.chat_logs USING btree (client_id, created_at DESC);
-- Index
CREATE INDEX IF NOT EXISTS idx_chat_logs_error ON public.chat_logs USING btree (had_error) WHERE (had_error = true);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: push_subscriptions_endpoint_key
ALTER TABLE push_subscriptions ADD CONSTRAINT IF NOT EXISTS push_subscriptions_endpoint_key UNIQUE (endpoint);
-- Index
CREATE INDEX IF NOT EXISTS idx_push_client ON public.push_subscriptions USING btree (client_id);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  platform TEXT NOT NULL,
  platform_order_id TEXT,
  status TEXT DEFAULT 'nueva'::text NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  items JSONB DEFAULT '[]'::jsonb NOT NULL,
  subtotal NUMERIC DEFAULT 0,
  delivery_fee NUMERIC DEFAULT 0,
  platform_commission NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  notes TEXT,
  estimated_pickup TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  address TEXT,
  phone TEXT,
  payment_method TEXT,
  cash_received NUMERIC,
  change_due NUMERIC,
  driver_id TEXT,
  en_route_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- Unique constraint: delivery_orders_platform_platform_order_id_key
ALTER TABLE delivery_orders ADD CONSTRAINT IF NOT EXISTS delivery_orders_platform_platform_order_id_key UNIQUE (platform_order_id, platform);
-- Index
CREATE INDEX IF NOT EXISTS idx_delivery_orders_platform ON public.delivery_orders USING btree (platform, platform_order_id);
-- Index
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON public.delivery_orders USING btree (client_id, status, created_at DESC);
-- Group: CORE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS reviews (
  id BIGSERIAL,
  review_id TEXT NOT NULL,
  author TEXT DEFAULT 'Anónimo'::text NOT NULL,
  rating SMALLINT NOT NULL,
  text TEXT DEFAULT ''::text NOT NULL,
  date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  draft_response TEXT DEFAULT ''::text NOT NULL,
  published_response TEXT DEFAULT ''::text NOT NULL,
  location_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Unique constraint: reviews_review_id_key
ALTER TABLE reviews ADD CONSTRAINT IF NOT EXISTS reviews_review_id_key UNIQUE (review_id);
-- Index
CREATE INDEX IF NOT EXISTS reviews_date_idx ON public.reviews USING btree (date DESC NULLS LAST);
-- Index
CREATE INDEX IF NOT EXISTS reviews_rating_idx ON public.reviews USING btree (rating);
-- Index
CREATE INDEX IF NOT EXISTS reviews_status_idx ON public.reviews USING btree (status);
-- Group: CRM
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS memories (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  salience DOUBLE PRECISION DEFAULT 1.0,
  sector TEXT DEFAULT 'episodic'::text,
  mission_context TEXT,
  keywords TEXT,
  client TEXT DEFAULT 'AMALAY'::text,
  created_at TIMESTAMP DEFAULT now(),
  accessed_at TIMESTAMP DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_memories_agent ON public.memories USING btree (agent_id);
-- Index
CREATE INDEX IF NOT EXISTS idx_memories_client ON public.memories USING btree (client);
-- Index
CREATE INDEX IF NOT EXISTS idx_memories_salience ON public.memories USING btree (salience DESC);
-- Group: CRM
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id BIGSERIAL,
  phone_number TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_input JSONB,
  tool_output JSONB,
  tokens_input INTEGER,
  tokens_output INTEGER,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_phone_date ON public.whatsapp_conversations USING btree (phone_number, created_at DESC);
-- Group: CRM
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS whatsapp_messages_log (
  id BIGSERIAL,
  direction TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  message_id TEXT,
  message_type TEXT,
  content TEXT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_phone_date ON public.whatsapp_messages_log USING btree (phone_number, created_at DESC);
-- Group: CRM
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS whatsapp_whitelist (
  id BIGSERIAL,
  phone_number TEXT NOT NULL,
  user_name TEXT NOT NULL,
  restaurante TEXT DEFAULT 'amalay'::text,
  role TEXT DEFAULT 'viewer'::text,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: whatsapp_whitelist_phone_number_key
ALTER TABLE whatsapp_whitelist ADD CONSTRAINT IF NOT EXISTS whatsapp_whitelist_phone_number_key UNIQUE (phone_number);
