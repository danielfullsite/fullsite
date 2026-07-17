-- =============================================================================
-- MIGRACIÓN: Sub-recetas + Factor de rendimiento + Conversiones
-- Versión: 1.1 (corregida post-review Daniel)
-- Fecha: 2026-07-17
--
-- CORRECCIONES v1.1:
--   1. RLS: escrituras solo via service_role, NO anon
--   2. yield_factor semántica: decimal 0-1 (0.90 = 90% rendimiento), NO porcentaje
--   3. Query POST 7.3: paréntesis en LIKE
--   4. Rollback: documenta que NULL→1 no se revierte
--
-- PREREQUISITO: Ejecutar PRE-checks y validar resultados antes de continuar
-- IMPACTO RUNTIME: CERO — solo crea estructuras nuevas y agrega columnas opcionales
-- =============================================================================

BEGIN;

-- ─── 1. EXTENDER pos_ingredients ─────────────────────────────────────────────

-- yield_factor: semántica = factor de conversión decimal
--   < 1 = merma (0.90 = pierde 10%, cáscara/hueso)
--   = 1 = sin cambio
--   > 1 = expansión (2.5 = frijol seco rinde 2.5x al cocinar)
-- El código existente (/costos/page.tsx) interpreta: realCost = cost / yf
-- PRE-CHECK: 1050 rows, 0 NULLs, min=0.43, max=2.5, 1 valor >1 (frijol negro)
ALTER TABLE pos_ingredients
  ALTER COLUMN yield_factor SET DEFAULT 1;

