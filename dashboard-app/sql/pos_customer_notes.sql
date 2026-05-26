-- Customer memory notes per mesa
CREATE TABLE IF NOT EXISTS pos_customer_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  mesa INTEGER NOT NULL,
  note TEXT NOT NULL,
  type TEXT DEFAULT 'general', -- allergy, preference, vip, general
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_mesa ON pos_customer_notes(mesa, client_id);

ALTER TABLE pos_customer_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_notes" ON pos_customer_notes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_notes" ON pos_customer_notes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "auth_all_notes" ON pos_customer_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_all_notes" ON pos_customer_notes FOR ALL TO service_role USING (true) WITH CHECK (true);
