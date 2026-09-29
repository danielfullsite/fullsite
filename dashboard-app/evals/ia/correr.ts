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
// Este archivo no importa la ruta ni toca la autenticación: el punto de entrada
// `correr.eval.ts` (vitest) simula `requireTenant` con vi.mock y le pasa `POST`.
// Así no hay ningún "modo eval" en el código de producción.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { categoriaError, ejecutarConsulta, type CredencialesLectura, type ResultadoConsulta } from '@/lib/ia-lectura'
import { lit, type Ctx, type PreguntaEval, type Texto } from './preguntas'
import {
  calificarRespuesta, calificarTrampa, reporteMarkdown, resumir, MOTIVO_INFRA,
  type Calificacion, type ResultadoPregunta, type Resumen,
} from './puntaje'

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
 */
export function configDesdeEnv(env: Record<string, string | undefined> = process.env, dirBase = __dirname):
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

/** Respuestas del chat que son falla de infraestructura (se reintenta una vez), no del modelo. */
export const esFallaTransitoria = (r: string) =>
  /Demasiadas consultas|Lo siento, hubo un error|temporalmente no disponible|Chat IA no disponible/i.test(r)

// ── Corrida ────────────────────────────────────────────────────────────────

const dormirReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Una celda de parámetros → texto (null/vacío = no aplica). */
const textoCelda = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))

export async function correrEval(o: {
  cfg: ConfigEval
  preguntas: PreguntaEval[]
  preguntar: Preguntar
  consultar: (sql: string) => Promise<ResultadoConsulta>
  dormir?: (ms: number) => Promise<void>
  progreso?: (r: ResultadoPregunta, i: number, total: number) => void
  /** Sólo para depurar en local (ver DetallePregunta). */
  detalle?: (d: DetallePregunta) => void
}): Promise<ResultadoPregunta[]> {
  const dormir = o.dormir ?? dormirReal
  const lista = filtrar(o.preguntas, o.cfg.solo)
  const out: ResultadoPregunta[] = []
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i]
    const r = await evaluarPregunta(p, o, dormir)
    out.push(r)
    o.progreso?.(r, i, lista.length)
    if (i < lista.length - 1 && o.cfg.pausaMs > 0) await dormir(o.cfg.pausaMs)
  }
  return out
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

async function evaluarPregunta(
  p: PreguntaEval,
  o: { cfg: ConfigEval; preguntar: Preguntar; consultar: (sql: string) => Promise<ResultadoConsulta>; detalle?: (d: DetallePregunta) => void },
  dormir: (ms: number) => Promise<void>,
): Promise<ResultadoPregunta> {
  const base = (extra: Partial<ResultadoPregunta>): ResultadoPregunta => ({
    id: p.id, categoria: p.categoria, estado: 'omitida', errorClase: null, chequeos: [], latenciaMs: 0, consultas: null,
    llamadasModelo: null, verificador: null, ...extra,
  })

  // 1. Parámetros del tenant.
  let ctx = contextoEval(o.cfg)
  if (p.parametrosSql) {
    const r = await o.consultar(render(p.parametrosSql, ctx))
    if (!r.ok) return base({ motivo: 'parámetros: la consulta falló', errorClase: claseDe(r) })
    const fila = r.filas[0]
    const pt: Record<string, string> = {}
    for (const [k, v] of Object.entries(fila || {})) { const t = textoCelda(v); if (t !== null) pt[k] = t }
    if (!fila || Object.keys(pt).length < Object.keys(fila).length) {
      return base({ motivo: 'no aplica a este tenant (los parámetros no devolvieron valores)' })
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
      if (r.ok && Number(r.filas[0]?.n) > 0) return base({ motivo: 'trampa no válida: sí hay datos para este tenant' })
    }
  } else {
    sqlVerdad = render(p.verdadSql, ctx)
    const r = await o.consultar(sqlVerdad)
    if (!r.ok) return base({ motivo: 'la verdad falló', errorClase: claseDe(r) })
    filasVerdad = r.filas
    if (r.filas.length === 0) return base({ motivo: 'la verdad no devolvió filas (sin datos para esta pregunta)' })
  }

  // 3. Chat en proceso (un reintento si la falla es de infraestructura).
  const texto = render(p.pregunta, ctx)
  let chat = await o.preguntar(texto)
  if (esFallaTransitoria(chat.respuesta)) {
    await dormir(20_000)
    chat = await o.preguntar(texto)
  }
  o.detalle?.({ id: p.id, pregunta: texto, respuesta: chat.respuesta, verdad: { sql: sqlVerdad, filas: filasVerdad.slice(0, 5) } })

  // 4. Puntaje.
  let cal: Calificacion
  let errorClase: string | null = null
  if (esFallaTransitoria(chat.respuesta)) {
    cal = { estado: 'omitida', chequeos: [], motivo: `${MOTIVO_INFRA}: el chat no respondió (no es error del modelo)` }
    errorClase = MOTIVO_INFRA
  } else if (p.categoria === 'trampa' || p.trampa) cal = calificarTrampa(chat.respuesta, p.trampa?.prohibido)
  else cal = calificarRespuesta(p, filasVerdad, chat.respuesta)

  return base({
    estado: cal.estado, motivo: cal.motivo, errorClase, chequeos: cal.chequeos,
    latenciaMs: chat.ms, consultas: chat.consultas, llamadasModelo: chat.llamadasModelo, verificador: chat.verificador,
  })
}

// ── Reportes ───────────────────────────────────────────────────────────────

export function escribirReportes(cfg: ConfigEval, rs: ResultadoPregunta[], resumen: Resumen, stamp = new Date().toISOString()): { json: string; md: string } {
  mkdirSync(cfg.dirSalida, { recursive: true })
  const nombre = stamp.replace(/[:.]/g, '-')
  const meta = { tenant: cfg.tenant, mes: cfg.mes, ahora: cfg.ahora ?? 'real', umbral: cfg.umbral, modelo: cfg.modelo }
  const json = join(cfg.dirSalida, `${nombre}.json`)
  const md = join(cfg.dirSalida, `${nombre}.md`)
  writeFileSync(json, JSON.stringify({ meta, resumen, resultados: rs }, null, 2))
  writeFileSync(md, reporteMarkdown(rs, resumen, meta))
  return { json, md }
}

export { resumir }
