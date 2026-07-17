# Diseño: Sub-recetas + Factor de Rendimiento + Conversiones

> Basado en evidencia directa de Wansoft (screenshots Jul 17, 2026)
> y sesiones con Eduardo (Jul 7, Jul 16).
> Este documento es la referencia para implementar. No se escribe código sin leerlo.

---

## El problema que resolvemos

Un restaurante no puede saber cuánto le cuesta un platillo sin 3 cosas:

1. **Recetas con sub-recetas** — un platillo usa salsa bolognesa, la salsa tiene su propia receta con 12 ingredientes. Sin sub-recetas, o metes los 12 ingredientes en cada platillo que usa la salsa (insostenible) o el costo es mentira.

2. **Factor de rendimiento** — compras 1 kg de aguacate a $100, pero solo usas 900g (cáscara + hueso). El costo real por kg limpio es $111.11, no $100. Sin rendimiento, el food cost está subestimado en cada platillo que use productos naturales.

3. **Conversiones entre unidades** — la receta pide 0.5 LT de leche, el inventario está en ML, y se compra por CAJA. Sin conversiones, no puedes calcular cuánto inventario se consume ni cuánto cuesta.

Eduardo (Jul 16): "El factor de rendimiento es todo en lo que fallan los restaurantes. No saben que existe."

---

## Evidencia de Wansoft

### Sub-receta: SUB SALSA BOLOGNESA
- Rendimiento: 2.5 KG
- 12 ingredientes (laurel 0.003kg, pimienta 0.003kg, tomate pelati 0.8kg, carne molida 1kg, vino tinto 0.5L, orégano 0.001kg, sal 0.01kg, tomate guaje 0.6kg, zanahoria 0.2kg, aceite oliva 0.08kg, apio 0.2kg, ajo pelado 0.08kg)
- Mezcla unidades: kg y litros en la misma receta
- Se usa como ingrediente en recetas de platillos

### Sub-receta: AMALAY - GALLETAS BOTE DE 420G
- Rendimiento: 1 Pieza (PZ)
- 3 ingredientes: bolsa celofán, cilindro de cartón, 30 PZ de SUB GALLETA AMALAY A GRANEL
- Sub-receta anidada: usa OTRO subproducto como ingrediente

### Receta de platillo: CHILAQUILES ($34.93)
- 8 ingredientes, incluyendo "SUB FRIJOLES COCIDOS REFRITOS" (0.13 KG, $3.23)
- El subproducto aparece como ingrediente normal — misma estructura
- Costo se calcula automáticamente sumando todos los ingredientes

### Producto: AGUACATE (FYV001)
- Rendimiento: 90% (10% merma por cáscara/hueso)
- Costo ideal: $100/KG
- Flag "Crítico": checked
- Costo real por KG limpio = $100 / 0.90 = $111.11

### Producto: ACEITE DE COCO (ABA002)
- Rendimiento: 100% (sin merma)
- Costo ideal: $333.52/KG

### Tipos de producto en Wansoft
- **Materia prima** — ingrediente crudo
- **Producto terminado** — se vende directo sin receta
- **Subproducto** — resultado de producción (salsa, base, masa)
- **Indirecto** — no es ingrediente (servilletas, gas)

### Departamentos relevantes
ABARROTES, BEBIDAS, CERVEZAS, CONGELADOS, EMPAQUE, FRUTAS Y VERDURAS, GRANEL, LACTEOS, MARCA PROPIA, PANADERIA, PRODUCTOS MARKET, PROTEINA ANIMAL, PULPAS, SECOS, SUBS COCINA, SUBS PANADERIA, TISANAS, VINOS & LICUOR, VINOS Y LICORES, VITAMINAS & SUPLEMENTOS

### 19 unidades de medida
KG, GR, GL, LT, ML, OZ, PZ, MJ (manojo), LA (lata), PQ (paquete), BL (bolsa), CJ (caja), BT (bote), VA (vaso), TA (taza), POR (porción), REB (rebanada), BTA (botella), PZA

### Conversiones globales (Wansoft)
| De | Cantidad | A |
|---|---|---|
| KG | 1000 | GR |
| GR | 0.001 | KG |
| GL | 3.7854 | LT |
| GL | 3785.4 | ML |
| LT | 33.8148 | OZ |
| LT | 1000 | ML |
| ML | 0.001 | LT |
| OZ | 0.0296 | LT |

### Presentaciones (unidad de compra)
CAJA 15 KG, CAJA 6 PZ, BOLSA 350GR, BOTE 3.8LT, BOTE 2.5L, BIDON 20LT, BOTE 4KG, BOTE 1LT
- Son etiquetas — la equivalencia se asigna por producto

### Carga masiva
- Plantilla Excel para recetas de platillos
- Plantilla Excel para recetas de subproductos
- Botón "Importar" en ambas pantallas

---

## Modelo de datos para Fullsite

### Cambios a tabla existente: `pos_ingredients`

