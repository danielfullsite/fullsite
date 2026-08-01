# Diseño: Sub-recetas + Factor de Rendimiento + Conversiones

> Basado en evidencia directa de Wansoft (screenshots Jul 17, 2026)
> y sesiones con Eduardo (Jul 7, Jul 16).
> Este documento es la referencia para implementar. No se escribe código sin leerlo.
>
> v2 — Ajustes arquitectónicos revisados por Daniel Jul 17.

---

## El problema que resolvemos

Un restaurante no puede saber cuánto le cuesta un platillo sin 3 cosas:

1. **Recetas con sub-recetas** — un platillo usa salsa bolognesa, la salsa tiene su propia receta con 12 ingredientes. Sin sub-recetas, o metes los 12 ingredientes en cada platillo que usa la salsa (insostenible) o el costo es mentira.

2. **Factor de rendimiento** — compras 1 kg de aguacate a $100, pero solo usas 900g (cáscara + hueso). El costo real por kg limpio es $111.11, no $100. Sin rendimiento, el food cost está subestimado en cada platillo que use productos naturales.

3. **Conversiones entre unidades** — la receta pide 0.5 LT de leche, el inventario está en ML, y se compra por CAJA. Sin conversiones, no puedes calcular cuánto inventario se consume ni cuánto cuesta.

Eduardo (Jul 16): "El factor de rendimiento es todo en lo que fallan los restaurantes. No saben que existe."

---

## Decisiones arquitectónicas (v2)

### D1: Costos siempre derivados, nunca persistidos

No se persiste cost_per_yield ni costo calculado de sub-recetas. Todos los costos se recalculan a partir del costo actual de los ingredientes base. Si el precio de la carne sube, el costo de la bolognesa se actualiza instantáneamente sin sync ni cache invalidation.

**Implicación:** Las queries de food cost son más pesadas (recorren el árbol de recetas). Aceptable para <5000 productos. Si escala, se agrega una vista materializada con refresh periódico — pero la fuente de verdad siempre es el cálculo en vivo.

### D2: Detección explícita de ciclos, no solo límite de profundidad

Al agregar un ingrediente tipo sub-receta a otra sub-receta, se valida que no se cree una referencia circular. Se recorre el árbol hacia arriba (ancestors) y se verifica que el sub-recipe que se está agregando no sea un ancestro.

```
validate_no_cycle(parent_sub_recipe_id, new_ingredient_sub_recipe_id):
  ancestors = get_all_ancestors(parent_sub_recipe_id)
  if new_ingredient_sub_recipe_id in ancestors:
    ERROR "Referencia circular: {name} ya es un ancestro de esta sub-receta"
```

### D3: yield como default, no verdad absoluta

El campo se llama `default_yield` (no `yield_percent`). Es el rendimiento estándar del ingrediente. Más adelante se podrá sobreescribir por:
- Lote específico (este proveedor entrega aguacates más grandes, rendimiento 92%)
- Proveedor (proveedor A da rendimiento 85%, proveedor B da 90%)
- Temporada (invierno el aguacate rinde menos)

Por ahora solo existe `default_yield`. El campo está nombrado para que la extensión sea natural sin migración.

### D4: Conversiones físicas separadas de presentaciones comerciales

Dos sistemas completamente separados:

**Conversiones físicas** (`pos_unit_conversions`): relaciones universales entre unidades de medida. KG↔GR, LT↔ML. No dependen del producto. Son leyes de física.

**Presentaciones comerciales** (`pos_presentations` + `pos_ingredient_presentations`): cómo se compra un producto específico. "ACEITE OLIVA viene en BOTE 3.8LT". Es un dato comercial que cambia por proveedor y por producto.

No se mezclan. Una conversión física nunca referencia un producto. Una presentación siempre referencia un producto.

### D5: Modelo compatible con versionado de recetas (sin implementar)

Las recetas NO tienen campo `version` hoy. Pero el modelo permite agregarlo sin migración destructiva:
- `pos_sub_recipes` y `pos_recipes` usan `id` como PK (no nombre)
- Versionado futuro: agregar `version int DEFAULT 1` + `effective_from date` + constraint unique(client_id, name, version)
- Las órdenes históricas referencian `recipe_id` (PK inmutable), no nombre
- Al crear una nueva versión, se crea un nuevo row con nuevo id — las órdenes viejas siguen apuntando al id original

