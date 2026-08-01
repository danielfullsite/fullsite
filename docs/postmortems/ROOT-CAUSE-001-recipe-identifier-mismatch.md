# ROOT-CAUSE-001 — Recipe Identifier Mismatch

> Tipo: Causa raíz + propuesta de solución  
> Status: PENDIENTE APROBACIÓN — diseño documentado, implementación no autorizada  
> Fecha: 2026-07-27  
> Evidencia: MT-03 (`docs/migrations/MT-03-orphan-diagnosis.md`, commit `ad13889`)  
> Impacto: 615 recetas (100%), 1,456 líneas, food cost incalculable  
> Workstream: Migration Engine — Fase 1  
> No mezclar con: CFG-01, SEC-DEPLOY-01, tablas productivas

---

## Problema

El pipeline de migración de recetas (`scripts/migration-pipeline/dry-run.ts`) reporta 1,456 líneas de receta rechazadas con error `orphan_reference`. El reporte original describía esto como "65% de registros rechazados", lo que sugería corrupción parcial de datos. El diagnóstico determinista (MT-03) demostró que la tasa real es **100% de todas las líneas de receta** — ninguna receta puede resolverse bajo la lógica actual.

---

## Causa raíz

El pipeline construye dos claves de identificación para ingredientes usando **reglas distintas e incompatibles**:

### Clave del catálogo (ingredientes)

```typescript
// dry-run.ts ~línea 65
const id = String(raw.id || raw.codigo || slugify(String(raw.name || raw.nombre || '')))
```

`wansoft_products.json` tiene campo `codigo` y no tiene campo `id`. Por lo tanto:

```
id del catálogo = raw.codigo   →   e.g., "ABA003", "FYV014", "LAC010"
```

Los IDs del catálogo son **códigos alfanuméricos opacos**, asignados por Wansoft.

### Clave de referencia en recetas

```typescript
// dry-run.ts ~líneas 120-126
for (const ing of r.ingredients || []) {
  rawRecipes.push({
    ingredient_id: slugify(ing.product),  // ← slug derivado del nombre
    quantity: ing.qty,
  })
}
```

`wansoft_recetas.json` tiene campo `product` (nombre legible, e.g., `"ACEITE OLIVA"`). El pipeline aplica `slugify()` sobre ese nombre.

```
ingredient_id = slugify("ACEITE OLIVA")   →   "aceite_oliva"
```

### La comparación siempre falla

```
ingredientIds.has("aceite_oliva")  →  false
// porque ingredientIds contiene "ABA003", no "aceite_oliva"
```

No hay intersección posible entre `{slug de nombre}` y `{codigo opaco}`. El pipeline compara dos espacios de claves que nunca se solapan.

---

## Evidencia

| Archivo | Línea | Comportamiento | Status |
|---|---|---|---|
| `scripts/migration-pipeline/dry-run.ts` | ~65 | Genera ID de catálogo desde `raw.codigo` | HECHO |
| `scripts/migration-pipeline/dry-run.ts` | ~120-126 | Genera `ingredient_id` desde `slugify(ing.product)` | HECHO |
| `scripts/migration-pipeline/maps/names.ts` | 67-75 | Función `slugify()` — exact implementation | HECHO |
| `agents/wansoft/wansoft_products.json` | cualquier fila | Campo `codigo: "ABA003"`, campo `nombre: "ACEITE OLIVA"` | HECHO |
| `agents/wansoft/wansoft_recetas.json` | cualquier fila | Campo `product: "ACEITE OLIVA"`, sin campo `codigo` | HECHO |
| `scripts/migration-pipeline/dry-run-report.json` | — | `rejected: 1456`, `total_records: 2225` | HECHO |
| `scripts/migration-pipeline/orphan-classification-report.json` | — | `NORMALIZED_EXACT: 511 IDs, 1334 líneas` | HECHO |

**Ejemplo concreto:**

| Nombre | ID en catálogo | ID generado en receta | ¿Match? |
|---|---|---|---|
| ACEITE OLIVA | `ABA003` | `aceite_oliva` | ❌ |
| PECHUGA DE POLLO | `PRO015` | `pechuga_de_pollo` | ❌ |
| HUEVO BLANCO | `PRO002` | `huevo_blanco` | ❌ |
| AGUACATE | `FYV001` | `aguacate` | ❌ |

