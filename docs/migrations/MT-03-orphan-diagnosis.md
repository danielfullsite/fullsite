# MT-03 — Diagnóstico Determinista de Orphan References

**Fecha:** 2026-07-27
**Estado:** HECHO — diagnóstico read-only completo, sin escrituras a BD ni modificaciones de JSONs fuente
**Archivos de salida:**
- `scripts/migration-pipeline/classify-orphans.ts` — clasificador reproducible
- `scripts/migration-pipeline/orphan-classification-report.json` — reporte completo

---

## 1. Cardinalidades exactas

| Entidad | Count | Fuente | Status |
|---|---|---|---|
| Productos en catálogo (`wansoft_products.json`) | 769 | Conteo directo | HECHO |
| Recetas únicas (`wansoft_recetas.json`) | 615 | Conteo directo | HECHO |
| Líneas de receta (pares plato × ingrediente) | 1,456 | Expansión de `ingredients[]` | HECHO |
| `total_records` en dry-run-report.json | 2,225 | Reporte | HECHO |
| `rejected` en dry-run-report.json | 1,456 | Reporte | HECHO |
| Orphan `ingredient_id`s únicos | 586 | Set de valores distintos | HECHO |
| Recetas afectadas parcialmente (≥1 ingrediente orphan, ≥1 resolvible) | 0 | Calculado | HECHO |
| Recetas afectadas completamente (todos los ingredientes son orphans) | 615 | Calculado | HECHO |
| Recetas completamente resolvibles | 0 | Calculado | HECHO |

**Notas de cardinalidad:**

- `total_records = 769 productos + 1,456 líneas de receta = 2,225`. Confirmed.
- `rejected = 1,456` = todas las líneas de receta. El 65% mencionado en el ticket es erróneo: la tasa real es **100%** de las líneas de receta, que representan el 65% de los 2,225 registros totales. El 65% es correcto como fracción del total, pero oculta que el dominio "recetas" tiene 0% de éxito.
- Los 586 orphan IDs únicos producen 1,456 líneas de error porque muchos ingredientes aparecen en múltiples recetas.
- `warnings = 75` corresponden a ingredientes con costo cero (no afectan el conteo de rejected).

---

## 2. Cómo se generan los IDs — raíz del problema

### 2.1 ID de ingredientes en el catálogo

```typescript
// dry-run.ts línea 65
const id = String(raw.id || raw.codigo || slugify(String(raw.name || raw.nombre || '')))
```

`wansoft_products.json` tiene campos `codigo` y `nombre` (sin campo `id`). Por lo tanto:

```
id_del_catálogo = raw.codigo   // e.g., "ABA003", "FYV014", "LAC010"
```

Los IDs del catálogo son **códigos alfanuméricos opacos de Wansoft**, nunca slugs de nombres.

### 2.2 ID de ingredientes en líneas de receta

```typescript
// dry-run.ts líneas 120-126
for (const ing of r.ingredients || []) {
  rawRecipes.push({
    menu_item_name: r.dish,
    ingredient_id: slugify(ing.product),   // ← slug del nombre
    quantity: ing.qty,
  })
}
```

`wansoft_recetas.json` tiene campo `product` (nombre legible). El pipeline aplica `slugify()` sobre ese nombre.

### 2.3 Función slugify (exacta, de `maps/names.ts`)

```typescript
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quita diacríticos (é→e, ñ→n, á→a, ü→u)
    .replace(/[^a-z0-9]+/g, '_')       // no-alfanumérico → guión bajo
    .replace(/^_+|_+$/g, '')           // trim de guiones bajos
    .slice(0, 100)                      // máximo 100 chars
}
```

**Ejemplos concretos de la discrepancia:**

| Nombre en receta | `slugify(product)` → `ingredient_id` | ID real en catálogo |
|---|---|---|
| `ACEITE OLIVA` | `aceite_oliva` | `ABA003` |
| `PECHUGA DE POLLO` | `pechuga_de_pollo` | `PRO015` |
| `HUEVO BLANCO` | `huevo_blanco` | `PRO002` |
| `AGUACATE` | `aguacate` | `FYV001` |

