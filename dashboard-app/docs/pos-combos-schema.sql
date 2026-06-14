-- pos_combos: combo definitions for the Fullsite POS
-- Each combo groups multiple menu items at a discounted total price.

CREATE TABLE IF NOT EXISTS pos_combos (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL DEFAULT 'amalay',
  name          TEXT NOT NULL,                          -- e.g. "Combo Desayuno"
  items         JSONB NOT NULL,                         -- [{menu_item_id, name, substitutions: [{id, name}]}]
  price         NUMERIC NOT NULL,                       -- combo price (less than sum of individual items)
  upsell        JSONB,                                  -- {label: "Agrandar combo", price_add: 29}
  active        BOOLEAN NOT NULL DEFAULT true,
  schedule      JSONB,                                  -- {days: [0..6], start_time, end_time, start_date, end_date}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only authenticated users can read
ALTER TABLE pos_combos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON pos_combos
  FOR SELECT TO authenticated
  USING (true);

-- Index for the typical fetch query
CREATE INDEX IF NOT EXISTS idx_pos_combos_client_active
  ON pos_combos (client_id, active);

-- Example insert:
-- INSERT INTO pos_combos (id, client_id, name, items, price, upsell, schedule) VALUES (
--   'combo-desayuno-1',
--   'amalay',
--   'Combo Desayuno',
--   '[{"menu_item_id":"chil-001","name":"Chilaquiles Verdes","substitutions":[{"id":"chil-002","name":"Chilaquiles Rojos"}]},{"menu_item_id":"cof-001","name":"Café Americano","substitutions":[{"id":"cof-002","name":"Latte"}]}]',
--   159.00,
--   '{"label":"Agrandar a Grande","price_add":29}',
--   '{"days":[1,2,3,4,5],"start_time":"07:00","end_time":"12:00","start_date":"","end_date":""}'
-- );
