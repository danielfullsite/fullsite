/**
 * Category normalization map — Wansoft → Fullsite canonical.
 *
 * Rules:
 * 1. ALL CAPS for consistency
 * 2. Singular for product types (PROTEINA, ABARROTE)
 * 3. Plural for groups (LACTEOS, BEBIDAS, FRUTAS Y VERDURAS)
 * 4. Fix typos (ABARRROTE → ABARROTE)
 * 5. Unknown categories → 'SIN CATEGORIA' (never silently drop)
 */

export const CATEGORY_MAP: Record<string, string> = {
  // ── Abarrote variants ──
  'abarrote': 'ABARROTE',
  'ABARROTE': 'ABARROTE',
  'ABARRROTE': 'ABARROTE',    // typo: triple R
  'ABARROTES': 'ABARROTE',    // plural
  'abarrotes': 'ABARROTE',

  // ── Proteina variants ──
  'proteina': 'PROTEINA',
  'PROTEINA': 'PROTEINA',
  'CARNES': 'PROTEINA',
  'PROTEINA ANIMAL': 'PROTEINA',

  // ── Frutas y Verduras ──
  'FRUTAS Y VERDURAS': 'FRUTAS Y VERDURAS',
  'vegetal': 'FRUTAS Y VERDURAS',
  'VEGETAL': 'FRUTAS Y VERDURAS',

  // ── Lacteos ──
  'lacteo': 'LACTEOS',
  'LACTEOS': 'LACTEOS',
  'QUESOS': 'LACTEOS',

  // ── Sub-recetas ──
  'subreceta': 'SUBRECETA',
  'SUBRECETA': 'SUBRECETA',
  'subproducto': 'SUBRECETA',
  'SUBPRODUCTO': 'SUBRECETA',

  // ── Bebidas ──
  'bebida': 'BEBIDAS',
  'BEBIDAS': 'BEBIDAS',

  // ── Panaderia ──
  'PANADERIA': 'PANADERIA',
  'panaderia': 'PANADERIA',

  // ── Market ──
  'market': 'MARKET',
  'MARKET': 'MARKET',
  'PRODUCTOS MARKET': 'MARKET',
  'MARCA PROPIA': 'MARKET',

  // ── Otros ──
  'otro': 'OTRO',
  'OTRO': 'OTRO',

  // ── Wansoft departments (from wansoft_products.json) ──
  'SUBS COCINA': 'SUBRECETA',
  'SUBS PANADERIA': 'SUBRECETA',
  'SUBS BARRA': 'SUBRECETA',

  // ── Discovered from dry-run with real data ──
  'TISANAS': 'BEBIDAS',
  'SECOS': 'ABARROTE',
  'GRANEL': 'ABARROTE',
  'CERVEZAS': 'BEBIDAS',
  'VINOS Y LICORES': 'BEBIDAS',
  'EMPAQUE': 'OTRO',
  'CONGELADOS': 'ABARROTE',
  'PULPAS': 'FRUTAS Y VERDURAS',
}

export const CANONICAL_CATEGORIES = [
  'ABARROTE',
  'PROTEINA',
  'FRUTAS Y VERDURAS',
  'LACTEOS',
  'BEBIDAS',
  'PANADERIA',
  'SUBRECETA',
  'MARKET',
  'OTRO',
] as const

export type CanonicalCategory = typeof CANONICAL_CATEGORIES[number]

export function normalizeCategory(raw: string | null | undefined): string {
  if (!raw || raw.trim() === '') return 'SIN CATEGORIA'
  const trimmed = raw.trim()
  const mapped = CATEGORY_MAP[trimmed]
  if (mapped) return mapped
  // Try case-insensitive
  const lower = trimmed.toLowerCase()
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (key.toLowerCase() === lower) return val
  }
  return 'SIN CATEGORIA'
}

export function isKnownCategory(raw: string): boolean {
  return normalizeCategory(raw) !== 'SIN CATEGORIA'
}
