-- Migration 003: Add recipe_ref to pos_menu_items
-- Applied: 2026-07-24 via Supabase MCP (add_recipe_ref_to_pos_menu_items)
--
-- PURPOSE:
--   Replaces the fuzzy RECIPE_ALIASES text-matching in deductIngredientsForOrder()
--   with a direct DB link. recipe_ref stores the canonical LOWER(menu_item_name)
--   used as lookup key in pos_recipes_old. NULL = use fuzzy fallback.
--
-- ROLLBACK:
--   Code: revert deductIngredientsForOrder() — fuzzy fallback resumes automatically.
--   Data: column can stay; NULL rows use fallback.
--   Column removal (optional): ALTER TABLE pos_menu_items DROP COLUMN recipe_ref;

ALTER TABLE pos_menu_items
  ADD COLUMN IF NOT EXISTS recipe_ref TEXT NULL;

COMMENT ON COLUMN pos_menu_items.recipe_ref IS
  'Canonical lookup key: matches LOWER(pos_recipes_old.menu_item_name). NULL = fuzzy fallback.';

CREATE INDEX IF NOT EXISTS idx_pos_menu_items_recipe_ref
  ON pos_menu_items(client_id, recipe_ref)
  WHERE recipe_ref IS NOT NULL;

-- ─── Seed AMALAY (idempotent) ─────────────────────────────────────────────
-- Safe to re-run: only updates rows where recipe_ref IS DISTINCT FROM target
-- and recipe EXISTS in pos_recipes_old (no orphan refs created).

WITH seed AS (
  SELECT item_name_lower, recipe_ref FROM (VALUES
    ('chilaquiles verdes',          'chilaquiles verdes'),
    ('chilaquiles rojos',           'chilaquiles rojos'),
    ('chilaquiles light',           'chilaquiles ligth'),
    ('enchiladas suizas',           'enchiladas suizas'),
    ('machacado con huevo',         'machacado con huevo'),
    ('half & half combo',           'half  half combo'),
    ('garden omelet',               'garden omelet'),
    ('combo fit',                   'combo fit'),
    ('egg and pancake combo',       'combo kids pancake & eggs'),
    ('miss. benedict',              'miss. benedict'),
    ('miss benedict keto-panela wallander', 'miss benedict keto-panela wallander'),
    ('cafe americano',              'cafe americano'),
    ('capuchino caliente',          'capuchino caliente'),
    ('cafe latte caliente',         'cafe latte caliente'),
    ('latte frio',                  'latte frio'),
    ('matcha latte frio',           'matcha latte frio'),
    ('chai latte frio',             'chai latte frio'),
    ('mocca latte caliente',        'mocca latte caliente'),
    ('avocado toast',               'avo toast'),
    ('amalay salmon special toast', 'amalay smoked salmon & avocado toast'),
    ('el mexicano toast',           'el mexicano toast'),
    ('salmon bagel',                'salmon bagel'),
    ('combo amalay',                'combo amalay'),
    ('french toast',                'french toast'),
    ('mimosa clasica',              'mimosa clasica'),
    ('chamoyada de mango',          'chamoyada de mango'),
    ('croque madame amalay',        'croque madame'),
    ('croissant nutella',           'croissant nutella'),
    ('turkey  swiss croissant',     'turkey & swiss croisaint'),
    ('croissant almendra',          'croissant almendra'),
    ('jugo de naranja natural',     'jugo de naranja natural'),
    ('jugo verde de la casa',       'jugo verde de la casa'),
    ('jugo be inmune',              'jugo be inmune'),
    ('jugo dr detox',               'jugo dr detox'),
    ('jugo u glow',                 'jugo u glow'),
    ('limonada natural',            'limonada natural'),
    ('limonada de frutos rojos',    'limonada de frutos rojos'),
    ('smoothie mango-matcha',       'smoothie mango-matcha'),
    ('smoothie pink flamingo',      'smoothie pink flamingo'),
    ('smoothie tropical coconut',   'smoothie tropical coconut'),
    ('frappe matcha',               'frappe matcha'),
    ('frappe mango-maracuya',       'frappe mango-maracuya'),
    ('classic pancakes',            'classic buttermilk pancakes'),
    ('chicken panini',              'turkey pannini'),
    ('pasta mamarosa',              'pasta pacceri al pesto'),
    ('pizza pepperoni',             'pizza peperoni'),
    ('pizza margarita',             'pizza margarita'),
    ('acai love bowl',              'acai love'),
    ('fruit bowl',                  'plato de berrys'),
    ('blueberry cheesecake',        'blueberry cheesecake'),
    ('new york cheesecake',         'new york cheesecake'),
    ('carrot cake',                 'carrot cake'),
    ('concha de mantequilla',       'concha de mantequilla'),
    ('healthy crunchy mix',         'healthy & crunchy'),
    ('te chai',                     'te chai'),
    ('te verde',                    'te verde')
  ) AS t(item_name_lower, recipe_ref)
)
UPDATE pos_menu_items mi
SET    recipe_ref = s.recipe_ref
FROM   seed s
WHERE  mi.client_id = 'amalay'
  AND  LOWER(mi.name) = s.item_name_lower
  AND  mi.recipe_ref IS DISTINCT FROM s.recipe_ref
  AND  EXISTS (
    SELECT 1 FROM pos_recipes_old r
    WHERE  r.client_id = 'amalay'
      AND  LOWER(r.menu_item_name) = s.recipe_ref
    LIMIT  1
  );