**Regla: nunca usar `recipe_name` como foreign key.** Siempre `recipe_id`.

### D6: Grafo de dependencias para recalcular costos

Al cambiar el costo de un ingrediente, necesitamos saber:
1. Qué sub-recetas lo usan → recalcular su costo
2. Qué platillos usan esas sub-recetas → recalcular su costo
3. Si algún platillo cruza el umbral de food cost → generar alerta

Esto se resuelve con una query recursiva, no con una tabla de dependencias:

```sql
-- Dado un ingredient_id, encontrar todos los platillos afectados:
WITH RECURSIVE deps AS (
  -- Sub-recetas que usan este ingrediente directamente
  SELECT sub_recipe_id FROM pos_sub_recipe_ingredients WHERE ingredient_id = $1
  UNION
  -- Sub-recetas que usan sub-recetas del nivel anterior
  SELECT sri.sub_recipe_id FROM pos_sub_recipe_ingredients sri
  JOIN deps d ON sri.ingredient_id = d.sub_recipe_id AND sri.ingredient_type = 'sub_recipe'
)
-- Platillos que usan cualquiera de estas sub-recetas (o el ingrediente directo)
SELECT DISTINCT r.item_id FROM pos_recipes r
WHERE r.ingredient_id = $1
   OR (r.ingredient_type = 'sub_recipe' AND r.ingredient_id IN (SELECT sub_recipe_id FROM deps));
```

No se persiste el grafo. Se recalcula on-demand cuando un precio cambia. Es O(ingredientes × profundidad) que para <5000 productos es <100ms.

---

## Evidencia de Wansoft

### Sub-receta: SUB SALSA BOLOGNESA
- Rendimiento: 2.5 KG
- 12 ingredientes (laurel 0.003kg, pimienta 0.003kg, tomate pelati 0.8kg, carne molida 1kg, vino tinto 0.5L, orégano 0.001kg, sal 0.01kg, tomate guaje 0.6kg, zanahoria 0.2kg, aceite oliva 0.08kg, apio 0.2kg, ajo pelado 0.08kg)
- Mezcla unidades: kg y litros en la misma receta

### Sub-receta: AMALAY - GALLETAS BOTE DE 420G
- Rendimiento: 1 Pieza (PZ)
- 3 ingredientes incluyendo SUB GALLETA AMALAY A GRANEL (sub-receta anidada)

### Receta de platillo: CHILAQUILES ($34.93)
- 8 ingredientes, incluyendo "SUB FRIJOLES COCIDOS REFRITOS" (0.13 KG, $3.23)
- El subproducto aparece como ingrediente normal — misma estructura

### Producto: AGUACATE (FYV001)
- Rendimiento: 90% → costo limpio = $100 / 0.90 = $111.11/KG
- Flag "Crítico": checked

### Tipos de producto: materia_prima, producto_terminado, subproducto, indirecto
### Conversiones: KG↔GR, GL↔LT, LT↔ML↔OZ (bidireccionales)
### Presentaciones: CAJA 15KG, BIDON 20LT, BOTE 3.8LT, etc. (etiquetas con asignación por producto)
### 19 unidades de medida: KG, GR, GL, LT, ML, OZ, PZ, MJ, LA, PQ, BL, CJ, BT, VA, TA, POR, REB, BTA, PZA

---

## Modelo de datos

### Cambios a tabla existente: `pos_ingredients`

```sql
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS default_yield numeric DEFAULT 100;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'materia_prima';
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS cost_per_unit numeric DEFAULT 0;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 0;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_product_key text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_unit_key text;

COMMENT ON COLUMN pos_ingredients.default_yield IS 'Factor de rendimiento por defecto (%). 100=sin merma, 90=10% merma. Extensible a yield por lote/proveedor.';
COMMENT ON COLUMN pos_ingredients.product_type IS 'materia_prima | producto_terminado | subproducto | indirecto';
```

### Nueva tabla: `pos_sub_recipes`

```sql
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
  UNIQUE(client_id, name)
);

COMMENT ON TABLE pos_sub_recipes IS 'Sub-recetas (salsas, bases, preparaciones). El costo se calcula en vivo, nunca se persiste.';
```

### Nueva tabla: `pos_sub_recipe_ingredients`

