-- ═══════════════════════════════════════════════════════════
-- FULLSITE CONSOLIDATED SCHEMA — ALL CORE TABLES
-- Generated: 2026-07-21 from production
-- Tables: 75 (dependency-ordered)
-- Includes: columns, PK, FK, UNIQUE, indexes
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id BIGSERIAL,
  ts TIMESTAMPTZ DEFAULT now(),
  agent_name TEXT NOT NULL,
  trigger_type TEXT,
  action_type TEXT NOT NULL,
  tables_touched TEXT[],
  result TEXT,
  detail TEXT,
  duration_ms INTEGER,
  auth_role TEXT,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_agent_ts ON public.agent_audit_log USING btree (agent_name, ts DESC);
CREATE TABLE IF NOT EXISTS agent_results (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  agent_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  summary TEXT,
  priority TEXT DEFAULT 'info'::text,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE agent_results ADD CONSTRAINT agent_results_client_id_agent_id_fecha_key UNIQUE (client_id, agent_id, fecha);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_agent_results_agent ON public.agent_results USING btree (client_id, agent_id, fecha DESC);
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
  data_status TEXT DEFAULT 'ok'::text,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created ON public.agent_runs USING btree (agent_id, created_at DESC);
CREATE TABLE IF NOT EXISTS amalay_reservaciones (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  nombre TEXT NOT NULL,
  telefono TEXT,
  fecha DATE NOT NULL,
  espacio TEXT NOT NULL,
  horario_inicio TIME WITHOUT TIME ZONE NOT NULL,
  horario_fin TIME WITHOUT TIME ZONE NOT NULL,
  guests INTEGER NOT NULL,
  paquete TEXT,
  pastel TEXT,
  entradas TEXT[],
  deco TEXT,
  total NUMERIC,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  codigo_reserva TEXT NOT NULL,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE amalay_reservaciones ADD CONSTRAINT amalay_reservaciones_codigo_reserva_key UNIQUE (codigo_reserva);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_res_espacio ON public.amalay_reservaciones USING btree (espacio);
CREATE INDEX IF NOT EXISTS idx_res_fecha ON public.amalay_reservaciones USING btree (fecha);
CREATE INDEX IF NOT EXISTS idx_res_status ON public.amalay_reservaciones USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS no_double_booking ON public.amalay_reservaciones USING btree (fecha, espacio, horario_inicio) WHERE (status = ANY (ARRAY['pending'::text, 'confirmed'::text]));
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
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_chat_logs_client ON public.chat_logs USING btree (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_logs_error ON public.chat_logs USING btree (had_error) WHERE (had_error = true);
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
  business_day_start_local TIME WITHOUT TIME ZONE,
  wansoft_cookies JSONB,
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS client_locations (
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE client_locations ADD CONSTRAINT client_locations_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS client_users (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  user_id UUID,
  client_id TEXT,
  role TEXT DEFAULT 'viewer'::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE client_users ADD CONSTRAINT client_users_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE client_users ADD CONSTRAINT client_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES null();
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
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
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_vault_client ON public.credentials_vault USING btree (client_id, category);
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
  closed_at TIMESTAMPTZ,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_platform_platform_order_id_key UNIQUE (platform, platform_order_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_delivery_orders_platform ON public.delivery_orders USING btree (platform, platform_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON public.delivery_orders USING btree (client_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS events (
  sequence BIGINT NOT NULL,
  id UUID NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  actor JSONB NOT NULL,
  payload JSONB NOT NULL,
  audit JSONB,
  PRIMARY KEY (sequence)
);
DO 21423 BEGIN
  ALTER TABLE events ADD CONSTRAINT events_id_key UNIQUE (id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
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
  accessed_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON public.memories USING btree (agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_client ON public.memories USING btree (client);
CREATE INDEX IF NOT EXISTS idx_memories_salience ON public.memories USING btree (salience DESC);
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
  rows_aggregated INTEGER DEFAULT 0,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE ops_daily ADD CONSTRAINT ops_daily_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_ops_daily_fecha ON public.ops_daily USING btree (client_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ops_daily_latest ON public.ops_daily USING btree (client_id, fecha DESC, record_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_daily_close ON public.ops_daily USING btree (client_id, fecha, record_type) WHERE (record_type = ANY (ARRAY['cierre'::text, 'cierre_wansoft'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_daily_snapshot ON public.ops_daily USING btree (client_id, fecha, bucket_start) WHERE (record_type = 'snapshot'::text);
CREATE TABLE IF NOT EXISTS pos_attendance (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  type TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT now(),
  method TEXT DEFAULT 'pin'::text,
  device_id TEXT,
  notes TEXT,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.pos_attendance USING btree (client_id, staff_id, registered_at DESC);
CREATE TABLE IF NOT EXISTS pos_audit_log (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  order_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  mesa INTEGER,
  details JSONB,
  reason TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.pos_audit_log USING btree (action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.pos_audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_order ON public.pos_audit_log USING btree (order_id);
CREATE TABLE IF NOT EXISTS pos_billing_clients (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  nombre TEXT NOT NULL,
  rfc TEXT NOT NULL,
  regimen_fiscal TEXT,
  codigo_postal TEXT,
  email TEXT,
  calle TEXT,
  no_interior TEXT,
  no_exterior TEXT,
  colonia TEXT,
  ciudad TEXT,
  estado TEXT,
  pais TEXT DEFAULT 'MEXICO'::text,
  uso_cfdi TEXT DEFAULT 'G03'::text,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_billing_clients ADD CONSTRAINT pos_billing_clients_rfc_client_id_key UNIQUE (rfc, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  turno_id TEXT,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_category_modifiers (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  category_id TEXT NOT NULL,
  modifier_group_id TEXT NOT NULL,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_category_modifiers ADD CONSTRAINT pos_category_modifiers_client_id_category_id_modifier_group_key UNIQUE (client_id, category_id, modifier_group_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
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
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_cfdi_created ON public.pos_cfdi_requests USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfdi_rfc ON public.pos_cfdi_requests USING btree (rfc);
CREATE INDEX IF NOT EXISTS idx_cfdi_status ON public.pos_cfdi_requests USING btree (status);
CREATE TABLE IF NOT EXISTS pos_cierres (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  turno_id TEXT,
  fecha DATE NOT NULL,
  fondo_inicial NUMERIC DEFAULT 0,
  billetes JSONB,
  monedas JSONB,
  total_contado NUMERIC DEFAULT 0,
  efectivo_sistema NUMERIC DEFAULT 0,
  tarjeta_sistema NUMERIC DEFAULT 0,
  transferencias_sistema NUMERIC DEFAULT 0,
  diferencia NUMERIC DEFAULT 0,
  total_ventas NUMERIC DEFAULT 0,
  tickets_count INTEGER DEFAULT 0,
  cancelaciones INTEGER DEFAULT 0,
  descuentos NUMERIC DEFAULT 0,
  propinas NUMERIC DEFAULT 0,
  notas TEXT,
  closed_by TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_cierres_fecha ON public.pos_cierres USING btree (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cierres_turno ON public.pos_cierres USING btree (turno_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierres_turno_id ON public.pos_cierres USING btree (turno_id) WHERE (turno_id IS NOT NULL);
CREATE TABLE IF NOT EXISTS pos_combos (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  items JSONB NOT NULL,
  price NUMERIC NOT NULL,
  upsell JSONB,
  active BOOLEAN DEFAULT true,
  schedule JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_customer_notes (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  mesa INTEGER NOT NULL,
  note TEXT NOT NULL,
  type TEXT DEFAULT 'general'::text,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_notes_mesa ON public.pos_customer_notes USING btree (mesa, client_id);
CREATE TABLE IF NOT EXISTS pos_customers (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  total_visits INTEGER DEFAULT 0 NOT NULL,
  total_spent NUMERIC DEFAULT 0 NOT NULL,
  avg_ticket NUMERIC DEFAULT 0 NOT NULL,
  last_visit TIMESTAMPTZ,
  first_visit TIMESTAMPTZ DEFAULT now() NOT NULL,
  tags TEXT[] DEFAULT '{}'::text[],
  birthday DATE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_customers ADD CONSTRAINT pos_customers_client_id_phone_key UNIQUE (client_id, phone);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_pos_customers_client_id ON public.pos_customers USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_pos_customers_last_visit ON public.pos_customers USING btree (client_id, last_visit DESC);
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON public.pos_customers USING btree (client_id, phone);
CREATE TABLE IF NOT EXISTS pos_customer_visits (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  customer_id BIGINT NOT NULL,
  order_id UUID,
  amount NUMERIC DEFAULT 0 NOT NULL,
  items_count INTEGER DEFAULT 0 NOT NULL,
  visited_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_customer_visits ADD CONSTRAINT pos_customer_visits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES pos_customers(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_client ON public.pos_customer_visits USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_customer ON public.pos_customer_visits USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_pos_customer_visits_date ON public.pos_customer_visits USING btree (visited_at DESC);
CREATE TABLE IF NOT EXISTS pos_delivery_zones (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  min_order NUMERIC DEFAULT 0,
  delivery_fee NUMERIC DEFAULT 0,
  delivery_time TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_facturas (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  purchase_order_id TEXT,
  supplier TEXT NOT NULL,
  folio TEXT,
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'capturada'::text,
  captured_by TEXT NOT NULL,
  approved_by TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  payment_terms INTEGER DEFAULT 15,
  due_date DATE,
  uuid_sat TEXT,
  PRIMARY KEY (id)
);
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
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_gift_cards (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  code TEXT NOT NULL,
  balance NUMERIC DEFAULT 0,
  original_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active'::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_presentations (
  id TEXT DEFAULT ('pres-'::text || (gen_random_uuid())::text) NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_presentations ADD CONSTRAINT uq_pres_client_code UNIQUE (client_id, code);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_ingredient_presentations (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  ingredient_id TEXT NOT NULL,
  presentation_id TEXT NOT NULL,
  contains_quantity NUMERIC NOT NULL,
  contains_unit TEXT NOT NULL,
  cost_per_presentation NUMERIC DEFAULT 0,
  supplier_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_ingredient_presentations ADD CONSTRAINT uq_ip_client_ingredient_pres UNIQUE (client_id, ingredient_id, presentation_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_ingredient_presentations ADD CONSTRAINT pos_ingredient_presentations_presentation_id_fkey FOREIGN KEY (presentation_id) REFERENCES pos_presentations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_ip_ingredient ON public.pos_ingredient_presentations USING btree (ingredient_id);
CREATE TABLE IF NOT EXISTS pos_ingredients (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  cost_per_unit NUMERIC DEFAULT 0,
  category TEXT,
  supplier TEXT,
  yield_factor NUMERIC DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  product_type TEXT DEFAULT 'materia_prima'::text,
  department TEXT,
  is_critical BOOLEAN DEFAULT false,
  sale_price NUMERIC DEFAULT 0,
  sat_product_key TEXT,
  sat_unit_key TEXT,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_ingredients ADD CONSTRAINT uq_ingredients_client_id UNIQUE (client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
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
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_inventory (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  ingredient_id TEXT NOT NULL,
  stock NUMERIC DEFAULT 0 NOT NULL,
  reorder_point NUMERIC DEFAULT 0,
  reorder_quantity NUMERIC DEFAULT 0,
  last_restock TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  stock_unit TEXT,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_inventory ADD CONSTRAINT pos_inventory_client_id_ingredient_id_key UNIQUE (client_id, ingredient_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_inventory_alerts (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  message TEXT NOT NULL,
  order_id TEXT,
  actor TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_inventory_products (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  cost_per_unit NUMERIC,
  stock NUMERIC DEFAULT 0 NOT NULL,
  reorder_point NUMERIC DEFAULT 0,
  category TEXT,
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_inventory_products ADD CONSTRAINT pos_inventory_products_client_id_name_key UNIQUE (client_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_inv_products_client ON public.pos_inventory_products USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_name ON public.pos_inventory_products USING btree (name);
CREATE TABLE IF NOT EXISTS pos_market_stock (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  menu_item_id TEXT NOT NULL,
  stock NUMERIC DEFAULT 0 NOT NULL,
  reorder_point NUMERIC DEFAULT 0,
  reorder_quantity NUMERIC DEFAULT 0,
  last_restock TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_market_stock ADD CONSTRAINT pos_market_stock_client_id_menu_item_id_key UNIQUE (client_id, menu_item_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_market_stock ADD CONSTRAINT uq_market_stock_client_item_id UNIQUE (client_id, menu_item_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_market_stock_item ON public.pos_market_stock USING btree (menu_item_id);
CREATE TABLE IF NOT EXISTS pos_menu_categories (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  color TEXT DEFAULT 'bg-slate-500'::text,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_menu_cat_client ON public.pos_menu_categories USING btree (client_id);
CREATE TABLE IF NOT EXISTS pos_menu_items (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  barcode TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  aplica_2x1 BOOLEAN DEFAULT false,
  aplica_descuento BOOLEAN DEFAULT true,
  aplica_cortesia BOOLEAN DEFAULT true,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_menu_items ADD CONSTRAINT uq_menu_items_client_id UNIQUE (client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_menu_items ADD CONSTRAINT pos_menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES pos_menu_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_menu_items_cat ON public.pos_menu_items USING btree (category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_client ON public.pos_menu_items USING btree (client_id);
CREATE TABLE IF NOT EXISTS pos_recipe_versions (
  id BIGSERIAL,
  client_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  active BOOLEAN DEFAULT false NOT NULL,
  source TEXT NOT NULL,
  source_batch TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  activated_by TEXT,
  deactivated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_recipe_versions ADD CONSTRAINT pos_recipe_versions_client_id_menu_item_id_id_key UNIQUE (client_id, menu_item_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_versions ADD CONSTRAINT pos_recipe_versions_client_id_menu_item_id_version_key UNIQUE (client_id, menu_item_id, version);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_versions ADD CONSTRAINT uq_recipe_versions_client_id UNIQUE (client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_versions ADD CONSTRAINT pos_recipe_versions_client_id_menu_item_id_fkey FOREIGN KEY (client_id, client_id, menu_item_id, menu_item_id) REFERENCES pos_menu_items(id, client_id, client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_active ON public.pos_recipe_versions USING btree (client_id, menu_item_id) WHERE (active = true);
CREATE TABLE IF NOT EXISTS pos_reconciliation_results (
  id BIGSERIAL,
  client_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  result TEXT DEFAULT 'PENDING'::text NOT NULL,
  cantidad NUMERIC DEFAULT 0 NOT NULL,
  pinned_mode TEXT,
  pinned_recipe_version_id BIGINT,
  pinned_market_stock_id BIGINT,
  applied_consumption NUMERIC DEFAULT 0 NOT NULL,
  last_mutation_revision INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_client_id_order_id_order_item_id_key UNIQUE (client_id, order_id, order_item_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_client_id_menu_item_id_pinned_m_fkey FOREIGN KEY (client_id, client_id, client_id, menu_item_id, menu_item_id, menu_item_id, pinned_market_stock_id, pinned_market_stock_id, pinned_market_stock_id) REFERENCES pos_market_stock(menu_item_id, client_id, id, client_id, menu_item_id, id, id, menu_item_id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_reconciliation_results ADD CONSTRAINT pos_reconciliation_results_client_id_menu_item_id_pinned_r_fkey FOREIGN KEY (client_id, client_id, client_id, menu_item_id, menu_item_id, menu_item_id, pinned_recipe_version_id, pinned_recipe_version_id, pinned_recipe_version_id) REFERENCES pos_recipe_versions(id, menu_item_id, client_id, id, menu_item_id, client_id, client_id, id, menu_item_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_recon_results_order ON public.pos_reconciliation_results USING btree (client_id, order_id);
CREATE TABLE IF NOT EXISTS pos_inventory_movements (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  product_id BIGINT,
  movement_type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  order_id UUID,
  actor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  ingredient_id TEXT,
  reconciliation_result_id BIGINT,
  mutation_revision INTEGER,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_inventory_movements ADD CONSTRAINT pos_inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES pos_inventory_products(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_inventory_movements ADD CONSTRAINT pos_inventory_movements_reconciliation_result_id_fkey FOREIGN KEY (reconciliation_result_id) REFERENCES pos_reconciliation_results(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_inv_mov_created ON public.pos_inventory_movements USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON public.pos_inventory_movements USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reconciliation ON public.pos_inventory_movements USING btree (reconciliation_result_id) WHERE (reconciliation_result_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON public.pos_inventory_movements USING btree (movement_type);
CREATE TABLE IF NOT EXISTS pos_item_inventory_policy (
  id BIGSERIAL,
  client_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  inventory_mode TEXT DEFAULT 'unclassified'::text NOT NULL,
  market_stock_id BIGINT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_client_id_menu_item_id_key UNIQUE (client_id, menu_item_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_client_id_menu_item_id_fkey FOREIGN KEY (client_id, client_id, menu_item_id, menu_item_id) REFERENCES pos_menu_items(id, client_id, id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_item_inventory_policy ADD CONSTRAINT pos_item_inventory_policy_client_id_menu_item_id_market_st_fkey FOREIGN KEY (client_id, client_id, client_id, menu_item_id, menu_item_id, menu_item_id, market_stock_id, market_stock_id, market_stock_id) REFERENCES pos_market_stock(id, client_id, menu_item_id, client_id, menu_item_id, id, id, client_id, menu_item_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_item_modifier_groups (
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  item_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (client_id, item_id, group_id)
);
CREATE TABLE IF NOT EXISTS pos_market_movements (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  menu_item_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  order_id TEXT,
  actor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  reconciliation_result_id BIGINT,
  mutation_revision INTEGER,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_market_movements ADD CONSTRAINT pos_market_movements_reconciliation_result_id_fkey FOREIGN KEY (reconciliation_result_id) REFERENCES pos_reconciliation_results(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_market_mov_created ON public.pos_market_movements USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_mov_item ON public.pos_market_movements USING btree (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_mkt_mov_reconciliation ON public.pos_market_movements USING btree (reconciliation_result_id) WHERE (reconciliation_result_id IS NOT NULL);
CREATE TABLE IF NOT EXISTS pos_modifier_groups (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  level INTEGER DEFAULT 1 NOT NULL,
  min_selections INTEGER DEFAULT 0 NOT NULL,
  max_selections INTEGER,
  required BOOLEAN DEFAULT false NOT NULL,
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_modifiers (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_modifiers ADD CONSTRAINT pos_modifiers_group_id_fkey FOREIGN KEY (group_id) REFERENCES pos_modifier_groups(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_modifiers_group ON public.pos_modifiers USING btree (group_id);
CREATE TABLE IF NOT EXISTS pos_mutation_authority (
  client_id TEXT NOT NULL,
  sale_authority TEXT DEFAULT 'legacy'::text NOT NULL,
  cutover_at TIMESTAMPTZ,
  cutover_by TEXT,
  PRIMARY KEY (client_id)
);
DO 21423 BEGIN
  ALTER TABLE pos_mutation_authority ADD CONSTRAINT pos_mutation_authority_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_orders (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  mesa INTEGER,
  mesero TEXT,
  personas INTEGER DEFAULT 1,
  status TEXT DEFAULT 'abierta'::text,
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  descuento NUMERIC DEFAULT 0,
  metodo_pago TEXT,
  notas TEXT,
  items JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  propina NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  location_id TEXT DEFAULT 'amalay-spgg'::text,
  customer_name TEXT,
  order_number INTEGER,
  pagos JSONB,
  turno_id TEXT,
  kds_item_status JSONB,
  order_revision BIGINT DEFAULT 0 NOT NULL,
  last_inventory_processed_revision BIGINT DEFAULT 0 NOT NULL,
  last_inventory_complete_revision BIGINT DEFAULT 0 NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_pos_orders_mesa ON public.pos_orders USING btree (mesa, status);
CREATE INDEX IF NOT EXISTS idx_pos_orders_status ON public.pos_orders USING btree (client_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS pos_payment_methods (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'cash'::text,
  commission_pct NUMERIC DEFAULT 0,
  fiscal_code TEXT DEFAULT ''::text,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_print_jobs (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  order_id TEXT,
  station TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  retries INTEGER DEFAULT 0,
  error TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  printed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON public.pos_print_jobs USING btree (client_id, status);
CREATE TABLE IF NOT EXISTS pos_promotions (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value NUMERIC DEFAULT 0,
  applies_to TEXT DEFAULT 'order'::text,
  category_ids JSONB DEFAULT '[]'::jsonb,
  item_ids JSONB DEFAULT '[]'::jsonb,
  schedule JSONB DEFAULT '{}'::jsonb,
  auto_apply BOOLEAN DEFAULT false,
  max_per_day INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_purchase_order_items (
  id BIGSERIAL,
  order_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  ingredient_name TEXT NOT NULL,
  quantity_ordered NUMERIC NOT NULL,
  quantity_received NUMERIC,
  unit TEXT NOT NULL,
  unit_cost NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_purchase_orders (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  supplier TEXT NOT NULL,
  status TEXT DEFAULT 'borrador'::text,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  notes TEXT,
  subtotal NUMERIC DEFAULT 0,
  iva NUMERIC DEFAULT 0,
  total NUMERIC DEFAULT 0,
  ai_suggested BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_recipe_lines (
  id BIGSERIAL,
  client_id TEXT NOT NULL,
  recipe_version_id BIGINT NOT NULL,
  ingredient_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  recipe_unit TEXT,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_recipe_version_id_ingredient_id_key UNIQUE (recipe_version_id, ingredient_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_client_id_ingredient_id_fkey FOREIGN KEY (client_id, client_id, ingredient_id, ingredient_id) REFERENCES pos_ingredients(client_id, id, id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_client_id_ingredient_id_fkey1 FOREIGN KEY (client_id, client_id, ingredient_id, ingredient_id) REFERENCES pos_inventory(ingredient_id, client_id, ingredient_id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
DO 21423 BEGIN
  ALTER TABLE pos_recipe_lines ADD CONSTRAINT pos_recipe_lines_client_id_recipe_version_id_fkey FOREIGN KEY (client_id, client_id, recipe_version_id, recipe_version_id) REFERENCES pos_recipe_versions(id, client_id, id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_recipes (
  id BIGINT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  nombre TEXT NOT NULL,
  precio_venta NUMERIC DEFAULT 0,
  costo_total NUMERIC DEFAULT 0,
  pct_costo NUMERIC DEFAULT 0,
  ingredientes JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'excel'::text,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_recipes_old (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  menu_item_id TEXT NOT NULL,
  menu_item_name TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  ingredient_type TEXT DEFAULT 'ingredient'::text,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_recipes_old ADD CONSTRAINT pos_recipes_client_id_menu_item_id_ingredient_id_key UNIQUE (client_id, menu_item_id, ingredient_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_retail_items (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  code TEXT,
  department TEXT,
  price NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  stock NUMERIC DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_save_operations (
  client_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  save_operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT DEFAULT 'EXECUTING'::text NOT NULL,
  committed_revision BIGINT,
  rejection_detail TEXT,
  rejection_expected BIGINT,
  rejection_current BIGINT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (client_id, order_id, save_operation_id)
);
CREATE TABLE IF NOT EXISTS pos_schedules (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  start_time TIME WITHOUT TIME ZONE,
  end_time TIME WITHOUT TIME ZONE,
  days TEXT[] DEFAULT '{}'::text[],
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_sizes (
  id TEXT DEFAULT (gen_random_uuid())::text NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  multiplier NUMERIC DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
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
  role_display TEXT DEFAULT 'mesero'::text,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_staff ADD CONSTRAINT unique_pin_per_client UNIQUE (pin, client_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS pos_staff_audit (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  staff_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_fields JSONB,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_staff_shifts (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  breaks JSONB DEFAULT '[]'::jsonb,
  hours_worked NUMERIC,
  orders_count INTEGER DEFAULT 0,
  sales_total NUMERIC DEFAULT 0,
  tips_total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_client ON public.pos_staff_shifts USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON public.pos_staff_shifts USING btree (clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_staff ON public.pos_staff_shifts USING btree (staff_id, clock_in DESC);
CREATE TABLE IF NOT EXISTS pos_sub_recipes (
  id TEXT DEFAULT ('sub-'::text || (gen_random_uuid())::text) NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  name TEXT NOT NULL,
  yield_quantity NUMERIC DEFAULT 1 NOT NULL,
  yield_unit TEXT DEFAULT 'KG'::text NOT NULL,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_sub_recipes ADD CONSTRAINT uq_sub_recipes_client_name UNIQUE (client_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_sub_recipes_client ON public.pos_sub_recipes USING btree (client_id);
CREATE TABLE IF NOT EXISTS pos_sub_recipe_ingredients (
  id BIGSERIAL,
  sub_recipe_id TEXT NOT NULL,
  ingredient_id TEXT NOT NULL,
  ingredient_type TEXT DEFAULT 'ingredient'::text NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT DEFAULT 'KG'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_sub_recipe_ingredients ADD CONSTRAINT pos_sub_recipe_ingredients_sub_recipe_id_fkey FOREIGN KEY (sub_recipe_id) REFERENCES pos_sub_recipes(id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_sri_ingredient ON public.pos_sub_recipe_ingredients USING btree (ingredient_id);
CREATE INDEX IF NOT EXISTS idx_sri_sub_recipe ON public.pos_sub_recipe_ingredients USING btree (sub_recipe_id);
CREATE TABLE IF NOT EXISTS pos_suppliers (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  email TEXT,
  authorized BOOLEAN DEFAULT true,
  authorized_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  payment_terms INTEGER DEFAULT 15,
  delivery_days INTEGER DEFAULT 1,
  rfc TEXT,
  giro TEXT,
  clave_wansoft TEXT,
  category TEXT,
  invoice_count INTEGER DEFAULT 0,
  invoice_total NUMERIC DEFAULT 0,
  expense_type TEXT,
  invoice_period TEXT,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_suppliers ADD CONSTRAINT pos_suppliers_client_name_key UNIQUE (client_id, name);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
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
  notas TEXT,
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS pos_unit_conversions (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor NUMERIC NOT NULL,
  is_system BOOLEAN DEFAULT false,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE pos_unit_conversions ADD CONSTRAINT uq_uc_client_units UNIQUE (client_id, from_unit, to_unit);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE TABLE IF NOT EXISTS prospects (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  nombre TEXT,
  restaurante TEXT,
  email TEXT,
  telefono TEXT,
  pos TEXT,
  status TEXT DEFAULT 'nuevo'::text,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS idx_push_client ON public.push_subscriptions USING btree (client_id);
CREATE TABLE IF NOT EXISTS reservaciones (
  id UUID DEFAULT gen_random_uuid() NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  codigo_reserva TEXT,
  nombre TEXT,
  telefono TEXT,
  fecha DATE,
  espacio TEXT,
  horario_inicio TIME WITHOUT TIME ZONE,
  horario_fin TIME WITHOUT TIME ZONE,
  guests INTEGER,
  paquete TEXT,
  pastel TEXT,
  deco TEXT,
  total NUMERIC,
  status TEXT DEFAULT 'pending'::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  entradas TEXT[],
  PRIMARY KEY (id)
);
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
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_review_id_key UNIQUE (review_id);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
CREATE INDEX IF NOT EXISTS reviews_date_idx ON public.reviews USING btree (date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS reviews_rating_idx ON public.reviews USING btree (rating);
CREATE INDEX IF NOT EXISTS reviews_status_idx ON public.reviews USING btree (status);
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
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_phone_date ON public.whatsapp_conversations USING btree (phone_number, created_at DESC);
CREATE TABLE IF NOT EXISTS whatsapp_messages_log (
  id BIGSERIAL,
  direction TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  message_id TEXT,
  message_type TEXT,
  content TEXT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_phone_date ON public.whatsapp_messages_log USING btree (phone_number, created_at DESC);
CREATE TABLE IF NOT EXISTS whatsapp_whitelist (
  id BIGSERIAL,
  phone_number TEXT NOT NULL,
  user_name TEXT NOT NULL,
  restaurante TEXT DEFAULT 'amalay'::text,
  role TEXT DEFAULT 'viewer'::text,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);
DO 21423 BEGIN
  ALTER TABLE whatsapp_whitelist ADD CONSTRAINT whatsapp_whitelist_phone_number_key UNIQUE (phone_number);
EXCEPTION WHEN duplicate_object THEN NULL; END 21423;