-- Constraint: yield_factor debe ser > 0 (sin límite superior — expansión es válida)
DO $$ BEGIN
  ALTER TABLE pos_ingredients ADD CONSTRAINT chk_yield_factor_positive
    CHECK (yield_factor > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- product_type (materia_prima | producto_terminado | subproducto | indirecto)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'materia_prima';

DO $$ BEGIN
  ALTER TABLE pos_ingredients ADD CONSTRAINT chk_product_type_valid
    CHECK (product_type IN ('materia_prima', 'producto_terminado', 'subproducto', 'indirecto'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- department (agrupación operativa)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS department text;

-- is_critical (flag para productos cuya falta afecta el menú)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;

-- sale_price (precio para venta a terceros)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 0;

-- SAT keys (para facturación)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_product_key text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_unit_key text;


-- ─── 2. CREAR pos_sub_recipes ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_sub_recipes (
  id text PRIMARY KEY DEFAULT 'sub-' || gen_random_uuid()::text,
  client_id text NOT NULL DEFAULT 'amalay',
  name text NOT NULL,
  yield_quantity numeric NOT NULL DEFAULT 1,
  yield_unit text NOT NULL DEFAULT 'KG',
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT chk_sub_yield_positive CHECK (yield_quantity > 0),
  CONSTRAINT chk_sub_yield_unit_not_empty CHECK (yield_unit <> ''),
  CONSTRAINT uq_sub_recipes_client_name UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sub_recipes_client
  ON pos_sub_recipes(client_id);

COMMENT ON TABLE pos_sub_recipes IS 'Sub-recetas (salsas, bases, preparaciones). Costo SIEMPRE derivado, nunca persistido.';


-- ─── 3. CREAR pos_sub_recipe_ingredients ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_sub_recipe_ingredients (
  id bigserial PRIMARY KEY,
  sub_recipe_id text NOT NULL REFERENCES pos_sub_recipes(id) ON DELETE CASCADE,
  ingredient_id text NOT NULL,
  ingredient_type text NOT NULL DEFAULT 'ingredient',
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'KG',
  created_at timestamptz DEFAULT now(),

  CONSTRAINT chk_sri_type CHECK (ingredient_type IN ('ingredient', 'sub_recipe')),
  CONSTRAINT chk_sri_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_sri_unit_not_empty CHECK (unit <> ''),
  CONSTRAINT chk_sri_no_self_ref CHECK (
    ingredient_type != 'sub_recipe' OR ingredient_id != sub_recipe_id
  )
);

CREATE INDEX IF NOT EXISTS idx_sri_sub_recipe
  ON pos_sub_recipe_ingredients(sub_recipe_id);
CREATE INDEX IF NOT EXISTS idx_sri_ingredient
  ON pos_sub_recipe_ingredients(ingredient_id);

COMMENT ON COLUMN pos_sub_recipe_ingredients.ingredient_type
  IS 'ingredient = materia prima de pos_ingredients, sub_recipe = otra sub-receta de pos_sub_recipes';
COMMENT ON CONSTRAINT chk_sri_no_self_ref ON pos_sub_recipe_ingredients
  IS 'Impide self-reference directa. Ciclos indirectos se validan en API server-side.';


-- ─── 4. EXTENDER pos_recipes_old ─────────────────────────────────────────────

ALTER TABLE pos_recipes_old ADD COLUMN IF NOT EXISTS ingredient_type text DEFAULT 'ingredient';

DO $$ BEGIN
  ALTER TABLE pos_recipes_old ADD CONSTRAINT chk_recipe_ingredient_type
    CHECK (ingredient_type IN ('ingredient', 'sub_recipe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─── 5. CREAR pos_unit_conversions (solo conversiones físicas) ───────────────

CREATE TABLE IF NOT EXISTS pos_unit_conversions (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric NOT NULL,
  is_system boolean DEFAULT false,

  CONSTRAINT chk_uc_factor_positive CHECK (factor > 0),
  CONSTRAINT chk_uc_different_units CHECK (from_unit <> to_unit),
  CONSTRAINT chk_uc_units_not_empty CHECK (from_unit <> '' AND to_unit <> ''),
  CONSTRAINT uq_uc_client_units UNIQUE (client_id, from_unit, to_unit)
);

COMMENT ON TABLE pos_unit_conversions IS 'Conversiones FISICAS entre unidades. NO mezclar con presentaciones comerciales.';

INSERT INTO pos_unit_conversions (client_id, from_unit, to_unit, factor, is_system) VALUES
('amalay', 'KG', 'GR', 1000, true),
('amalay', 'GR', 'KG', 0.001, true),
('amalay', 'GL', 'LT', 3.7854, true),
('amalay', 'GL', 'ML', 3785.4, true),
('amalay', 'LT', 'OZ', 33.8148, true),
('amalay', 'LT', 'ML', 1000, true),
('amalay', 'ML', 'LT', 0.001, true),
('amalay', 'OZ', 'LT', 0.0296, true)
ON CONFLICT (client_id, from_unit, to_unit) DO NOTHING;


-- ─── 6. CREAR pos_presentations (solo comercial) ────────────────────────────

CREATE TABLE IF NOT EXISTS pos_presentations (
  id text PRIMARY KEY DEFAULT 'pres-' || gen_random_uuid()::text,
  client_id text NOT NULL DEFAULT 'amalay',
  code text NOT NULL,
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT chk_pres_code_not_empty CHECK (code <> ''),
  CONSTRAINT uq_pres_client_code UNIQUE (client_id, code)
);

COMMENT ON TABLE pos_presentations IS 'Presentaciones COMERCIALES de compra (CAJA 15KG, BIDON 20LT). NO son conversiones fisicas.';


-- ─── 7. CREAR pos_ingredient_presentations ──────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_ingredient_presentations (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  ingredient_id text NOT NULL,
  presentation_id text NOT NULL REFERENCES pos_presentations(id) ON DELETE CASCADE,
  contains_quantity numeric NOT NULL,
  contains_unit text NOT NULL,
  cost_per_presentation numeric DEFAULT 0,
  supplier_id text,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT chk_ip_quantity_positive CHECK (contains_quantity > 0),
  CONSTRAINT chk_ip_unit_not_empty CHECK (contains_unit <> ''),
  CONSTRAINT chk_ip_cost_non_negative CHECK (cost_per_presentation >= 0),
  CONSTRAINT uq_ip_client_ingredient_pres UNIQUE (client_id, ingredient_id, presentation_id)
);

CREATE INDEX IF NOT EXISTS idx_ip_ingredient
  ON pos_ingredient_presentations(ingredient_id);

COMMENT ON TABLE pos_ingredient_presentations IS 'Vinculo producto-presentacion con equivalencia. Ej: ACEITE OLIVA en BOTE 3.8LT = 3.8 LT.';


-- ─── 8. RLS — lectura abierta, escritura solo service_role ──────────────────

-- pos_sub_recipes
ALTER TABLE pos_sub_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sub_recipes_select ON pos_sub_recipes;
DROP POLICY IF EXISTS rls_sub_recipes_service ON pos_sub_recipes;
CREATE POLICY rls_sub_recipes_select ON pos_sub_recipes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_sub_recipes_service ON pos_sub_recipes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- pos_sub_recipe_ingredients
ALTER TABLE pos_sub_recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sri_select ON pos_sub_recipe_ingredients;
DROP POLICY IF EXISTS rls_sri_service ON pos_sub_recipe_ingredients;
CREATE POLICY rls_sri_select ON pos_sub_recipe_ingredients
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_sri_service ON pos_sub_recipe_ingredients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- pos_unit_conversions
ALTER TABLE pos_unit_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_uc_select ON pos_unit_conversions;
DROP POLICY IF EXISTS rls_uc_service ON pos_unit_conversions;
CREATE POLICY rls_uc_select ON pos_unit_conversions
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_uc_service ON pos_unit_conversions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- pos_presentations
ALTER TABLE pos_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_pres_select ON pos_presentations;
DROP POLICY IF EXISTS rls_pres_service ON pos_presentations;
CREATE POLICY rls_pres_select ON pos_presentations
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_pres_service ON pos_presentations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- pos_ingredient_presentations
ALTER TABLE pos_ingredient_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ip_select ON pos_ingredient_presentations;
DROP POLICY IF EXISTS rls_ip_service ON pos_ingredient_presentations;
CREATE POLICY rls_ip_select ON pos_ingredient_presentations
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_ip_service ON pos_ingredient_presentations
  FOR ALL TO service_role USING (true) WITH CHECK (true);


COMMIT;