```sql
CREATE TABLE IF NOT EXISTS pos_sub_recipe_ingredients (
  id bigserial PRIMARY KEY,
  sub_recipe_id text NOT NULL REFERENCES pos_sub_recipes(id) ON DELETE CASCADE,
  ingredient_id text NOT NULL,
  ingredient_type text NOT NULL DEFAULT 'ingredient',
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'KG',
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_ingredient_type CHECK (ingredient_type IN ('ingredient', 'sub_recipe'))
);

COMMENT ON COLUMN pos_sub_recipe_ingredients.ingredient_type IS 'ingredient = materia prima de pos_ingredients, sub_recipe = otra sub-receta de pos_sub_recipes';
COMMENT ON COLUMN pos_sub_recipe_ingredients.ingredient_id IS 'FK a pos_ingredients.id (si type=ingredient) o pos_sub_recipes.id (si type=sub_recipe)';
```

### Cambios a tabla existente: `pos_recipes`

```sql
ALTER TABLE pos_recipes ADD COLUMN IF NOT EXISTS ingredient_type text DEFAULT 'ingredient';

COMMENT ON COLUMN pos_recipes.ingredient_type IS 'ingredient = materia prima, sub_recipe = subproducto. Mismo patrón que pos_sub_recipe_ingredients.';

ALTER TABLE pos_recipes ADD CONSTRAINT valid_recipe_ingredient_type
  CHECK (ingredient_type IN ('ingredient', 'sub_recipe'));
```

### Nueva tabla: `pos_unit_conversions` (solo física)

```sql
CREATE TABLE IF NOT EXISTS pos_unit_conversions (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric NOT NULL,
  is_system boolean DEFAULT false,
  UNIQUE(client_id, from_unit, to_unit)
);

COMMENT ON TABLE pos_unit_conversions IS 'Conversiones FÍSICAS entre unidades de medida. NO mezclar con presentaciones comerciales.';
COMMENT ON COLUMN pos_unit_conversions.is_system IS 'true = conversión estándar (KG↔GR), no editable por el usuario';

INSERT INTO pos_unit_conversions (client_id, from_unit, to_unit, factor, is_system) VALUES
('amalay', 'KG', 'GR', 1000, true),
('amalay', 'GR', 'KG', 0.001, true),
('amalay', 'GL', 'LT', 3.7854, true),
('amalay', 'GL', 'ML', 3785.4, true),
('amalay', 'LT', 'OZ', 33.8148, true),
('amalay', 'LT', 'ML', 1000, true),
('amalay', 'ML', 'LT', 0.001, true),
('amalay', 'OZ', 'LT', 0.0296, true)
ON CONFLICT DO NOTHING;
```

### Nueva tabla: `pos_presentations` (solo comercial)

```sql
CREATE TABLE IF NOT EXISTS pos_presentations (
  id text PRIMARY KEY DEFAULT 'pres-' || gen_random_uuid()::text,
  client_id text NOT NULL DEFAULT 'amalay',
  code text NOT NULL,
  name text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, code)
);

COMMENT ON TABLE pos_presentations IS 'Presentaciones COMERCIALES de compra (CAJA 15KG, BIDON 20LT). NO son conversiones físicas.';
```

### Nueva tabla: `pos_ingredient_presentations` (vínculo producto ↔ presentación)

```sql
CREATE TABLE IF NOT EXISTS pos_ingredient_presentations (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  ingredient_id text NOT NULL,
  presentation_id text NOT NULL REFERENCES pos_presentations(id),
  contains_quantity numeric NOT NULL,
  contains_unit text NOT NULL,
  cost_per_presentation numeric DEFAULT 0,
  supplier_id text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, ingredient_id, presentation_id)
);

COMMENT ON TABLE pos_ingredient_presentations IS 'Cuánto contiene cada presentación para un producto específico. Ej: ACEITE OLIVA en BOTE 3.8LT contiene 3.8 LT.';
COMMENT ON COLUMN pos_ingredient_presentations.contains_quantity IS 'Cantidad de unidades base que contiene esta presentación';
COMMENT ON COLUMN pos_ingredient_presentations.contains_unit IS 'Unidad base (debe coincidir con la unidad del ingrediente o tener conversión)';
```

---

## Reglas de negocio

### Cálculo de costo limpio de ingrediente

```
costo_limpio(ingredient) =
  ingredient.cost_per_unit / (ingredient.default_yield / 100)

Ejemplo AGUACATE:
  cost_per_unit = $100/KG
  default_yield = 90
  costo_limpio = $100 / 0.90 = $111.11/KG
```