```sql
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS yield_percent numeric DEFAULT 100;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'materia_prima';
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS is_critical boolean DEFAULT false;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS cost_per_unit numeric DEFAULT 0;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 0;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_product_key text;
ALTER TABLE pos_ingredients ADD COLUMN IF NOT EXISTS sat_unit_key text;

COMMENT ON COLUMN pos_ingredients.yield_percent IS 'Factor de rendimiento. 100=sin merma, 90=10% merma. Costo limpio = cost / (yield/100)';
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
  cost_per_yield numeric GENERATED ALWAYS AS (0) STORED,  -- se calcula
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_sub_recipe_ingredients (
  id bigserial PRIMARY KEY,
  sub_recipe_id text NOT NULL REFERENCES pos_sub_recipes(id) ON DELETE CASCADE,
  ingredient_id text NOT NULL,  -- puede ser materia prima O otro subproducto
  ingredient_type text NOT NULL DEFAULT 'ingredient',  -- 'ingredient' | 'sub_recipe'
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'KG',
  created_at timestamptz DEFAULT now()
);
```

### Cambios a tabla existente: `pos_recipes`

```sql
-- Los ingredientes de receta ahora pueden ser subproductos
ALTER TABLE pos_recipes ADD COLUMN IF NOT EXISTS ingredient_type text DEFAULT 'ingredient';

COMMENT ON COLUMN pos_recipes.ingredient_type IS 'ingredient = materia prima, sub_recipe = subproducto';
```

### Nueva tabla: `pos_unit_conversions`

```sql
CREATE TABLE IF NOT EXISTS pos_unit_conversions (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  from_unit text NOT NULL,
  to_unit text NOT NULL,
  factor numeric NOT NULL,
  UNIQUE(client_id, from_unit, to_unit)
);

-- Seed con conversiones estándar
INSERT INTO pos_unit_conversions (client_id, from_unit, to_unit, factor) VALUES
('amalay', 'KG', 'GR', 1000),
('amalay', 'GR', 'KG', 0.001),
('amalay', 'GL', 'LT', 3.7854),
('amalay', 'GL', 'ML', 3785.4),
('amalay', 'LT', 'OZ', 33.8148),
('amalay', 'LT', 'ML', 1000),
('amalay', 'ML', 'LT', 0.001),
('amalay', 'OZ', 'LT', 0.0296)
ON CONFLICT DO NOTHING;
```

### Nueva tabla: `pos_presentations`

```sql
CREATE TABLE IF NOT EXISTS pos_presentations (
  id text PRIMARY KEY DEFAULT 'pres-' || gen_random_uuid()::text,
  client_id text NOT NULL DEFAULT 'amalay',
  code text NOT NULL,
  name text NOT NULL,
  active boolean DEFAULT true,
  UNIQUE(client_id, code)
);

-- Asignación de presentación a producto
CREATE TABLE IF NOT EXISTS pos_ingredient_presentations (
  id bigserial PRIMARY KEY,
  client_id text NOT NULL DEFAULT 'amalay',
  ingredient_id text NOT NULL,
  presentation_id text NOT NULL REFERENCES pos_presentations(id),
  quantity numeric NOT NULL,  -- cuántas unidades base contiene
  unit text NOT NULL,  -- unidad base del producto
  cost numeric DEFAULT 0,  -- costo por presentación
  UNIQUE(client_id, ingredient_id, presentation_id)
);
```

---

## Reglas de negocio

### Cálculo de costo de ingrediente limpio

```
costo_limpio = costo_compra / (yield_percent / 100)

Ejemplo AGUACATE:
  costo_compra = $100/KG
  yield_percent = 90
  costo_limpio = $100 / 0.90 = $111.11/KG
```

### Cálculo de costo de sub-receta

```
costo_sub_receta = SUM(ingrediente.cantidad * ingrediente.costo_limpio) para cada ingrediente
costo_por_unidad_rendimiento = costo_sub_receta / yield_quantity

Ejemplo SUB SALSA BOLOGNESA:
  Ingredientes suman = $X total
  Rendimiento = 2.5 KG
  Costo por KG de salsa = $X / 2.5
```

### Cálculo de costo de platillo

```
costo_platillo = SUM(ingrediente.cantidad * ingrediente.costo_por_unidad)

Donde costo_por_unidad:
  - Si es materia prima: costo_limpio (con rendimiento aplicado)
  - Si es subproducto: costo_por_unidad_rendimiento de su sub-receta

Ejemplo CHILAQUILES:
  0.13 KG SUB FRIJOLES REFRITOS × $24.85/KG = $3.23
  0.03 KG QUESO PANELA × $133.00/KG = $3.99
  0.04 KG CREMA ACIDA × $63.00/KG = $2.52
  ... etc
  Total = $34.93
```

### Deducción de inventario al enviar a cocina