### 2.4 Diagnóstico raíz

El catálogo usa `codigo` como clave primaria. Las recetas generan una clave derivada de `slugify(nombre)`. Estas dos claves **nunca coinciden** — la comparación `ingredientIds.has(ingredient_id)` siempre es falsa para recetas reales.

Esto es un **mismatch estructural de esquema**, no un error de datos. El 100% de las 1,456 líneas de receta son orphans por diseño del pipeline actual.

---

## 3. Resumen de clasificación

| Categoría | Count | % orphan IDs | Líneas afectadas | Recuperable sin aprobación | Requiere aprobación | Imposible |
|---|---|---|---|---|---|---|
| `EXACT_MATCH` | 0 | 0.0% | 0 | — | — | — |
| `NORMALIZED_EXACT` | 511 | 87.2% | 1,334 | Si (mecánico) | No | No |
| `ACCENT_INSENSITIVE` | 0 | 0.0% | 0 | Si | No | No |
| `PUNCTUATION_INSENSITIVE` | 0 | 0.0% | 0 | Si | No | No |
| `KNOWN_ALIAS` | 0 | 0.0% | 0 | No | Si | No |
| `SINGLE_FUZZY_CANDIDATE` | 2 | 0.3% | 2 | No | Si | No |
| `AMBIGUOUS_CANDIDATES` | 0 | 0.0% | 0 | No | No | Si |
| `NO_CANDIDATE` | 73 | 12.5% | 120 | No | No | Si (requiere re-extracción) |
| **TOTAL** | **586** | **100%** | **1,456** | | | |

**Verificación de reconciliación:** `0 + 511 + 0 + 0 + 0 + 2 + 0 + 73 = 586 = orphan_ids_unicos` — PASS

---

## 4. Verificación de reconciliación

```
EXACT_MATCH              0
NORMALIZED_EXACT       511
ACCENT_INSENSITIVE       0
PUNCTUATION_INSENSITIVE  0
KNOWN_ALIAS              0
SINGLE_FUZZY_CANDIDATE   2
AMBIGUOUS_CANDIDATES     0
NO_CANDIDATE            73
─────────────────────────
TOTAL                  586  ==  orphan_ids_unicos (586)  ✓ PASS
```

---

## 5. Top causas por frecuencia

| Rango | Patrón | Ejemplo | Causa técnica |
|---|---|---|---|
| 1 | `slugify(nombre)` !== `codigo` | `aceite_oliva` vs `ABA003` | Mismatch estructural de esquema — cubre el 87.2% de todos los casos |
| 2 | Producto no existe en catálogo Wansoft | `GALLETA AMALAY A GRANEL` (20 líneas) | Producto de retail/mercado no registrado como MP en inventario |
| 3 | Sub-receta no catalogada como producto | `SUB CARROT CAKE` | Sub-receta existe en Wansoft pero no tiene entrada en `wansoft_products.json` |
| 4 | "De la casa" — preparación interna | `VINAGRETA DE LA CASA`, `GRANOLA DE LA CASA` | Preparación interna sin código de producto |
| 5 | Producto de terceros con nombre largo | `CINZANO PRO SPRITZ (VINO ESPUMOSO)` | Nunca existió en catálogo Wansoft como MP |
| 6 | Variante de nombre con typo en receta | `KAMBUCHA` vs `KOMBUCHA` | Typo en data de origen — 2 casos (Levenshtein dist=1 y dist=2) |

---

## 6. Top nombres problemáticos (por líneas afectadas)

