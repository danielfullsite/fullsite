# Migración: Sub-recetas + Factor de Rendimiento + Conversiones

> Gate técnico antes de ejecución.
> No se ejecuta hasta que Daniel dé el OK a este documento completo.

---

## 1. Auditoría del esquema actual

### pos_ingredients (existe en producción)

| Columna | Tipo | Constraint | Origen |
|---|---|---|---|
| id | text | PK | CREATE TABLE |
| client_id | text | DEFAULT 'amalay', parte de uq_ingredients_client_id | CREATE TABLE |
| name | text | NOT NULL | CREATE TABLE |
| unit | text | NOT NULL | CREATE TABLE |
| cost_per_unit | numeric | DEFAULT 0 | CREATE TABLE |
| category | text | nullable | CREATE TABLE |
| active | boolean | DEFAULT true | CREATE TABLE |
| created_at | timestamptz | DEFAULT now() | CREATE TABLE |
| supplier | text | nullable | Agregado post-creación (sin DDL en repo) |
| yield_factor | numeric | nullable (sin DEFAULT) | Agregado post-creación (sin DDL en repo) |

**Constraint existente:** `uq_ingredients_client_id UNIQUE(client_id, id)` (de migration-r1-canonical-inventory.sql)

**RLS:** No habilitado (no aparece en rls_tighten_policies.sql)

**Consumidores:** 12 archivos leen, 3 archivos escriben (ver auditoría completa arriba)

### pos_recipes_old (existe — tabla relacional de recetas)

| Columna | Tipo | Constraint | Origen |
|---|---|---|---|
| id | bigserial | PK | 02-recetas.sql |
| client_id | text | DEFAULT 'amalay' | 02-recetas.sql |
| menu_item_id | text | NOT NULL | 02-recetas.sql |
| menu_item_name | text | nullable | 02-recetas.sql |
| ingredient_id | text | NOT NULL | 02-recetas.sql |
| quantity | numeric | DEFAULT 0 | 02-recetas.sql |
| unit | text | DEFAULT 'kg' | 02-recetas.sql |

**Constraint existente:** `UNIQUE(client_id, menu_item_id, ingredient_id)`

**RLS:** Habilitado con policies anon_read/insert/update/delete (02-recetas.sql)

**Consumidores:** 8 archivos leen, 5 archivos escriben

### pos_recipes (existe — tabla Excel food-cost, NO relacional)

| Columna | Tipo | Notas |
|---|---|---|
| nombre | text | Nombre del platillo (lookup key) |
| precio_venta | numeric | Precio de venta |
| costo_total | numeric | Costo total de la receta |
| pct_costo | numeric | % de food cost |
| ingredientes | jsonb | Lista de ingredientes como JSON |
| category | text | nullable |
| client_id | text | DEFAULT 'amalay' |

**No confundir:** esta tabla NO se modifica en esta migración.

### Tablas nuevas (no existen)
- pos_sub_recipes: NO existe
- pos_sub_recipe_ingredients: NO existe
- pos_unit_conversions: NO existe
- pos_presentations: NO existe
- pos_ingredient_presentations: NO existe

### r1_reconcile_order
No referencia pos_ingredients ni pos_recipes_old. Opera sobre pos_recipe_versions + pos_recipe_lines + pos_inventory. **Esta migración no afecta R1.**

---

## 2. Decisiones pre-migración

### yield_factor ya existe → reusar, no duplicar

El campo `yield_factor` ya existe en `pos_ingredients` y es leído por `/costos/page.tsx`. Es el mismo concepto que `default_yield` del diseño. **Decisión: reusar `yield_factor`**, agregar DEFAULT 100 y constraint, NO crear columna nueva.

Renombrar a `default_yield` sería un breaking change para los consumidores existentes. No vale la pena.

### pos_recipes_old es la tabla a extender

Se agrega `ingredient_type` a `pos_recipes_old` (no a `pos_recipes`). Los consumidores existentes no se rompen porque el DEFAULT es 'ingredient' (comportamiento actual).

