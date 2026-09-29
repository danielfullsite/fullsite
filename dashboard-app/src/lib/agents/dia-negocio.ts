/**
 * Dia de venta del restaurante, visto desde el SERVIDOR (agentes, cron).
 *
 * POR QUE EXISTE
 * --------------
 * Los agentes armaban su "hoy" asi:
 *
 *   const d = nowMX(); d.setHours(0, 0, 0, 0); d.toISOString()
 *
 * `nowMX()` devuelve la hora de PARED de Mexico reinterpretada como hora del proceso
 * (UTC en Vercel). `toISOString()` sobre eso da `YYYY-MM-DDT00:00:00Z`, que en Mexico
 * son las 18:00 de AYER. Resultado: una orden de anoche que se quedo en 'lista' entraba
 * a "las mesas de hoy" y el agente de operaciones gritaba "mesa lleva 900 min esperando
 * cobro" como critico. Ver `date-mx.ts:nowMX`, que ya advertia exactamente esto.
 *
 * Aqui "hoy" es el DIA DE VENTA — la misma definicion que usa la base para
 * `pos_orders.dia_venta` (trigger `set_pos_order_number`): zona `clients.timezone`,
 * inicio `clients.business_day_start_local` (default 05:00). Una sola definicion de
 * "que dia es" para todo el sistema.
 */
import { INICIO_DIA_DEFAULT, horaInicioDia } from '@/lib/dia-de-venta'
import { sumarDias } from '@/lib/date-mx'

type SbGet = <T>(table: string, query: string) => Promise<T[]>

/** Mismo default que client-config.ts. Mexico centro y Monterrey = UTC-6 sin horario de verano. */
export const TZ_DEFAULT = 'America/Mexico_City'

/**
 * Regla unica de venta (= lib/data.ts, pos-daily.ts y fs_es_venta en la base):
 * pagada, o cerrada sin payment_status. 'lista' NO es venta: es una cuenta sin cobrar.
 */
export const FILTRO_VENTA = 'or=(payment_status.eq.pagada,and(payment_status.is.null,status.eq.cerrada))'

export function esVenta(o: { status?: string | null; payment_status?: string | null }): boolean {
  return o.payment_status === 'pagada' || (o.payment_status == null && o.status === 'cerrada')
}

export interface ContextoDia {
  tz: string
  /** 'HH:MM:SS' tal como viene de clients.business_day_start_local */
  inicio: string
  inicioHoras: number
  /** Dia de venta en curso, YYYY-MM-DD */
  hoy: string
  /** Instante (ISO UTC) en que arranco el dia de venta en curso */
  inicioHoyISO: string
  ahoraMs: number
  /** Hora de pared local del negocio (0-23) */
  horaLocal: number
  /** Dia de la semana DEL DIA DE VENTA (0 = domingo) */
  dow: number
  /** Minutos transcurridos desde que arranco el dia de venta */
  minutosDesdeInicio: number
}

interface Pared { y: number; m: number; d: number; h: number; min: number; s: number }

function paredEnZona(ms: number, tz: string): Pared {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const p: Record<string, string> = {}
  for (const x of parts) p[x.type] = x.value
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    h: p.hour === '24' ? 0 : Number(p.hour), min: Number(p.minute), s: Number(p.second),
  }
}

/**
 * Instante UTC (ISO) en que arranca el dia de venta `fecha` (YYYY-MM-DD) en `tz`, con
 * inicio a `inicioHoras` (5 = 05:00). El offset se mide EN esa hora de pared, no a
 * medianoche, para que una zona con horario de verano no se corra una hora.
 */
export function inicioDiaDeVentaISO(fecha: string, tz: string, inicioHoras: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const h = Math.floor(inicioHoras)
  const min = Math.round((inicioHoras - h) * 60)
  const comoUTC = Date.UTC(y, m - 1, d, h, min, 0)
  // Dos pasadas: la primera estima el offset, la segunda lo corrige en el instante real.
  let instante = comoUTC
  for (let i = 0; i < 2; i++) {
    const w = paredEnZona(instante, tz)
    const offset = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - instante
    instante = comoUTC - offset
  }
  return new Date(instante).toISOString()
}