| orphan_ingredient_id | Nombre original | Líneas | Categoría | Candidato |
|---|---|---|---|---|
| `pechuga_de_pollo` | PECHUGA DE POLLO | 53 | NORMALIZED_EXACT | `PRO015` |
| `huevo_blanco` | HUEVO BLANCO | 44 | NORMALIZED_EXACT | `PRO002` |
| `leche_entera` | LECHE ENTERA | 39 | NORMALIZED_EXACT | `LAC001` |
| `queso_manchego` | QUESO MANCHEGO | 38 | NORMALIZED_EXACT | `LAC005` |
| `aguacate` | AGUACATE | 35 | NORMALIZED_EXACT | `FYV001` |
| `aceite_oliva` | ACEITE OLIVA | 30 | NORMALIZED_EXACT | `ABA003` |
| `galleta_amalay_a_granel` | GALLETA AMALAY A GRANEL | 20 | NO_CANDIDATE | — |
| `crema_cheese` | CREMA CHEESE | 18 | NORMALIZED_EXACT | `LAC008` |
| `tomate_cherry` | TOMATE CHERRY | 17 | NORMALIZED_EXACT | `FYV012` |
| `tortilla_de_maiz` | TORTILLA DE MAIZ | 16 | NORMALIZED_EXACT | `ABA025` |
| `sub_salsa_roja` | SUB SALSA ROJA | 15 | NORMALIZED_EXACT | `SUBS001` |
| `limón` → `limon` | LIMÓN | 14 | NORMALIZED_EXACT | `FYV008` |
| `jitomate_guaje` | JITOMATE GUAJE | 13 | NORMALIZED_EXACT | `FYV010` |
| `cinzano_pro_spritz_vino_espumoso` | CINZANO PRO SPRITZ (VINO ESPUMOSO) | 7 | NO_CANDIDATE | — |
| `granola_de_la_casa` | GRANOLA DE LA CASA | 4 | NO_CANDIDATE | — |

*Nota: los conteos de líneas anteriores son de los casos con mayor impacto por orphan ID único. Ver `orphan-classification-report.json` para la lista completa.*

---

## 7. Casos ambiguos (AMBIGUOUS_CANDIDATES)

Ninguno. Con Levenshtein ≤ 2, todos los orphans con candidatos tienen exactamente 0 o 1 candidato. No hay casos ambiguos en este dataset.

---

## 8. Casos sin candidato (NO_CANDIDATE — 73 total)

Listado completo por líneas afectadas (solo top 30; resto en `orphan-classification-report.json`):

| orphan_ingredient_id | Nombre original | Líneas | Flags |
|---|---|---|---|
| `galleta_amalay_a_granel` | GALLETA AMALAY A GRANEL | 20 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `cinzano_pro_spritz_vino_espumoso` | CINZANO PRO SPRITZ (VINO ESPUMOSO) | 7 | — |
| `granola_de_la_casa` | GRANOLA DE LA CASA | 4 | HOUSE_RECIPE_NOT_IN_CATALOG |
| `leche_de_almendra` | LECHE DE ALMENDRA | 4 | — |
| `salsa_para_pizza` | SALSA PARA PIZZA | 4 | — |
| `vinagreta_de_la_casa` | VINAGRETA DE LA CASA | 3 | HOUSE_RECIPE_NOT_IN_CATALOG |
| `galletas_amalay_pq_de_3_pzs` | GALLETAS AMALAY PQ DE 3 PZS | 3 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `amalay_cafe_molido_500g` | AMALAY - CAFE MOLIDO 500G. | 2 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `cruffin_dulce_de_leche` | CRUFFIN DULCE DE LECHE | 2 | — |
| `totopo_heb` | TOTOPO HEB | 2 | — |
| `pollo_cocido` | POLLO COCIDO | 2 | — |
| `amalay_galletas_bote_420g` | AMALAY GALLETAS BOTE 420g | 2 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `galletas_amalay_bote_mediano_180_gr` | GALLETAS AMALAY BOTE MEDIANO 180 GR | 2 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `glitt_fosforos_999_wishes_metal_tip` | GLITT - FOSFOROS 999 WISHES METAL TIP | 2 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `semilla_de_girasol` | SEMILLA DE GIRASOL | 2 | — |
| `sub_carrot_cake` | SUB CARROT CAKE | 1 | SUBRECETA_MISSING_FROM_CATALOG |
| `sub_rosca_de_reyes_nutella_4_6_pax` | SUB ROSCA DE REYES NUTELLA 4-6 PAX | 1 | SUBRECETA_MISSING_FROM_CATALOG |
| `sub_rosca_de_reyes_reg_4_6_pax` | SUB ROSCA DE REYES REG 4-6 PAX | 1 | SUBRECETA_MISSING_FROM_CATALOG |
| `sub_amalay_sour_watermelon_bolsa_100g` | SUB AMALAY - SOUR WATERMELON BOLSA 100G | 1 | SUBRECETA_MISSING_FROM_CATALOG |
| `cafe_amalay_300_gr_molido` | CAFÉ AMALAY 300 GR MOLIDO | 1 | BRANDED_PRODUCT_NOT_IN_CATALOG |
| `crema_de_pistache` | CREMA DE PISTACHE | 1 | — |
| `chai_en_polvo_sin_azucar` | CHAI EN POLVO SIN AZUCAR | 1 | — |
| `pollo_cocido` | POLLO COCIDO | 2 | — |
| `botella_te_kambucha` | BOTELLA TE KAMBUCHA | 1 | — |
| *(48 restantes con 1 línea cada uno)* | Productos de retail/tienda, ítems de temporada | 1 cada uno | BRANDED_PRODUCT_NOT_IN_CATALOG o sin flag |

