// ── Runner de la evaluación de exactitud de la IA del dueño ─────────────────────
//
// Por cada pregunta de `preguntas.ts`:
//   1. (opcional) elige parámetros del tenant con SQL (mesero top, categoría top…);
//   2. calcula la VERDAD por rpc ia_consulta (mismo filtro por restaurante que el chat);
//   3. pregunta al chat EN PROCESO (POST de app/api/chat/route.ts, Groq real);
//   4. califica (puntaje.ts) y guarda latencia, consultas y lo que hizo el verificador.
// Escribe evals/ia/resultados/<fecha>.{json,md} SIN datos del restaurante (sólo aprobado/
// fallido, números esperado vs obtenido, latencia, consultas y clase de error).
//
// La lista sale de `armarLista`: banco escrito a mano (preguntas.ts, opcional) + muestra
// estratificada de preguntas GENERADAS sobre los datos del tenant (generador.ts). Las
// generadas degeneradas (verdad vacía/cero/empate) se reemplazan con la reserva del
// muestreo. Ritmo: pausa entre preguntas, backoff ante 429 de Groq (respeta retry-after) y
// paro ordenado si se agota la cuota diaria (reporte parcial; cuenta como infraestructura).
//
// Este archivo no importa la ruta ni toca la autenticación: el punto de entrada
// `correr.eval.ts` (vitest) simula `requireTenant` con vi.mock y le pasa `POST`.
// Así no hay ningún "modo eval" en el código de producción.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { categoriaError, ejecutarConsulta, type CredencialesLectura, type ResultadoConsulta } from '@/lib/ia-lectura'
import { leerConfigDayparts, type DaypartsConfig } from '@/lib/dayparts'
import { lit, PREGUNTAS, type Ctx, type PreguntaEval, type Texto } from './preguntas'
import {
  calificarRespuesta, calificarTrampa, reporteMarkdown, resumir, tendencia, MOTIVO_CUOTA, MOTIVO_INFRA,
  type Calificacion, type InfoCorrida, type ResultadoPregunta, type Resumen,
} from './puntaje'
import {
  descubrirDominios, generarPreguntas, intercalar, muestrear, plantillasPorCategoria, prng, semillaDelDia, tamanosDominios,
  MOTIVO_DEGENERADA, PLANTILLAS, type Reserva,
} from './generador'

// ── Configuración ──────────────────────────────────────────────────────────