### Cálculo de costo de sub-receta (siempre derivado)

```
costo_sub_receta(sub_recipe) =
  SUM(
    for each ingredient in sub_recipe.ingredients:
      if ingredient.type == 'ingredient':
        quantity × convert_unit(ingredient.unit, base_unit) × costo_limpio(ingredient)
      elif ingredient.type == 'sub_recipe':
        quantity × costo_por_unidad(referenced_sub_recipe)
  )

costo_por_unidad(sub_recipe) = costo_sub_receta(sub_recipe) / sub_recipe.yield_quantity
```

### Cálculo de costo de platillo (siempre derivado)

```
costo_platillo(recipe) =
  SUM(
    for each ingredient in recipe.ingredients:
      if ingredient.type == 'ingredient':
        quantity × convert_unit(...) × costo_limpio(ingredient)
      elif ingredient.type == 'sub_recipe':
        quantity × costo_por_unidad(referenced_sub_recipe)
  )
```

### Deducción de inventario al enviar a cocina

```
Al enviar 1 CHILAQUILES:
  Para cada ingrediente de la receta:
    if type == 'ingredient':
      descontar = quantity / (default_yield / 100)  -- ajuste por merma
      descontar del inventario en la unidad correcta (con conversión si necesario)
    elif type == 'sub_recipe':
      descontar del inventario del subproducto
      (O expandir: recorrer la sub-receta y descontar ingredientes base)
```

### Validación anti-ciclos al agregar ingrediente a sub-receta

```
validate_no_cycle(parent_id, new_child_id):
  if new_child_id == parent_id: ERROR
  
  -- Recorrer hacia arriba: ¿quién usa parent_id como ingrediente?
  ancestors = set()
  queue = [parent_id]
  while queue:
    current = queue.pop()
    -- Buscar sub-recetas que contienen current como ingrediente
    parents = SELECT sub_recipe_id FROM pos_sub_recipe_ingredients
              WHERE ingredient_id = current AND ingredient_type = 'sub_recipe'
    for p in parents:
      if p == new_child_id: ERROR "Ciclo detectado"
      if p not in ancestors:
        ancestors.add(p)
        queue.append(p)
  
  -- También verificar hacia abajo: ¿new_child contiene parent como descendiente?
  descendants = set()
  queue = [new_child_id]
  while queue:
    current = queue.pop()
    children = SELECT ingredient_id FROM pos_sub_recipe_ingredients
               WHERE sub_recipe_id = current AND ingredient_type = 'sub_recipe'
    for c in children:
      if c == parent_id: ERROR "Ciclo detectado"
      if c not in descendants:
        descendants.add(c)
        queue.append(c)
```

### Grafo de dependencias para alertas de costo

```sql
-- Dado ingredient_id $1, encontrar todos los platillos afectados:
WITH RECURSIVE affected_sub_recipes AS (
  SELECT sub_recipe_id FROM pos_sub_recipe_ingredients
  WHERE ingredient_id = $1
  UNION
  SELECT sri.sub_recipe_id FROM pos_sub_recipe_ingredients sri
  JOIN affected_sub_recipes asr ON sri.ingredient_id = asr.sub_recipe_id
  AND sri.ingredient_type = 'sub_recipe'
)
SELECT DISTINCT r.item_id AS affected_dish
FROM pos_recipes r
WHERE r.ingredient_id = $1
   OR (r.ingredient_type = 'sub_recipe'
       AND r.ingredient_id IN (SELECT sub_recipe_id FROM affected_sub_recipes));
```

### Conversión de unidades (solo física)

```
convert(quantity, from_unit, to_unit):
  if from_unit == to_unit: return quantity
  
  -- Buscar conversión directa
  direct = SELECT factor FROM pos_unit_conversions
           WHERE from_unit = $from AND to_unit = $to
  if direct: return quantity × direct.factor
  
  -- Buscar conversión inversa
  inverse = SELECT factor FROM pos_unit_conversions
            WHERE from_unit = $to AND to_unit = $from
  if inverse: return quantity / inverse.factor
  
  ERROR "No existe conversión entre {from_unit} y {to_unit}"
```

---

## Dónde vive en Fullsite (UI)

### /recetas — rediseñada con tabs

