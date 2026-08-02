-- P1-D03: Backup AMALAY station routing to clients.pos_settings
-- Run BEFORE removing mkt-* slugs from the system default in settings.ts / pos-constants.ts.
-- Without this, AMALAY's POS loses caja routing for market categories.
--
-- Run once against production. Safe to re-run (JSONB merge is idempotent).

UPDATE clients
SET pos_settings = jsonb_set(
  COALESCE(pos_settings, '{}'),
  '{pos.station_routing}',
  '{
    "cocina": [
      "chilaquiles","eggs","croissants","pancakes","paninis",
      "pizzas","bowls","ceviche","toast","bakery","postres",
      "promos","keto","kids","soups","munchies","extras","envios",
      "enchiladas-tacos","salads-ceviche","appetizers","evento","signature"
    ],
    "barra": [
      "coffee","jugos","fresh","smoothies","frappes",
      "sodas","tea","alcohol","activaciones","vinos","cerveza","licores"
    ],
    "caja": [
      "icecream","desserts","mkt-cafe",
      "mkt-healthy","mkt-vitaminas","mkt-regalos","mkt-amalay"
    ]
  }'::jsonb,
  true
)
WHERE id = 'amalay';

-- Verify
SELECT id, pos_settings->'pos.station_routing' AS routing FROM clients WHERE id = 'amalay';