export interface ConfigEval {
  sbUrl: string
  serviceKey: string
  anonKey: string
  tenant: string
  tz: string
  /** 'YYYY-MM' */
  mes: string
  /** Reloj fijado (ISO con zona) o null = reloj real. */
  ahora: string | null
  umbral: number
  pausaMs: number
  /** Filtro por id (prefijo) o categoría; null = todas. */
  solo: string[] | null
  dirSalida: string
  modelo: string
  /** Preguntas GENERADAS a muestrear (0 = sólo el banco escrito a mano). */
  muestra: number
  /** Semilla del muestreo (misma semilla + mismos datos = misma muestra). */
  semilla: string
  /** Incluir las preguntas de preguntas.ts además de la muestra. */
  incluirBase: boolean
  /** Meses con datos que el generador usa como eje. */
  mesesGen: number
  /** Reintentos de una pregunta tras un 429 / falla transitoria. */
  reintentos: number
  /** Espera máxima por un 429; si Groq pide más, se trata como cuota agotada. */
  maxEsperaMs: number
  /** Presupuesto de la corrida en minutos; al pasarlo se detiene con reporte parcial. */
  maxMinutos: number
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const ultimoDia = (mes: string) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const sumarDias = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/**
 * Variables (explícitas a propósito: nunca se toman SUPABASE_URL/SUPABASE_SERVICE_KEY
 * sueltas, que en una máquina de desarrollo suelen ser de PRODUCCIÓN):
 *   EVAL_IA_SUPABASE_URL, EVAL_IA_SUPABASE_SERVICE_KEY (obligatorias; staging)
 *   GROQ_API_KEY (obligatoria)
 *   EVAL_IA_SUPABASE_ANON_KEY (opcional; por defecto la service key)
 *   EVAL_IA_TENANT (chickin-demo) · EVAL_IA_TZ (America/Monterrey) · EVAL_IA_MES (2026-08)
 *   EVAL_IA_AHORA (primer día del mes siguiente a las 12:00 −06:00; 'real' = sin fijar)
 *   EVAL_IA_UMBRAL (0.9) · EVAL_IA_PAUSA_MS (3000) · EVAL_IA_SOLO (ids/categorías, coma)
 *   EVAL_IA_DIR (evals/ia/resultados)
 *   EVAL_IA_MUESTRA (150; 0 = sólo el banco) · EVAL_IA_SEMILLA (fecha YYYYMMDD) · EVAL_IA_INCLUIR_BASE (1)
 *   EVAL_IA_MESES_GEN (3) · EVAL_IA_REINTENTOS (3) · EVAL_IA_MAX_ESPERA_MS (120000) · EVAL_IA_MAX_MIN (150)
 */
export function configDesdeEnv(env: Record<string, string | undefined> = process.env, dirBase = __dirname, ahoraReal = Date.now()):
  { ok: true; cfg: ConfigEval } | { ok: false; faltan: string[] } {
  const faltan: string[] = []
  const sbUrl = (env.EVAL_IA_SUPABASE_URL || '').replace(/\/+$/, '')
  const serviceKey = env.EVAL_IA_SUPABASE_SERVICE_KEY || ''
  if (!sbUrl) faltan.push('EVAL_IA_SUPABASE_URL')
  if (!serviceKey) faltan.push('EVAL_IA_SUPABASE_SERVICE_KEY')
  if (!env.GROQ_API_KEY && !env.GROQ) faltan.push('GROQ_API_KEY')
  const mes = env.EVAL_IA_MES || '2026-08'
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) faltan.push('EVAL_IA_MES (formato YYYY-MM)')
  const tz = env.EVAL_IA_TZ || 'America/Monterrey'
  if (!/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(tz)) faltan.push('EVAL_IA_TZ (zona IANA)')
  const umbral = Number(env.EVAL_IA_UMBRAL ?? '0.9')
  if (!(umbral >= 0 && umbral <= 1)) faltan.push('EVAL_IA_UMBRAL (0..1)')
  const entero = (nombre: string, def: number, min = 0): number => {
    const x = Number(env[nombre] === undefined || env[nombre] === '' ? def : env[nombre])
    if (!Number.isInteger(x) || x < min) { faltan.push(`${nombre} (entero ≥ ${min})`); return def }
    return x
  }
  const muestra = entero('EVAL_IA_MUESTRA', 150)
  const mesesGen = entero('EVAL_IA_MESES_GEN', 3, 1)
  const reintentos = entero('EVAL_IA_REINTENTOS', 3)
  const maxEsperaMs = entero('EVAL_IA_MAX_ESPERA_MS', 120_000, 1000)
  const maxMinutos = entero('EVAL_IA_MAX_MIN', 150, 1)
  const semilla = (env.EVAL_IA_SEMILLA || '').trim() || semillaDelDia(ahoraReal)
  if (faltan.length > 0) return { ok: false, faltan }
  const ahoraEnv = env.EVAL_IA_AHORA
  const ahora = ahoraEnv === 'real' ? null : ahoraEnv || `${sumarMeses(mes, 1)}-01T12:00:00-06:00`
  if (ahora && !Number.isFinite(Date.parse(ahora))) return { ok: false, faltan: ['EVAL_IA_AHORA (ISO con zona, o "real")'] }
  const solo = env.EVAL_IA_SOLO ? env.EVAL_IA_SOLO.split(',').map(s => s.trim()).filter(Boolean) : null
  return {
    ok: true,
    cfg: {
      sbUrl, serviceKey, anonKey: env.EVAL_IA_SUPABASE_ANON_KEY || serviceKey,
      tenant: env.EVAL_IA_TENANT || 'chickin-demo', tz, mes, ahora, umbral,
      pausaMs: Math.max(0, Number(env.EVAL_IA_PAUSA_MS ?? '3000') || 0),
      solo: solo && solo.length > 0 ? solo : null,
      dirSalida: env.EVAL_IA_DIR || join(dirBase, 'resultados'),
      modelo: env.GROQ_MODEL || 'openai/gpt-oss-120b (default de lib/groq)',
      muestra, semilla, mesesGen, reintentos, maxEsperaMs, maxMinutos,
      incluirBase: !/^(0|false|no)$/i.test((env.EVAL_IA_INCLUIR_BASE ?? '1').trim()),
    },
  }
}

