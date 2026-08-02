-- PAE Café Nómada — v1_recipes.sql
-- 10 recetas en el sistema normalizado (pos_recipe_versions + pos_recipe_lines).
-- Cubre las categorías cocina y barra para probar food cost en dashboard.
-- Prerequisito: v1_menu.sql y v1_ingredients.sql aplicados.

-- -------------------------------------------------------
-- pos_recipe_versions — una versión activa por ítem
-- -------------------------------------------------------

INSERT INTO pos_recipe_versions
  (client_id, menu_item_id, version, active, source, created_by)
VALUES
  -- Barra: café
  ('nomada', 'nomada-item-cappuccino',       1, true, 'manual', 'seed/v1'),
  ('nomada', 'nomada-item-latte',            1, true, 'manual', 'seed/v1'),
  ('nomada', 'nomada-item-cafe-frio',        1, true, 'manual', 'seed/v1'),
  -- Barra: bebidas
  ('nomada', 'nomada-item-jugo-verde',       1, true, 'manual', 'seed/v1'),
  -- Cocina: desayunos
  ('nomada', 'nomada-item-huevos-rancheros', 1, true, 'manual', 'seed/v1'),
  ('nomada', 'nomada-item-omelette-jamon',   1, true, 'manual', 'seed/v1'),
  ('nomada', 'nomada-item-chilaquiles',      1, true, 'manual', 'seed/v1'),
  -- Cocina: tostadas
  ('nomada', 'nomada-item-tostada-aguacate', 1, true, 'manual', 'seed/v1'),
  -- Cocina: especiales
  ('nomada', 'nomada-item-sandwich-chef',    1, true, 'manual', 'seed/v1'),
  -- Cocina: bowls
  ('nomada', 'nomada-item-bowl-fruta',       1, true, 'manual', 'seed/v1');

-- -------------------------------------------------------
-- pos_recipe_lines — ingredientes por receta
-- Las cantidades producen food cost entre 22% y 30%.
-- -------------------------------------------------------

-- Cappuccino ($55) — costo ~$13.20 (24%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-cafe-grano',     0.020, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cappuccino';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-leche-entera',   0.180, 'L'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cappuccino';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-azucar',         0.010, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cappuccino';

-- Latte ($60) — costo ~$15.36 (26%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-cafe-grano',     0.020, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-latte';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-leche-entera',   0.250, 'L'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-latte';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-vainilla',      10.000, 'ml'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-latte';

-- Café Frío ($65) — costo ~$15.74 (24%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-cafe-grano',     0.025, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cafe-frio';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-leche-entera',   0.200, 'L'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cafe-frio';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-azucar',         0.015, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-cafe-frio';

-- Jugo Verde ($65) — costo ~$16.20 (25%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-fruta-temporada', 0.200, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-jugo-verde';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-aguacate',        0.100, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-jugo-verde';

-- Huevos Rancheros ($95) — costo ~$25.60 (27%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-huevos',          3.000, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-huevos-rancheros';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jitomate',        0.150, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-huevos-rancheros';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-cebolla',         0.080, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-huevos-rancheros';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-chile-serrano',   0.020, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-huevos-rancheros';

-- Omelette de Jamón ($110) — costo ~$30.40 (28%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-huevos',          3.000, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-omelette-jamon';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jamon',           0.080, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-omelette-jamon';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-queso-manchego',  0.040, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-omelette-jamon';

-- Chilaquiles Rojos ($115) — costo ~$27.75 (24%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-huevos',          2.000, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-chilaquiles';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jitomate',        0.200, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-chilaquiles';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-chile-serrano',   0.030, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-chilaquiles';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-queso-manchego',  0.030, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-chilaquiles';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-crema-batir',     0.020, 'L'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-chilaquiles';

-- Tostada con Aguacate ($85) — costo ~$22.40 (26%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-aguacate',        0.500, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-tostada-aguacate';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-pan-caja',        2.000, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-tostada-aguacate';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jitomate',        0.050, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-tostada-aguacate';

-- Sándwich del Chef ($130) — costo ~$34.00 (26%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jamon',           0.100, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-sandwich-chef';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-queso-manchego',  0.050, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-sandwich-chef';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-pan-caja',        2.000, 'pza'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-sandwich-chef';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-jitomate',        0.080, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-sandwich-chef';

-- Bowl de Fruta ($75) — costo ~$19.50 (26%)
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-fruta-temporada', 0.250, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-bowl-fruta';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-granola',         0.050, 'kg'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-bowl-fruta';
INSERT INTO pos_recipe_lines (client_id, recipe_version_id, ingredient_id, quantity, recipe_unit)
SELECT 'nomada', rv.id, 'nomada-ing-crema-batir',     0.030, 'L'
  FROM pos_recipe_versions rv
 WHERE rv.client_id='nomada' AND rv.menu_item_id='nomada-item-bowl-fruta';

-- -------------------------------------------------------
-- Verificación
-- -------------------------------------------------------

DO $$
DECLARE rv_cnt integer; rl_cnt integer;
BEGIN
  SELECT count(*) INTO rv_cnt
    FROM pos_recipe_versions WHERE client_id = 'nomada';
  SELECT count(*) INTO rl_cnt
    FROM pos_recipe_lines WHERE client_id = 'nomada';
  IF rv_cnt <> 10 THEN
    RAISE EXCEPTION 'v1_recipes: expected 10 recipe versions for nomada, got %', rv_cnt;
  END IF;
  IF rl_cnt < 20 THEN
    RAISE EXCEPTION 'v1_recipes: expected ≥20 recipe lines for nomada, got %', rl_cnt;
  END IF;
  RAISE NOTICE 'v1_recipes OK: % versions, % lines for nomada', rv_cnt, rl_cnt;
END $$;
