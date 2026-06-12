-- ═══════════════════════════════════════════════════════════════════════════
-- Market Inventory: stock por unidad para productos Market (categorías mkt-*)
-- A diferencia de cocina/barra (recetas → insumos), el Market es retail 1:1:
-- vender 1 unidad descuenta 1 unidad de stock del menu item.
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Stock por menu item del Market
CREATE TABLE IF NOT EXISTS pos_market_stock (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  menu_item_id TEXT NOT NULL,        -- references pos_menu_items.id (mkt-*)
  stock NUMERIC NOT NULL DEFAULT 0,
  reorder_point NUMERIC DEFAULT 0,
  reorder_quantity NUMERIC DEFAULT 0,
  last_restock TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, menu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_market_stock_item ON pos_market_stock(menu_item_id);

-- 2. Movimientos (audit trail — nada se borra, igual que pos_inventory_movements)
CREATE TABLE IF NOT EXISTS pos_market_movements (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  menu_item_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,       -- 'venta', 'entrada', 'merma', 'ajuste'
  quantity NUMERIC NOT NULL,         -- negativo = sale stock, positivo = entra
  order_id TEXT,
  actor TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_market_mov_item ON pos_market_movements(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_market_mov_created ON pos_market_movements(created_at DESC);

-- 3. RLS (mismo patrón que pos_inventory: el POS usa anon key)
ALTER TABLE pos_market_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_market_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_market_stock" ON pos_market_stock FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_market_stock" ON pos_market_stock FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_market_stock" ON pos_market_stock FOR UPDATE TO anon USING (true);
CREATE POLICY "anon_read_market_mov" ON pos_market_movements FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_market_mov" ON pos_market_movements FOR INSERT TO anon WITH CHECK (true);
-- Sin DELETE: audit trail intocable (regla anti-fraude de Eduardo).