Cada uno de los 586 orphan IDs únicos sigue este mismo patrón para los 511 del grupo NORMALIZED_EXACT.

---

## Impacto

- **Inmediato:** 0 de 615 recetas son procesables. Food cost calculado desde el pipeline = 0.
- **Operativo:** `pos_recipes_old` fue poblada desde otro mecanismo (SQL ad-hoc) y no refleja el estado del pipeline TypeScript. Si el pipeline se activa sin este fix, sobreescribiría con datos inválidos.
- **Futuro:** Cualquier conector que no exponga un campo de ID estable tiene el mismo problema latente.

---

## Propuesta de solución — Índice slug→ID

### Principio

El origen del problema es que las recetas de Wansoft referencian ingredientes **por nombre**, no por código. El catálogo de Wansoft tiene tanto nombre como código. El pipeline puede construir un índice que mapee el slug del nombre al código estable, sin modificar ningún JSON fuente ni requerir cambios en el conector.

### Cómo funciona el índice

```
nombre en catálogo    →   normalización     →   slug          →   código estable
"ACEITE OLIVA"        →   slugify()         →   "aceite_oliva" →  "ABA003"
"PECHUGA DE POLLO"    →   slugify()         →   "pechuga_de_pollo" → "PRO015"
"LIMÓN"               →   slugify()         →   "limon"        →  "FYV008"
```

```
nombre en receta      →   normalización     →   slug          →   lookup en índice   →   ID resuelto
"ACEITE OLIVA"        →   slugify()         →   "aceite_oliva" →  slugIndex.get()   →   "ABA003"  ✓
"PECHUGA DE POLLO"    →   slugify()         →   "pechuga_de_pollo" → slugIndex.get() →  "PRO015"  ✓
"GALLETA AMALAY"      →   slugify()         →   "galleta_amalay_a_granel" → undefined →  orphan   ✗
```

### Dónde vive el índice

El índice lo construye el **pipeline core**, no el conector:

```typescript
// En el pipeline core (dry-run.ts o un módulo lib/resolver.ts)

function buildSlugIndex(ingredients: NormalizedIngredient[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const ing of ingredients) {
    const slug = slugify(String(ing.name))
    index.set(slug, String(ing.id))
  }
  return index
}

function resolveIngredientId(rawSlug: string, slugIndex: Map<string, string>): string {
  return slugIndex.get(rawSlug) ?? rawSlug
}
```

El conector (WansoftConnector) solo necesita entregar registros con campos canónicos `id` y `name`. La lógica de resolución no pertenece al conector.

### Invariantes del índice

1. **Determinista:** El mismo catálogo produce el mismo índice en cada run.
2. **Idempotente:** Construirlo N veces da el mismo resultado.
3. **Sin escritura:** El índice existe solo en memoria durante el run del pipeline.
4. **No modifica fuentes:** Los JSONs `wansoft_products.json` y `wansoft_recetas.json` permanecen intactos.
5. **Sin aliases implícitos:** El índice solo mapea `slugify(nombre)` → `codigo`. No deduce nada.

### Por qué este mecanismo es agnóstico al conector

El índice opera sobre la **interfaz canónica del pipeline**, no sobre la estructura de Wansoft:

```typescript
// Lo que cualquier conector entrega al pipeline
interface NormalizedIngredient {
  id: string    // ID estable del sistema origen (codigo, SKU, UUID, etc.)
  name: string  // Nombre legible en el sistema origen
}
```

El conector Wansoft mapea `producto.codigo → id` y `producto.nombre → name`. Un conector CSV mapearía `row.sku → id` y `row.product_name → name`. Un conector de Soft Restaurant mapearía sus propios campos. En todos los casos, el pipeline core construye el mismo índice con la misma lógica.

La invariante que hace funcionar esto:

> **El sistema origen debe proporcionar, para cada ingrediente, tanto un ID estable como un nombre legible. Si solo provee uno de los dos, el índice no puede construirse.**

Para Wansoft esto es verdad: `codigo` es estable, `nombre` es el mismo término que aparece en recetas.

### Pseudocódigo del fix (referencia — no implementar todavía)