/** Día de calendario de un instante en la zona dada. */
export function fechaEnZona(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

export function contextoEval(cfg: Pick<ConfigEval, 'mes' | 'tz' | 'ahora'>, p: Record<string, string> = {}, pt: Record<string, string> = {}): Ctx {
  const [y, m] = cfg.mes.split('-').map(Number)
  const hoy = fechaEnZona(cfg.ahora ? Date.parse(cfg.ahora) : Date.now(), cfg.tz)
  const viejo = sumarMeses(cfg.mes, -6)
  const [vy, vm] = viejo.split('-').map(Number)
  return {
    mes: cfg.mes,
    desde: `${cfg.mes}-01`,
    hasta: `${cfg.mes}-${String(ultimoDia(cfg.mes)).padStart(2, '0')}`,
    mesNombre: `${MESES[m - 1]} de ${y}`,
    mesSolo: MESES[m - 1],
    tz: cfg.tz,
    hoy,
    ayer: sumarDias(hoy, -1),
    anteayer: sumarDias(hoy, -2),
    mesViejo: { desde: `${viejo}-01`, hasta: `${viejo}-${String(ultimoDia(viejo)).padStart(2, '0')}`, nombre: `${MESES[vm - 1]} de ${vy}` },
    p, pt,
  }
}

export const render = (t: Texto | undefined, c: Ctx): string => (t === undefined ? '' : typeof t === 'function' ? t(c) : t)

export function filtrar(preguntas: PreguntaEval[], solo: string[] | null): PreguntaEval[] {
  if (!solo) return preguntas
  return preguntas.filter(p => solo.some(s => p.id.startsWith(s) || p.categoria === s))
}

// ── Reloj fijado ───────────────────────────────────────────────────────────

/**
 * Fija "ahora" (Date.now / new Date()) en `iso`; el reloj sigue avanzando desde ahí (los
 * presupuestos de tiempo del ciclo siguen funcionando). Devuelve la función que lo
 * restaura. OJO: el `now()` de Postgres sigue siendo el real — si el modelo escribe
 * `current_date` en su SQL en vez de la fecha del prompt, la pregunta de fechas falla
 * (y eso es una señal real: en producción `current_date` es UTC, no el día de venta).
 */
export function fijarAhora(iso: string): () => void {
  const Real = globalThis.Date
  const desfase = Real.parse(iso) - Real.now()
  class DateFijo extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(Real.now() + desfase)
      else super(...(args as [number]))
    }
    static now(): number { return Real.now() + desfase }
  }
  globalThis.Date = DateFijo as unknown as DateConstructor
  return () => { globalThis.Date = Real }
}

// ── Red ────────────────────────────────────────────────────────────────────

export function credenciales(cfg: Pick<ConfigEval, 'sbUrl' | 'serviceKey'>): CredencialesLectura {
  return { sbUrl: cfg.sbUrl, apikey: cfg.serviceKey, bearer: cfg.serviceKey, modo: 'service_key' }
}

