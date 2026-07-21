/**
 * Name normalization — standardize ingredient/product names.
 *
 * Rules:
 * 1. Trim whitespace
 * 2. Collapse multiple spaces
 * 3. Normalize accents for matching (preserve original for display)
 * 4. Remove leading/trailing hyphens and periods
 * 5. Standardize case: Title Case for display, lowercase for matching
 */

export function normalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')           // collapse spaces
    .replace(/^[-.\s]+|[-.\s]+$/g, '')  // trim leading/trailing symbols
}

export function normalizeForMatching(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove accent marks
    .replace(/[^a-z0-9 ]/g, ' ')     // non-alphanumeric → space
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize numeric values for consistent storage.
 */
export function normalizeDecimal(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[$,]/g, '').trim()
    const num = parseFloat(cleaned)
    return Number.isFinite(num) ? num : 0
  }
  return 0
}

/**
 * Normalize boolean from various Wansoft representations.
 */
export function normalizeBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase().trim()
    return lower === 'true' || lower === 'si' || lower === 'sí' || lower === '1' || lower === 'yes' || lower === 'activo'
  }
  return false
}

/**
 * Normalize null/undefined/empty to null.
 */
export function normalizeNullable<T>(raw: T | null | undefined | ''): T | null {
  if (raw === null || raw === undefined || raw === '') return null
  return raw
}

/**
 * Generate a safe slug ID from a name.
 * Used when source system doesn't provide a stable ID.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}