```typescript
// 1. Cargar catálogo (ya existe)
const ingredients = loadIngredients(wansoftProductsJson)

// 2. Construir índice (nuevo)
const slugIndex = buildSlugIndex(ingredients)  // Map<slug, codigo>

// 3. Set de IDs válidos (ya existe, ajustado)
const ingredientIds = new Set(ingredients.map(i => i.id))

// 4. Resolver recetas (líneas ~120-126 del dry-run, ajustado)
for (const ing of r.ingredients || []) {
  const rawSlug = slugify(ing.product)
  const resolvedId = resolveIngredientId(rawSlug, slugIndex)
  rawRecipes.push({
    ingredient_id: resolvedId,   // ← usa el ID resuelto, no el slug raw
    quantity: ing.qty,
  })
}
```

---

## Riesgos del fix

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Colisión en el índice: dos productos con el mismo slug pero distintos codigos | ALTO | Detectar y reportar en tiempo de construcción del índice. Si `slugIndex.has(slug) && slugIndex.get(slug) !== id`, lanzar error con los dos candidatos. |
| Slug de nombre en catálogo ≠ slug de nombre en receta por diferencia sutil | MEDIO | Ya cubierto por MT-03: los 511 NORMALIZED_EXACT fueron verificados. Los 73 NO_CANDIDATE no producen match y siguen siendo orphans — no se resuelven incorrectamente. |
| El índice resuelve un ingrediente que fue renombrado en Wansoft | BAJO | El `source_hash` del catálogo detectará el cambio entre runs. El índice se reconstruye en cada run, así que siempre refleja el catálogo actual. |
| El fix silencia orphans reales | BAJO | Los 73 NO_CANDIDATE siguen siendo orphans. Solo los 511 NORMALIZED_EXACT se resuelven, y solo cuando el slug del catálogo coincide exactamente. |

---

## Pruebas necesarias antes de implementar

1. **Test de reconciliación:** Con el fix aplicado, el número de orphans debe caer de 1,456 a exactamente 122 (2 SINGLE_FUZZY + 120 NO_CANDIDATE). Si el número difiere, hay un bug.
2. **Test de colisión de índice:** El builder debe detectar si dos productos producen el mismo slug. Verificar con el catálogo actual: ¿hay algún par de nombres cuyo slug sea idéntico?
3. **Test de smoke con fixtures neutros:** El clasificador `classify-orphans.ts` debe correr con los fixtures de `scripts/migration-pipeline/fixtures/` y producir 0 orphans si los fixtures están bien construidos.
4. **Test de regresión de NORMALIZED_EXACT:** Tomar los 511 orphan IDs clasificados como NORMALIZED_EXACT y verificar que cada uno resuelve al `codigo` correcto usando el índice.

---

## Por qué este cambio no rompe otros conectores

El cambio propuesto modifica **únicamente la lógica interna del pipeline core** (dry-run.ts), no el contrato externo de ningún conector.

- El contrato del conector (`extract()` → `NormalizedIngredient[]`) no cambia.
- El conector Wansoft ya entrega `{id: codigo, name: nombre}` — no necesita modificarse.
- Un hipotético CSV Connector que entregue `{id: sku, name: product_name}` se beneficia del mismo mecanismo sin ningún cambio.
- Un conector que NO proporcione campo `name` (solo `id`) simplemente no produce entradas en el índice — el pipeline continúa usando el `id` directamente, sin degradar.

El índice es **aditivo**: agrega capacidad de resolución sin remover la comparación directa por ID. Si el ID raw ya existe en el catálogo (caso EXACT_MATCH), el lookup directo sigue funcionando.

---

## Siguiente paso autorizado

Una vez aprobado este documento:

1. Implementar `buildSlugIndex()` y `resolveIngredientId()` en `scripts/migration-pipeline/lib/resolver.ts` (archivo nuevo)
2. Integrar en `dry-run.ts` en las líneas ~120-126 usando `resolveIngredientId()`
3. Verificar que el reporte pase de `rejected: 1456` a `rejected: 122`
4. Verificar ausencia de colisiones con el catálogo real
5. Commit aislado, sin mezclar con aliases ni SEC-DEPLOY-01

**La implementación no está autorizada hasta que este documento sea aprobado explícitamente.**
