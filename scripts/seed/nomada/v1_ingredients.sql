-- PAE Café Nómada — v1_ingredients.sql
-- 20 ingredientes con costos reales de referencia (staging only).
-- Prerequisito: v1_client.sql aplicado.

INSERT INTO pos_ingredients (id, client_id, name, unit, cost_per_unit, category, yield_factor, is_critical, product_type) VALUES
  -- Café y lácteos (base del menú)
  ('nomada-ing-cafe-grano',       'nomada', 'Café en grano',       'kg',  180.00, 'bebidas',    0.95, true,  'materia_prima'),
  ('nomada-ing-leche-entera',     'nomada', 'Leche entera',        'L',    22.00, 'lacteos',    1.00, true,  'materia_prima'),
  ('nomada-ing-leche-almendra',   'nomada', 'Leche de almendra',   'L',    65.00, 'lacteos',    1.00, false, 'materia_prima'),
  ('nomada-ing-leche-avena',      'nomada', 'Leche de avena',      'L',    58.00, 'lacteos',    1.00, false, 'materia_prima'),
  ('nomada-ing-crema-batir',      'nomada', 'Crema para batir',    'L',    85.00, 'lacteos',    1.00, false, 'materia_prima'),
  -- Proteínas
  ('nomada-ing-huevos',           'nomada', 'Huevos',              'pza',   5.00, 'proteinas',  1.00, true,  'materia_prima'),
  ('nomada-ing-jamon',            'nomada', 'Jamón',               'kg',  220.00, 'proteinas',  0.95, false, 'materia_prima'),
  ('nomada-ing-salmon-ahumado',   'nomada', 'Salmón ahumado',      'kg',  580.00, 'proteinas',  1.00, false, 'materia_prima'),
  -- Frutas y verduras
  ('nomada-ing-aguacate',         'nomada', 'Aguacate',            'pza',  25.00, 'frutas',     0.80, true,  'materia_prima'),
  ('nomada-ing-jitomate',         'nomada', 'Jitomate',            'kg',   35.00, 'verduras',   0.90, false, 'materia_prima'),
  ('nomada-ing-cebolla',          'nomada', 'Cebolla',             'kg',   28.00, 'verduras',   0.85, false, 'materia_prima'),
  ('nomada-ing-chile-serrano',    'nomada', 'Chile serrano',       'kg',   45.00, 'verduras',   0.85, false, 'materia_prima'),
  ('nomada-ing-fruta-temporada',  'nomada', 'Fruta de temporada',  'kg',   65.00, 'frutas',     0.80, false, 'materia_prima'),
  -- Panadería y granos
  ('nomada-ing-pan-caja',         'nomada', 'Pan de caja',         'pza',   8.00, 'panaderia',  1.00, false, 'materia_prima'),
  ('nomada-ing-harina',           'nomada', 'Harina',              'kg',   22.00, 'panaderia',  1.00, false, 'materia_prima'),
  ('nomada-ing-granola',          'nomada', 'Granola',             'kg',  120.00, 'granos',     1.00, false, 'materia_prima'),
  -- Insumos de café
  ('nomada-ing-azucar',           'nomada', 'Azúcar',              'kg',   28.00, 'insumos',    1.00, false, 'materia_prima'),
  ('nomada-ing-chocolate-polvo',  'nomada', 'Chocolate en polvo',  'kg',  145.00, 'insumos',    1.00, false, 'materia_prima'),
  ('nomada-ing-vainilla',         'nomada', 'Vainilla',            'ml',    2.50, 'insumos',    1.00, false, 'materia_prima'),
  -- Quesos
  ('nomada-ing-queso-manchego',   'nomada', 'Queso manchego',      'kg',  180.00, 'lacteos',   0.90, false, 'materia_prima');

DO $$
DECLARE cnt integer;
BEGIN
  SELECT count(*) INTO cnt FROM pos_ingredients WHERE client_id = 'nomada';
  IF cnt <> 20 THEN
    RAISE EXCEPTION 'v1_ingredients: expected 20 rows for nomada, got %', cnt;
  END IF;
  RAISE NOTICE 'v1_ingredients OK: % ingredients for nomada', cnt;
END $$;
