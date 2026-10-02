/**
 * Horarios de venta (dayparts) por restaurante.
 *
 * Cada restaurante define SUS franjas —brunch, lunch, merienda, dinner, o las que use
 * su operación— en clients.sales_dayparts. Aquí viven:
 *   · la forma y validación de esa configuración (la usan la API y la pantalla),
 *   · la llamada a la función SQL ventas_por_franja (agrega dentro de Postgres),
 *   · el bloque de contexto ya calculado que se le da al chat IA.
 *
 * Regla de diseño: nunca se guardan totales por franja. Se guarda la hora de cada
 * orden y se clasifica al consultar; cambiar un horario recalcula todo el histórico.
 */

import { datoTexto } from '@/lib/chat-context'

export interface Franja {
  key: string
  nombre: string
  /** HH:MM, hora local del restaurante. */
  inicio: string
  /** HH:MM inclusivo al minuto, o null = hasta el cierre. */
  fin: string | null
}

export interface DaypartsConfig {
  franjas: Franja[]
}

export interface RangoHorarioSolicitado {
  franja: Franja
}

/** Si el restaurante no ha configurado nada. Se le dice a la IA que es genérico. */
export const DAYPARTS_DEFAULT: DaypartsConfig = {
  franjas: [
    { key: 'desayuno', nombre: 'Desayuno', inicio: '06:00', fin: '11:59' },
    { key: 'comida', nombre: 'Comida', inicio: '12:00', fin: '17:59' },
    { key: 'cena', nombre: 'Cena', inicio: '18:00', fin: null },
  ],
}

export const MAX_FRANJAS = 8
/** Debajo de esto, el % por franja se marca como no representativo. */
export const MIN_ORDENES_REPRESENTATIVO = 100
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Minuto "de jornada": lo anterior al inicio del día operativo es de la noche previa. */
function deJornada(min: number, inicioDia: number): number {
  return min < inicioDia ? min + 1440 : min
}

function slug(nombre: string): string {
  return nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 30) || 'franja'
}

export type ResultadoValidacion =
  | { ok: true; config: DaypartsConfig }
  | { ok: false; error: string }

/**
 * Valida y normaliza lo que manda la pantalla. Rechaza traslapes: una orden debe caer
 * en UNA sola franja o los % sumarían más de 100.
 */
export function validarDayparts(raw: unknown, inicioDia = '05:00'): ResultadoValidacion {
  const lista = (raw as { franjas?: unknown })?.franjas
  if (!Array.isArray(lista) || lista.length === 0) return { ok: false, error: 'Agrega al menos una franja' }
  if (lista.length > MAX_FRANJAS) return { ok: false, error: `Máximo ${MAX_FRANJAS} franjas` }

  const d0 = aMinutos(RE_HORA.test(inicioDia) ? inicioDia : '05:00')
  const franjas: Franja[] = []
  const keys = new Set<string>()

  for (const f of lista as Record<string, unknown>[]) {
    const nombre = String(f?.nombre ?? '').trim().slice(0, 30)
    const inicio = String(f?.inicio ?? '').trim()
    const finRaw = f?.fin
    const fin = finRaw === null || finRaw === undefined || finRaw === '' ? null : String(finRaw).trim()

    if (!nombre) return { ok: false, error: 'Cada franja necesita nombre' }
    if (!RE_HORA.test(inicio)) return { ok: false, error: `Hora de inicio inválida en "${nombre}"` }
    if (fin !== null && !RE_HORA.test(fin)) return { ok: false, error: `Hora de fin inválida en "${nombre}"` }
    if (fin !== null && deJornada(aMinutos(fin), d0) < deJornada(aMinutos(inicio), d0)) {
      return { ok: false, error: `"${nombre}" termina antes de empezar` }
    }

    let key = slug(nombre)
    for (let i = 2; keys.has(key); i++) key = `${slug(nombre)}-${i}`
    keys.add(key)
    franjas.push({ key, nombre, inicio, fin })
  }

  // Ordena por inicio de jornada y busca traslapes.
  franjas.sort((a, b) => deJornada(aMinutos(a.inicio), d0) - deJornada(aMinutos(b.inicio), d0))
  for (let i = 0; i < franjas.length; i++) {
    const a = franjas[i]
    const finA = a.fin === null ? d0 + 1439 : deJornada(aMinutos(a.fin), d0)
    if (a.fin === null && i < franjas.length - 1) {
      return { ok: false, error: `"${a.nombre}" va hasta el cierre; debe ser la última franja` }
    }
    const b = franjas[i + 1]
    if (b && deJornada(aMinutos(b.inicio), d0) <= finA) {
      return { ok: false, error: `"${a.nombre}" y "${b.nombre}" se enciman` }
    }
  }
  return { ok: true, config: { franjas } }
}

