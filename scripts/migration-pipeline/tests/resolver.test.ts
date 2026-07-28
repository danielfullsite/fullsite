import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { buildSlugIndex, resolveIngredientId, type NormalizedIngredient } from '../lib/resolver'
import { slugify } from '../maps/names'

const gitCommonDir = execSync('git rev-parse --git-common-dir', {
  cwd: import.meta.dirname,
}).toString().trim()
const PROJECT_ROOT = path.resolve(
  path.isAbsolute(gitCommonDir) ? gitCommonDir : path.join(import.meta.dirname, gitCommonDir),
  '..'
)

// ── Unit tests — synthetic fixtures ──

describe('buildSlugIndex', () => {
  it('builds a slug→id map from a catalog', () => {
    const catalog: NormalizedIngredient[] = [
      { id: 'ABA003', name: 'ACEITE OLIVA' },
      { id: 'ABA002', name: 'ACEITE DE COCO' },
      { id: 'FYV001', name: 'AGUACATE' },
    ]
    const index = buildSlugIndex(catalog)
    expect(index.get('aceite_oliva')).toBe('ABA003')
    expect(index.get('aceite_de_coco')).toBe('ABA002')
    expect(index.get('aguacate')).toBe('FYV001')
    expect(index.size).toBe(3)
  })

  it('strips diacritics when building the index', () => {
    const catalog: NormalizedIngredient[] = [
      { id: 'LAC010', name: 'LECHE DESLACTOSADA' },
      { id: 'FYV008', name: 'LIMÓN' },
      { id: 'PRO031', name: 'CORAZÓN DE ALCACHOFA' },
    ]
    const index = buildSlugIndex(catalog)
    // slugify("LIMÓN") → "limon" (accent stripped)
    expect(index.get('limon')).toBe('FYV008')
    expect(index.get('limoń')).toBeUndefined()
    expect(index.get('corazon_de_alcachofa')).toBe('PRO031')
  })

  it('returns empty map for empty input', () => {
    const index = buildSlugIndex([])
    expect(index.size).toBe(0)
  })

  it('throws on slug collision between distinct IDs', () => {
    const catalog: NormalizedIngredient[] = [
      { id: 'X001', name: 'ACEITE OLIVA' },
      { id: 'X002', name: 'aceite-oliva' }, // same slug after normalization
    ]
    expect(() => buildSlugIndex(catalog)).toThrow(/Slug collision/)
  })

  it('does not throw when same id appears twice (idempotent)', () => {
    // Same id, same name — not a collision
    const catalog: NormalizedIngredient[] = [
      { id: 'ABA003', name: 'ACEITE OLIVA' },
      { id: 'ABA003', name: 'ACEITE OLIVA' },
    ]
    expect(() => buildSlugIndex(catalog)).not.toThrow()
    const index = buildSlugIndex(catalog)
    expect(index.get('aceite_oliva')).toBe('ABA003')
  })

  it('collision message names both conflicting IDs', () => {
    const catalog: NormalizedIngredient[] = [
      { id: 'X001', name: 'SALSA ROJA' },
      { id: 'X002', name: 'salsa-roja' },
    ]
    let message = ''
    try {
      buildSlugIndex(catalog)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('X001')
    expect(message).toContain('X002')
    expect(message).toContain('salsa_roja')
  })
})

describe('resolveIngredientId', () => {
  it('resolves a known slug to its catalog ID', () => {
    const index = new Map([['aceite_oliva', 'ABA003']])
    expect(resolveIngredientId('aceite_oliva', index)).toBe('ABA003')
  })

  it('returns the raw slug unchanged when not in the index (orphan path)', () => {
    const index = new Map([['aceite_oliva', 'ABA003']])
    expect(resolveIngredientId('galleta_amalay', index)).toBe('galleta_amalay')
  })

  it('returns empty string unchanged for empty slug', () => {
    const index = new Map([['aceite_oliva', 'ABA003']])
    expect(resolveIngredientId('', index)).toBe('')
  })

  it('is case-sensitive on lookup (slugs are always lowercase)', () => {
    const index = new Map([['aceite_oliva', 'ABA003']])
    expect(resolveIngredientId('ACEITE_OLIVA', index)).toBe('ACEITE_OLIVA')
  })
})

// ── Integration tests — real wansoft catalog ──

const PRODUCTS_PATH = path.join(PROJECT_ROOT, 'agents/wansoft/wansoft_products.json')
const RECIPES_PATH = path.join(PROJECT_ROOT, 'agents/wansoft/wansoft_recetas.json')

describe('integration — real wansoft catalog (769 products)', () => {
  const rawProducts = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8')) as {
    codigo: string
    nombre: string
  }[]

  const catalog: NormalizedIngredient[] = rawProducts.map(p => ({
    id: p.codigo,
    name: p.nombre,
  }))

  it('builds index without collisions across all 769 products', () => {
    expect(() => buildSlugIndex(catalog)).not.toThrow()
    const index = buildSlugIndex(catalog)
    expect(index.size).toBeGreaterThan(0)
    expect(index.size).toBeLessThanOrEqual(769)
  })

  it('resolves known NORMALIZED_EXACT pairs (from MT-03)', () => {
    const index = buildSlugIndex(catalog)

    const knownPairs: Array<[string, string]> = [
      ['aceite_oliva', 'ABA003'],
      ['aceite_de_coco', 'ABA002'],
      ['aceite_vegetal', 'ABA001'],
      ['aguacate', 'FYV001'],
    ]

    for (const [slug, expectedCodigo] of knownPairs) {
      expect(resolveIngredientId(slug, index)).toBe(expectedCodigo)
    }
  })

  it('does not resolve NO_CANDIDATE orphans to wrong entries', () => {
    const index = buildSlugIndex(catalog)
    // These slugs appear in recipes but have no match in catalog
    // They must remain as orphans (return their own slug)
    const noCandidates = [
      'galleta_amalay_a_granel',
      'mezcla_subamalay',
    ]
    for (const slug of noCandidates) {
      expect(resolveIngredientId(slug, index)).toBe(slug)
    }
  })
})

