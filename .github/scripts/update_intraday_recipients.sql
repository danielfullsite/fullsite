-- Add "raul" to intraday report recipients
-- Run this in Supabase SQL Editor
UPDATE clients
SET report_recipients = jsonb_set(
  report_recipients::jsonb,
  '{intraday}',
  '["daniel", "monica", "raul"]'::jsonb
)
WHERE id = 'amalay';

-- Also add panaderia keywords to menu_categories
UPDATE clients
SET menu_categories = jsonb_set(
  menu_categories::jsonb,
  '{panaderia}',
  '["CONCHA", "CRUNCHY MIX", "MUFFIN", "CUERNO", "DONA", "ROL DE CANELA"]'::jsonb
)
WHERE id = 'amalay';

-- Update postres to exclude pancakes
UPDATE clients
SET menu_categories = jsonb_set(
  menu_categories::jsonb,
  '{postres}',
  '["BROWNIE", "CHEESECAKE", "FLAN", "PASTEL", "CAKE", "CHURRO", "TIRAMISU", "CREPAS", "CREPE"]'::jsonb
)
WHERE id = 'amalay';

-- Add chilaquiles keywords
UPDATE clients
SET menu_categories = jsonb_set(
  menu_categories::jsonb,
  '{chilaquiles}',
  '["CHILAQUIL"]'::jsonb
)
WHERE id = 'amalay';
