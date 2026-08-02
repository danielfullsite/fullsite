-- PAE Café Nómada — v1_menu.sql
-- 10 categorías + 40 ítems (4 por categoría).
-- IDs con prefijo nomada- para evitar colisiones.
-- Prerequisito: v1_client.sql aplicado.

-- -------------------------------------------------------
-- CATEGORÍAS
-- -------------------------------------------------------

INSERT INTO pos_menu_categories (id, client_id, name, color, sort_order, active) VALUES
  ('nomada-cat-cafes-calientes',   'nomada', 'Cafés Calientes',     'bg-amber-700',   1,  true),
  ('nomada-cat-cafes-frios',       'nomada', 'Cafés Fríos',         'bg-sky-600',     2,  true),
  ('nomada-cat-desayunos',         'nomada', 'Desayunos',           'bg-orange-500',  3,  true),
  ('nomada-cat-tostadas-bagels',   'nomada', 'Tostadas y Bagels',   'bg-yellow-600',  4,  true),
  ('nomada-cat-bowls',             'nomada', 'Bowls',               'bg-green-600',   5,  true),
  ('nomada-cat-jugos-smoothies',   'nomada', 'Jugos y Smoothies',   'bg-lime-600',    6,  true),
  ('nomada-cat-postres',           'nomada', 'Postres',             'bg-pink-500',    7,  true),
  ('nomada-cat-aguas',             'nomada', 'Aguas Frescas',       'bg-cyan-500',    8,  true),
  ('nomada-cat-especiales',        'nomada', 'Especiales del Día',  'bg-violet-600',  9,  true),
  ('nomada-cat-extras',            'nomada', 'Extras',              'bg-slate-500',   10, true);

-- -------------------------------------------------------
-- ÍTEMS — Cafés Calientes
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-americano',        'nomada', 'nomada-cat-cafes-calientes', 'Americano',          45,  1, true),
  ('nomada-item-cappuccino',       'nomada', 'nomada-cat-cafes-calientes', 'Cappuccino',         55,  2, true),
  ('nomada-item-latte',            'nomada', 'nomada-cat-cafes-calientes', 'Latte',              60,  3, true),
  ('nomada-item-machiato',         'nomada', 'nomada-cat-cafes-calientes', 'Machiato',           65,  4, true);

-- -------------------------------------------------------
-- ÍTEMS — Cafés Fríos
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-cafe-frio',        'nomada', 'nomada-cat-cafes-frios', 'Café Frío',              65,  1, true),
  ('nomada-item-frappe-vainilla',  'nomada', 'nomada-cat-cafes-frios', 'Frappé de Vainilla',     70,  2, true),
  ('nomada-item-latte-frio',       'nomada', 'nomada-cat-cafes-frios', 'Latte Frío',             65,  3, true),
  ('nomada-item-cold-brew',        'nomada', 'nomada-cat-cafes-frios', 'Cold Brew',              75,  4, true);