/** Verdad por rpc ia_consulta (mismo filtro por tenant que el chat). */
export function consultaVerdad(cfg: ConfigEval, sql: string): Promise<ResultadoConsulta> {
  return ejecutarConsulta(credenciales(cfg), cfg.tenant, sql, 30_000)
}

/**
 * El chat escribe bitácoras (chat_logs, agent_runs) con la service key. En la eval no
 * se escribe nada: cualquier POST/PATCH/DELETE a /rest/v1/<tabla> contesta 201 falso.
 * Las RPC (/rest/v1/rpc/*, sólo lectura) y Groq pasan. Devuelve el restaurador.
 */
export function bloquearEscrituras(): () => void {
  const real = globalThis.fetch
  const envoltura: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const metodo = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase()
    if (metodo !== 'GET' && metodo !== 'HEAD' && /\/rest\/v1\/(?!rpc\/)/.test(url)) {
      return new Response(null, { status: 201 })
    }
    return real(input, init)
  }
  globalThis.fetch = envoltura
  return () => { globalThis.fetch = real }
}

// ── Chat en proceso ────────────────────────────────────────────────────────

export interface RespuestaChat {
  respuesta: string
  ms: number
  consultas: number | null
  llamadasModelo: number | null
  verificador: ResultadoPregunta['verificador']
}
export type Preguntar = (mensaje: string) => Promise<RespuestaChat>
type HandlerPost = (req: never) => Promise<Response>

/** Extrae el JSON de una línea de log "[chat] <etiqueta> {...}". */
export function jsonDeLog(lineas: string[], etiqueta: string): Record<string, unknown> | null {
  const pref = `[chat] ${etiqueta} `
  for (const l of [...lineas].reverse()) {
    if (l.startsWith(pref)) {
      try { return JSON.parse(l.slice(pref.length)) as Record<string, unknown> } catch { return null }
    }
  }
  return null
}

/** Llama al POST de /api/chat en proceso y lee sus líneas de observabilidad (conteos). */
export function preguntarEnProceso(POST: HandlerPost): Preguntar {
  return async (mensaje: string) => {
    const req = {
      headers: new Headers(),
      cookies: { get: () => undefined },
      json: async () => ({ message: mensaje, history: [] }),
    }
    const lineas: string[] = []
    const logReal = console.log
    console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[chat] ')) lineas.push(a[0]); else logReal(...a) }
    const t0 = Date.now()
    try {
      const res = await POST(req as never)
      const j = await res.json() as { response?: string; error?: string }
      const lu = jsonDeLog(lineas, 'lectura universal')
      const v = jsonDeLog(lineas, 'verificador')
      return {
        respuesta: String(j.response ?? j.error ?? ''),
        ms: Date.now() - t0,
        consultas: lu && typeof lu.consultas === 'number' ? lu.consultas : null,
        llamadasModelo: lu && typeof lu.llamadas_modelo === 'number' ? lu.llamadas_modelo : null,
        verificador: v ? {
          afirmaciones: Number(v.afirmaciones) || 0, sin_rastro: Number(v.sin_rastro) || 0,
          reparado: v.reparado === true, marcados: Number(v.marcados) || 0,
        } : null,
      }
    } finally {
      console.log = logReal
    }
  }
}

/** Respuestas del chat que son falla de infraestructura (se reintenta), no del modelo. */
export const esFallaTransitoria = (r: string) =>
  /Demasiadas consultas|Lo siento, hubo un error|temporalmente no disponible|Chat IA no disponible/i.test(r)

// ── Límites de Groq (429) ──────────────────────────────────────────────────

/** Un 429 de Groq visto durante una pregunta. Sin cuerpo ni cabeceras guardadas: sólo esto. */
export interface Evento429 {
  /** Lo que pidió esperar (retry-after o "try again in …"); null si no dijo. */
  esperaMs: number | null
  /** Cuota DIARIA agotada (RPD/TPD): no tiene caso seguir hoy. */
  diario: boolean
}