### product_type como campo nuevo

`pos_ingredients.category` ya existe con valores como 'proteina', 'lacteo', 'vegetal'. `product_type` es un concepto diferente (materia_prima vs subproducto vs producto_terminado vs indirecto). Se agrega como columna nueva sin tocar `category`.

---

## 3. Riesgos detectados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| yield_factor tiene valores inconsistentes en prod | Media | Bajo | Query de verificación pre-migración detecta valores fuera de rango |
| ALTER TABLE pos_ingredients falla por lock | Baja | Medio | Ejecutar en horario bajo (madrugada) con statement_timeout |
| ADD CONSTRAINT en tabla con datos violantes | Media | Medio | Verificar con queries antes de agregar constraints |
| pos_recipes_old tiene rows que violarían ingredient_type constraint | Nula | Nulo | DEFAULT 'ingredient' cubre todos los rows existentes |
| Código existente que hace SELECT * se rompe | Nula | Nulo | Columnas nuevas son nullable o tienen DEFAULT — SELECT * sigue funcionando |

---

## 4. Queries de verificación PRE-migración

```sql
-- 4.1 Verificar que yield_factor existe y sus valores actuales
SELECT
  count(*) as total,
  count(yield_factor) as con_yield,
  count(*) - count(yield_factor) as sin_yield,
  min(yield_factor) as min_yield,
  max(yield_factor) as max_yield,
  count(*) FILTER (WHERE yield_factor <= 0) as yield_invalido,
  count(*) FILTER (WHERE yield_factor > 100) as yield_mayor_100
FROM pos_ingredients
WHERE client_id = 'amalay';

-- 4.2 Verificar que no existen las tablas nuevas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('pos_sub_recipes', 'pos_sub_recipe_ingredients',
                     'pos_unit_conversions', 'pos_presentations',
                     'pos_ingredient_presentations');

-- 4.3 Verificar columnas actuales de pos_ingredients
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'pos_ingredients' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 4.4 Verificar columnas actuales de pos_recipes_old
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'pos_recipes_old' AND table_schema = 'public'
ORDER BY ordinal_position;

-- 4.5 Verificar constraints existentes
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name IN ('pos_ingredients', 'pos_recipes_old')
  AND table_schema = 'public';

-- 4.6 Contar rows existentes (para verificación post)
SELECT 'pos_ingredients' as tbl, count(*) FROM pos_ingredients WHERE client_id = 'amalay'
UNION ALL
SELECT 'pos_recipes_old', count(*) FROM pos_recipes_old WHERE client_id = 'amalay';
```

---

## 5. SQL de migración (idempotente)