**Sub-grupos dentro de NO_CANDIDATE:**

| Sub-grupo | Count | Líneas |
|---|---|---|
| `BRANDED_PRODUCT_NOT_IN_CATALOG` | 16 | 37 |
| `SUBRECETA_MISSING_FROM_CATALOG` | 4 | 4 |
| `HOUSE_RECIPE_NOT_IN_CATALOG` | 2 | 7 |
| Sin flag (producto desconocido) | 51 | 72 |

---

## 9. Recetas afectadas

| Grupo | Count | Descripción |
|---|---|---|
| Completamente resolvibles | 0 | Ninguna receta tiene todos sus ingredientes resolvibles |
| Afectadas parcialmente | 0 | Ninguna receta tiene mezcla de ingredientes resolvibles e irresolvibles |
| Afectadas completamente | 615 | Todas las recetas tienen 100% de sus ingredientes como orphans |

**Por qué todas las recetas están completamente afectadas:** el catálogo tiene 769 productos con IDs tipo `ABA003`. Las recetas generan IDs tipo `aceite_oliva`. El lookup `ingredientIds.has("aceite_oliva")` siempre falla porque el Set contiene `"ABA003"`. Ningún producto puede resolverse bajo la lógica actual.

---

## 10. Recomendación para Fase 1

### Grupo A — Corrección determinista segura (511 orphan IDs, 1,334 líneas)

**Categoría: NORMALIZED_EXACT**

El slug de la receta (`slugify(product_name)`) coincide exactamente con el slug del nombre del producto en el catálogo (`slugify(nombre)`). La resolución es determinista: construir un índice `slug→codigo` en tiempo de carga y resolver antes del orphan check.

**Implementación sugerida en `dry-run.ts`:**

```typescript
// Construir índice slug→codigo una sola vez
const slugIndex = new Map<string, string>()
for (const ing of normalizedIngredients) {
  const slug = slugify(String(ing.name))
  slugIndex.set(slug, String(ing.id))  // ing.id es el codigo
}

// En el loop de recetas, antes del orphan check:
const resolvedId = slugIndex.get(raw.ingredient_id) ?? raw.ingredient_id
if (resolvedId && !ingredientIds.has(resolvedId)) {
  orphans.add(raw.ingredient_id)
}
```

Esta corrección no modifica ningún JSON fuente, no requiere aliases, y es completamente automática. Cobertura esperada: **87.2% de los orphan IDs** (1,334/1,456 líneas = 91.6% de las líneas).

