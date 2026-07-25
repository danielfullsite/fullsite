-- P1 RECIPE COVERAGE REPORT
-- Mirrors TypeScript runtime resolution in deductIngredientsForOrder():
--   recipesByName = Map keyed on LOWER(menu_item_name)
--   DB path: recipesByName.get(recipeRef) → exact lowercase match
--   Fuzzy path: recipesByName.get(alias.toLowerCase()) → exact lowercase match
--
-- BUG FIXED 2026-07-24: original script used r.menu_item_name = mi.recipe_ref
-- (case-sensitive). pos_recipes_old stores names in UPPERCASE; recipe_ref is
-- lowercase. Fix: LOWER(r.menu_item_name) = LOWER(mi.recipe_ref).
--
-- CATEGORIES
--   DB_MAPPING            – recipe_ref set + recipe found (case-insensitive)
--   FUZZY_FALLBACK        – no recipe_ref, alias in RECIPE_ALIASES resolves to recipe
--   UNRESOLVED_APPLICABLE – food items that should deduct inventory; recipe missing
--   UNRESOLVED_NON_APPLICABLE – alcohol, retail packaged goods, simple espresso shots;
--                               deliberately excluded from ingredient deduction

WITH recipe_aliases(alias_key, recipe_target) AS (VALUES
  ('chilaquiles verdes','chilaquiles verdes'),('chilaquiles rojos','chilaquiles rojos'),
  ('chilaquiles light','chilaquiles ligth'),('enchiladas suizas','enchiladas suizas'),
  ('machacado con huevo','machacado con huevo'),('half & half combo','half & half combo'),
  ('garden omelet','garden omelet'),('combo fit','combo fit'),
  ('egg and pancake combo','combo kids pancake & eggs'),
  ('miss benedict','miss. benedict'),('cafe americano','cafe americano'),
  ('capuchino caliente','capuchino'),('cafe latte caliente','cafe latte'),
  ('latte frio','latte frio'),('matcha latte frio','matcha latte'),
  ('chai latte frio','chai latte'),('mocca latte caliente','mocca latte'),
  ('avocado toast','avo toast'),
  ('amalay salmon special toast','amalay smoked salmon & avocado toast'),
  ('el mexicano toast','el mexicano toast'),('salmon bagel','salmon bagel'),
  ('combo amalay','combo amalay'),('french toast','french toast'),
  ('mimosa clasica','mimosa clasica'),('chamoyada de mango','chamoyada de mango'),
  ('croque madame amalay','croque madame'),('croissant nutella','croissant nutella'),
  ('turkey & swiss croissant','turkey & swiss croisaint'),('croissant almendra','croissant almendra'),
  ('jugo de naranja natural','jugo de naranja'),('jugo verde de la casa','jugo verde'),
  ('jugo be inmune','jugo be inmune'),('jugo dr detox','jugo dr detox'),('jugo u glow','jugo u glow'),
  ('limonada natural','limonada natural'),('limonada de frutos rojos','limonada de frutos rojos'),
  ('smoothie mango-matcha','smoothie mango matcha'),('smoothie pink flamingo','smoothie pink flamingo'),
  ('smoothie tropical coconut','smoothie tropical coconut'),
  ('frapuccino','frapuccino'),
  ('frappe matcha','frappe matcha'),('frappe mango-maracuya','frappe mango-maracuya'),
  ('classic pancakes','classic buttermilk pancakes'),
  ('chicken panini','turkey pannini'),
  ('pasta mamarosa','pasta pacceri al pesto'),
  ('pasta bologese','pasta bologese'),
  ('pizza pepperoni','pizza peperoni'),
  ('pizza peperoni','pizza peperoni'),
  ('pizza margarita','pizza margarita'),
  ('acai love bowl','acai love'),('fruit bowl','plato de berrys'),
  ('cheesecake','cheesecake'),('carrot cake','carrot cake'),
  ('concha de mantequilla','concha de mantequilla'),('healthy crunchy mix','healthy & crunchy'),
  ('te chai','te chai'),('te verde','te verde')
),
ordered_items AS (
  SELECT
    LOWER(item->>'nombre')  AS item_name,
    item->>'menuItemId'     AS item_id,
    COUNT(*)                AS order_count
  FROM pos_orders,
       jsonb_array_elements(items) AS item
  WHERE client_id = 'amalay'
    AND jsonb_typeof(items) = 'array'
  GROUP BY 1, 2
),
resolved AS (
  SELECT
    oi.item_name,
    oi.item_id,
    oi.order_count,
    CASE
      -- DB path: recipe_ref set + case-insensitive match (mirrors recipesByName.get(recipeRef))
      WHEN mi.recipe_ref IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pos_recipes_old r
          WHERE r.client_id = 'amalay'
            AND LOWER(r.menu_item_name) = LOWER(mi.recipe_ref)
        )  THEN 'DB_MAPPING'
      -- Fuzzy path: alias resolves (mirrors RECIPE_ALIASES + recipesByName.get(alias.toLowerCase()))
      WHEN ra.alias_key IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pos_recipes_old r
          WHERE r.client_id = 'amalay'
            AND LOWER(r.menu_item_name) = ra.recipe_target
        )  THEN 'FUZZY_FALLBACK'
      -- Non-applicable: alcohol, retail packaged goods, simple espresso shots
      WHEN (
        oi.item_id ~ '^ws-(cer|boh|vl|lug|san|smc|hec)'
        OR oi.item_id ~ '^ws-[0-9]{10,}'
        OR oi.item_name IN (
          'espresso doble', 'espresso 45ml', 'flat white caliente', 'matcha ceremonial'
        )
      ) THEN 'UNRESOLVED_NON_APPLICABLE'
      -- Applicable: food items that should deduct inventory; recipe not yet created
      ELSE 'UNRESOLVED_APPLICABLE'
    END AS resolution
  FROM ordered_items oi
  LEFT JOIN pos_menu_items mi
    ON mi.client_id = 'amalay' AND mi.id = oi.item_id
  LEFT JOIN recipe_aliases ra
    ON ra.alias_key = oi.item_name
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (ORDER BY order_count DESC) AS rank
  FROM resolved
)

-- ── TOP 20 ──────────────────────────────────────────────────────────────────
SELECT 'TOP_20' AS section, rank, item_name, item_id, order_count, resolution
FROM ranked WHERE rank <= 20
UNION ALL
-- ── TOP 50 ──────────────────────────────────────────────────────────────────
SELECT 'TOP_50' AS section, rank, item_name, item_id, order_count, resolution
FROM ranked WHERE rank > 20 AND rank <= 50
UNION ALL
-- ── TOTALS ──────────────────────────────────────────────────────────────────
SELECT
  'TOTALS'      AS section,
  NULL          AS rank,
  resolution    AS item_name,
  NULL          AS item_id,
  SUM(order_count)::int AS order_count,
  COUNT(*)::text || ' items' AS resolution
FROM resolved
GROUP BY resolution
ORDER BY section, rank NULLS LAST, order_count DESC;
