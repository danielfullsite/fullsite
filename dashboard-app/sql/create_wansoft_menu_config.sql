-- Wansoft menu config — synced weekly from portal
CREATE TABLE IF NOT EXISTS wansoft_menu_config (
  client_id TEXT NOT NULL,
  fecha DATE NOT NULL,
  groups JSONB DEFAULT '[]',
  saucers JSONB DEFAULT '[]',
  saucers_with_cost JSONB DEFAULT '[]',
  complements JSONB DEFAULT '[]',
  promotions JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, fecha)
);

ALTER TABLE wansoft_menu_config DISABLE ROW LEVEL SECURITY;