/** "1m26.4s", "7.66s", "520ms", "2h3m" → ms (null si no se entiende). */
export function duracionMs(s: string): number | null {
  let total = 0
  let alguno = false
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const x = Number(m[1])
    total += m[2] === 'ms' ? x : m[2] === 's' ? x * 1000 : m[2] === 'm' ? x * 60_000 : x * 3_600_000
    alguno = true
  }
  return alguno ? Math.round(total) : null
}

/** Lee un 429 de Groq: cuánto esperar y si es la cuota diaria. */
export function leer429(headers: Headers, cuerpo: string, ahora = Date.now()): Evento429 {
  let esperaMs: number | null = null
  const ra = headers.get('retry-after')
  if (ra) {
    const s = Number(ra)
    if (Number.isFinite(s)) esperaMs = Math.max(0, Math.round(s * 1000))
    else if (Number.isFinite(Date.parse(ra))) esperaMs = Math.max(0, Date.parse(ra) - ahora)
  }
  if (esperaMs === null) {
    const m = /try again in\s+([\d.hms]+)/i.exec(cuerpo)
    if (m) esperaMs = duracionMs(m[1])
  }
  const diario = /per day|\((RPD|TPD)\)|daily (request|token)/i.test(cuerpo) || headers.get('x-ratelimit-remaining-requests') === '0'
  return { esperaMs, diario }
}

/**
 * Envuelve fetch para VER (no cambiar) los 429 de api.groq.com que ocurren dentro del chat
 * en proceso. El runner los toma después de cada pregunta: si hubo 429 la respuesta no es
 * confiable (el chat pudo contestar por un camino degradado) → espera y reintenta.
 */
export function vigilarGroq(): { restaurar: () => void; tomar: () => Evento429[] } {
  const real = globalThis.fetch
  let eventos: Evento429[] = []
  const envoltura: typeof fetch = async (input, init) => {
    const res = await real(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (res.status === 429 && /(^|\/\/)api\.groq\.com\//.test(url)) {
      let cuerpo = ''
      try { cuerpo = await res.clone().text() } catch { /* sin cuerpo */ }
      eventos.push(leer429(res.headers, cuerpo))
    }
    return res
  }
  globalThis.fetch = envoltura
  return {
    restaurar: () => { globalThis.fetch = real },
    tomar: () => { const e = eventos; eventos = []; return e },
  }
}

// ── Lista de preguntas (banco + generadas) ─────────────────────────────────

export interface InfoLista {
  semilla: string
  /** Preguntas generadas pedidas / elegidas / total generado para este tenant. */
  muestraPedida: number
  muestra: number
  generadas: number
  generadasPorCategoria: Record<string, number>
  cuotas: Record<string, number>
  base: number
  plantillas: Record<string, number>
  /** Sólo tamaños (nunca valores). */
  dominios: Record<string, number>
  erroresDescubrimiento: Record<string, string>
  franjasDefault: boolean | null
}

export async function armarLista(o: {
  cfg: ConfigEval
  consultar: (sql: string) => Promise<ResultadoConsulta>
  /** Franjas del tenant (clients.sales_dayparts); por defecto GET de sólo lectura con la service key. */
  leerFranjas?: () => Promise<{ config: DaypartsConfig; esDefault: boolean; inicioDia: string }>
  base?: PreguntaEval[]
}): Promise<{ lista: PreguntaEval[]; reserva: Reserva | null; info: InfoLista }> {
  const { cfg } = o
  const base = cfg.incluirBase ? filtrar(o.base ?? PREGUNTAS, cfg.solo) : []
  const info: InfoLista = {
    semilla: cfg.semilla, muestraPedida: cfg.muestra, muestra: 0, generadas: 0, generadasPorCategoria: {}, cuotas: {},
    base: base.length, plantillas: plantillasPorCategoria(), dominios: {}, erroresDescubrimiento: {}, franjasDefault: null,
  }
  if (cfg.muestra <= 0) return { lista: base, reserva: null, info }

  const ctx = contextoEval(cfg)
  const D = await descubrirDominios({
    consultar: o.consultar, ctx, opciones: { meses: cfg.mesesGen },
    leerFranjas: o.leerFranjas ?? (() => leerConfigDayparts(cfg.sbUrl, cfg.serviceKey, cfg.tenant)),
  })
  const pool = filtrar(generarPreguntas(D, ctx, PLANTILLAS), cfg.solo)
  const { muestra, reserva, cuotas } = muestrear(pool, { n: cfg.muestra, semilla: cfg.semilla })
  for (const p of pool) info.generadasPorCategoria[p.categoria] = (info.generadasPorCategoria[p.categoria] ?? 0) + 1
  Object.assign(info, {
    muestra: muestra.length, generadas: pool.length, cuotas, dominios: tamanosDominios(D),
    erroresDescubrimiento: D.errores, franjasDefault: D.franjasDefault,
  })
  const lista = base.length > 0 ? intercalar([...base, ...muestra], prng(`${cfg.semilla}:base`)) : muestra
  return { lista, reserva, info }
}

// ── Corrida ────────────────────────────────────────────────────────────────

const dormirReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Una celda de parámetros → texto (null/vacío = no aplica). */
const textoCelda = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))

