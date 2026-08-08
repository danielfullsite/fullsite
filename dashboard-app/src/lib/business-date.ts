/**
 * W1-C — Business date canónico (espejo TS de ops_aggregate.py)
 *
 * FUENTE DE VERDAD DE COMPORTAMIENTO: .github/scripts/ops_aggregate.py
 * (get_business_day_config / get_business_date / get_business_day_bounds).
 * Los agentes Python ya operan con esa semántica; este módulo la replica 1:1
 * para dashboard/POS/reportes. La paridad se certifica con fixtures generados
 * por el propio Python (w1c-business-date-parity.json).
 *
 * Reglas:
 * - El día operativo D corre [D@boundary local, D+1@boundary local).
 * - Un instante con hora local < boundary pertenece al día calendario ANTERIOR.
 * - El boundary pertenece exactamente a un día: ts == boundary → día D (no D-1).
 * - Timezone IANA por configuración del tenant (clients.timezone). PROHIBIDO
 *   hardcodear offsets (-06:00) o usar la zona del navegador/servidor para
 *   semántica contable.
 * - Config faltante/ inválida: FAIL CLOSED (throw), igual que Python. Para
 *   superficies de UI que deban degradar, usar resolveBusinessDayConfig() —
 *   la degradación es EXPLÍCITA (flag + warn), nunca silenciosa.
 *
 * NOTA calendar vs business: cumpleaños, fechas de reservación, fechas de
 * emisión de factura, etc. son fechas CALENDARIO — no usar este módulo ahí.
 */

export interface BusinessDayConfig {
  timeZone: string
  /** 'HH:MM' | 'HH:MM:SS' — hora local de inicio del día operativo */
  boundary: string
}

export interface ResolvedBusinessDayConfig extends BusinessDayConfig {
  /** true si el tenant no tiene business_day_start_local y se degradó a
   *  medianoche (semántica calendario, conducta pre-W1-C). */
  degraded: boolean
}

interface WallParts { y: number; mo: number; d: number; h: number; mi: number; s: number }

// ── Internos ──────────────────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function getDtf(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone)
  if (!dtf) {
    // Lanza RangeError si la zona IANA es inválida — fail closed.
    dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    dtfCache.set(timeZone, dtf)
  }
  return dtf
}

/** Partes de reloj de pared del instante `instant` en `timeZone`. */
function wallParts(instant: Date, timeZone: string): WallParts {
  const parts = getDtf(timeZone).formatToParts(instant)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') }
}

/** Instante UTC que corresponde al reloj de pared (y,mo,d,h,mi) en timeZone.
 *  Doble iteración de offset — estable ante DST; en huecos de DST converge a
 *  un instante determinista. */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const target = Date.UTC(y, mo - 1, d, h, mi, 0)
  let guessMs = target
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(guessMs), timeZone)
    const wAsUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
    guessMs += target - wAsUtc
  }
  return new Date(guessMs)
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function isoDate(y: number, mo: number, d: number): string { return `${y}-${pad(mo)}-${pad(d)}` }

function prevCalendarDay(y: number, mo: number, d: number): string {
  const t = new Date(Date.UTC(y, mo - 1, d))
  t.setUTCDate(t.getUTCDate() - 1)
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

function nextCalendarDay(y: number, mo: number, d: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(y, mo - 1, d))
  t.setUTCDate(t.getUTCDate() + 1)
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

// ── API canónica ──────────────────────────────────────────────────────

/** Valida y parsea el boundary 'HH:MM' | 'HH:MM:SS'. Fail closed. */
export function parseBoundary(raw: string): { hour: number; minute: number } {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`business_day_start_local inválido: '${raw}'`)
  }
  const parts = raw.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1] ?? 0)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`business_day_start_local inválido: '${raw}' (esperado HH:MM[:SS])`)
  }
  return { hour, minute }
}

