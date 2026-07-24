const TZ = 'America/Mexico_City'

/**
 * Returns a Date whose .getFullYear()/.getMonth()/.getDate() reflect
 * current time in Mexico City (UTC-6, no DST since 2022).
 * Use instead of new Date() when you need the local calendar date.
 */
export function nowMX(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}

/**
 * Formats any Date as YYYY-MM-DD in Mexico City timezone.
 * Use instead of .toISOString().slice(0,10) to avoid UTC off-by-one.
 */
export function fmtDateMX(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

/** Today's date as YYYY-MM-DD in Mexico City timezone. */
export function todayMX(): string {
  return fmtDateMX(new Date())
}