/** Reemplazos máximos por lugar de la muestra (cada uno cuesta una consulta, no una llamada a Groq). */
export const MAX_REEMPLAZOS = 5
/** Espera base tras una falla transitoria sin retry-after (se duplica en cada reintento). */
export const ESPERA_BASE_MS = 20_000

interface OpcionesCorrida {
  cfg: ConfigEval
  preguntas: PreguntaEval[]
  preguntar: Preguntar
  consultar: (sql: string) => Promise<ResultadoConsulta>
  dormir?: (ms: number) => Promise<void>
  progreso?: (r: ResultadoPregunta, i: number, total: number) => void
  /** Sólo para depurar en local (ver DetallePregunta). */
  detalle?: (d: DetallePregunta) => void
  /** Reserva del muestreo: reemplaza generadas degeneradas / sin datos. */
  reserva?: Reserva | null
  /** 429 de Groq vistos (vigilarGroq). */
  limites?: { tomar: () => Evento429[] }
  /** Reloj para el presupuesto de minutos (por defecto Date.now). */
  reloj?: () => number
}

/** Compatibilidad: sólo los resultados. */
export async function correrEval(o: OpcionesCorrida): Promise<ResultadoPregunta[]> {
  return (await correrEvalCompleta(o)).resultados
}

export async function correrEvalCompleta(o: OpcionesCorrida): Promise<{ resultados: ResultadoPregunta[]; corrida: InfoCorrida }> {
  const dormir = o.dormir ?? dormirReal
  const reloj = o.reloj ?? (() => Date.now())
  const lista = filtrar(o.preguntas, o.cfg.solo)
  const out: ResultadoPregunta[] = []
  const corrida: InfoCorrida = { detenida: null, noCorridas: 0, reemplazos: 0, esperas429: 0 }
  const estado = { chats: 0 }
  const t0 = reloj()
  for (let i = 0; i < lista.length; i++) {
    if (reloj() - t0 > o.cfg.maxMinutos * 60_000) {
      corrida.detenida = 'tiempo'
      corrida.noCorridas = lista.length - i
      break
    }
    let p = lista[i]
    let r = await evaluarPregunta(p, o, dormir, estado, corrida)
    for (let k = 0; r.reemplazable && o.reserva && p.plantilla && k < MAX_REEMPLAZOS; k++) {
      const otra = o.reserva.siguiente(p)
      if (!otra) break
      corrida.reemplazos++
      p = otra
      r = await evaluarPregunta(p, o, dormir, estado, corrida)
    }
    out.push(r.resultado)
    o.progreso?.(r.resultado, i, lista.length)
    if (r.detener) {
      corrida.detenida = 'cuota'
      corrida.noCorridas = lista.length - i - 1
      break
    }
  }
  return { resultados: out, corrida }
}

