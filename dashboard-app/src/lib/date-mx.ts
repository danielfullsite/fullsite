// ─── Zona horaria del negocio (multi-tenant) ────────────────────────────────
// El "día de negocio", cortes y reportes deben usar UNA zona fija por sucursal
// (no la del navegador de quien mira, ni una hardcodeada a México centro).
//
// Contrato:
//   - Cliente (POS / dashboard): la zona se resuelve de localStorage
//     `fullsite_timezone`, que se setea al login (desde la config del tenant/
//     sucursal) o al arrancar la terminal (desde su config.json). Ver
//     setActiveTimezone() y contexts/AuthContext.tsx.
//   - Servidor / SSR: cae al DEFAULT (México centro). Resolver la zona del
//     tenant server-side (agentes, cron, algunas rutas API) es follow-up:
//     requiere pasar la zona desde la config del cliente que ya cargan.
//
// El DEFAULT preserva el comportamiento previo (todo era 'America/Mexico_City'),
// así que ningún tenant existente cambia hasta que su zona quede seteada.

const DEFAULT_TZ = 'America/Mexico_City'
const TZ_KEY = 'fullsite_timezone'

/**
 * Zona horaria activa del negocio. Prioridad:
 *   1. localStorage `fullsite_timezone` (seteada al login desde la config del
 *      tenant/sucursal, o por la terminal desde su config.json) — la fuente
 *      autoritativa y consistente entre terminales.
 *   2. (sólo cliente) la zona de ESTA máquina (Intl) — una terminal recién
 *      instalada, sin login, está físicamente en la sucursal, así que su huso
 *      ES el de la sucursal. Es el "que se adapte a la compu". No regresa para
 *      instalaciones en el centro de México (su Intl = Central = el default).
 *   3. DEFAULT_TZ (México centro) — servidor/SSR, o si Intl falla.
 * Nunca lanza (private mode / SSR → default).
 */
export function getActiveTimezone(): string {
  if (typeof window === 'undefined') return DEFAULT_TZ
  try {
    const tz = localStorage.getItem(TZ_KEY)
    if (tz && tz.trim()) return tz.trim()
  } catch { /* private mode / storage bloqueado */ }
  try {
    const dev = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (dev && dev.trim()) return dev.trim()
  } catch { /* motor sin Intl completo */ }
  return DEFAULT_TZ
}

/** Persiste la zona del negocio para que getActiveTimezone() la resuelva. */
export function setActiveTimezone(tz: string | null | undefined): void {
  if (typeof window === 'undefined') return
  try {
    if (tz && tz.trim()) localStorage.setItem(TZ_KEY, tz.trim())
  } catch { /* — */ }
}

/**
 * Returns a Date whose .getFullYear()/.getMonth()/.getDate() reflect
 * current time in la zona activa del negocio.
 * Use instead of new Date() when you need the local calendar date.
 */
export function nowMX(): Date {
  // CUIDADO: EL INSTANTE DE ESTA FECHA NO ES EL REAL, Y ESO ES A PROPOSITO.
  //
  // `toLocaleString` da los numeros de PARED de la zona del negocio, y `new Date(str)`
  // los reinterpreta como hora local del proceso. Resultado: los getters LOCALES
  // (`getFullYear`, `getMonth`, `getDate`, `getHours`) devuelven el calendario correcto
  // del negocio -- que es para lo que existe y como la usan `gastos` y `ventas`.
  //
  // Pero `getTime()` y `toISOString()` estan CORRIDOS por la diferencia entre la zona
  // del proceso y la del negocio. Nunca uses esta fecha para:
  //   - `.toISOString()` ni `.toISOString().split('T')[0]`  -> usa `todayMX()`
  //   - comparar contra otro `Date` o restar milisegundos    -> usa `sumarDias()`
  //   - mandarla a la base                                   -> usa `zonedStartOfDayISO()`
  //
  // Es el mismo idioma que le quitaba la comida al corte del dia (ver
  // `el-corte-del-dia-cubre-el-dia.test.ts`). Aqui es correcto porque sus llamadores
  // solo leen componentes locales, y el contrato queda anclado en `date-mx.test.ts`.
  return new Date(new Date().toLocaleString('en-US', { timeZone: getActiveTimezone() }))
}

