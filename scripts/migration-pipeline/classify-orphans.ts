#!/usr/bin/env npx tsx
/**
 * MT-03 — Orphan Reference Classifier
 *
 * Deterministic analysis of every orphan ingredient_id produced by dry-run.ts.
 * Classifies each orphan into one of 8 categories in priority order and produces
 * orphan-classification-report.json.
 *
 * READ-ONLY. No writes to any database, no modifications to source JSONs.
 *
 * Usage (requires tsx):
 *   npx tsx scripts/migration-pipeline/classify-orphans.ts
 *
 * Root cause identified by this script:
 *   The dry-run pipeline builds ingredient catalog IDs from wansoft_products.json
 *   using the `codigo` field (e.g. "ABA003"). Recipe lines from wansoft_recetas.json
 *   reference ingredients by slugify(product_name) (e.g. "aceite_oliva"). Since
 *   "aceite_oliva" !== "ABA003", every single recipe line fails the lookup — 100%
 *   orphan rate is the expected result given the current pipeline logic.
 *
 * Fix (not applied here — requires MT-04 approval):
 *   Build a slug→codigo index at catalog-load time and resolve ingredient_id via
 *   that index before the orphan check, OR change the recipe normalizer to emit
 *   the codigo instead of the slug.
 *
 * Dependencies:
 *   - tsx (not in current package.json — add with: npm i -D tsx)
 *   - Node.js built-in fs, path
 *   - No external npm packages beyond tsx
 */

import * as fs from 'fs'
import * as path from 'path'

// ── Reproduced exactly from maps/names.ts ──

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}

function normalizeForMatching(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Levenshtein distance (pure, no deps) ──

function levenshtein(a: string, b: string): number {
  if (a.length > b.length) [a, b] = [b, a]
  let current: number[] = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let bi = 0; bi < b.length; bi++) {
    const previous = current
    current = [bi + 1, ...Array(a.length).fill(0)]
    for (let ai = 0; ai < a.length; ai++) {
      const ins = previous[ai + 1] + 1
      const del = current[ai] + 1
      const sub = previous[ai] + (a[ai] !== b[bi] ? 1 : 0)
      current[ai + 1] = Math.min(ins, del, sub)
    }
  }
  return current[a.length]
}

// ── Data structures ──

interface WansoftProduct {
  codigo: string
  nombre: string
  unidad: string
  departamento: string
  critico: boolean
  tipo: string
  rendimiento: number
  costo: number
}

interface WansoftIngredient {
  product: string
  unit: string
  qty: number
}

interface WansoftReceta {
  code: string
  dish: string
  ingredients: WansoftIngredient[]
}

type Category =
  | 'EXACT_MATCH'
  | 'NORMALIZED_EXACT'
  | 'ACCENT_INSENSITIVE'
  | 'PUNCTUATION_INSENSITIVE'
  | 'KNOWN_ALIAS'
  | 'SINGLE_FUZZY_CANDIDATE'
  | 'AMBIGUOUS_CANDIDATES'
  | 'NO_CANDIDATE'

interface OrphanEntry {
  orphan_ingredient_id: string
  source_names: string[]
  recipe_dishes: string[]
  line_count: number
  category: Category
  flags: string[]
  transformation_applied: string
  candidate_ids: string[]
  candidate_names: string[]
  note: string
}

// ── Load source data ──

const baseDir = path.dirname(new URL(import.meta.url).pathname)