```sql
-- =============================================================================
-- MIGRACIÓN: Sub-recetas + Factor de rendimiento + Conversiones
-- Versión: 1.0
-- Fecha: 2026-07-17
-- Prerequisito: Ejecutar queries de verificación (sección 4) y validar resultados
-- Impacto runtime: CERO — solo crea estructuras nuevas y agrega columnas opcionales
-- =============================================================================

BEGIN;

-- ─── 5.1 EXTENDER pos_ingredients ────────────────────────────────────────────

-- yield_factor: agregar DEFAULT y constraint (columna ya existe)
ALTER TABLE pos_ingredients
  ALTER COLUMN yield_factor SET DEFAULT 100;

-- Llenar NULLs existentes con 100 (sin merma) antes de agregar constraint
UPDATE pos_ingredients SET yield_factor = 100 WHERE yield_factor IS NULL;

-- Constraint: yield_factor debe ser > 0 y <= 100
DO $$ BEGIN
  ALTER TABLE pos_ingredients ADD CONSTRAINT chk_yield_factor_range
    CHECK (yield_factor > 0 AND yield_factor <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- product_type (materia_prima | producto_terminado | subproducto | indirecto)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'materia_prima';

DO $$ BEGIN
  ALTER TABLE pos_ingredients ADD CONSTRAINT chk_product_type_valid
    CHECK (product_type IN ('materia_prima', 'producto_terminado', 'subproducto', 'indirecto'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- department (agrupación operativa — ABARROTES, FRUTAS Y VERDURAS, etc.)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS department text;

-- is_critical (flag para productos cuya falta afecta el menú)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;

-- sale_price (precio para venta a terceros)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 0;

-- SAT keys (para facturación)
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_product_key text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_unit_key text;


-- ─── 5.2 CREAR pos_sub_recipes ───────────────────────────────────────────────

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


-- ─── 5.3 CREAR pos_sub_recipe_ingredients ────────────────────────────────────

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
COMMENT ON COLUMN pos_sub_recipe_ingredients.ingredient_id
  IS 'FK lógica a pos_ingredients.id (si type=ingredient) o pos_sub_recipes.id (si type=sub_recipe). No es FK física para permitir polimorfismo.';
COMMENT ON CONSTRAINT chk_sri_no_self_ref ON pos_sub_recipe_ingredients
  IS 'Impide que una sub-receta se referencie directamente a sí misma. Los ciclos indirectos se validan en la API.';


-- ─── 5.4 EXTENDER pos_recipes_old ────────────────────────────────────────────

ALTER TABLE pos_recipes_old ADD COLUMN IF NOT EXISTS ingredient_type text DEFAULT 'ingredient';

DO $$ BEGIN
  ALTER TABLE pos_recipes_old ADD CONSTRAINT chk_recipe_ingredient_type
    CHECK (ingredient_type IN ('ingredient', 'sub_recipe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─── 5.5 CREAR pos_unit_conversions (solo conversiones físicas) ──────────────

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

COMMENT ON TABLE pos_unit_conversions IS 'Conversiones FÍSICAS entre unidades de medida. NO mezclar con presentaciones comerciales.';
COMMENT ON COLUMN pos_unit_conversions.is_system IS 'true = conversión estándar no editable (KG↔GR, LT↔ML)';

-- Seed conversiones estándar
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


-- ─── 5.6 CREAR pos_presentations (solo comercial) ───────────────────────────

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

COMMENT ON TABLE pos_presentations IS 'Presentaciones COMERCIALES de compra (CAJA 15KG, BIDON 20LT). NO son conversiones físicas.';


-- ─── 5.7 CREAR pos_ingredient_presentations ─────────────────────────────────

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

COMMENT ON TABLE pos_ingredient_presentations IS 'Vínculo producto-presentación con equivalencia. Ej: ACEITE OLIVA en BOTE 3.8LT = 3.8 LT.';


-- ─── 5.8 RLS para todas las tablas nuevas ────────────────────────────────────

-- pos_sub_recipes
ALTER TABLE pos_sub_recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sub_recipes_read ON pos_sub_recipes;
DROP POLICY IF EXISTS rls_sub_recipes_write ON pos_sub_recipes;
CREATE POLICY rls_sub_recipes_read ON pos_sub_recipes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_sub_recipes_write ON pos_sub_recipes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- pos_sub_recipe_ingredients
ALTER TABLE pos_sub_recipe_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sri_read ON pos_sub_recipe_ingredients;
DROP POLICY IF EXISTS rls_sri_write ON pos_sub_recipe_ingredients;
CREATE POLICY rls_sri_read ON pos_sub_recipe_ingredients FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_sri_write ON pos_sub_recipe_ingredients FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- pos_unit_conversions
ALTER TABLE pos_unit_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_uc_read ON pos_unit_conversions;
DROP POLICY IF EXISTS rls_uc_write ON pos_unit_conversions;
CREATE POLICY rls_uc_read ON pos_unit_conversions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_uc_write ON pos_unit_conversions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- pos_presentations
ALTER TABLE pos_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_pres_read ON pos_presentations;
DROP POLICY IF EXISTS rls_pres_write ON pos_presentations;
CREATE POLICY rls_pres_read ON pos_presentations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_pres_write ON pos_presentations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- pos_ingredient_presentations
ALTER TABLE pos_ingredient_presentations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ip_read ON pos_ingredient_presentations;
DROP POLICY IF EXISTS rls_ip_write ON pos_ingredient_presentations;
CREATE POLICY rls_ip_read ON pos_ingredient_presentations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls_ip_write ON pos_ingredient_presentations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


COMMIT;
```