/**
 * Formats any Date as YYYY-MM-DD en la zona activa del negocio.
 * Use instead of .toISOString().slice(0,10) to avoid UTC off-by-one.
 */
export function fmtDateMX(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: getActiveTimezone() }).format(d)
}

/**
 * YYYY-MM-DD de un instante en una zona EXPLICITA.
 *
 * El encabezado de este archivo nombraba esto como follow-up: "Servidor / SSR cae al
 * DEFAULT. Resolver la zona del tenant server-side (agentes, cron, algunas rutas API)
 * requiere pasar la zona desde la config del cliente que ya cargan." Esto es esa
 * funcion: no lee localStorage, asi que sirve igual en una ruta API que en el navegador.
 *
 * `fmtDateMX` sigue existiendo para el cliente, donde la zona se resuelve sola.
 */
export function fmtDateEnZona(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
}

/** Hoy en una zona EXPLICITA, YYYY-MM-DD. Para servidor y agentes. */
export function hoyEnZona(tz: string): string {
  return fmtDateEnZona(new Date(), tz)
}

/**
 * Suma (o resta) dias de CALENDARIO en una zona explicita, sobre una fecha YYYY-MM-DD.
 *
 * No se hace con `new Date(ms - 86400000)`: un dia no siempre dura 86,400,000 ms. En
 * una zona con horario de verano --Tijuana lo conserva para alinearse con California--
 * el dia del cambio dura 23 o 25 horas, y restar 86.4 millones de ms cae en el dia
 * equivocado dos veces al ano.
 *
 * Se opera sobre los numeros de calendario, que es lo que significa "ayer".
 */
export function sumarDias(fechaISO: string, dias: number, tz: string): string {
  const [y, m, d] = fechaISO.split('-').map(Number)
  // Mediodia UTC como ancla: queda lejos de cualquier frontera de dia en cualquier
  // zona, asi que el formateo posterior no se puede pasar de dia por el desfase.
  const anclado = new Date(Date.UTC(y, m - 1, d + dias, 12, 0, 0))
  return fmtDateEnZona(anclado, tz)
}

/** Today's date as YYYY-MM-DD en la zona activa del negocio. */
export function todayMX(): string {
  return fmtDateMX(new Date())
}

/**
 * Offset en minutos de `tz` respecto a UTC en el instante `at`
 * (positivo si la zona va adelantada de UTC; México centro = -360).
 * Determinista (usa formatToParts), no depende de la zona de la máquina.
 */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  // formatToParts puede devolver '24' a medianoche en algunos motores.
  const hour = m.hour === '24' ? 0 : Number(m.hour)
  const asWallUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hour, Number(m.minute), Number(m.second))
  return Math.round((asWallUTC - at.getTime()) / 60000)
}

/**
 * Instante UTC (ISO) del inicio del día (00:00 hora local de `tz`) para una
 * fecha YYYY-MM-DD. Reemplaza el hardcode `${fecha}T00:00:00-06:00`.
 * Con tz=México centro devuelve `${fecha}T06:00:00.000Z` — idéntico al offset
 * -06:00 previo (retrocompatible). Con Tijuana (PDT) devuelve `...T07:00:00Z`.
 */
export function zonedStartOfDayISO(dateStr: string, tz: string = getActiveTimezone()): string {
  const guess = new Date(`${dateStr}T00:00:00Z`)
  const offsetMin = tzOffsetMinutes(tz, guess)
  return new Date(guess.getTime() - offsetMin * 60000).toISOString()
}
