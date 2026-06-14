CREATE TABLE pos_print_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT DEFAULT 'amalay',
  order_id TEXT,
  station TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retries INTEGER DEFAULT 0,
  error TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  printed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_print_jobs_status ON pos_print_jobs(client_id, status);
ALTER TABLE pos_print_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_all ON pos_print_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY anon_all ON pos_print_jobs FOR ALL TO anon USING (true) WITH CHECK (true);
