# Paso 2: API Contracts — Sub-recetas + Rendimiento + Conversiones

> Diseño de contratos antes de escribir código.
> Cada endpoint se implementa y prueba antes de avanzar al siguiente.
> No se conecta a POS, inventario, ni r1_reconcile_order.

---

## Reglas globales

- **Auth:** Todas las escrituras via service_role (API routes con SUPABASE_SERVICE_KEY). Lecturas permiten anon/authenticated.
- **client_id:** Se deriva del contexto seguro (header x-client-id validado por `getClientId(request)` de api-auth.ts, o hardcode 'amalay' en fallback). NUNCA se acepta del body.
- **Transacciones:** Toda operación de escritura que involucre más de una tabla o validación corre dentro de una transacción PostgreSQL (via función RPC o secuencia de queries con el mismo connection).
- **Errores:** Formato consistente: `{ error: string, detail?: string }` con HTTP status code apropiado.

---

## Endpoint 1: CRUD Sub-recetas

### GET /api/sub-recipes

Lista sub-recetas del cliente.

| Campo | Valor |
|---|---|
| Método | GET |
| Ruta | /api/sub-recipes |
| Auth | anon, authenticated, service_role |
| Query params | `?active=true` (opcional, default: solo activas) |
| Request body | ninguno |
| Response 200 | `SubRecipe[]` |
| Tablas | pos_sub_recipes (SELECT) |
| Transacción | No (lectura simple) |

```typescript
// Response type
interface SubRecipe {
  id: string
  name: string
  yield_quantity: number
  yield_unit: string
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  ingredients: SubRecipeIngredient[]  // join con pos_sub_recipe_ingredients
}

interface SubRecipeIngredient {
  id: number
  ingredient_id: string
  ingredient_type: 'ingredient' | 'sub_recipe'
  ingredient_name: string  // resuelto del join
  quantity: number
  unit: string
}
```

**Query SQL:**
```sql
SELECT sr.*, json_agg(json_build_object(
  'id', sri.id, 'ingredient_id', sri.ingredient_id,
  'ingredient_type', sri.ingredient_type, 'quantity', sri.quantity, 'unit', sri.unit
)) FILTER (WHERE sri.id IS NOT NULL) as ingredients
FROM pos_sub_recipes sr
LEFT JOIN pos_sub_recipe_ingredients sri ON sri.sub_recipe_id = sr.id
WHERE sr.client_id = $client_id AND sr.active = true
GROUP BY sr.id
ORDER BY sr.name
```

**Errores:**
- 401: No autorizado

**Pruebas mínimas:**
1. GET sin datos → `[]`
2. GET con datos → array de sub-recetas con ingredientes
3. GET respeta client_id (no devuelve datos de otro tenant)

---

### POST /api/sub-recipes

Crea una sub-receta (sin ingredientes — se agregan después).

| Campo | Valor |
|---|---|
| Método | POST |
| Ruta | /api/sub-recipes |
| Auth | service_role (API route usa SUPABASE_SERVICE_KEY) |
| Request body | `{ name, yield_quantity, yield_unit, notes? }` |
| Response 201 | `{ id, name, yield_quantity, yield_unit }` |
| Response 400 | `{ error: "..." }` si validación falla |
| Response 409 | `{ error: "Ya existe una sub-receta con ese nombre" }` |
| Tablas | pos_sub_recipes (INSERT) |
| Transacción | No (insert simple) |

**Validaciones server-side:**
1. `name` no vacío, trimmed
2. `yield_quantity` > 0
3. `yield_unit` no vacío, normalizado a uppercase
4. Unicidad: (client_id, name) — la DB tiene UNIQUE constraint, capturar error 23505

**Errores:**
- 400: name vacío, yield_quantity <= 0, yield_unit vacío
- 409: nombre duplicado para este client_id

**Pruebas mínimas:**
1. POST válido → 201 con id generado
2. POST nombre vacío → 400
3. POST yield_quantity = 0 → 400
4. POST nombre duplicado → 409
5. Verificar que client_id se asigna del contexto, no del body

---

### PATCH /api/sub-recipes/[id]

Actualiza una sub-receta existente.

| Campo | Valor |
|---|---|
| Método | PATCH |
| Ruta | /api/sub-recipes/[id] |
| Auth | service_role |
| Request body | `{ name?, yield_quantity?, yield_unit?, notes?, active? }` |
| Response 200 | `{ id, name, yield_quantity, yield_unit, active }` |
| Response 404 | Sub-receta no existe o no pertenece al client_id |
| Tablas | pos_sub_recipes (UPDATE) |
| Transacción | No (update simple) |

