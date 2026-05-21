-- Generic Wansoft data store for all endpoints
-- Uses (client_id, fecha, data_key) as composite key
CREATE TABLE IF NOT EXISTS wansoft_data (
  client_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  data_key TEXT NOT NULL,
  data JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, fecha, data_key)
);

ALTER TABLE wansoft_data DISABLE ROW LEVEL SECURITY;

-- Index for fast lookups by key
CREATE INDEX IF NOT EXISTS idx_wansoft_data_key ON wansoft_data (client_id, data_key, fecha DESC);