/** Lee la config guardada; si viene rota o vacía, cae al default (y lo dice). */
export function leerDayparts(raw: unknown, inicioDia?: string): { config: DaypartsConfig; esDefault: boolean } {
  if (raw) {
    const v = validarDayparts(raw, inicioDia)
    if (v.ok) return { config: v.config, esDefault: false }
  }
  return { config: DAYPARTS_DEFAULT, esDefault: true }
}

/** Franja de un minuto del día (0–1439). null = fuera de todas. Espejo de la SQL. */
export function franjaDe(minuto: number, config: DaypartsConfig, inicioDia = '05:00'): Franja | null {
  const d0 = aMinutos(inicioDia)
  const m = deJornada(minuto, d0)
  for (const f of config.franjas) {
    const ini = deJornada(aMinutos(f.inicio), d0)
    const fin = f.fin === null ? d0 + 1439 : deJornada(aMinutos(f.fin), d0)
    if (m >= ini && m <= fin) return f
  }
  return null
}

export function describirFranja(f: Franja): string {
  const h = (s: string) => {
    const [hh, mm] = s.split(':').map(Number)
    const ap = hh < 12 ? 'am' : 'pm'
    const h12 = hh % 12 === 0 ? 12 : hh % 12
    return `${h12}:${String(mm).padStart(2, '0')}${ap}`
  }
  return `${h(f.inicio)}–${f.fin ? h(f.fin) : 'cierre'}`
}

function horaConMeridiano(hora: string, meridiano: string | undefined): number | null {
  if (!meridiano) return null
  const h = Number(hora)
  if (!Number.isInteger(h) || h < 1 || h > 12) return null
  const pm = /^p/.test(meridiano.replace(/\./g, '').toLowerCase())
  return (h % 12) + (pm ? 12 : 0)
}

