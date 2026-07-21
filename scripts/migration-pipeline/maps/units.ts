/**
 * Unit normalization map — Wansoft → Fullsite canonical.
 *
 * Canonical units: kg, g, lt, ml, pz
 * All lowercase, abbreviated, unambiguous.
 *
 * Conversion factors are relative to the canonical unit in each dimension.
 * Dimension prevents cross-dimension conversions (kg → lt blocked).
 */

export type Dimension = 'mass' | 'volume' | 'piece' | 'other'

export interface UnitMapping {
  canonical: string
  dimension: Dimension
  factor: number  // multiply by this to convert to canonical
}

export const UNIT_MAP: Record<string, UnitMapping> = {
  // ── Mass (canonical: kg) ──
  'kg': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'KG': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'Kg': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'kilo': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'Kilo': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'KILO': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'Kilogramo': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'kilogramo': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'KILOGRAMO': { canonical: 'kg', dimension: 'mass', factor: 1 },
  'KGM': { canonical: 'kg', dimension: 'mass', factor: 1 },  // SAT unit code
  'k': { canonical: 'kg', dimension: 'mass', factor: 1 },    // typo

  'g': { canonical: 'g', dimension: 'mass', factor: 0.001 },
  'GR': { canonical: 'g', dimension: 'mass', factor: 0.001 },
  'gr': { canonical: 'g', dimension: 'mass', factor: 0.001 },
  'gramos': { canonical: 'g', dimension: 'mass', factor: 0.001 },
  'Gramos': { canonical: 'g', dimension: 'mass', factor: 0.001 },
  'GRAMOS': { canonical: 'g', dimension: 'mass', factor: 0.001 },

  // ── Volume (canonical: lt) ──
  'lt': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'LT': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'Lt': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'litro': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'Litro': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'LITRO': { canonical: 'lt', dimension: 'volume', factor: 1 },
  'LTR': { canonical: 'lt', dimension: 'volume', factor: 1 },  // SAT unit code

  'ml': { canonical: 'ml', dimension: 'volume', factor: 0.001 },
  'ML': { canonical: 'ml', dimension: 'volume', factor: 0.001 },
  'Ml': { canonical: 'ml', dimension: 'volume', factor: 0.001 },
  'mililitro': { canonical: 'ml', dimension: 'volume', factor: 0.001 },

  // ── Piece (canonical: pz) ──
  'pz': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'PZ': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'PZA': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'pza': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'pza.': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'Pieza': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'pieza': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'PIEZA': { canonical: 'pz', dimension: 'piece', factor: 1 },
  'H87': { canonical: 'pz', dimension: 'piece', factor: 1 },   // SAT unit code
  'E48': { canonical: 'pz', dimension: 'piece', factor: 1 },   // SAT service unit

  // ── Other (keep as-is, flag for review) ──
  'BTA': { canonical: 'pz', dimension: 'other', factor: 1 },   // botella → piece
  'paq': { canonical: 'pz', dimension: 'other', factor: 1 },   // paquete → piece
  'PQ': { canonical: 'pz', dimension: 'other', factor: 1 },
  'BL': { canonical: 'pz', dimension: 'other', factor: 1 },    // bolsa → piece
  'porcion': { canonical: 'pz', dimension: 'other', factor: 1 },
  'porción': { canonical: 'pz', dimension: 'other', factor: 1 },
  'SOBRE': { canonical: 'pz', dimension: 'other', factor: 1 },
  'BOLSA': { canonical: 'pz', dimension: 'other', factor: 1 },
  'CJ': { canonical: 'pz', dimension: 'other', factor: 1 },    // caja → piece
  'GL': { canonical: 'lt', dimension: 'volume', factor: 3.785 }, // galón → litros
}

export function normalizeUnit(raw: string | null | undefined): { unit: string; dimension: Dimension; warning?: string } {
  if (!raw || raw.trim() === '') return { unit: 'pz', dimension: 'piece', warning: 'Empty unit defaulted to pz' }

  const trimmed = raw.trim()
  const mapped = UNIT_MAP[trimmed]
  if (mapped) return { unit: mapped.canonical, dimension: mapped.dimension }

  // Try case-insensitive
  const lower = trimmed.toLowerCase()
  for (const [key, val] of Object.entries(UNIT_MAP)) {
    if (key.toLowerCase() === lower) return { unit: val.canonical, dimension: val.dimension }
  }

  return { unit: trimmed.toLowerCase(), dimension: 'other', warning: `Unknown unit: "${raw}" — kept as-is` }
}

export function canConvert(fromUnit: string, toUnit: string): boolean {
  const from = UNIT_MAP[fromUnit]
  const to = UNIT_MAP[toUnit]
  if (!from || !to) return false
  return from.dimension === to.dimension
}

export function convert(qty: number, fromUnit: string, toUnit: string): number | null {
  const from = UNIT_MAP[fromUnit]
  const to = UNIT_MAP[toUnit]
  if (!from || !to || from.dimension !== to.dimension) return null
  // Convert: qty * fromFactor / toFactor (both relative to base)
  return qty * from.factor / to.factor
}