**Validaciones:**
1. Sub-receta existe Y pertenece a client_id
2. Si name cambia: verificar unicidad (client_id, name)
3. Si yield_quantity cambia: > 0
4. Si yield_unit cambia: no vacío

**Errores:**
- 400: validación falla
- 404: sub-receta no encontrada para este client_id
- 409: nombre duplicado

**Pruebas mínimas:**
1. PATCH válido → 200
2. PATCH id inexistente → 404
3. PATCH de sub-receta de otro client_id → 404
4. PATCH nombre a duplicado → 409

---

### DELETE /api/sub-recipes/[id]

Elimina una sub-receta y sus ingredientes (CASCADE).

| Campo | Valor |
|---|---|
| Método | DELETE |
| Ruta | /api/sub-recipes/[id] |
| Auth | service_role |
| Request body | ninguno |
| Response 200 | `{ deleted: true }` |
| Response 404 | No existe o no pertenece a client_id |
| Response 409 | `{ error: "Sub-receta en uso", used_by: [...] }` |
| Tablas | pos_sub_recipes (DELETE), pos_sub_recipe_ingredients (CASCADE) |
| Transacción | Sí (verificar dependencias + delete) |

**Validaciones:**
1. Sub-receta existe Y pertenece a client_id
2. Verificar que no está en uso como ingrediente en otras sub-recetas (`pos_sub_recipe_ingredients WHERE ingredient_id = $id AND ingredient_type = 'sub_recipe'`)
3. Verificar que no está en uso en recetas de platillos (`pos_recipes_old WHERE ingredient_id = $id AND ingredient_type = 'sub_recipe'`)
4. Si está en uso → 409 con lista de dependientes

**Errores:**
- 404: no encontrada
- 409: en uso por otra sub-receta o platillo (con lista de dependientes)

**Pruebas mínimas:**
1. DELETE sin dependencias → 200, ingredientes eliminados en cascade
2. DELETE con dependencia en otra sub-receta → 409 con detalle
3. DELETE con dependencia en platillo → 409 con detalle
4. DELETE de otro client_id → 404

---

## Endpoint 2: CRUD Ingredientes de sub-receta

### POST /api/sub-recipes/[id]/ingredients

Agrega un ingrediente a una sub-receta.

| Campo | Valor |
|---|---|
| Método | POST |
| Ruta | /api/sub-recipes/[id]/ingredients |
| Auth | service_role |
| Request body | `{ ingredient_id, ingredient_type, quantity, unit }` |
| Response 201 | `{ id, ingredient_id, ingredient_type, ingredient_name, quantity, unit }` |
| Response 400 | Validación falla |
| Response 404 | Sub-receta no existe |
| Response 409 | Ciclo detectado |
| Tablas | pos_sub_recipe_ingredients (INSERT), pos_sub_recipes (SELECT), pos_ingredients (SELECT) |
| Transacción | **Sí — con advisory lock para anti-ciclos** |

**Validaciones server-side (en orden):**
1. Sub-receta `[id]` existe Y pertenece a client_id
2. `ingredient_type` es 'ingredient' o 'sub_recipe'
3. `quantity` > 0
4. `unit` no vacío
5. Si `ingredient_type = 'ingredient'`: verificar que `ingredient_id` existe en `pos_ingredients` con el mismo client_id
6. Si `ingredient_type = 'sub_recipe'`: verificar que `ingredient_id` existe en `pos_sub_recipes` con el mismo client_id
7. Self-reference: `ingredient_id != id` (la DB lo valida pero verificar antes para mejor error message)
8. **Anti-ciclos:** ejecutar recursive CTE dentro de transacción con `pg_advisory_xact_lock(hashtext(client_id))`

