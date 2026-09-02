/**
 * recipe-derivation — Deriva la capa de DEPLECIÓN (`pos_recipes_old`, plano, con
 * `ingredient_id` real) desde la capa de COSTEO (`pos_recipes.ingredientes`, jsonb
 * con nombres). Es el eslabón que faltaba: sin él un tenant tiene costeo/IA pero el
 * POS nunca descuenta stock (la venta rebaja vía `r1_reconcile_item` leyendo R1, que
 * se construye desde `pos_recipes_old` por `/api/pos/recipe-sync`).
 *
 * CONTRATO (por qué existe y qué garantiza):
 *  - PURO: cero acceso a BD/red. Entra data del tenant, sale { rows, report }. Esto
 *    lo hace testeable y reusable: lo usa el cierre de un cliente Y el uploader de
 *    Excel de onboarding. Una sola implementación, con guardarraíles, evita repetir
 *    los hacks per-cliente que causaron errores (tabla equivocada, no-idempotencia,
 *    unidades sin normalizar, nombres sin resolver).
 *  - EXPLOTA todo a INSUMO CRUDO: combos (BOM 2 niveles) y subrecetas se resuelven
 *    recursivamente hasta filas que apuntan a `pos_ingredients`. Así `recipe-sync`
 *    (que salta `ingredient_type='sub_recipe'`) recibe solo líneas 'ingredient' y
 *    construye R1 limpio. Es la ÚNICA estrategia que el motor de rebaja soporta
 *    (el RPC no encadena producto→producto) y evita doble conteo.
 *  - NADA SILENCIOSO: nombres de insumo no resueltos y unidades desconocidas se
 *    reportan en `report`, no se descartan. El llamador decide (crear el insumo,
 *    corregir el nombre) ANTES de escribir.
 *  - `client_id` NO es responsabilidad de este módulo: lo pone el llamador al
 *    persistir (falla cerrado si va vacío). Aquí solo se derivan filas por tenant.
 *
 * No confundir con `cost-engine.ts` (costeo puro, derivado, no persiste) ni con
 * `inventory.ts` (`recordMovement`, movimientos manuales de stock). Ver
 * `docs/platform/CERRAR-CHICKIN-Y-ONBOARDING-RAIZ.md`.
 */

/** Unidad canónica aceptada por los CHECK de `pos_inventory.stock_unit` y
 * `pos_recipe_lines.recipe_unit`, y por `convert_recipe_to_stock`. */
export type CanonicalUnit = 'kg' | 'g' | 'lt' | 'ml' | 'pz'

/** Un ingrediente del catálogo del tenant (`pos_ingredients`). */
export interface CatalogIngredient {
  id: string
  name: string
  unit: string | null
}

/** Un platillo del menú del tenant (`pos_menu_items`). */
export interface CatalogMenuItem {
  id: string
  name: string
}

/** Una entrada del jsonb `ingredientes` de una receta. */
export interface RecipeIngredientEntry {
  nombre: string
  /** cantidad por porción (en la unidad `um`); para un componente compuesto = # de piezas */
  porcion: number
  um?: string | null
}

/** Una receta de `pos_recipes` (vendible si `precio_venta != null`; subreceta si null). */
export interface SourceRecipe {
  nombre: string
  precio_venta: number | null
  costo_total?: number | null
  ingredientes: RecipeIngredientEntry[]
}

/** Una fila derivada lista para `pos_recipes_old` (sin `client_id`, sin `id`). */
export interface DerivedRecipeLine {
  menu_item_id: string
  menu_item_name: string
  ingredient_id: string
  quantity: number
  unit: CanonicalUnit | null
  ingredient_type: 'ingredient'
}

export interface DerivationReport {
  /** Nombres del jsonb que no resolvieron ni a insumo ni a receta (líneas perdidas). */
  unresolvedNames: string[]
  /** Unidades del jsonb que no mapearon al vocabulario canónico (línea con unit=null → bloqueará la rebaja). */
  unknownUnits: string[]
  /** Recetas vendibles sin platillo de menú correspondiente (no se derivan). */
  menuItemsNotFound: string[]
  /** Ciclos/recursión excedida (composite que se referencia en loop). */
  cyclesDetected: string[]
  /** Recetas cuya suma de líneas no reconcilia con costo_total (si se proveyó). */
  reconciliationWarnings: { recipe: string; expected: number; derived: number }[]
}

export interface DerivationResult {
  rows: DerivedRecipeLine[]
  report: DerivationReport
}