/** Dia de la semana de una fecha YYYY-MM-DD (0 = domingo), independiente de la zona del proceso. */
export function dowDeFecha(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** Contexto puro, sin red. Separado para poder probarlo con un reloj fijo. */
export function contextoDia(ahoraMs: number, tz: string = TZ_DEFAULT, inicio: string = INICIO_DIA_DEFAULT): ContextoDia {
  const inicioHoras = horaInicioDia(inicio)
  const w = paredEnZona(ahoraMs, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  const calendario = `${w.y}-${pad(w.m)}-${pad(w.d)}`
  const horaPared = w.h + w.min / 60 + w.s / 3600
  const hoy = horaPared < inicioHoras ? sumarDias(calendario, -1, tz) : calendario
  const inicioHoyISO = inicioDiaDeVentaISO(hoy, tz, inicioHoras)
  return {
    tz, inicio, inicioHoras, hoy, inicioHoyISO, ahoraMs,
    horaLocal: w.h,
    dow: dowDeFecha(hoy),
    minutosDesdeInicio: Math.max(0, Math.floor((ahoraMs - Date.parse(inicioHoyISO)) / 60_000)),
  }
}

/**
 * Lee zona e inicio de dia del restaurante y arma el contexto. Si la lectura falla se
 * usan los defaults del producto (los mismos que usa el trigger de la base cuando el
 * cliente no declara nada): es configuracion, no dato de ventas, asi que el default es
 * la respuesta correcta y no un "cero" inventado.
 */
export async function leerContextoDia(clientId: string, sbGet: SbGet, ahoraMs = Date.now()): Promise<ContextoDia> {
  let tz = TZ_DEFAULT
  let inicio = INICIO_DIA_DEFAULT
  try {
    const rows = await sbGet<{ timezone?: string | null; business_day_start_local?: string | null }>(
      'clients',
      `id=eq.${encodeURIComponent(clientId)}&select=timezone,business_day_start_local&limit=1`,
    )
    const r = Array.isArray(rows) ? rows[0] : undefined
    if (r?.timezone && typeof r.timezone === 'string') {
      // Zona invalida -> Intl lanza. Se valida aqui para no tumbar al agente despues.
      try { new Intl.DateTimeFormat('en-US', { timeZone: r.timezone }); tz = r.timezone } catch { /* default */ }
    }
    if (r?.business_day_start_local && typeof r.business_day_start_local === 'string') inicio = r.business_day_start_local
  } catch { /* defaults */ }
  return contextoDia(ahoraMs, tz, inicio)
}

/**
 * Lee TODAS las filas de una consulta paginando. PostgREST corta en silencio en su
 * `max-rows` (1000 por defecto), y un `limit=500` sin `order` devuelve 500 filas
 * cualesquiera: medir "cancelaciones en 24h" sobre una muestra arbitraria no es medir.
 *
 * `query` debe traer su propio `order=` (estable) y NO traer `limit`/`offset`.
 * Devuelve `truncado: true` si se alcanzo el tope de paginas: el llamador DEBE decirlo.
 */
export async function leerPaginado<T>(
  sbGet: SbGet, table: string, query: string, opts: { pagina?: number; maxPaginas?: number } = {},
): Promise<{ filas: T[]; truncado: boolean }> {
  const pagina = opts.pagina ?? 1000
  const maxPaginas = opts.maxPaginas ?? 10
  const filas: T[] = []
  for (let i = 0; i < maxPaginas; i++) {
    const lote = await sbGet<T>(table, `${query}&limit=${pagina}&offset=${i * pagina}`)
    filas.push(...lote)
    if (lote.length < pagina) return { filas, truncado: false }
  }
  return { filas, truncado: true }
}