**Tab 1: Recetas de platillos** (ya existe, se extiende)
- Dropdown platillo + lista de ingredientes
- Cada ingrediente puede ser materia prima O sub-receta
- Costo calculado en tiempo real (no persistido)
- "Agregar ingrediente" + "Agregar conversión" (como Wansoft)

**Tab 2: Sub-recetas** (nuevo)
- CRUD de sub-recetas
- Rendimiento (cantidad + unidad)
- Lista de ingredientes (materia prima o sub-receta anidada)
- Validación anti-ciclos al agregar
- Costo calculado en tiempo real
- Carga masiva por Excel

**Tab 3: Ingredientes** (nuevo — vista enriquecida de pos_ingredients)
- Tabla con: código, nombre, unidad, departamento, tipo, yield, costo, crítico
- Editar yield por ingrediente
- Filtrar por departamento, tipo, crítico
- Flag visual: "sin rendimiento configurado" para ingredientes naturales

**Tab 4: Conversiones** (nuevo)
- Conversiones físicas (sistema + custom)
- Sistema no editable (KG↔GR)
- Custom para unidades del restaurante

**Tab 5: Presentaciones** (nuevo)
- Presentaciones comerciales con asignación por producto
- Precio por presentación

---

## Qué mejoramos vs Wansoft

1. **Costos siempre actualizados** — Wansoft persiste "Costo presupuestado: $34.93". Si el proveedor sube precios, el costo del platillo sigue mostrando $34.93 hasta que alguien lo recalcule. Fullsite recalcula en vivo.

2. **Alerta automática por cambio de costo** — Si el precio de la carne sube, Fullsite recorre el grafo de dependencias y alerta: "15 platillos afectados, food cost promedio subió de 28% a 32%."

3. **Simulador de precios** — Eduardo: "dado que quiero 25% de food cost, ¿a cuánto debería vender este platillo?" Input: receta + % objetivo. Output: precio sugerido.

4. **Yield sugerido por IA** — Para vegetales/proteínas estándar, sugerir factores típicos. El usuario confirma o ajusta.

5. **Detección de ciclos** — Wansoft no valida referencias circulares en sub-recetas. Fullsite las bloquea antes de guardar.

6. **Sub-receta visible en POS** — Eduardo pidió (Jul 7): ver receta desde POS para alérgenos y capacitación. Fullsite puede expandir la receta incluyendo sub-recetas.

---

## Orden de implementación

### Paso 1: SQL (modelo de datos)
- ALTER pos_ingredients (default_yield, product_type, department, is_critical, cost_per_unit, sale_price, sat keys)
- CREATE pos_sub_recipes
- CREATE pos_sub_recipe_ingredients (con constraint de ingredient_type)
- ALTER pos_recipes (ingredient_type con constraint)
- CREATE pos_unit_conversions + seed datos estándar
- CREATE pos_presentations + pos_ingredient_presentations
- RLS policies para todas las tablas nuevas

### Paso 2: API
- CRUD /api/sub-recipes (con validación anti-ciclos)
- GET /api/ingredients?include=yield (ingredientes con rendimiento)
- GET /api/food-cost/calculate (cálculo con sub-recetas y rendimiento)
- PATCH /api/ingredients/:id (actualizar yield, tipo, departamento)
- GET /api/dependencies/:ingredient_id (grafo de platillos afectados)
- CRUD /api/unit-conversions
- CRUD /api/presentations

### Paso 3: UI — /recetas rediseñada con tabs
- Tab Sub-recetas: CRUD con lista de ingredientes + validación ciclos
- Tab Ingredientes: editar yield, tipo, departamento, crítico
- Tab Conversiones: tabla editable (sistema protegido)
- Tab Presentaciones: CRUD con asignación por producto
- Costo calculado en tiempo real en todas las tabs

### Paso 4: Integrar con food-cost
- /food-cost usa cálculo con rendimiento y sub-recetas
- Alertas de variación recalculan con grafo de dependencias
- Simulador de precios (input: receta + % objetivo → precio sugerido)

### Paso 5: Integrar con inventario
- Deducción al enviar a cocina respeta default_yield
- Opción de expandir sub-recetas a ingredientes base para deducción
- Alerta si el inventario no alcanza para la producción programada

---

> No se implementa sin que Daniel dé el OK a este documento v2.
> Cada decisión está respaldada por evidencia directa de Wansoft
> y ajustada con las decisiones arquitectónicas de Daniel.
