/**
 * Input sanitization utilities
 * Prevents XSS, SQL injection, and other input-based attacks
 */

// Strip HTML tags and script injections
export function sanitizeText(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
}

// Sanitize for SQL-safe strings (used in Supabase REST params)
export function sanitizeForQuery(input: string): string {
  return input
    .replace(/['";\\]/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .trim()
    .slice(0, 500) // max length
}

// Validate RFC format (Mexican tax ID)
export function isValidRFC(rfc: string): boolean {
  const clean = rfc.trim().toUpperCase()
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean)
}

// Validate email
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

// Validate Mexican postal code
export function isValidCP(cp: string): boolean {
  return /^\d{5}$/.test(cp)
}

// Sanitize PIN (only digits, max 6)
export function sanitizePIN(pin: string): string {
  return pin.replace(/\D/g, '').slice(0, 6)
}

// Rate limit check for client-side (prevents rapid-fire submissions)
const submissionTimestamps = new Map<string, number>()
export function canSubmit(key: string, cooldownMs: number = 2000): boolean {
  const now = Date.now()
  const last = submissionTimestamps.get(key) || 0
  if (now - last < cooldownMs) return false
  submissionTimestamps.set(key, now)
  return true
}