/** Espejo de get_business_day_config (fail closed en tz y boundary faltantes). */
export function getBusinessDayConfig(client: {
  id?: string
  timezone?: string | null
  business_day_start_local?: string | null
}): BusinessDayConfig {
  const timeZone = client.timezone
  if (!timeZone) {
    throw new Error(
      `Client '${client.id}' sin timezone configurada. Setear clients.timezone (IANA, ej. 'America/Monterrey').`
    )
  }
  getDtf(timeZone) // valida IANA — lanza si es inválida
  const boundary = client.business_day_start_local
  if (!boundary) {
    throw new Error(
      `Client '${client.id}' sin business_day_start_local. Setear clients.business_day_start_local (ej. '04:00:00').`
    )
  }
  parseBoundary(boundary)
  return { timeZone, boundary }
}

/** Resolver para superficies de UI: degrada EXPLÍCITAMENTE a medianoche
 *  (semántica calendario = conducta pre-W1-C) cuando el tenant aún no tiene
 *  business_day_start_local. La zona horaria sigue siendo obligatoria. */
const _degradedWarned = new Set<string>()
export function resolveBusinessDayConfig(client: {
  id?: string
  timezone?: string | null
  business_day_start_local?: string | null
}): ResolvedBusinessDayConfig {
  const timeZone = client.timezone
  if (!timeZone) {
    throw new Error(`Client '${client.id}' sin timezone configurada — no hay fallback silencioso.`)
  }
  getDtf(timeZone)
  if (client.business_day_start_local) {
    parseBoundary(client.business_day_start_local)
    return { timeZone, boundary: client.business_day_start_local, degraded: false }
  }
  const key = client.id ?? timeZone
  if (!_degradedWarned.has(key)) {
    _degradedWarned.add(key)
    console.warn(
      `[business-date] Client '${key}' sin business_day_start_local — degradando a ` +
      `medianoche (fecha calendario). Configurar clients.business_day_start_local.`
    )
  }
  return { timeZone, boundary: '00:00', degraded: true }
}

/** Espejo de get_business_date: fecha operativa 'YYYY-MM-DD' de un instante UTC. */
export function getBusinessDate(tsUtc: string | Date, timeZone: string, boundary: string): string {
  const { hour, minute } = parseBoundary(boundary)
  const instant = typeof tsUtc === 'string' ? new Date(tsUtc) : tsUtc
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Timestamp inválido: '${tsUtc}'`)
  }
  const w = wallParts(instant, timeZone)
  const tsSecs = w.h * 3600 + w.mi * 60 + w.s
  const boundarySecs = hour * 3600 + minute * 60
  if (tsSecs < boundarySecs) {
    return prevCalendarDay(w.y, w.mo, w.d)
  }
  return isoDate(w.y, w.mo, w.d)
}

/** Espejo de get_business_day_bounds: intervalo UTC [start, end) del día
 *  operativo `fecha`. Cada extremo se construye desde su propia fecha
 *  calendario — DST-safe. Usar SIEMPRE gte.start + lt.end (nunca ::date ni
 *  lte con T23:59:59). */
export function getBusinessDayBounds(fecha: string, timeZone: string, boundary: string): {
  utcStart: string
  utcEnd: string
} {
  const { hour, minute } = parseBoundary(boundary)
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) throw new Error(`Fecha inválida: '${fecha}' (esperado YYYY-MM-DD)`)
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const next = nextCalendarDay(y, mo, d)
  return {
    utcStart: wallToUtc(y, mo, d, hour, minute, timeZone).toISOString(),
    utcEnd: wallToUtc(next.y, next.mo, next.d, hour, minute, timeZone).toISOString(),
  }
}

/** Fecha operativa actual del tenant (espejo de get_current_business_date). */
export function getCurrentBusinessDate(cfg: BusinessDayConfig): string {
  return getBusinessDate(new Date(), cfg.timeZone, cfg.boundary)
}