/** Normaliza un nombre para matching robusto: minúsculas, sin acentos, espacios colapsados. */
export function normalizeName(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos combinantes
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const UNIT_MAP: Record<string, CanonicalUnit> = {
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg',
  ml: 'ml', mls: 'ml', mililitro: 'ml', mililitros: 'ml',
  lt: 'lt', lts: 'lt', l: 'lt', litro: 'lt', litros: 'lt',
  pz: 'pz', pza: 'pz', pzs: 'pz', pzas: 'pz', pieza: 'pz', piezas: 'pz', pieza_s: 'pz', unidad: 'pz',
}

/** Mapea una unidad libre (GRS/ML/PZA…) al vocabulario canónico; null si no reconoce. */
export function normalizeUnit(um: string | null | undefined): CanonicalUnit | null {
  if (!um) return null
  const key = normalizeName(um).replace(/\./g, '').replace(/\s/g, '')
  return UNIT_MAP[key] ?? null
}

/**
 * Deriva las líneas planas (`pos_recipes_old`) para TODAS las recetas vendibles de un
 * tenant, explotando combos y subrecetas hasta insumo crudo.
 */
export function deriveRecipeLines(
  recipes: SourceRecipe[],
  ingredients: CatalogIngredient[],
  menuItems: CatalogMenuItem[],
): DerivationResult {
  const ingByName = new Map<string, CatalogIngredient>()
  for (const ing of ingredients) ingByName.set(normalizeName(ing.name), ing)

  const recipeByName = new Map<string, SourceRecipe>()
  for (const r of recipes) recipeByName.set(normalizeName(r.nombre), r)

  const menuByName = new Map<string, CatalogMenuItem>()
  for (const mi of menuItems) menuByName.set(normalizeName(mi.name), mi)

  const report: DerivationReport = {
    unresolvedNames: [],
    unknownUnits: [],
    menuItemsNotFound: [],
    cyclesDetected: [],
    reconciliationWarnings: [],
  }
  const unresolved = new Set<string>()
  const unknownUnits = new Set<string>()
  const cycles = new Set<string>()

  /**
   * Explota una receta a hojas (insumo crudo). `scale` multiplica las porciones al
   * subir por un componente compuesto. `visiting` corta ciclos.
   */
  function explode(
    recipe: SourceRecipe,
    scale: number,
    visiting: Set<string>,
    acc: Map<string, { quantity: number; unit: CanonicalUnit | null }>,
  ): void {
    for (const entry of recipe.ingredientes || []) {
      const nk = normalizeName(entry.nombre)
      const qty = (Number(entry.porcion) || 0) * scale
      if (qty <= 0) continue

      const asIngredient = ingByName.get(nk)
      if (asIngredient) {
        // Hoja: insumo crudo real. La unidad de la línea viene del jsonb (um),
        // no del catálogo — es la unidad EN QUE se usa en la receta.
        const unit = normalizeUnit(entry.um)
        if (unit === null && entry.um) unknownUnits.add(entry.um)
        const prev = acc.get(asIngredient.id)
        if (prev) prev.quantity += qty
        else acc.set(asIngredient.id, { quantity: qty, unit })
        continue
      }

      const asRecipe = recipeByName.get(nk)
      if (asRecipe) {
        // Compuesto (combo o subreceta): recursión, escalando por # de piezas.
        if (visiting.has(nk)) { cycles.add(entry.nombre); continue }
        visiting.add(nk)
        explode(asRecipe, qty, visiting, acc)
        visiting.delete(nk)
        continue
      }

      // Ni insumo ni receta → línea perdida, se reporta.
      unresolved.add(entry.nombre)
    }
  }

  const rows: DerivedRecipeLine[] = []

  for (const recipe of recipes) {
    if (recipe.precio_venta == null) continue // subrecetas no son platillos vendibles
    const menuItem = menuByName.get(normalizeName(recipe.nombre))
    if (!menuItem) { report.menuItemsNotFound.push(recipe.nombre); continue }

    const acc = new Map<string, { quantity: number; unit: CanonicalUnit | null }>()
    explode(recipe, 1, new Set([normalizeName(recipe.nombre)]), acc)

    for (const [ingredient_id, v] of acc) {
      rows.push({
        menu_item_id: menuItem.id,
        menu_item_name: menuItem.name,
        ingredient_id,
        quantity: Number(v.quantity.toFixed(6)),
        unit: v.unit,
        ingredient_type: 'ingredient',
      })
    }
  }

  report.unresolvedNames = [...unresolved].sort()
  report.unknownUnits = [...unknownUnits].sort()
  report.cyclesDetected = [...cycles].sort()
  return { rows, report }
}

/**
 * Deriva el `stock_unit` canónico de cada insumo desde su `unit` de catálogo.
 * Sin `stock_unit` la rebaja de receta se bloquea (`convert_recipe_to_stock` → NULL →
 * `BLOCKED_UNIT_MISSING`). Devuelve solo los insumos cuya unidad mapea; reporta el resto.
 */
export function deriveStockUnits(
  ingredients: CatalogIngredient[],
): { updates: { id: string; stock_unit: CanonicalUnit }[]; unknownUnits: { id: string; unit: string | null }[] } {
  const updates: { id: string; stock_unit: CanonicalUnit }[] = []
  const unknownUnits: { id: string; unit: string | null }[] = []
  for (const ing of ingredients) {
    const u = normalizeUnit(ing.unit)
    if (u) updates.push({ id: ing.id, stock_unit: u })
    else unknownUnits.push({ id: ing.id, unit: ing.unit })
  }
  return { updates, unknownUnits }
}