/**
 * Detalle CON datos (pregunta, respuesta, verdad) para depurar en local. Nunca se guarda en
 * los reportes ni en CI: `correr.eval.ts` sólo lo escribe con EVAL_IA_DETALLE_LOCAL=1 y sin CI.
 */
export interface DetallePregunta {
  id: string
  pregunta: string
  respuesta: string
  verdad: { sql: string | null; filas: Record<string, unknown>[] }
}

const claseDe = (r: ResultadoConsulta): string | null => (r.ok ? null : r.categoria || categoriaError(r.codigo, r.status))

interface Evaluada {
  resultado: ResultadoPregunta
  /** Omitida por falta de datos / degenerada: se puede cambiar por otra de la reserva. */
  reemplazable: boolean
  /** Cuota diaria agotada: la corrida se detiene aquí. */
  detener: boolean
}

async function evaluarPregunta(
  p: PreguntaEval,
  o: OpcionesCorrida,
  dormir: (ms: number) => Promise<void>,
  estado: { chats: number },
  corrida: InfoCorrida,
): Promise<Evaluada> {
  const base = (extra: Partial<ResultadoPregunta>): ResultadoPregunta => ({
    id: p.id, categoria: p.categoria, ...(p.plantilla ? { plantilla: p.plantilla } : {}), estado: 'omitida', errorClase: null, chequeos: [],
    latenciaMs: 0, consultas: null, llamadasModelo: null, verificador: null, ...extra,
  })
  const sinDatos = (motivo: string): Evaluada => ({ resultado: base({ motivo }), reemplazable: true, detener: false })
  const listo = (resultado: ResultadoPregunta, detener = false): Evaluada => ({ resultado, reemplazable: false, detener })

  // 1. Parámetros del tenant.
  let ctx = contextoEval(o.cfg)
  if (p.parametrosSql) {
    const r = await o.consultar(render(p.parametrosSql, ctx))
    if (!r.ok) return listo(base({ motivo: 'parámetros: la consulta falló', errorClase: claseDe(r) }))
    const fila = r.filas[0]
    const pt: Record<string, string> = {}
    for (const [k, v] of Object.entries(fila || {})) { const t = textoCelda(v); if (t !== null) pt[k] = t }
    if (!fila || Object.keys(pt).length < Object.keys(fila).length) {
      return sinDatos('no aplica a este tenant (los parámetros no devolvieron valores)')
    }
    const pEsc: Record<string, string> = {}
    for (const [k, v] of Object.entries(pt)) pEsc[k] = lit(v)
    ctx = contextoEval(o.cfg, pEsc, pt)
  }

  // 2. Verdad (o validez de la trampa). Las filas se quedan en memoria: no se guardan.
  let sqlVerdad: string | null = null
  let filasVerdad: Record<string, unknown>[] = []
  if (p.categoria === 'trampa' || p.trampa) {
    for (const t of p.trampa?.validezSql || []) {
      const r = await o.consultar(render(t, ctx))
      // Error (p. ej. la tabla no existe para este tenant) = no hay datos: la trampa sigue válida.
      if (r.ok && Number(r.filas[0]?.n) > 0) return sinDatos('trampa no válida: sí hay datos para este tenant')
    }
  } else {
    sqlVerdad = render(p.verdadSql, ctx)
    const r = await o.consultar(sqlVerdad)
    if (!r.ok) return listo(base({ motivo: 'la verdad falló', errorClase: claseDe(r) }))
    filasVerdad = r.filas
    if (r.filas.length === 0) return sinDatos('la verdad no devolvió filas (sin datos para esta pregunta)')
    const deg = p.degenerada?.(r.filas)
    if (deg) return sinDatos(deg.startsWith(MOTIVO_DEGENERADA) ? deg : `${MOTIVO_DEGENERADA}: ${deg}`)
  }

  // 3. Chat en proceso: pausa entre preguntas; si hubo 429 de Groq o falla transitoria, espera
  //    (retry-after o backoff exponencial) y reintenta; cuota diaria → se detiene la corrida.
  const texto = render(p.pregunta, ctx)
  if (estado.chats > 0 && o.cfg.pausaMs > 0) await dormir(o.cfg.pausaMs)
  let chat: RespuestaChat
  let infra: string | null = null
  for (let intento = 0; ; intento++) {
    o.limites?.tomar()
    chat = await o.preguntar(texto)
    estado.chats++
    const eventos = o.limites?.tomar() ?? []
    const pedido = eventos.reduce<number | null>((m, e) => (e.esperaMs === null ? m : Math.max(m ?? 0, e.esperaMs)), null)
    if (eventos.some(e => e.diario) || (pedido !== null && pedido > o.cfg.maxEsperaMs)) { infra = MOTIVO_CUOTA; break }
    if (eventos.length === 0 && !esFallaTransitoria(chat.respuesta)) break
    if (intento >= o.cfg.reintentos) { infra = `${MOTIVO_INFRA}: el chat no respondió (no es error del modelo)`; break }
    if (eventos.length > 0) corrida.esperas429++
    await dormir(pedido !== null ? pedido + 1000 : Math.min(o.cfg.maxEsperaMs, ESPERA_BASE_MS * 2 ** intento))
  }
  o.detalle?.({ id: p.id, pregunta: texto, respuesta: chat.respuesta, verdad: { sql: sqlVerdad, filas: filasVerdad.slice(0, 5) } })

  // 4. Puntaje.
  let cal: Calificacion
  let errorClase: string | null = null
  if (infra) {
    cal = { estado: 'omitida', chequeos: [], motivo: infra }
    errorClase = MOTIVO_INFRA
  } else if (p.categoria === 'trampa' || p.trampa) cal = calificarTrampa(chat.respuesta, p.trampa?.prohibido)
  else cal = calificarRespuesta(p, filasVerdad, chat.respuesta)

  return listo(base({
    estado: cal.estado, motivo: cal.motivo, errorClase, chequeos: cal.chequeos,
    latenciaMs: chat.ms, consultas: chat.consultas, llamadasModelo: chat.llamadasModelo, verificador: chat.verificador,
  }), infra === MOTIVO_CUOTA)
}

