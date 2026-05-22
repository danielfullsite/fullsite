-- POS Admin Tables for Restaurante + Tienda

-- Tamaños (sizes for menu items)
CREATE TABLE IF NOT EXISTS pos_sizes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  multiplier NUMERIC DEFAULT 1.0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Horarios de platillos (time-based availability)
CREATE TABLE IF NOT EXISTS pos_schedules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week JSONB DEFAULT '["lun","mar","mie","jue","vie","sab","dom"]',
  menu_items JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Formas de pago configuration
CREATE TABLE IF NOT EXISTS pos_payment_methods (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  type TEXT DEFAULT 'cash',
  commission_pct NUMERIC DEFAULT 0,
  fiscal_code TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promociones engine
CREATE TABLE IF NOT EXISTS pos_promotions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  type TEXT DEFAULT 'discount',
  discount_pct NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  applies_to JSONB DEFAULT '[]',
  valid_from DATE,
  valid_until DATE,
  hours_start TIME,
  hours_end TIME,
  days_of_week JSONB DEFAULT '["lun","mar","mie","jue","vie","sab","dom"]',
  min_purchase NUMERIC DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Zonas de domicilio (delivery zones)
CREATE TABLE IF NOT EXISTS pos_delivery_zones (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  postal_codes JSONB DEFAULT '[]',
  delivery_fee NUMERIC DEFAULT 0,
  min_order NUMERIC DEFAULT 0,
  estimated_minutes INT DEFAULT 30,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tarjetas de regalo
CREATE TABLE IF NOT EXISTS pos_gift_cards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  code TEXT NOT NULL UNIQUE,
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  current_balance NUMERIC NOT NULL DEFAULT 0,
  customer_name TEXT,
  customer_phone TEXT,
  status TEXT DEFAULT 'active',
  expires_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tienda: Artículos retail
CREATE TABLE IF NOT EXISTS pos_retail_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id TEXT NOT NULL DEFAULT 'amalay',
  name TEXT NOT NULL,
  barcode TEXT,
  department TEXT,
  group_name TEXT,
  price NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  stock NUMERIC DEFAULT 0,
  min_stock NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'pieza',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS on all new tables
ALTER TABLE pos_sizes DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payment_methods DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_promotions DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_delivery_zones DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_gift_cards DISABLE ROW LEVEL SECURITY;
ALTER TABLE pos_retail_items DISABLE ROW LEVEL SECURITY;

-- Seed default payment methods for AMALAY
INSERT INTO pos_payment_methods (client_id, name, type, commission_pct) VALUES
  ('amalay', 'Efectivo', 'cash', 0),
  ('amalay', 'Tarjeta de crédito', 'card', 3.5),
  ('amalay', 'Tarjeta de débito', 'card', 2.5),
  ('amalay', 'Transferencia', 'transfer', 0),
  ('amalay', 'Ubereats', 'platform', 30),
  ('amalay', 'Rappi', 'platform', 25)
ON CONFLICT DO NOTHING;