describe('integration — recipe line resolution (1456 → ~122)', () => {
  const rawProducts = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8')) as {
    codigo: string
    nombre: string
  }[]
  const rawRecipes = JSON.parse(fs.readFileSync(RECIPES_PATH, 'utf8')) as {
    dish: string
    ingredients: { product: string; qty: number; unit: string }[]
  }[]

  const catalog: NormalizedIngredient[] = rawProducts.map(p => ({
    id: p.codigo,
    name: p.nombre,
  }))

  it('resolves NORMALIZED_EXACT slugs — orphan count must drop below 200', () => {
    const index = buildSlugIndex(catalog)
    const ingredientIds = new Set(catalog.map(i => i.id))

    let totalLines = 0
    let orphanCount = 0
    const orphanIds = new Set<string>()

    for (const r of rawRecipes) {
      for (const ing of r.ingredients || []) {
        totalLines++
        const rawSlug = slugify(ing.product)
        const resolvedId = resolveIngredientId(rawSlug, index)
        if (!ingredientIds.has(resolvedId)) {
          orphanCount++
          orphanIds.add(resolvedId)
        }
      }
    }

    // Before fix: 1456 orphan lines, 586 unique orphan IDs
    // After fix:  ~122 orphan lines (2 SINGLE_FUZZY + 120 NO_CANDIDATE)
    expect(totalLines).toBe(1456)
    expect(orphanCount).toBeLessThan(200)
    expect(orphanIds.size).toBeLessThan(100)
  })

  it('resolved IDs that are in the catalog were reached via the slug index', () => {
    const index = buildSlugIndex(catalog)
    const ingredientIds = new Set(catalog.map(i => i.id))

    // For each line where resolution succeeded, verify that
    // the raw slug was NOT already in ingredientIds before resolution.
    // This confirms the slug index is doing actual work, not a no-op.
    let resolutionsViaIndex = 0
    for (const r of rawRecipes) {
      for (const ing of r.ingredients || []) {
        const rawSlug = slugify(ing.product)
        const resolvedId = resolveIngredientId(rawSlug, index)
        if (ingredientIds.has(resolvedId) && resolvedId !== rawSlug) {
          resolutionsViaIndex++
        }
      }
    }
    // At minimum, the 511 NORMALIZED_EXACT unique IDs × their line counts
    expect(resolutionsViaIndex).toBeGreaterThan(1000)
  })
})
