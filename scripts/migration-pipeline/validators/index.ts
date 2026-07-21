/**
 * Pre-import validators — run before writing to any table.
 * Each validator returns a list of issues (warnings or errors).
 */

import { normalizeCategory, isKnownCategory } from '../maps/categories'
import { normalizeUnit } from '../maps/units'
import { normalizeDecimal, normalizeForMatching } from '../maps/names'

export type Severity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: Severity
  domain: string
  record_id: string
  field: string
  message: string
  value?: unknown
}

// ── Ingredient validators ──

export function validateIngredient(row: {
  id?: string
  name?: string
  unit?: string
  cost_per_unit?: unknown
  category?: string
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const rid = row.id || row.name || 'unknown'

  if (!row.name || row.name.trim() === '') {
    issues.push({ severity: 'error', domain: 'ingredient', record_id: rid, field: 'name', message: 'Empty name' })
  }

  if (!row.unit || row.unit.trim() === '') {
    issues.push({ severity: 'warning', domain: 'ingredient', record_id: rid, field: 'unit', message: 'Empty unit — will default to pz' })
  } else {
    const { warning } = normalizeUnit(row.unit)
    if (warning) {
      issues.push({ severity: 'warning', domain: 'ingredient', record_id: rid, field: 'unit', message: warning, value: row.unit })
    }
  }

  const cost = normalizeDecimal(row.cost_per_unit)
  if (cost < 0) {
    issues.push({ severity: 'error', domain: 'ingredient', record_id: rid, field: 'cost_per_unit', message: 'Negative cost', value: cost })
  } else if (cost === 0) {
    issues.push({ severity: 'warning', domain: 'ingredient', record_id: rid, field: 'cost_per_unit', message: 'Zero cost' })
  }

  if (row.category && !isKnownCategory(row.category)) {
    issues.push({ severity: 'warning', domain: 'ingredient', record_id: rid, field: 'category', message: `Unknown category: "${row.category}" → SIN CATEGORIA`, value: row.category })
  }

  return issues
}

// ── Recipe validators ──

export function validateRecipe(row: {
  menu_item_name?: string
  ingredient_id?: string
  quantity?: unknown
}, allIngredientIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const rid = `${row.menu_item_name}→${row.ingredient_id}`

  if (!row.menu_item_name) {
    issues.push({ severity: 'error', domain: 'recipe', record_id: rid, field: 'menu_item_name', message: 'Empty dish name' })
  }

  if (!row.ingredient_id) {
    issues.push({ severity: 'error', domain: 'recipe', record_id: rid, field: 'ingredient_id', message: 'Empty ingredient_id' })
  } else if (!allIngredientIds.has(row.ingredient_id)) {
    issues.push({ severity: 'error', domain: 'recipe', record_id: rid, field: 'ingredient_id', message: 'Orphan reference — ingredient_id not found in catalog', value: row.ingredient_id })
  }

  const qty = normalizeDecimal(row.quantity)
  if (qty <= 0) {
    issues.push({ severity: 'error', domain: 'recipe', record_id: rid, field: 'quantity', message: 'Zero or negative quantity', value: qty })
  }

  return issues
}

// ── Duplicate detector ──

export function findDuplicates(items: { id: string; name: string }[]): {
  exact: [string, string][]
  fuzzy: [string, string, number][]
} {
  const exact: [string, string][] = []
  const fuzzy: [string, string, number][] = []
  const byNorm = new Map<string, string[]>()

  for (const item of items) {
    const norm = normalizeForMatching(item.name)
    if (!byNorm.has(norm)) byNorm.set(norm, [])
    byNorm.get(norm)!.push(item.id)
  }

  for (const [, ids] of byNorm) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          exact.push([ids[i], ids[j]])
        }
      }
    }
  }

  return { exact, fuzzy }
}

// ── Supplier validators ──

export function validateSupplier(row: {
  name?: string
  rfc?: string
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const rid = row.name || 'unknown'

  if (!row.name || row.name.trim() === '') {
    issues.push({ severity: 'error', domain: 'supplier', record_id: rid, field: 'name', message: 'Empty name' })
  }

  if (row.rfc) {
    const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/
    if (!rfcRegex.test(row.rfc.toUpperCase())) {
      issues.push({ severity: 'warning', domain: 'supplier', record_id: rid, field: 'rfc', message: 'Invalid RFC format', value: row.rfc })
    }
  }

  return issues
}

// ── Full dataset validation ──

export interface ValidationReport {
  total_records: number
  normalized: number
  rejected: number
  warnings: number
  errors: number
  issues: ValidationIssue[]
  unmapped_categories: string[]
  unmapped_units: string[]
  orphan_references: string[]
  duplicates: { exact: number; fuzzy: number }
}

export function generateReport(issues: ValidationIssue[], extras: {
  total: number
  unmappedCats: Set<string>
  unmappedUnits: Set<string>
  orphans: Set<string>
  duplicates: { exact: number; fuzzy: number }
}): ValidationReport {
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  return {
    total_records: extras.total,
    normalized: extras.total - errors.length,
    rejected: errors.length,
    warnings: warnings.length,
    errors: errors.length,
    issues,
    unmapped_categories: [...extras.unmappedCats],
    unmapped_units: [...extras.unmappedUnits],
    orphan_references: [...extras.orphans],
    duplicates: extras.duplicates,
  }
}