**Anti-ciclos CTE (ejecutado dentro de la transacción):**
```sql
-- Adquirir advisory lock por tenant
SELECT pg_advisory_xact_lock(hashtext($client_id));

-- Verificar que agregar $child_id como ingrediente de $parent_id no crea ciclo
WITH RECURSIVE ancestors AS (
  SELECT sri.sub_recipe_id as id, ARRAY[sri.sub_recipe_id] as path
  FROM pos_sub_recipe_ingredients sri
  JOIN pos_sub_recipes sr ON sr.id = sri.sub_recipe_id AND sr.client_id = $client_id
  WHERE sri.ingredient_id = $parent_id AND sri.ingredient_type = 'sub_recipe'
  UNION ALL
  SELECT sri.sub_recipe_id, a.path || sri.sub_recipe_id
  FROM pos_sub_recipe_ingredients sri
  JOIN pos_sub_recipes sr ON sr.id = sri.sub_recipe_id AND sr.client_id = $client_id
  JOIN ancestors a ON sri.ingredient_id = a.id AND sri.ingredient_type = 'sub_recipe'
  WHERE NOT (sri.sub_recipe_id = ANY(a.path))
    AND array_length(a.path, 1) < 10
),
descendants AS (
  SELECT sri.ingredient_id as id, ARRAY[sri.ingredient_id] as path
  FROM pos_sub_recipe_ingredients sri
  WHERE sri.sub_recipe_id = $child_id AND sri.ingredient_type = 'sub_recipe'
  UNION ALL
  SELECT sri.ingredient_id, d.path || sri.ingredient_id
  FROM pos_sub_recipe_ingredients sri
  JOIN descendants d ON sri.sub_recipe_id = d.id AND sri.ingredient_type = 'sub_recipe'
  WHERE NOT (sri.ingredient_id = ANY(d.path))
    AND array_length(d.path, 1) < 10
)
SELECT 'ancestor' as direction, id, path FROM ancestors WHERE id = $child_id
UNION ALL
SELECT 'descendant', id, path FROM descendants WHERE id = $parent_id;
```

**Errores:**
- 400: tipo inválido, cantidad <= 0, unidad vacía
- 404: sub-receta no encontrada, o ingrediente referenciado no existe
- 409: `{ error: "Ciclo detectado", path: ["sub-A", "sub-B", "sub-C"] }`

**Pruebas mínimas:**
1. Agregar materia prima → 201
2. Agregar sub-receta válida → 201
3. Agregar ingrediente inexistente → 404
4. Agregar con ingredient_type incorrecto → 400
5. Self-reference (A como ingrediente de A) → 409
6. Ciclo indirecto (A→B, luego B→A) → 409
7. Ciclo profundo (A→B→C, luego C→A) → 409
8. Verificar advisory lock previene race condition (2 requests concurrentes)

---

### DELETE /api/sub-recipes/[id]/ingredients/[ingredientLineId]

Elimina un ingrediente de una sub-receta.

| Campo | Valor |
|---|---|
| Método | DELETE |
| Ruta | /api/sub-recipes/[id]/ingredients/[ingredientLineId] |
| Auth | service_role |
| Response 200 | `{ deleted: true }` |
| Response 404 | Línea no existe o no pertenece a esta sub-receta |
| Tablas | pos_sub_recipe_ingredients (DELETE) |
| Transacción | No (delete simple) |

**Validaciones:**
1. Sub-receta existe Y pertenece a client_id
2. Línea de ingrediente existe Y pertenece a esta sub-receta

**Pruebas mínimas:**
1. DELETE válido → 200
2. DELETE línea inexistente → 404
3. DELETE línea de otra sub-receta → 404

---

## Endpoint 3: Conversiones de unidades

### GET /api/unit-conversions

| Campo | Valor |
|---|---|
| Método | GET |
| Auth | anon, authenticated, service_role |
| Response 200 | `UnitConversion[]` |
| Tablas | pos_unit_conversions (SELECT) |

```typescript
interface UnitConversion {
  id: number
  from_unit: string
  to_unit: string
  factor: number
  is_system: boolean
}
```

**Pruebas mínimas:**
1. GET → 8 conversiones sistema
2. Filtro por client_id implícito

---

### POST /api/unit-conversions

Agrega conversión custom (no sistema).

| Campo | Valor |
|---|---|
| Método | POST |
| Auth | service_role |
| Request body | `{ from_unit, to_unit, factor }` |
| Response 201 | `{ id, from_unit, to_unit, factor, is_system: false }` |
| Response 409 | Conversión ya existe |
| Tablas | pos_unit_conversions (INSERT) |

**Validaciones:**
1. `from_unit` y `to_unit` no vacíos, trimmed, uppercase
2. `from_unit != to_unit`
3. `factor` > 0
4. `is_system` siempre false (no se pueden crear conversiones sistema via API)

**Pruebas mínimas:**
1. POST válido → 201
2. POST unidades iguales → 400
3. POST factor <= 0 → 400
4. POST duplicado → 409

---

## Endpoint 4: Presentaciones

### GET /api/presentations

| Campo | Valor |
|---|---|
| Método | GET |
| Auth | anon, authenticated, service_role |
| Response 200 | `Presentation[]` |
| Tablas | pos_presentations (SELECT) |

### POST /api/presentations

| Campo | Valor |
|---|---|
| Método | POST |
| Auth | service_role |
| Request body | `{ code, name }` |
| Response 201 | `{ id, code, name }` |
| Response 409 | Código duplicado |
| Tablas | pos_presentations (INSERT) |

### POST /api/presentations/[id]/assign

Asigna presentación a un ingrediente con equivalencia.