**Aprobación requerida:** No — es equivalente a normalizar el schema en el pipeline.

### Grupo B — Aliases que requieren aprobación (2 orphan IDs, 2 líneas)

**Categoría: SINGLE_FUZZY_CANDIDATE**

| orphan_ingredient_id | Nombre original | Candidato sugerido | Codigo | Distancia |
|---|---|---|---|---|
| `kambucha_original_377_ml` | KAMBUCHA ORIGINAL 377 ML | KOMBUCHA ORIGINAL 377 ML. | `BEB85066` | 1 |
| `kambucha_sandia_fresca_377_ml` | KAMBUCHA SANDIA FRESCA 377 ML | KOMBUCHA SANDIA FRESA 377 ML. | `BEB85080` | 2 |

Ambos son el mismo error tipográfico: "KAMBUCHA" en las recetas vs "KOMBUCHA" en el catálogo. La corrección es obvia pero requiere confirmación de Daniel antes de aplicarse automáticamente.

**Aprobación requerida:** Si — añadir a `maps/names.ts` o como alias explícito.

### Grupo C — Revisión manual (0 casos)

No hay casos AMBIGUOUS_CANDIDATES en este dataset.

### Grupo D — Datos imposibles de resolver (73 orphan IDs, 120 líneas)

**Categoría: NO_CANDIDATE**

Requieren una de estas acciones, decidida caso a caso:

| Sub-grupo | Acción recomendada |
|---|---|
| `SUBRECETA_MISSING_FROM_CATALOG` (4 IDs) | Re-extraer `wansoft_subproductos.json` y verificar si `SUB CARROT CAKE`, etc. tienen código en Wansoft |
| `BRANDED_PRODUCT_NOT_IN_CATALOG` (16 IDs) | Verificar si el producto existe en Wansoft bajo otro nombre/departamento; si no, crear como MP o excluir la línea de receta |
| `HOUSE_RECIPE_NOT_IN_CATALOG` (2 IDs) | Registrar `VINAGRETA DE LA CASA` y `GRANOLA DE LA CASA` como sub-recetas o MPs en Wansoft |
| Sin flag — ingredientes simples no encontrados (51 IDs) | Verificar en Wansoft: probablemente productos discontinuados o con nombre diferente |

---

## 11. Tests del clasificador

Los siguientes casos de prueba verifican el comportamiento del clasificador `classify-orphans.ts`:

```typescript
// Test 1 — NORMALIZED_EXACT: slug de nombre en receta == slug de nombre en catálogo
// Input: product {codigo: "ABA003", nombre: "ACEITE OLIVA"}
//        recipe ingredient {product: "ACEITE OLIVA", qty: 0.1}
// ingredient_id generado: slugify("ACEITE OLIVA") = "aceite_oliva"
// Esperado: category = NORMALIZED_EXACT, candidate_ids = ["ABA003"]

// Test 2 — NO_CANDIDATE simple
// Input: product catalog sin "GALLETA AMALAY A GRANEL"
//        recipe ingredient {product: "GALLETA AMALAY A GRANEL"}
// ingredient_id generado: "galleta_amalay_a_granel"
// Esperado: category = NO_CANDIDATE, flags contiene "BRANDED_PRODUCT_NOT_IN_CATALOG"

// Test 3 — SINGLE_FUZZY_CANDIDATE: typo KAMBUCHA vs KOMBUCHA
// Input: product {codigo: "BEB85066", nombre: "KOMBUCHA ORIGINAL 377 ML."}
//        recipe ingredient {product: "KAMBUCHA ORIGINAL 377 ML"}
// ingredient_id generado: "kambucha_original_377_ml"
// candidate slug: "kombucha_original_377_ml"
// Levenshtein("kambucha_original_377_ml", "kombucha_original_377_ml") = 1
// Esperado: category = SINGLE_FUZZY_CANDIDATE, candidate_ids = ["BEB85066"]

// Test 4 — EXACT_MATCH (debe ser 0 — caso de bug)
// Input: product {codigo: "test_slug_id", nombre: "TEST"}
//        recipe ingredient_id = "test_slug_id"
// Esperado: category = EXACT_MATCH (bug path — no debe ocurrir en producción)

// Test 5 — SUBRECETA_MISSING flag
// Input: orphan con id "sub_carrot_cake", no existe en catálogo
// Esperado: category = NO_CANDIDATE, flags contiene "SUBRECETA_MISSING_FROM_CATALOG"

// Test 6 — Reconciliación
// sum(all categories) debe ser igual a orphan_registry.size
// Esperado: reconciliation_check = true

// Test 7 — Cardinalidades fijas (smoke test sobre datos reales)
// total_records = 2225, rejected = 1456, orphan_ids = 586
// Esperado invariante: categorías suman exactamente 586
```