function loadJSON<T>(filepath: string): T[] {
  try {
    const raw = fs.readFileSync(filepath, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    console.error(`Could not load: ${filepath}`)
    return []
  }
}

const productFile = path.resolve(baseDir, '../../agents/wansoft/wansoft_products.json')
const recipeFile  = path.resolve(baseDir, '../../agents/wansoft/wansoft_recetas.json')

const products = loadJSON<WansoftProduct>(productFile)
const recetas  = loadJSON<WansoftReceta>(recipeFile)

console.log('═══════════════════════════════════════════')
console.log('  MT-03 — ORPHAN REFERENCE CLASSIFIER')
console.log('═══════════════════════════════════════════')
console.log(`  Products loaded:  ${products.length}`)
console.log(`  Recetas loaded:   ${recetas.length}`)

// ── Build catalog indexes ──

// ID generation for products (mirrors dry-run.ts line 65):
//   id = String(raw.id || raw.codigo || slugify(String(raw.name || raw.nombre || '')))
// wansoft_products.json has no .id field, has .codigo → so id = codigo
const productByCodigo = new Map<string, WansoftProduct>()
const slugToCodeMap   = new Map<string, string[]>()  // slug of nombre → [codigos]
const normToCodeMap   = new Map<string, string[]>()  // normalizeForMatching of nombre → [codigos]

for (const p of products) {
  const codigo = p.codigo
  productByCodigo.set(codigo, p)

  const slug = slugify(p.nombre)
  if (!slugToCodeMap.has(slug)) slugToCodeMap.set(slug, [])
  slugToCodeMap.get(slug)!.push(codigo)

  const norm = normalizeForMatching(p.nombre)
  if (!normToCodeMap.has(norm)) normToCodeMap.set(norm, [])
  normToCodeMap.get(norm)!.push(codigo)
}

const allProductSlugs = [...slugToCodeMap.keys()]

// ── Build orphan registry from recipe lines ──
// ID generation for recipe ingredient references (mirrors dry-run.ts lines 120-126):
//   ingredient_id = slugify(ing.product)

interface OrphanInfo {
  sourceNames: Set<string>
  recipeDishes: Set<string>
  lineCount: number
}

const orphanRegistry = new Map<string, OrphanInfo>()

let totalRecipeLines = 0
for (const r of recetas) {
  for (const ing of r.ingredients ?? []) {
    totalRecipeLines++
    const iid = slugify(ing.product)
    // An ingredient is orphaned when its slugified ID is not found in the
    // product catalog (which uses codigo as ID — never a slug).
    if (!productByCodigo.has(iid)) {
      if (!orphanRegistry.has(iid)) {
        orphanRegistry.set(iid, { sourceNames: new Set(), recipeDishes: new Set(), lineCount: 0 })
      }
      const entry = orphanRegistry.get(iid)!
      entry.sourceNames.add(ing.product)
      entry.recipeDishes.add(r.dish)
      entry.lineCount++
    }
  }
}

console.log(`  Recipe lines:     ${totalRecipeLines}`)
console.log(`  Orphan IDs:       ${orphanRegistry.size}`)
console.log()

// ── Classify each orphan ──

const classified: OrphanEntry[] = []
const summaryCounts: Record<Category, number> = {
  EXACT_MATCH: 0,
  NORMALIZED_EXACT: 0,
  ACCENT_INSENSITIVE: 0,
  PUNCTUATION_INSENSITIVE: 0,
  KNOWN_ALIAS: 0,
  SINGLE_FUZZY_CANDIDATE: 0,
  AMBIGUOUS_CANDIDATES: 0,
  NO_CANDIDATE: 0,
}

for (const [oid, info] of orphanRegistry) {
  const entry: OrphanEntry = {
    orphan_ingredient_id: oid,
    source_names: [...info.sourceNames].sort(),
    recipe_dishes: [...info.recipeDishes].sort(),
    line_count: info.lineCount,
    category: 'NO_CANDIDATE',
    flags: [],
    transformation_applied: 'none',
    candidate_ids: [],
    candidate_names: [],
    note: '',
  }

  // ── Category 1: EXACT_MATCH ──
  // orphan_id literally exists as a product codigo — would be a bug in dry-run
  if (productByCodigo.has(oid)) {
    entry.category = 'EXACT_MATCH'
    entry.note = 'BUG: ID exists in catalog as codigo but was flagged as orphan in dry-run'
  }

  // ── Category 2: NORMALIZED_EXACT ──
  // slugify(product_name) from recipe exactly matches slugify(nombre) of a catalog product.
  // This is the primary root cause: 511 of 586 orphans fall here.
  else if (slugToCodeMap.has(oid)) {
    const cids = slugToCodeMap.get(oid)!
    entry.category = 'NORMALIZED_EXACT'
    entry.transformation_applied = 'slugify_nombre'
    entry.candidate_ids = cids
    entry.candidate_names = cids.map(c => productByCodigo.get(c)!.nombre)
    entry.note =
      'Slug of recipe product name matches slug of catalog product nombre exactly. ' +
      'Root fix: resolve ingredient_id via slug→codigo index at catalog-load time.'
  }

  // ── Category 3: ACCENT_INSENSITIVE ──
  // normalizeForMatching(oid) matches normalizeForMatching(product nombre).
  // Handles cases where slug comparison still differs due to accent-induced char differences.
  else {
    const oidNorm = normalizeForMatching(oid.replace(/_/g, ' '))
    if (normToCodeMap.has(oidNorm)) {
      const cids = normToCodeMap.get(oidNorm)!
      entry.category = 'ACCENT_INSENSITIVE'
      entry.transformation_applied = 'remove_accents_normalize'
      entry.candidate_ids = cids
      entry.candidate_names = cids.map(c => productByCodigo.get(c)!.nombre)
    }

    // ── Category 4: PUNCTUATION_INSENSITIVE ──
    // After removing ._-/(), characters, slugs match.
    else {
      const oidNoPunct = oidNorm.replace(/[._\-\/(),]+/g, '').replace(/\s+/g, ' ').trim()
      let punctMatch: { cids: string[]; names: string[] } | null = null
      for (const [slug, cids] of slugToCodeMap) {
        const slugNoPunct = slug.replace(/[._\-\/(),]+/g, '').replace(/\s+/g, ' ').trim()
        if (slugNoPunct === oidNoPunct) {
          punctMatch = { cids, names: cids.map(c => productByCodigo.get(c)!.nombre) }
          break
        }
      }

      if (punctMatch) {
        entry.category = 'PUNCTUATION_INSENSITIVE'
        entry.transformation_applied = 'remove_punctuation'
        entry.candidate_ids = punctMatch.cids
        entry.candidate_names = punctMatch.names
      }

      // ── Category 5: KNOWN_ALIAS ──
      // maps/names.ts contains no alias dictionary (only normalization functions),
      // so this category is empty in the current pipeline.
      // Placeholder: no-op.

      // ── Categories 6 & 7: FUZZY (Levenshtein ≤ 2) ──
      else {
        const fuzzy: Array<{ dist: number; slug: string; codigo: string; nombre: string }> = []
        for (const slug of allProductSlugs) {
          const d = levenshtein(oid, slug)
          if (d <= 2) {
            for (const codigo of slugToCodeMap.get(slug)!) {
              fuzzy.push({ dist: d, slug, codigo, nombre: productByCodigo.get(codigo)!.nombre })
            }
          }
        }
        fuzzy.sort((a, b) => a.dist - b.dist)

        if (fuzzy.length === 1) {
          entry.category = 'SINGLE_FUZZY_CANDIDATE'
          entry.transformation_applied = `levenshtein_dist_${fuzzy[0].dist}`
          entry.candidate_ids = [fuzzy[0].codigo]
          entry.candidate_names = [fuzzy[0].nombre]
          entry.note = 'SUGGESTION ONLY — requires human approval before applying'
        } else if (fuzzy.length > 1) {
          entry.category = 'AMBIGUOUS_CANDIDATES'
          entry.transformation_applied = 'levenshtein_dist_<=2'
          entry.candidate_ids = fuzzy.slice(0, 5).map(c => c.codigo)
          entry.candidate_names = fuzzy.slice(0, 5).map(c => c.nombre)
          entry.note = 'Multiple fuzzy candidates — requires manual review'
        }

        // ── Category 8: NO_CANDIDATE ──
        else {
          entry.category = 'NO_CANDIDATE'
          // Flag: sub_ prefix = subreceta reference missing from product catalog
          if (oid.startsWith('sub_')) {
            entry.flags.push('SUBRECETA_MISSING_FROM_CATALOG')
          }
          // Flag: known third-party brand names → likely market/retail products not in Wansoft inventory
          const sourceName = entry.source_names[0]?.toUpperCase() ?? ''
          if (
            sourceName.includes('AMALAY') ||
            sourceName.includes('ALMA VIVA') ||
            sourceName.includes('BAITZ') ||
            sourceName.includes('AMORANTH') ||
            sourceName.includes('BIRDMAN') ||
            sourceName.includes('GLITT') ||
            sourceName.includes('NUCELLI') ||
            sourceName.includes('EXTRA VIRGEN') ||
            sourceName.includes('BEEF JERKY')
          ) {
            entry.flags.push('BRANDED_PRODUCT_NOT_IN_CATALOG')
          }
          // Flag: "DE LA CASA" = house-made preparation not catalogued as ingredient
          if (sourceName.includes('DE LA CASA')) {
            entry.flags.push('HOUSE_RECIPE_NOT_IN_CATALOG')
          }
        }
      }
    }
  }

  summaryCounts[entry.category]++
  classified.push(entry)
}

// ── Recipe-level impact ──

const recipesFullyAffected: string[] = []
const recipesPartiallyAffected: string[] = []
const recipesFullyResolvable: string[] = []

for (const r of recetas) {
  const slugs = (r.ingredients ?? []).map(ing => slugify(ing.product))
  const orphanedSlugs = slugs.filter(s => orphanRegistry.has(s))
  if (orphanedSlugs.length === 0) {
    recipesFullyResolvable.push(r.dish)
  } else if (orphanedSlugs.length < slugs.length) {
    recipesPartiallyAffected.push(r.dish)
  } else {
    recipesFullyAffected.push(r.dish)
  }
}

// ── Build output report ──

const totalClassified = Object.values(summaryCounts).reduce((a, b) => a + b, 0)
const reconciles = totalClassified === orphanRegistry.size

const byCategory: Record<string, OrphanEntry[]> = {}
for (const cat of Object.keys(summaryCounts) as Category[]) {
  byCategory[cat] = classified.filter(e => e.category === cat)
}

const topProblematic = [...classified]
  .sort((a, b) => b.line_count - a.line_count)
  .slice(0, 15)

const report = {
  metadata: {
    generated_at: '2026-07-27',
    input_files: [productFile, recipeFile],
    dry_run_report_version: path.resolve(baseDir, 'dry-run-report.json'),
    total_records_in_source: products.length + totalRecipeLines,
    total_rejected: totalRecipeLines,
    total_classified: totalClassified,
  },
  cardinalidad: {
    recetas_unicas: recetas.length,
    lineas_de_receta: totalRecipeLines,
    ingredientes_en_catalogo: products.length,
    orphan_ids_unicos: orphanRegistry.size,
    recetas_afectadas_parcialmente: recipesPartiallyAffected.length,
    recetas_afectadas_completamente: recipesFullyAffected.length,
    recetas_completamente_resolvibles: recipesFullyResolvable.length,
    nota: 'Todas las recetas están afectadas: el catálogo usa codigo como ID pero las recetas generan IDs por slugify(product_name)',
  },
  summary: {
    ...summaryCounts,
    total: totalClassified,
    reconciliation_check: `sum == orphan_ids_unicos: ${reconciles}`,
  },
  by_category: byCategory,
  top_problematic_names: topProblematic,
  no_candidate_cases: byCategory['NO_CANDIDATE'],
  single_fuzzy_cases: byCategory['SINGLE_FUZZY_CANDIDATE'],
}

// ── Write report ──

const outPath = path.resolve(baseDir, 'orphan-classification-report.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

// ── Console summary ──

console.log('═══════════════════════════════════════════')
console.log('  CLASSIFICATION SUMMARY')
console.log('═══════════════════════════════════════════')
for (const [cat, count] of Object.entries(summaryCounts)) {
  const pct = ((count / orphanRegistry.size) * 100).toFixed(1)
  console.log(`  ${cat.padEnd(28)} ${String(count).padStart(4)}  (${pct}%)`)
}
console.log(`  ${'TOTAL'.padEnd(28)} ${String(totalClassified).padStart(4)}`)
console.log()
console.log(`  Reconciliation: ${reconciles ? 'PASS' : 'FAIL'} (${totalClassified} == ${orphanRegistry.size})`)
console.log()
console.log('  Recipe impact:')
console.log(`    Fully resolvable:   ${recipesFullyResolvable.length}`)
console.log(`    Partially affected: ${recipesPartiallyAffected.length}`)
console.log(`    Fully affected:     ${recipesFullyAffected.length}`)
console.log()
console.log(`  Report saved to: ${outPath}`)