| Campo | Valor |
|---|---|
| Método | POST |
| Auth | service_role |
| Request body | `{ ingredient_id, contains_quantity, contains_unit, cost_per_presentation?, supplier_id? }` |
| Response 201 | `{ id, ingredient_id, presentation_id, contains_quantity, contains_unit }` |
| Tablas | pos_ingredient_presentations (INSERT), pos_presentations (SELECT), pos_ingredients (SELECT) |

**Validaciones:**
1. Presentación existe Y pertenece a client_id
2. Ingrediente existe Y pertenece a client_id
3. `contains_quantity` > 0
4. `contains_unit` no vacío

**Pruebas mínimas:**
1. Asignar presentación a ingrediente → 201
2. Ingrediente inexistente → 404
3. Presentación inexistente → 404
4. Duplicado (mismo ingrediente + presentación) → 409

---

## Endpoint 5: Cálculo de costo (función pura)

### GET /api/food-cost/calculate?item_id=X

Calcula el costo de un platillo o sub-receta, recorriendo el árbol completo.

| Campo | Valor |
|---|---|
| Método | GET |
| Auth | anon, authenticated, service_role |
| Query params | `item_id` (platillo) o `sub_recipe_id` |
| Response 200 | `CostBreakdown` |
| Tablas | pos_recipes_old, pos_sub_recipes, pos_sub_recipe_ingredients, pos_ingredients (todas SELECT) |
| Transacción | No (lectura pura) |

```typescript
interface CostBreakdown {
  item_id?: string
  sub_recipe_id?: string
  name: string
  total_cost: number
  ingredients: {
    ingredient_id: string
    name: string
    type: 'ingredient' | 'sub_recipe'
    quantity: number
    unit: string
    unit_cost: number        // costo por unidad (con yield aplicado si es materia prima)
    line_cost: number        // quantity × unit_cost
    yield_factor?: number    // solo si es materia prima
    sub_breakdown?: CostBreakdown  // recursivo si es sub-receta
  }[]
}
```

**Lógica:**
1. Obtener ingredientes del platillo o sub-receta
2. Para cada ingrediente tipo 'ingredient': `line_cost = quantity × (cost_per_unit / yield_factor)`
3. Para cada ingrediente tipo 'sub_recipe': calcular recursivamente, `line_cost = quantity × (sub_cost / sub_yield_quantity)`
4. `total_cost = SUM(line_cost)`
5. Conversión de unidades si `ingredient.unit != pos_ingredients.unit`

**NO persiste nada. NO cachea. Cálculo puro.**

**Errores:**
- 404: platillo o sub-receta no encontrada
- 400: ni item_id ni sub_recipe_id proporcionado

**Pruebas mínimas:**
1. Platillo con solo materias primas → costo correcto
2. Platillo con sub-receta → costo incluye expansión recursiva
3. Ingrediente con yield_factor < 1 → costo limpio más alto
4. Ingrediente con yield_factor > 1 (frijol) → costo limpio más bajo
5. Sub-receta anidada (A usa B que usa C) → 3 niveles correctos
6. Conversión de unidades (receta en ML, ingrediente en LT)

---

### GET /api/dependencies/[ingredientId]

Dado un ingrediente, devuelve todas las sub-recetas y platillos que lo usan.

| Campo | Valor |
|---|---|
| Método | GET |
| Auth | anon, authenticated, service_role |
| Response 200 | `{ sub_recipes: [...], dishes: [...] }` |
| Tablas | pos_sub_recipe_ingredients, pos_recipes_old, pos_sub_recipes (todas SELECT) |

```typescript
interface DependencyMap {
  ingredient_id: string
  ingredient_name: string
  sub_recipes: { id: string, name: string, path: string[] }[]
  dishes: { item_id: string, name: string, via_sub_recipe?: string }[]
}
```

**Usa el recursive CTE del design doc, filtrado por client_id.**

**Pruebas mínimas:**
1. Ingrediente sin dependencias → listas vacías
2. Ingrediente usado directamente en platillo → aparece en dishes
3. Ingrediente usado en sub-receta → aparece en sub_recipes + dishes que usan esa sub-receta

---

## Orden de implementación

1. **GET + POST + PATCH + DELETE /api/sub-recipes** → probar → commit
2. **POST + DELETE /api/sub-recipes/[id]/ingredients** (con anti-ciclos) → probar → commit
3. **GET + POST /api/unit-conversions** → probar → commit
4. **GET + POST /api/presentations + assign** → probar → commit
5. **GET /api/food-cost/calculate** → probar → commit
6. **GET /api/dependencies/[ingredientId]** → probar → commit

Cada paso se commitea y verifica antes de avanzar al siguiente.
