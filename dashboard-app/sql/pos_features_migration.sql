-- ═══════════════════════════════════════════════════════════════════════════
-- POS Features Migration: Cierre de Caja + Staff Shifts + Realtime
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. CIERRE DE CAJA table
CREATE TABLE IF NOT EXISTS pos_cierres (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cierres_fecha ON pos_cierres(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cierres_turno ON pos_cierres(turno_id);

-- 2. STAFF SHIFTS table
CREATE TABLE IF NOT EXISTS pos_staff_shifts (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  breaks JSONB DEFAULT '[]',
  hours_worked NUMERIC,
  orders_count INTEGER DEFAULT 0,
  sales_total NUMERIC DEFAULT 0,
  tips_total NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shifts_staff ON pos_staff_shifts(staff_id, clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON pos_staff_shifts(clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_client ON pos_staff_shifts(client_id);

-- 3. RLS for new tables
ALTER TABLE pos_cierres ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_staff_shifts ENABLE ROW LEVEL SECURITY;

-- Anon read access (POS uses anon key)
CREATE POLICY "anon_read_cierres" ON pos_cierres FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_cierres" ON pos_cierres FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_read_shifts" ON pos_staff_shifts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_shifts" ON pos_staff_shifts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_shifts" ON pos_staff_shifts FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Authenticated full access
CREATE POLICY "auth_all_cierres" ON pos_cierres FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_shifts" ON pos_staff_shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Service role full access
CREATE POLICY "service_all_cierres" ON pos_cierres FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_shifts" ON pos_staff_shifts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Enable Realtime for POS tables
ALTER PUBLICATION supabase_realtime ADD TABLE pos_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE pos_inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE pos_staff_shifts;

-- 5. Add metodo_pago column to pos_orders if missing (some schemas use metodoPago)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_orders' AND column_name = 'metodo_pago'
  ) THEN
    ALTER TABLE pos_orders ADD COLUMN metodo_pago TEXT;
  END IF;
END $$;

-- 6. Add propina column to pos_orders if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_orders' AND column_name = 'propina'
  ) THEN
    ALTER TABLE pos_orders ADD COLUMN propina NUMERIC DEFAULT 0;
  END IF;
END $$;
