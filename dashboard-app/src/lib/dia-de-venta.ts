/**
 * Dia de venta (business day) — el dia del restaurante, no el del calendario.
 *
 * Un restaurante que cierra a las 2 a.m. sigue en el dia de AYER. Por eso `clients`
 * tiene `business_day_start_local` (AMALAY: 05:00). Hasta hoy esa columna solo se
 * escribia al aprovisionar: NINGUN codigo del cliente la leia.
 *
 * INCIDENTE 2026-08-31, terminal Entrada de AMALAY. Al poner el PIN aparecia
 * "Turno del dia anterior - Ir a realizar Corte Z" con un turno del 30 de agosto
 * que en el servidor YA ESTABA CERRADO. El caché de turnos vencia por un TTL de
 * 24 h, no por dia de venta, asi que a las 22:00 seguia sirviendo el turno de la
 * noche anterior. El Corte Z no tenia nada que cerrar y la pantalla regresaba al
 * PIN, en bucle.
 *
 * La vigencia de un turno NO es funcion de cuando lo guardamos. Es funcion de si
 * el dia de venta sigue siendo el mismo.
 */

/** Default cuando el cliente no declara nada. Coincide con provision-tenant.ts. */
export const INICIO_DIA_DEFAULT = '05:00:00'

/** Hora de inicio como numero de horas. Acepta 'HH:MM' y 'HH:MM:SS'. */
export function horaInicioDia(valor?: string | null): number {
  const m = /^(\d{1,2}):(\d{2})/.exec((valor ?? INICIO_DIA_DEFAULT).trim())
  if (!m) return 5
  const h = Number(m[1]) + Number(m[2]) / 60
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : 5
}

/**
 * Fecha del dia de venta al que pertenece un instante, como 'YYYY-MM-DD' local.
 * Antes de la hora de inicio, el instante pertenece al dia ANTERIOR.
 */
export function diaDeVenta(instante: Date | string | number, inicio?: string | null): string {
  const d = instante instanceof Date ? new Date(instante.getTime()) : new Date(instante)
  if (Number.isNaN(d.getTime())) return ''
  const h = horaInicioDia(inicio)
  const horaLocal = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
  if (horaLocal < h) d.setDate(d.getDate() - 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** ¿Los dos instantes caen en el MISMO dia de venta? */
export function mismoDiaDeVenta(
  a: Date | string | number,
  b: Date | string | number,
  inicio?: string | null,
): boolean {
  const da = diaDeVenta(a, inicio)
  return da !== '' && da === diaDeVenta(b, inicio)
}

/**
 * Inicio de dia configurado para este cliente, leido del cache local si existe.
 * Se lee de forma tolerante: si no hay nada, el default. Nunca lanza.
 */
export function inicioDiaConfigurado(): string {
  if (typeof localStorage === 'undefined') return INICIO_DIA_DEFAULT
  try {
    const raw = localStorage.getItem('pos_client_settings')
    if (!raw) return INICIO_DIA_DEFAULT
    const v = JSON.parse(raw)?.business_day_start_local
    return typeof v === 'string' && v ? v : INICIO_DIA_DEFAULT
  } catch {
    return INICIO_DIA_DEFAULT
  }
}