---

## 6. SQL de rollback (parcialmente reversible)

**Excepción honesta:** El UPDATE de `yield_factor` NULL→1 NO se revierte. Los NULLs originales se pierden porque no se preservan en ningún lado. Esto es aceptable: NULL en yield_factor era un dato faltante (no un dato significativo). El código existente ya hacía `Number(yield_factor) || 1` como fallback, así que el comportamiento efectivo no cambia.

```sql
-- =============================================================================
-- ROLLBACK: Revertir migración sub-recetas + rendimiento
-- Ejecutar SOLO si la migración causa problemas
-- NOTA: yield_factor NULL→1 NO se revierte (ver documentación arriba)
-- =============================================================================

BEGIN;

-- Revertir tablas nuevas (orden por FKs)
DROP TABLE IF EXISTS pos_ingredient_presentations CASCADE;
DROP TABLE IF EXISTS pos_presentations CASCADE;
DROP TABLE IF EXISTS pos_unit_conversions CASCADE;
DROP TABLE IF EXISTS pos_sub_recipe_ingredients CASCADE;
DROP TABLE IF EXISTS pos_sub_recipes CASCADE;

-- Revertir columnas nuevas de pos_ingredients
-- (NO revertir yield_factor — existía antes de la migración)
-- (NO revertir NULL→1 — NULLs eran datos faltantes, no significativos)
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS product_type;
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS department;
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS is_critical;
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS sale_price;
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS sat_product_key;
ALTER TABLE pos_ingredients DROP COLUMN IF EXISTS sat_unit_key;

-- Revertir constraint de yield_factor (mantener DEFAULT 1 — es mejora sin riesgo)
ALTER TABLE pos_ingredients DROP CONSTRAINT IF EXISTS chk_yield_factor_positive;

-- Revertir columna nueva de pos_recipes_old
ALTER TABLE pos_recipes_old DROP COLUMN IF EXISTS ingredient_type;
ALTER TABLE pos_recipes_old DROP CONSTRAINT IF EXISTS chk_recipe_ingredient_type;

COMMIT;
```

---

## 7. Queries de verificación POST-migración

```sql
-- 7.1 Verificar tablas nuevas existen
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('pos_sub_recipes', 'pos_sub_recipe_ingredients',
                     'pos_unit_conversions', 'pos_presentations',
                     'pos_ingredient_presentations')
ORDER BY table_name;
-- Esperado: 5 rows

-- 7.2 Verificar columnas nuevas en pos_ingredients
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'pos_ingredients' AND table_schema = 'public'
  AND column_name IN ('yield_factor', 'product_type', 'department',
                      'is_critical', 'sale_price', 'sat_product_key', 'sat_unit_key')
ORDER BY column_name;
-- Esperado: 7 rows

-- 7.3 Verificar constraints nuevos
SELECT constraint_name, table_name
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND constraint_name LIKE 'chk_%' OR constraint_name LIKE 'uq_%'
ORDER BY table_name, constraint_name;

-- 7.4 Verificar que yield_factor no tiene NULLs
SELECT count(*) as nulls FROM pos_ingredients WHERE yield_factor IS NULL;
-- Esperado: 0

-- 7.5 Verificar conversiones seed
SELECT count(*) FROM pos_unit_conversions WHERE client_id = 'amalay' AND is_system = true;
-- Esperado: 8

-- 7.6 Verificar RLS está habilitado
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('pos_sub_recipes', 'pos_sub_recipe_ingredients',
                    'pos_unit_conversions', 'pos_presentations',
                    'pos_ingredient_presentations');
-- Esperado: 5 rows, todas con rowsecurity = true

-- 7.7 Verificar que pos_recipes_old tiene ingredient_type
SELECT column_name, column_default FROM information_schema.columns
WHERE table_name = 'pos_recipes_old' AND column_name = 'ingredient_type';
-- Esperado: 1 row, default 'ingredient'

-- 7.8 Verificar row counts no cambiaron
SELECT 'pos_ingredients' as tbl, count(*) FROM pos_ingredients WHERE client_id = 'amalay'
UNION ALL
SELECT 'pos_recipes_old', count(*) FROM pos_recipes_old WHERE client_id = 'amalay';
-- Esperado: mismos counts que pre-migración (sección 4.6)

-- 7.9 Verificar chk_sri_no_self_ref existe
SELECT constraint_name FROM information_schema.table_constraints
WHERE constraint_name = 'chk_sri_no_self_ref';
-- Esperado: 1 row
```