// ── Reportes ───────────────────────────────────────────────────────────────

export function escribirReportes(
  cfg: ConfigEval, rs: ResultadoPregunta[], resumen: Resumen, stamp = new Date().toISOString(), info?: InfoLista,
): { json: string; md: string; tendencia: string } {
  mkdirSync(cfg.dirSalida, { recursive: true })
  const nombre = stamp.replace(/[:.]/g, '-')
  const meta = {
    tenant: cfg.tenant, mes: cfg.mes, ahora: cfg.ahora ?? 'real', umbral: cfg.umbral, modelo: cfg.modelo,
    semilla: cfg.semilla, muestra: cfg.muestra, incluirBase: cfg.incluirBase, stamp,
  }
  const json = join(cfg.dirSalida, `${nombre}.json`)
  const md = join(cfg.dirSalida, `${nombre}.md`)
  const tend = join(cfg.dirSalida, `${nombre}.tendencia.json`)
  writeFileSync(json, JSON.stringify({ meta, lista: info ?? null, resumen, resultados: rs }, null, 2))
  writeFileSync(md, reporteMarkdown(rs, resumen, meta, info))
  writeFileSync(tend, JSON.stringify(tendencia(resumen, meta)))
  return { json, md, tendencia: tend }
}

export { resumir, MOTIVO_CUOTA }