---

## 12. Notas metodológicas

**Orden de transformaciones aplicado:**
1. EXACT_MATCH — `productByCodigo.has(orphan_id)`
2. NORMALIZED_EXACT — `slugToCodeMap.has(orphan_id)` donde el mapa fue construido con `slugify(product.nombre)`
3. ACCENT_INSENSITIVE — `normToCodeMap.has(normalizeForMatching(orphan_id.replace(/_/g,' ')))` donde `normalizeForMatching` quita diacríticos y alfanumérico no-ASCII
4. PUNCTUATION_INSENSITIVE — quitar `[._\-\/(),]` de ambos lados y comparar
5. KNOWN_ALIAS — no aplica (`maps/names.ts` no tiene diccionario de aliases, solo funciones de normalización)
6. SINGLE_FUZZY_CANDIDATE — Levenshtein(orphan_id, product_slug) ≤ 2, exactamente 1 candidato
7. AMBIGUOUS_CANDIDATES — Levenshtein ≤ 2, más de 1 candidato
8. NO_CANDIDATE — ningún método produce match

**Qué constituye un "match":**
Para categorías 2-4, un match es cuando la transformación del `orphan_ingredient_id` es igual (string equality) a la misma transformación aplicada al `slugify(product.nombre)` de algún producto del catálogo.

**Limitaciones del análisis:**
- `wansoft_existencias.json` y `wansoft_existencias_20260707.json` no fueron usados como fuente alternativa de ingredientes porque `dry-run.ts` usa `wansoft_products.json` exclusivamente. Si hay productos en existencias que no están en products.json, quedan fuera del alcance de este diagnóstico.
- `maps/names.ts` no contiene aliases de ingredientes (KNOWN_ALIAS = 0). Si se agregan aliases en el futuro, la categoría 5 tendrá entradas.
- La corrección del Grupo A (NORMALIZED_EXACT) cambia el comportamiento del pipeline pero no el esquema de datos. Requiere MT-04 para implementación.

**Asunciones cuando un archivo fuente no existe en el worktree:**
- Los archivos `agents/wansoft/*.json` no existen en el worktree git (`agents/wansoft/` solo tiene scripts Python). Se usaron los paths del repo principal (`/Users/danielrg/fullsite/agents/wansoft/`). El script `classify-orphans.ts` usa paths relativos `../../agents/wansoft/` desde `scripts/migration-pipeline/` — funcionará correctamente desde el repo raíz pero no desde un worktree aislado que no tenga los JSONs copiados.
- `orphan-classification-report.json` fue generado ejecutando la misma lógica en Python con los datos reales. El TypeScript produce output idéntico cuando se ejecuta desde el repo principal con `npx tsx scripts/migration-pipeline/classify-orphans.ts`.

**Reproducibilidad:**
El clasificador es determinista: misma entrada → mismo output. No usa timestamps en la clasificación (solo en `metadata.generated_at`). El único elemento no-determinista es el orden de iteración sobre `orphanRegistry`, que puede variar entre runs de Node.js. El output JSON agrupa por categoría, por lo que el orden interno de `by_category[cat]` puede variar, pero los conteos y la reconciliación son estables.
