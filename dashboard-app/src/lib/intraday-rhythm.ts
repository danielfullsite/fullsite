/**
 * Ritmo intradía, calculado únicamente con cobros ya cerrados.
 *
 * No pronostica el cierre: compara el acumulado real hasta el mismo minuto del
 * día de negocio contra días cerrados equivalentes. La salida se puede omitir
 * con seguridad cuando todavía no existe muestra suficiente.
 */

export interface OrderForIntradayRhythm {
  dia_venta: string | null
  closed_at: string | null
  total: number | string | null
}

export interface IntradayRhythm {
  businessDate: string
  cutOffMinutes: number
  /** Hora local del servidor para explicar el corte al restaurante. */
  cutOffTime: string
  currentTotal: number
  expectedTotal: number
  comparableDays: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/

function partsAt(now: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  return Object.fromEntries(parts.map(p => [p.type, p.value]))
}

function weekday(iso: string): number | null {
  if (!DATE_RE.test(iso)) return null
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay()
}

/** Minutos desde el inicio configurado del día de negocio, en zona del tenant. */
export function businessMinutesAt(at: Date, timeZone: string, businessDayStart: string): number {
  const start = TIME_RE.exec(businessDayStart)
  if (!start) throw new Error('invalid business day start')
  const p = partsAt(at, timeZone)
  const minute = Number(p.hour) * 60 + Number(p.minute)
  const startMinute = Number(start[1]) * 60 + Number(start[2])
  return minute >= startMinute ? minute - startMinute : minute + 1440 - startMinute
}

/**
 * Acumula ventas cerradas de cada día hasta el corte equivalente. Sólo compara
 * el día de negocio actual con hasta cuatro días anteriores del mismo weekday.
 */
export function calculateIntradayRhythm(
  orders: OrderForIntradayRhythm[],
  now: Date,
  timeZone: string,
  businessDayStart: string,
  businessDate: string,
  minComparableDays = 2,
): IntradayRhythm | null {
  const targetWeekday = weekday(businessDate)
  if (targetWeekday === null) return null
  const cutOffMinutes = businessMinutesAt(now, timeZone, businessDayStart)
  const nowParts = partsAt(now, timeZone)
  const cutOffTime = `${nowParts.hour}:${nowParts.minute}`
  const totals = new Map<string, number>()
  const observedDays = new Set<string>([businessDate])

  for (const row of orders) {
    const day = row.dia_venta
    if (!day || !DATE_RE.test(day) || day > businessDate) continue
    const closedAt = row.closed_at ? new Date(row.closed_at) : null
    if (!closedAt || Number.isNaN(closedAt.getTime()) || closedAt > now) continue
    const total = Number(row.total)
    if (!Number.isFinite(total) || total <= 0) continue
    // Registrar el día aun cuando su primer cobro llegó DESPUÉS de este corte.
    // Así se compara con cero a esta hora y no se sesga el promedio eliminando
    // los días que arrancaron más lento.
    observedDays.add(day)
    // Una orden que cerró después de este momento aún no era conocida en el
    // corte histórico equivalente; incluirla sería mirar al futuro.
    if (businessMinutesAt(closedAt, timeZone, businessDayStart) > cutOffMinutes) continue
    totals.set(day, (totals.get(day) || 0) + total)
  }

  const currentTotal = totals.get(businessDate) || 0
  const comparable = Array.from(observedDays)
    .filter(day => day < businessDate && weekday(day) === targetWeekday)
    .sort((a, b) => a.localeCompare(b))
    .slice(-4)
    .map(day => totals.get(day) || 0)
  if (comparable.length < minComparableDays) return null
  const expectedTotal = comparable.reduce((sum, total) => sum + total, 0) / comparable.length
  if (expectedTotal <= 0) return null

  return { businessDate, cutOffMinutes, cutOffTime, currentTotal, expectedTotal, comparableDays: comparable.length }
}