-- -------------------------------------------------------
-- ÍTEMS — Desayunos
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-huevos-rancheros', 'nomada', 'nomada-cat-desayunos', 'Huevos Rancheros',       95,  1, true),
  ('nomada-item-omelette-jamon',   'nomada', 'nomada-cat-desayunos', 'Omelette de Jamón',      110, 2, true),
  ('nomada-item-chilaquiles',      'nomada', 'nomada-cat-desayunos', 'Chilaquiles Rojos',       115, 3, true),
  ('nomada-item-benedictinos',     'nomada', 'nomada-cat-desayunos', 'Benedictinos',            125, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Tostadas y Bagels
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-tostada-aguacate', 'nomada', 'nomada-cat-tostadas-bagels', 'Tostada con Aguacate', 85,  1, true),
  ('nomada-item-bagel-jamon',      'nomada', 'nomada-cat-tostadas-bagels', 'Bagel de Jamón Serrano', 120, 2, true),
  ('nomada-item-tostada-salmon',   'nomada', 'nomada-cat-tostadas-bagels', 'Tostada con Salmón',  135, 3, true),
  ('nomada-item-bagel-vegano',     'nomada', 'nomada-cat-tostadas-bagels', 'Bagel Vegano',         105, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Bowls
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-bowl-fruta',       'nomada', 'nomada-cat-bowls', 'Bowl de Fruta',              75,  1, true),
  ('nomada-item-bowl-griego',      'nomada', 'nomada-cat-bowls', 'Bowl Griego',                125, 2, true),
  ('nomada-item-acai-bowl',        'nomada', 'nomada-cat-bowls', 'Açaí Bowl',                  115, 3, true),
  ('nomada-item-bowl-granola',     'nomada', 'nomada-cat-bowls', 'Bowl de Granola',             95, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Jugos y Smoothies
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-jugo-verde',       'nomada', 'nomada-cat-jugos-smoothies', 'Jugo Verde',         65, 1, true),
  ('nomada-item-smoothie-mango',   'nomada', 'nomada-cat-jugos-smoothies', 'Smoothie de Mango',  70, 2, true),
  ('nomada-item-jugo-naranja',     'nomada', 'nomada-cat-jugos-smoothies', 'Jugo de Naranja',    55, 3, true),
  ('nomada-item-smoothie-prot',    'nomada', 'nomada-cat-jugos-smoothies', 'Smoothie Proteico',  80, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Postres
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-croissant-choco',  'nomada', 'nomada-cat-postres', 'Croissant de Chocolate',   65, 1, true),
  ('nomada-item-cheesecake',       'nomada', 'nomada-cat-postres', 'Cheesecake',               85, 2, true),
  ('nomada-item-cookie-avena',     'nomada', 'nomada-cat-postres', 'Cookie de Avena',           45, 3, true),
  ('nomada-item-muffin-blueberry', 'nomada', 'nomada-cat-postres', 'Muffin de Blueberry',      55, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Aguas Frescas
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-agua-jamaica',     'nomada', 'nomada-cat-aguas', 'Agua de Jamaica',            35, 1, true),
  ('nomada-item-agua-horchata',    'nomada', 'nomada-cat-aguas', 'Agua de Horchata',           35, 2, true),
  ('nomada-item-agua-pepino',      'nomada', 'nomada-cat-aguas', 'Agua de Pepino',             35, 3, true),
  ('nomada-item-agua-limon',       'nomada', 'nomada-cat-aguas', 'Agua de Limón',              30, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Especiales del Día
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-sandwich-chef',    'nomada', 'nomada-cat-especiales', 'Sándwich del Chef',     130, 1, true),
  ('nomada-item-ensalada-casa',    'nomada', 'nomada-cat-especiales', 'Ensalada de la Casa',   115, 2, true),
  ('nomada-item-pasta-dia',        'nomada', 'nomada-cat-especiales', 'Pasta del Día',         145, 3, true),
  ('nomada-item-sopa-dia',         'nomada', 'nomada-cat-especiales', 'Sopa del Día',           95, 4, true);

-- -------------------------------------------------------
-- ÍTEMS — Extras
-- -------------------------------------------------------

INSERT INTO pos_menu_items (id, client_id, category_id, name, price, sort_order, active) VALUES
  ('nomada-item-shot-espresso',    'nomada', 'nomada-cat-extras', 'Shot Extra de Espresso',    20, 1, true),
  ('nomada-item-leche-almendra',   'nomada', 'nomada-cat-extras', 'Leche de Almendra',         20, 2, true),
  ('nomada-item-leche-avena',      'nomada', 'nomada-cat-extras', 'Leche de Avena',            20, 3, true),
  ('nomada-item-jarabe-extra',     'nomada', 'nomada-cat-extras', 'Jarabe Extra',              15, 4, true);

-- -------------------------------------------------------
-- Verificación
-- -------------------------------------------------------

DO $$
DECLARE cat_cnt integer; item_cnt integer;
BEGIN
  SELECT count(*) INTO cat_cnt  FROM pos_menu_categories WHERE client_id = 'nomada';
  SELECT count(*) INTO item_cnt FROM pos_menu_items       WHERE client_id = 'nomada';
  IF cat_cnt <> 10 THEN
    RAISE EXCEPTION 'v1_menu: expected 10 categories for nomada, got %', cat_cnt;
  END IF;
  IF item_cnt <> 40 THEN
    RAISE EXCEPTION 'v1_menu: expected 40 items for nomada, got %', item_cnt;
  END IF;
  RAISE NOTICE 'v1_menu OK: % categories, % items', cat_cnt, item_cnt;
END $$;
