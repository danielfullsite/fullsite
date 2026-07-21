#!/usr/bin/env npx tsx
/**
 * Migration Pipeline — Dry Run
 *
 * Processes fixtures (or real data) through the normalization pipeline
 * and generates a validation report. Does NOT write to any database.
 *
 * Usage:
 *   npx tsx scripts/migration-pipeline/dry-run.ts
 *   npx tsx scripts/migration-pipeline/dry-run.ts --real  # use real data from JSON extracts
 */

import * as fs from 'fs'
import * as path from 'path'
import { normalizeCategory, CANONICAL_CATEGORIES } from './maps/categories'
import { normalizeUnit, UNIT_MAP } from './maps/units'
import { normalizeName, normalizeForMatching, normalizeDecimal, normalizeBoolean, slugify } from './maps/names'
import {
  validateIngredient, validateRecipe, findDuplicates,
  generateReport, type ValidationIssue
} from './validators'

const useReal = process.argv.includes('--real')
const baseDir = path.dirname(import.meta.url.replace('file://', ''))

// ── Load data ──

function loadJSON(filepath: string): unknown[] {
  try {
    const raw = fs.readFileSync(filepath, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    console.error('Could not load:', filepath)
    return []
  }
}

const ingredientFile = useReal
  ? path.resolve(baseDir, '../../agents/wansoft/wansoft_products.json')
  : path.resolve(baseDir, 'fixtures/ingredients.json')

const recipeFile = useReal
  ? path.resolve(baseDir, '../../agents/wansoft/wansoft_recetas.json')
  : path.resolve(baseDir, 'fixtures/recipes.json')

console.log('═══════════════════════════════════════════')
console.log('  MIGRATION PIPELINE — DRY RUN')
console.log('  Mode:', useReal ? 'REAL DATA' : 'FIXTURES')
console.log('═══════════════════════════════════════════')
console.log()

// ── Process Ingredients ──

const rawIngredients = loadJSON(ingredientFile) as Record<string, unknown>[]
console.log(`INGREDIENTS: ${rawIngredients.length} records loaded`)

const allIssues: ValidationIssue[] = []
const unmappedCats = new Set<string>()
const unmappedUnits = new Set<string>()
const normalizedIngredients: Record<string, unknown>[] = []

for (const raw of rawIngredients) {
  // Normalize fields
  const id = String(raw.id || raw.codigo || slugify(String(raw.name || raw.nombre || '')))
  const name = normalizeName(String(raw.name || raw.nombre || ''))
  const rawUnit = String(raw.unit || raw.unidad || '')
  const { unit, warning: unitWarning } = normalizeUnit(rawUnit)
  const rawCat = String(raw.category || raw.departamento || '')
  const category = normalizeCategory(rawCat)
  const cost = normalizeDecimal(raw.cost_per_unit || raw.costo)
  const critical = normalizeBoolean(raw.critico || raw.critical)

  if (category === 'SIN CATEGORIA' && rawCat && rawCat !== 'null' && rawCat !== 'undefined') {
    unmappedCats.add(rawCat)
  }
  if (unitWarning && rawUnit) {
    unmappedUnits.add(rawUnit)
  }

  // Validate
  const issues = validateIngredient({ id, name, unit: rawUnit, cost_per_unit: cost, category: rawCat })
  allIssues.push(...issues)

  // Normalize
  const hasErrors = issues.some(i => i.severity === 'error')
  if (!hasErrors) {
    normalizedIngredients.push({
      id,
      name,
      unit,
      cost_per_unit: cost,
      category,
      yield_factor: normalizeDecimal(raw.rendimiento || raw.yield_factor || 1),
      product_type: id.startsWith('sub_') ? 'subproducto' : 'materia_prima',
      is_critical: critical,
      source_system: 'wansoft',
      source_id: String(raw.codigo || raw.id || ''),
    })
  }
}

// Find duplicates
const dupes = findDuplicates(normalizedIngredients.map(i => ({ id: String(i.id), name: String(i.name) })))

console.log(`  Normalized: ${normalizedIngredients.length}`)
console.log(`  Rejected:   ${rawIngredients.length - normalizedIngredients.length}`)
console.log(`  Duplicates: ${dupes.exact.length} exact pairs`)
console.log()

// ── Process Recipes ──

let rawRecipes: { menu_item_name?: string; ingredient_id?: string; quantity?: unknown }[]

if (useReal) {
  // Real format: {code, dish, ingredients: [{product, unit, qty}]}
  const realRecipes = loadJSON(recipeFile) as { code: string; dish: string; ingredients: { product: string; unit: string; qty: number }[] }[]
  rawRecipes = []
  for (const r of realRecipes) {
    for (const ing of r.ingredients || []) {
      rawRecipes.push({
        menu_item_name: r.dish,
        ingredient_id: slugify(ing.product),
        quantity: ing.qty,
      })
    }
  }
} else {
  rawRecipes = loadJSON(recipeFile) as { menu_item_name?: string; ingredient_id?: string; quantity?: unknown }[]
}

console.log(`RECIPES: ${rawRecipes.length} lines loaded`)

const ingredientIds = new Set(normalizedIngredients.map(i => String(i.id)))
const orphans = new Set<string>()
let recipeErrors = 0

for (const raw of rawRecipes) {
  const issues = validateRecipe(raw, ingredientIds)
  allIssues.push(...issues)
  if (issues.some(i => i.severity === 'error')) recipeErrors++

  // Track orphan references
  if (raw.ingredient_id && !ingredientIds.has(raw.ingredient_id)) {
    orphans.add(raw.ingredient_id)
  }
}

console.log(`  Valid:     ${rawRecipes.length - recipeErrors}`)
console.log(`  Errors:    ${recipeErrors}`)
console.log(`  Orphans:   ${orphans.size} missing ingredient_ids`)
console.log()

// ── Generate Report ──

const report = generateReport(allIssues, {
  total: rawIngredients.length + rawRecipes.length,
  unmappedCats,
  unmappedUnits,
  orphans,
  duplicates: { exact: dupes.exact.length, fuzzy: dupes.fuzzy.length },
})

console.log('═══════════════════════════════════════════')
console.log('  VALIDATION REPORT')
console.log('═══════════════════════════════════════════')
console.log()
console.log(`  Total records:    ${report.total_records}`)
console.log(`  Normalized:       ${report.normalized}`)
console.log(`  Rejected:         ${report.rejected}`)
console.log(`  Warnings:         ${report.warnings}`)
console.log(`  Errors:           ${report.errors}`)
console.log()
console.log(`  Unmapped categories: ${report.unmapped_categories.length}`)
for (const c of report.unmapped_categories) console.log(`    - "${c}"`)
console.log(`  Unmapped units:      ${report.unmapped_units.length}`)
for (const u of report.unmapped_units) console.log(`    - "${u}"`)
console.log(`  Orphan references:   ${report.orphan_references.length}`)
for (const o of report.orphan_references.slice(0, 10)) console.log(`    - ${o}`)
if (report.orphan_references.length > 10) console.log(`    ... and ${report.orphan_references.length - 10} more`)
console.log(`  Duplicate pairs:     ${report.duplicates.exact}`)
console.log()

// Error details
if (report.errors > 0) {
  console.log('  ERRORS:')
  for (const i of report.issues.filter(i => i.severity === 'error').slice(0, 20)) {
    console.log(`    ✗ [${i.domain}] ${i.record_id}: ${i.message}`)
  }
}

console.log()

// Calculate auto-normalization rate
const autoRate = Math.round(report.normalized / report.total_records * 100)
console.log(`  AUTO-NORMALIZATION RATE: ${autoRate}%`)
console.log(`  MANUAL REVIEW NEEDED:   ${report.unmapped_categories.length} categories + ${report.orphan_references.length} orphans + ${report.duplicates.exact} duplicates`)

// Write report to file
const reportPath = path.resolve(baseDir, 'dry-run-report.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log()
console.log(`  Report saved to: ${reportPath}`)