---

## 8. Impacto esperado en runtime

**CERO cambios de runtime.** La migración:

- NO modifica datos existentes (excepto yield_factor NULL → 100)
- NO cambia el comportamiento de ningún query existente
- NO activa deducciones nuevas
- NO conecta con r1_reconcile_order
- NO cambia los consumidores existentes (SELECT * sigue funcionando con columnas nuevas)
- NO renombra columnas ni tablas

Las nuevas tablas están vacías hasta que el Paso 2 (API) y Paso 3 (UI) los pueblen.

---

## 9. Dónde se ejecuta la validación anti-ciclos

**NO en la base de datos.** PostgreSQL no puede validar ciclos transitivos con un CHECK constraint.

**Sí en la API (server-side, transaccional):**

```
POST /api/sub-recipes/:id/ingredients

1. Iniciar transacción
2. Validar que ingredient_type es válido
3. Si ingredient_type == 'sub_recipe':
   a. Verificar que ingredient_id existe en pos_sub_recipes
   b. Ejecutar detección de ciclos (recursive CTE dentro de la transacción)
   c. Si ciclo detectado: ROLLBACK + error 400
4. INSERT pos_sub_recipe_ingredients
5. COMMIT
```

La DB protege contra self-reference directa (`chk_sri_no_self_ref`). Los ciclos indirectos (A→B→C→A) se validan en la API con el recursive CTE antes del INSERT, dentro de la misma transacción. Si el CTE detecta un ciclo, se hace ROLLBACK.

**Recursive CTE con protección anti-ciclos:**

```sql
-- Dado: quiero agregar sub_recipe_id=$child como ingrediente de sub_recipe_id=$parent
-- Verificar que $parent no sea descendiente de $child (lo que crearía un ciclo)

WITH RECURSIVE ancestors AS (
  -- Nivel 0: buscar quién contiene a $parent como ingrediente
  SELECT sri.sub_recipe_id as id, ARRAY[sri.sub_recipe_id] as path
  FROM pos_sub_recipe_ingredients sri
  WHERE sri.ingredient_id = $parent AND sri.ingredient_type = 'sub_recipe'

  UNION ALL

  -- Niveles siguientes: subir en el árbol
  SELECT sri.sub_recipe_id, a.path || sri.sub_recipe_id
  FROM pos_sub_recipe_ingredients sri
  JOIN ancestors a ON sri.ingredient_id = a.id AND sri.ingredient_type = 'sub_recipe'
  WHERE NOT (sri.sub_recipe_id = ANY(a.path))  -- protección anti-loop infinito
    AND array_length(a.path, 1) < 10           -- hard limit de profundidad
),
descendants AS (
  -- Nivel 0: hijos directos de $child
  SELECT sri.ingredient_id as id, ARRAY[sri.ingredient_id] as path
  FROM pos_sub_recipe_ingredients sri
  WHERE sri.sub_recipe_id = $child AND sri.ingredient_type = 'sub_recipe'

  UNION ALL

  -- Niveles siguientes: bajar en el árbol
  SELECT sri.ingredient_id, d.path || sri.ingredient_id
  FROM pos_sub_recipe_ingredients sri
  JOIN descendants d ON sri.sub_recipe_id = d.id AND sri.ingredient_type = 'sub_recipe'
  WHERE NOT (sri.ingredient_id = ANY(d.path))  -- protección anti-loop infinito
    AND array_length(d.path, 1) < 10           -- hard limit de profundidad
)
SELECT 'CYCLE' as result, path
FROM ancestors WHERE id = $child
UNION ALL
SELECT 'CYCLE', path
FROM descendants WHERE id = $parent;

-- Si retorna rows → ciclo detectado → ROLLBACK
-- Si retorna 0 rows → seguro → proceder con INSERT
```