function menosUnMinuto(hhmm: string): string {
  const total = (aMinutos(hhmm) + 1439) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function describirHora(s: string): string {
  const [hh, mm] = s.split(':').map(Number)
  const ap = hh < 12 ? 'a.m.' : 'p.m.'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`
}

/**
 * Extrae sólo rangos inequívocos con AM/PM: "7pm a 10pm". La franja interna termina
 * un minuto antes porque `fin` es inclusivo; así 7–10 significa [19:00, 22:00), sin
 * colarse al bloque de las 10 p.m. Nunca adivina si falta el meridiano.
 */
export function extraerRangoHorario(pregunta: string): RangoHorarioSolicitado | null {
  const re = /(?:de\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\s*(?:a|al|hasta|[-–—])\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)/i
  const m = pregunta.match(re)
  if (!m) return null
  const iniHora = horaConMeridiano(m[1], m[3])
  const finHora = horaConMeridiano(m[4], m[6])
  const iniMin = Number(m[2] || 0)
  const finMin = Number(m[5] || 0)
  if (iniHora === null || finHora === null || iniMin > 59 || finMin > 59) return null
  const inicio = `${String(iniHora).padStart(2, '0')}:${String(iniMin).padStart(2, '0')}`
  const finExclusivo = `${String(finHora).padStart(2, '0')}:${String(finMin).padStart(2, '0')}`
  if (inicio === finExclusivo) return null
  return {
    franja: {
      key: 'ventana-solicitada',
      nombre: `${describirHora(inicio)}–${describirHora(finExclusivo)}`,
      inicio,
      fin: menosUnMinuto(finExclusivo),
    },
  }
}

/**
 * Config de franjas del restaurante. Filtra por la PK del tenant (clients.id = slug):
 * sólo lee la fila del restaurante que ya validó la ruta que llama.
 */
export async function leerConfigDayparts(sbUrl: string, sbKey: string, clientId: string): Promise<{
  config: DaypartsConfig; esDefault: boolean; inicioDia: string; timezone: string | null
}> {
  let row: { sales_dayparts?: unknown; business_day_start_local?: string | null; timezone?: string | null } = {}
  if (clientId) {
    try {
      const res = await fetch(
        `${sbUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=sales_dayparts,business_day_start_local,timezone`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
      )
      row = res.ok ? ((await res.json().catch(() => []))[0] || {}) : {}
    } catch { /* cae al default */ }
  }
  const inicioDia = row.business_day_start_local ? String(row.business_day_start_local).slice(0, 5) : '05:00'
  const { config, esDefault } = leerDayparts(row.sales_dayparts, inicioDia)
  return { config, esDefault, inicioDia, timezone: row.timezone ?? null }
}

// ── Agregado (fila que devuelve ventas_por_franja) ─────────────────────────────

export interface FilaFranja {
  location_id: string
  franja: string
  ordenes: number
  dias: number
  venta: number
  venta_comida: number
  venta_bebida: number
  fuente: string | null
}

export async function ventasPorFranja(opts: {
  sbUrl: string
  sbKey: string
  clientId: string
  desde: string
  hasta: string
  config: DaypartsConfig
  tz?: string
  inicioDia?: string
}): Promise<FilaFranja[] | null> {
  try {
    const res = await fetch(`${opts.sbUrl}/rest/v1/rpc/ventas_por_franja`, {
      method: 'POST',
      headers: { apikey: opts.sbKey, Authorization: `Bearer ${opts.sbKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_client_id: opts.clientId,
        p_desde: opts.desde,
        p_hasta: opts.hasta,
        p_franjas: opts.config.franjas,
        p_tz: opts.tz || 'America/Monterrey',
        p_inicio_dia: opts.inicioDia || '05:00',
      }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const rows = (await res.json()) as Record<string, unknown>[]
    return rows.map(r => ({
      location_id: String(r.location_id ?? '(sin sucursal)'),
      franja: String(r.franja ?? '__fuera__'),
      ordenes: Number(r.ordenes) || 0,
      dias: Number(r.dias) || 0,
      venta: Number(r.venta) || 0,
      venta_comida: Number(r.venta_comida) || 0,
      venta_bebida: Number(r.venta_bebida) || 0,
      fuente: (r.fuente as string) ?? null,
    }))
  } catch {
    return null
  }
}

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '0%')
const mxn = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`

/**
 * Bloque para el prompt del chat: % de venta total y de COMIDA por franja, ticket
 * por orden, y el mismo desglose por sucursal. Todo pre-calculado: la IA no suma.
 */
export function contextoFranjas(opts: {
  filas: FilaFranja[]
  config: DaypartsConfig
  esDefault: boolean
  desde: string
  hasta: string
  nombreSucursal: (id: string) => string
}): string {
  const { filas, config, esDefault, desde, hasta } = opts
  const encabezado = `VENTA POR HORARIO (del ${desde} al ${hasta}, ya calculado — NO lo recalcules):`
  // Nombres de franja y de sucursal los escribe el restaurante: van al prompt como DATO
  // (limpios y acotados), no como texto libre que pueda abrir una sección nueva.
  const horarios = config.franjas.map(f => `${datoTexto(f.nombre, 40)} ${describirFranja(f)}`).join(' · ')
  let out = `\n${encabezado}\nHorarios ${esDefault ? 'GENÉRICOS (el restaurante aún no configura los suyos — sugiérele hacerlo en [Horarios de venta →](/configuracion/horarios-venta))' : 'configurados por el restaurante'}: ${horarios}\n`

  if (filas.length === 0) {
    return out + 'No hay órdenes con hora registrada en ese periodo. Dilo así; no inventes porcentajes.\n'
  }

  const orden = [...config.franjas.map(f => f.key), '__fuera__']
  const nombre = (k: string) => datoTexto(config.franjas.find(f => f.key === k)?.nombre ?? 'Fuera de horario', 40)

  const bloque = (rows: FilaFranja[], sangria: string) => {
    const tot = rows.reduce((s, r) => s + r.venta, 0)
    const com = rows.reduce((s, r) => s + r.venta_comida, 0)
    const beb = rows.reduce((s, r) => s + r.venta_bebida, 0)
    let t = `${sangria}Total ${mxn(tot)} (comida ${mxn(com)} = ${pct(com, tot)}, bebida ${mxn(beb)} = ${pct(beb, tot)})\n`
    for (const k of orden) {
      const rs = rows.filter(r => r.franja === k)
      if (rs.length === 0) continue
      const v = rs.reduce((s, r) => s + r.venta, 0)
      const c = rs.reduce((s, r) => s + r.venta_comida, 0)
      const o = rs.reduce((s, r) => s + r.ordenes, 0)
      t += `${sangria}  ${nombre(k)}: ${pct(v, tot)} de la venta total (${mxn(v)}), ${pct(c, com)} de la venta de COMIDA (${mxn(c)}), ${o} órdenes, ticket ${mxn(o ? v / o : 0)}\n`
    }
    return t
  }

  // Cobertura: con pocas órdenes o pocos días con hora, un % engaña (ej. 10 órdenes
  // de prueba de noche = "100% dinner"). Se le dice a la IA que lo advierta.
  const totalOrdenes = filas.reduce((s, r) => s + r.ordenes, 0)
  const diasConHora = Math.max(...filas.map(r => r.dias || 0))
  const rango = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1
  const diasPeriodo = Number.isFinite(rango) && rango > 0 ? rango : null
  out += `Cobertura: ${totalOrdenes} órdenes con hora en ${diasConHora}${diasPeriodo ? ` de ${diasPeriodo}` : ''} días del periodo.\n`
  if (totalOrdenes < MIN_ORDENES_REPRESENTATIVO || (diasPeriodo !== null && diasConHora < diasPeriodo * 0.5)) {
    out += `⚠ MUESTRA INSUFICIENTE: estos % NO representan la operación. Dilo primero y claro (cuántas órdenes y días hay), da los números sólo como referencia y explica que se vuelven confiables cuando las ventas se cobren en el POS de Fullsite.\n`
  }
  out += 'TODO EL NEGOCIO:\n' + bloque(filas, '  ')
  const sucursales = [...new Set(filas.map(f => f.location_id))]
  if (sucursales.length > 1) {
    out += `POR SUCURSAL (${sucursales.length}):\n`
    for (const id of sucursales) {
      out += `  ${datoTexto(opts.nombreSucursal(id), 60)}:\n` + bloque(filas.filter(f => f.location_id === id), '    ')
    }
    out += 'Para comparar sucursales usa estos %: di cuál depende más de cada franja y dónde hay oportunidad.\n'
  }
  const fuentes = [...new Set(filas.map(f => f.fuente).filter(Boolean))].join(', ')
  if (fuentes) out += `(Fuente de horas: ${datoTexto(fuentes, 120)}. La hora de una orden es cuando se abrió.)\n`
  return out
}

/** ¿La pregunta es de horarios / franjas? */
export function preguntaDeFranjas(q: string, config?: DaypartsConfig): boolean {
  const n = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const base = ['brunch', 'lunch', 'dinner', 'desayuno', 'comida', 'cena', 'merienda', 'horario', 'franja', 'turno', 'manana', 'tarde', 'noche', 'hora pico', 'a que hora', 'daypart']
  const propias = (config?.franjas ?? []).map(f => f.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  return Boolean(extraerRangoHorario(q)) || [...base, ...propias].some(k => n.includes(k))
}
