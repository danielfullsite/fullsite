-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen Inventory: insumos/ingredientes usados en recetas de cocina
-- Diferente de pos_market_stock (retail 1:1). Aqui son materias primas
-- que se consumen via recetas (AGUACATE, HUEVO, LECHE, etc.)
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Productos de inventario (ingredientes/insumos)
CREATE TABLE IF NOT EXISTS pos_inventory_products (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  name TEXT NOT NULL,
  unit TEXT NOT NULL,              -- KG, PZA, LT, ML, GR, SOBRE, BOLSA, etc.
  cost_per_unit NUMERIC,          -- costo por unidad de medida
  stock NUMERIC NOT NULL DEFAULT 0,
  reorder_point NUMERIC DEFAULT 0,
  category TEXT,                  -- opcional: proteinas, lacteos, vegetales, etc.
  active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, name)
);
CREATE INDEX IF NOT EXISTS idx_inv_products_client ON pos_inventory_products(client_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_name ON pos_inventory_products(name);

-- 2. Movimientos de inventario (audit trail — nada se borra, regla de Eduardo)
-- COMPAT BRIDGE: ingredient_id is temporary while POS code uses the legacy
-- pos_ingredients model. product_id is the target column for the new model.
-- See docs/INVENTORY-MIGRATION.md for the migration plan.
CREATE TABLE IF NOT EXISTS pos_inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  product_id BIGINT REFERENCES pos_inventory_products(id),  -- nullable during compat bridge
  ingredient_id TEXT,             -- COMPAT BRIDGE: maps to pos_ingredients.id (TEXT)
  movement_type TEXT NOT NULL,    -- 'deduction', 'restock', 'adjustment', 'waste'
  quantity NUMERIC NOT NULL,      -- positivo = entra, negativo = sale
  order_id UUID,                  -- referencia a orden POS si aplica
  actor TEXT,                     -- quien hizo el movimiento
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON pos_inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created ON pos_inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON pos_inventory_movements(movement_type);

-- 3. RLS (POS usa anon key)
ALTER TABLE pos_inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_inventory_movements ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist (idempotent)
DROP POLICY IF EXISTS "anon_read_inv_products" ON pos_inventory_products;
DROP POLICY IF EXISTS "anon_insert_inv_products" ON pos_inventory_products;
DROP POLICY IF EXISTS "anon_update_inv_products" ON pos_inventory_products;
DROP POLICY IF EXISTS "anon_read_inv_movements" ON pos_inventory_movements;
DROP POLICY IF EXISTS "anon_insert_inv_movements" ON pos_inventory_movements;

-- Products: SELECT, INSERT, UPDATE (no DELETE)
CREATE POLICY "anon_read_inv_products" ON pos_inventory_products FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_inv_products" ON pos_inventory_products FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_inv_products" ON pos_inventory_products FOR UPDATE TO anon USING (true);

-- Movements: SELECT, INSERT only (no UPDATE, no DELETE — audit trail intocable)
CREATE POLICY "anon_read_inv_movements" ON pos_inventory_movements FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_inv_movements" ON pos_inventory_movements FOR INSERT TO anon WITH CHECK (true);
-- Sin DELETE ni UPDATE: audit trail intocable (regla anti-fraude de Eduardo).
