-- ═══════════════════════════════════════════════════════════
-- WANSOFT PIPELINE SCHEMA — Optional for ex-Wansoft clients
-- Generated: 2026-07-21 from production schema export
-- Tables: 16
-- ═══════════════════════════════════════════════════════════

-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS calendar_sync_log (
  id BIGSERIAL,
  event_id TEXT NOT NULL,
  event_title TEXT,
  event_start TIMESTAMPTZ,
  matched_reserva_id UUID,
  matched_codigo TEXT,
  action TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_sync_log_codigo ON public.calendar_sync_log USING btree (matched_codigo);
-- Index
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON public.calendar_sync_log USING btree (created_at DESC);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS delivery_platform_payments (
  id TEXT NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text,
  platform TEXT NOT NULL,
  lot_id TEXT,
  period_start DATE,
  period_end DATE,
  paid_date DATE,
  total NUMERIC,
  status TEXT,
  payment_ref TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_catalog (
  id BIGSERIAL,
  explored_at TIMESTAMPTZ DEFAULT now(),
  explorer_version TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT,
  level INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  ui_label TEXT,
  ui_selector TEXT,
  screenshot_path TEXT,
  has_export BOOLEAN DEFAULT false,
  export_format TEXT,
  xlsx_sheets JSONB,
  xlsx_sample_path TEXT,
  endpoints JSONB,
  filters JSONB,
  notes TEXT
);

-- Unique constraint: wansoft_catalog_path_explorer_version_key
ALTER TABLE wansoft_catalog ADD CONSTRAINT IF NOT EXISTS wansoft_catalog_path_explorer_version_key UNIQUE (path, explorer_version);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_daily (
  fecha DATE DEFAULT CURRENT_DATE NOT NULL,
  ventas_brutas NUMERIC,
  ventas_dia NUMERIC,
  descuentos NUMERIC,
  devoluciones NUMERIC,
  efectivo NUMERIC,
  tarjeta NUMERIC,
  chilaquiles_total NUMERIC,
  half_half_total NUMERIC,
  meseros JSONB,
  platillos_top JSONB,
  ventas_por_grupo JSONB,
  pago_metodos JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  propinas_total NUMERIC,
  mesas_atendidas INTEGER,
  ordenes_llevar INTEGER,
  tickets_count INTEGER,
  personas_restaurant INTEGER,
  cuentas_restaurant INTEGER,
  ticket_promedio_restaurant NUMERIC,
  client_slug TEXT DEFAULT 'amalay'::text NOT NULL,
  report_type TEXT DEFAULT 'cierre'::text NOT NULL,
  location_id TEXT DEFAULT 'amalay-spgg'::text
);

-- Unique constraint: wansoft_daily_fecha_key
ALTER TABLE wansoft_daily ADD CONSTRAINT IF NOT EXISTS wansoft_daily_fecha_key UNIQUE (fecha);
-- Index
CREATE INDEX IF NOT EXISTS idx_wansoft_daily_client_fecha ON public.wansoft_daily USING btree (client_slug, fecha DESC);
-- Index
CREATE UNIQUE INDEX idx_wansoft_daily_fecha ON public.wansoft_daily USING btree (fecha) WHERE (ventas_dia > (0)::numeric);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_food_cost (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_food_cost_client_id_fecha_key
ALTER TABLE wansoft_food_cost ADD CONSTRAINT IF NOT EXISTS wansoft_food_cost_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_hourly (
  fecha DATE NOT NULL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_inventory (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_inventory_client_id_fecha_key
ALTER TABLE wansoft_inventory ADD CONSTRAINT IF NOT EXISTS wansoft_inventory_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_kpis (
  id TEXT DEFAULT 'amalay'::text NOT NULL,
  ordenes_abiertas INTEGER,
  total_ordenes_mxn NUMERIC,
  ultima_venta TEXT,
  facturas INTEGER,
  devoluciones INTEGER,
  ordenes_compra INTEGER,
  transferencias INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now(),
  ventas_dia NUMERIC,
  egresos_dia NUMERIC,
  efectivo NUMERIC,
  tarjeta NUMERIC,
  inventario_critico TEXT,
  productos_top TEXT,
  cierre_caja TEXT,
  margen_dia NUMERIC,
  tickets_count INTEGER,
  hora_pico TEXT,
  notas TEXT,
  chilaquiles_count INTEGER,
  chilaquiles_total NUMERIC,
  half_half_count INTEGER,
  half_half_total NUMERIC,
  ticket_promedio_restaurant NUMERIC,
  personas_restaurant INTEGER,
  cuentas_restaurant INTEGER,
  meseros JSONB,
  platillos_top JSONB,
  propinas_meseros JSONB,
  pago_metodos JSONB,
  ventas_por_grupo JSONB,
  ventas_brutas NUMERIC,
  descuentos NUMERIC,
  fecha_reporte TEXT,
  propinas_total NUMERIC,
  mesas_atendidas INTEGER,
  ordenes_llevar INTEGER
);

-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_labor (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_labor_client_id_fecha_key
ALTER TABLE wansoft_labor ADD CONSTRAINT IF NOT EXISTS wansoft_labor_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_persons_hourly (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_persons_hourly_client_id_fecha_key
ALTER TABLE wansoft_persons_hourly ADD CONSTRAINT IF NOT EXISTS wansoft_persons_hourly_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_pnl (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  periodo TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_pnl_client_id_periodo_key
ALTER TABLE wansoft_pnl ADD CONSTRAINT IF NOT EXISTS wansoft_pnl_client_id_periodo_key UNIQUE (client_id, periodo);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_recipes (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  saucer_id TEXT NOT NULL,
  saucer_name TEXT,
  budget_cost NUMERIC,
  ingredients JSONB,
  raw JSONB,
  scraped_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_recipes_client_id_saucer_id_key
ALTER TABLE wansoft_recipes ADD CONSTRAINT IF NOT EXISTS wansoft_recipes_client_id_saucer_id_key UNIQUE (saucer_id, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_shrinkage (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_shrinkage_client_id_fecha_key
ALTER TABLE wansoft_shrinkage ADD CONSTRAINT IF NOT EXISTS wansoft_shrinkage_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_suppliers (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  periodo TEXT DEFAULT 'month'::text NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_suppliers_client_id_fecha_periodo_key
ALTER TABLE wansoft_suppliers ADD CONSTRAINT IF NOT EXISTS wansoft_suppliers_client_id_fecha_periodo_key UNIQUE (fecha, client_id, periodo);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_tips (
  id BIGSERIAL,
  client_id TEXT DEFAULT 'amalay'::text NOT NULL,
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: wansoft_tips_client_id_fecha_key
ALTER TABLE wansoft_tips ADD CONSTRAINT IF NOT EXISTS wansoft_tips_client_id_fecha_key UNIQUE (fecha, client_id);
-- Group: WANSOFT_PIPELINE
-- Auto-generated from production schema export (2026-07-21)
CREATE TABLE IF NOT EXISTS wansoft_waiter_categories (
  fecha DATE NOT NULL,
  data JSONB NOT NULL,
  items_count INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now()
);