**El CTE:**
- Incluye protección contra loops infinitos (`NOT ANY(path)`)
- Termina de forma determinista (hard limit de profundidad 10)
- Devuelve la ruta de dependencia (`path` array)
- Distingue dirección (ancestors vs descendants)
- Respeta client_id implícitamente (las sub-recetas son tenant-specific por su FK)

---

## 10. Lista de archivos que se modificarán DESPUÉS de esta migración

Esta migración SOLO crea la base de datos. Los siguientes archivos se modificarán en pasos posteriores:

### Paso 2 (API) — archivos nuevos:
- `dashboard-app/src/app/api/sub-recipes/route.ts` (CRUD + anti-ciclos)
- `dashboard-app/src/app/api/sub-recipes/[id]/ingredients/route.ts`
- `dashboard-app/src/app/api/unit-conversions/route.ts`
- `dashboard-app/src/app/api/presentations/route.ts`
- `dashboard-app/src/app/api/dependencies/[ingredientId]/route.ts`

### Paso 2 (API) — archivos existentes a modificar:
- `dashboard-app/src/lib/pos-data.ts` — agregar getSubRecipes(), calculateRecipeCost()
- `dashboard-app/src/app/api/food-cost/route.ts` — usar cálculo con yield + sub-recetas

### Paso 3 (UI) — archivos a modificar:
- `dashboard-app/src/app/recetas/page.tsx` — rediseñar con tabs
- `dashboard-app/src/app/costos/page.tsx` — mostrar yield_factor con nueva lógica
- `dashboard-app/src/app/food-cost/page.tsx` — integrar costo derivado

### Paso 4 (Inventario) — archivos a modificar:
- `dashboard-app/src/lib/pos-data.ts` — deducción con yield ajustado
- `dashboard-app/src/app/api/pos/save-order/route.ts` — deducción expandida

**Ninguno de estos cambios sucede en el Paso 1.** Este paso solo crea la base segura.

---

## 11. Pendientes registrados para Paso 2 (sin resolver todavía)

1. **Filtro explícito por client_id en todas las APIs y CTE** — cada query en las nuevas APIs debe incluir `WHERE client_id = $client_id`. El recursive CTE de dependencias debe filtrar por client_id en cada nivel para impedir referencias cruzadas entre tenants.

2. **Validación server-side de referencias polimórficas** — cuando `ingredient_type = 'sub_recipe'`, la API debe verificar que `ingredient_id` realmente existe en `pos_sub_recipes` (y con el mismo `client_id`). Cuando `ingredient_type = 'ingredient'`, verificar que existe en `pos_ingredients`. No depender de FK física.

3. **Protección de concurrencia para anti-ciclos** — el recursive CTE de detección de ciclos debe ejecutarse dentro de una transacción con `pg_advisory_xact_lock` sobre el client_id (hash). Esto previene que dos escrituras concurrentes creen un ciclo que ninguna detectó individualmente.

4. **Auditoría de referencias huérfanas** — crear un job periódico (o query bajo demanda) que detecte: (a) `pos_sub_recipe_ingredients` con `ingredient_id` que no existe en su tabla correspondiente, (b) `pos_recipes_old` con `ingredient_type = 'sub_recipe'` y `ingredient_id` que no existe en `pos_sub_recipes`.