```
Al enviar orden con 1 CHILAQUILES:
  - Descontar 0.13 KG de SUB FRIJOLES REFRITOS del inventario
    (o si se rastrea por ingredientes crudos: expandir la sub-receta
     y descontar los ingredientes base)
  - Descontar 0.03 KG de QUESO PANELA
  - etc.

Para ingredientes con rendimiento < 100:
  cantidad_a_descontar = cantidad_receta / (yield_percent / 100)
  
  Si la receta pide 0.02 KG de CEBOLLA MORADA (rendimiento 85%):
    descontar = 0.02 / 0.85 = 0.0235 KG del inventario
    (porque necesitas comprar más de lo que usas)
```

### Conversión de unidades

```
Cuando la receta usa una unidad diferente a la del inventario:
  1. Buscar conversión directa en pos_unit_conversions
  2. Si no existe, buscar conversión inversa (1/factor)
  3. Si no existe, error — unidades incompatibles

Ejemplo: receta pide 500 ML de leche, inventario está en LT
  conversión: 1 LT = 1000 ML → 500 ML = 0.5 LT
  descontar 0.5 LT del inventario
```

### Sub-recetas anidadas

```
Una sub-receta puede usar otra sub-receta como ingrediente.
Máximo 3 niveles de anidamiento (para evitar loops):
  Platillo → Sub-receta nivel 1 → Sub-receta nivel 2 → Solo materia prima

El costo se calcula bottom-up:
  1. Calcular costo de sub-recetas que solo usan materia prima
  2. Calcular costo de sub-recetas que usan sub-recetas del paso 1
  3. Calcular costo de platillos que usan cualquier combinación
```

---

## Dónde vive en Fullsite (UI)

### Opción 1: Extender página existente /recetas
- Tab 1: Recetas de platillos (ya existe)
- Tab 2: Sub-recetas (nuevo)
- Tab 3: Ingredientes/Productos (nuevo — con yield, tipo, departamento)
- Tab 4: Conversiones (nuevo)

### Opción 2: Páginas separadas (como Wansoft)
- /recetas — recetas de platillos
- /recetas/subproductos — sub-recetas
- /inventario-real/conversiones — conversiones de unidades
- /inventario-real/presentaciones — presentaciones de compra
- Ingredientes se editan desde /inventario-real con campo de rendimiento

### Recomendación: Opción 1
Un solo lugar para todo lo relacionado con costeo. El gerente no tiene que navegar 4 páginas — entra a /recetas y tiene todo. Wansoft lo separa porque su portal es de 2007. Nosotros podemos hacerlo mejor.

---

## Qué mejoramos vs Wansoft

1. **Costo calculado en tiempo real** — Wansoft muestra "Costo presupuestado: $34.93" como dato estático. Fullsite recalcula cada vez que cambia un precio de ingrediente o una receta.

2. **Alerta automática si el costo sube** — Si el proveedor sube el precio de la carne molida, Fullsite detecta que todos los platillos con SUB SALSA BOLOGNESA subieron de costo y alerta al gerente.

3. **Simulador de precios** — Eduardo lo pidió: "dado que quiero 25% de food cost, ¿a cuánto debería vender este platillo?" Wansoft no tiene esto.

4. **Validación de recetas completas** — Detectar platillos sin receta, sub-recetas sin ingredientes, ingredientes sin rendimiento configurado. Wansoft tiene esto como reporte pasivo. Fullsite lo puede hacer como alerta proactiva.

5. **Factor de rendimiento sugerido** — Para vegetales estándar, la IA puede sugerir factores típicos (cebolla ~85%, aguacate ~90%, arrachera ~70%). El usuario confirma o ajusta.

6. **Sub-receta visible en el POS** — Eduardo pidió (Jul 7): "poder ver receta/ingredientes de un platillo desde POS, útil para alérgenos y nuevos chefs." Fullsite puede mostrar la receta expandida (incluyendo sub-recetas) al tocar un platillo.

---

## Orden de implementación

### Paso 1: Modelo de datos (SQL)
- ALTER pos_ingredients (yield, product_type, department, is_critical)
- CREATE pos_sub_recipes + pos_sub_recipe_ingredients
- ALTER pos_recipes (ingredient_type)
- CREATE pos_unit_conversions + seed
- CREATE pos_presentations + pos_ingredient_presentations

### Paso 2: API
- GET/POST /api/sub-recipes — CRUD sub-recetas
- GET /api/ingredients?include=yield — ingredientes con rendimiento
- GET /api/food-cost/calculate — cálculo con sub-recetas y rendimiento
- PATCH /api/ingredients/:id — actualizar yield, tipo, departamento

### Paso 3: UI — /recetas rediseñada
- Tab Sub-recetas: CRUD con lista de ingredientes
- Tab Ingredientes: editar yield, tipo, departamento
- Tab Conversiones: tabla editable
- Integrar costo calculado en tiempo real

### Paso 4: Integrar con food-cost
- /food-cost page usa costo con rendimiento y sub-recetas
- Alertas de variación recalculan con la nueva lógica
- Simulador de precios

### Paso 5: Integrar con inventario
- Deducción al enviar a cocina respeta rendimiento
- Deducción expande sub-recetas a ingredientes base

---

> No se implementa sin que Daniel revise este diseño.
> Cada decisión está respaldada por evidencia directa de Wansoft.
