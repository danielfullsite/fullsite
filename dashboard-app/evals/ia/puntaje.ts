// ── Puntaje de la evaluación de exactitud (funciones puras, sin red) ─────────────
//
// Determinista: número con tolerancia, entidad por nombre, trampa por "dijo que no hay
// datos y no inventó". Nada aquí depende de otro modelo.

import { extraerCifras, MARCA_SIN_VERIFICAR } from '@/lib/verificador-numeros'
import type { Categoria, EntidadEsperada, NumeroEsperado, PreguntaEval, TipoEntidad } from './preguntas'

/** Tolerancia relativa para números (±0.5%): cubre redondeos por día y a pesos. */
export const TOLERANCIA_REL = 0.005

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9ñ@.:%$/\s-]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Un chequeo, SIN datos del restaurante: el campo es el nombre de la columna de la verdad
 * (o una etiqueta fija) y, sólo para números, el esperado y la cifra más cercana que dio
 * la respuesta. Nombres, fechas y textos esperados nunca se guardan.
 */
export interface Chequeo {
  tipo: 'numero' | 'entidad' | 'sin_datos' | 'sin_marcas' | 'prohibido'
  campo: string
  ok: boolean
  esperado?: number
  obtenido?: number | null
}

/**
 * ¿Aparece el número esperado en la respuesta? Coincide si alguna cifra de la respuesta
 * está a ±0.5% del esperado o es su redondeo a la precisión que muestra ("12.5k").
 * Un esperado de 0 también acepta "ninguna / no hubo / cero".
 */
export function numeroEnRespuesta(esperado: number, respuesta: string, tolRel = TOLERANCIA_REL): boolean {
  const e = Math.abs(esperado)
  const cifras = extraerCifras(respuesta)
  if (e === 0) {
    return cifras.some(c => c.valor === 0) || /\b(ninguna|ninguno|no hubo|no se cancel|cero)\b/.test(norm(respuesta))
  }
  return cifras.some(c => Math.abs(c.valor - e) <= Math.max(tolRel * e, c.paso / 2 + 1e-9))
}

/** Cifra de la respuesta más cercana al esperado (para el reporte), o null si no dio cifras. */
export function cifraMasCercana(esperado: number, respuesta: string): number | null {
  const e = Math.abs(esperado)
  let mejor: number | null = null
  for (const c of extraerCifras(respuesta)) if (mejor === null || Math.abs(c.valor - e) < Math.abs(mejor - e)) mejor = c.valor
  return mejor
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'al'])

/** ¿Aparece la entidad esperada (nombre, fecha, hora o día de la semana)? */
export function entidadEnRespuesta(esperado: string, respuesta: string, tipo: TipoEntidad = 'texto'): boolean {
  const r = ` ${norm(respuesta)} `
  if (tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(esperado)
    if (!m) return false
    const [, , mm, dd] = m
    const d = Number(dd); const mes = MESES[Number(mm) - 1]
    const formas = [`${m[1]}-${mm}-${dd}`, `${d} de ${mes}`, `${d}/${Number(mm)}`, `${dd}/${mm}`, `${mes} ${d}`]
    if (d === 1) formas.push(`primero de ${mes}`)
    return formas.some(f => new RegExp(`(^|[^0-9])${f.replace(/[/.]/g, '\\$&')}([^0-9]|$)`).test(r))
  }
  if (tipo === 'hora') {
    const h = Number(esperado)
    if (!Number.isInteger(h) || h < 0 || h > 23) return false
    const h12 = h % 12 || 12
    const tarde = h >= 12
    const pats = [
      `\\b0?${h}:00\\b(?!\\s?(am|pm|a\\.|p\\.))`, `\\b${h}\\s?(h|hrs|horas)\\b`, `\\blas ${h}\\b(?!(:\\d\\d)?\\s?(am|pm|a\\.|p\\.|de la))`,
      `\\b${h12}\\s?(${tarde ? 'pm|p\\.\\s?m\\.' : 'am|a\\.\\s?m\\.'})`,
      `\\b${h12}(:00)? de la ${h < 12 ? 'manana' : h < 19 ? 'tarde' : 'noche'}\\b`,
      `\\b${h}\\s*(y|a|-)\\s*(las\\s*)?${h + 1}\\b`,
    ]
    if (h === 13) pats.push('\\bla una de la tarde\\b')
    return pats.some(p => new RegExp(p).test(r))
  }
  if (tipo === 'dia_semana') {
    const d = norm(esperado)
    return new RegExp(`\\b${d}s?\\b`).test(r)
  }
  const e = norm(esperado)
  if (!e) return false
  if (r.includes(` ${e} `) || r.includes(e)) return true
  const tokens = e.split(' ').filter(t => t.length >= 3 && !VACIAS.has(t))
  if (tokens.length === 0) return false
  const hits = tokens.filter(t => new RegExp(`(^|[^a-z0-9ñ])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9ñ]|$)`).test(r)).length
  return hits >= Math.max(1, Math.ceil(tokens.length * 0.6))
}

/** Frases de "no tengo / no hay / no puedo" (sin acentos). */
const RE_SIN_DATOS = new RegExp([
  'no tengo', 'no tenemos', 'no hay (datos|registros|ventas|informacion|ordenes)', 'sin (datos|cobertura|registros|ventas registradas)',
  'no encontr', 'no cuento', 'no puedo', 'no pude', 'no esta disponible', 'no estan disponibles', 'no existe', 'no aparece',
  'no se registr', 'no tengo acceso', 'no es posible', 'no dispongo', 'solo puedo ayudarte', 'no se puede', 'no lo tengo',
  'no manejo', 'no guardo', 'no comparto', 'no puedo compartir', 'informacion (sensible|confidencial|privada)', 'no hay registro',
].join('|'))

export function dijoSinDatos(respuesta: string): boolean {
  return RE_SIN_DATOS.test(norm(respuesta))
}

export type Estado = 'aprobada' | 'fallida' | 'omitida'

/** Prefijo del motivo de una omisión por falla de infraestructura (Groq caído, 429 persistente). */
export const MOTIVO_INFRA = 'infraestructura'
/** Si más de esta fracción de preguntas se omite por infraestructura, la corrida no es válida. */
export const MAX_FRACCION_INFRA = 0.1

export interface Calificacion {
  estado: Estado
  chequeos: Chequeo[]
  motivo?: string
}

type Fila = Record<string, unknown>

const valorCelda = (filas: Fila[], x: NumeroEsperado | EntidadEsperada): unknown => filas[x.fila ?? 0]?.[x.col]

/** Califica una respuesta NO trampa contra las filas de la verdad. */
export function calificarRespuesta(p: Pick<PreguntaEval, 'numeros' | 'entidades'>, filas: Fila[], respuesta: string): Calificacion {
  if (filas.length === 0) return { estado: 'omitida', chequeos: [], motivo: 'la verdad no devolvió filas (sin datos para esta pregunta en este tenant)' }
  const chequeos: Chequeo[] = []
  for (const n of p.numeros || []) {
    const v = valorCelda(filas, n)
    const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (!Number.isFinite(num)) return { estado: 'omitida', chequeos: [], motivo: `la verdad no trae un número en "${n.col}"` }
    chequeos.push({ tipo: 'numero', campo: n.col, ok: numeroEnRespuesta(num, respuesta), esperado: num, obtenido: cifraMasCercana(num, respuesta) })
  }
  for (const e of p.entidades || []) {
    const v = valorCelda(filas, e)
    if (v === null || v === undefined || String(v).trim() === '') return { estado: 'omitida', chequeos: [], motivo: `la verdad no trae valor en "${e.col}"` }
    chequeos.push({ tipo: 'entidad', campo: e.col, ok: entidadEnRespuesta(String(v), respuesta, e.tipo) })
  }
  return { estado: chequeos.every(c => c.ok) ? 'aprobada' : 'fallida', chequeos }
}

/** Trampa: pasa sólo si dice que no hay datos / no se puede, sin cifras marcadas y sin nada prohibido. */
export function calificarTrampa(respuesta: string, prohibido: string[] = []): Calificacion {
  const chequeos: Chequeo[] = [
    { tipo: 'sin_datos', campo: 'dice que no hay datos / no se puede', ok: dijoSinDatos(respuesta) },
    { tipo: 'sin_marcas', campo: `sin ${MARCA_SIN_VERIFICAR}`, ok: !respuesta.includes(MARCA_SIN_VERIFICAR) },
  ]
  prohibido.forEach((pat, i) => chequeos.push({ tipo: 'prohibido', campo: `patrón prohibido #${i + 1}`, ok: !new RegExp(pat, 'i').test(respuesta) }))
  return { estado: chequeos.every(c => c.ok) ? 'aprobada' : 'fallida', chequeos }
}

// ── Resumen ────────────────────────────────────────────────────────────────

/**
 * Lo que se GUARDA de cada pregunta (reportes y artifacts de CI). Sin datos del
 * restaurante: ni el texto de la pregunta (lleva nombres de meseros/platillos), ni la
 * respuesta, ni las filas o el SQL de la verdad, ni mensajes de error de la base (sólo su
 * clase). Los números esperados/obtenidos sí (sin ellos no se puede depurar un fallo).
 */
export interface ResultadoPregunta {
  id: string
  categoria: Categoria
  estado: Estado
  /** Motivo de omisión: texto FIJO (nunca un mensaje de la base). */
  motivo?: string
  /** Clase del error que causó la omisión (permiso, sintaxis, columna, costo, timeout, otro, infraestructura). */
  errorClase: string | null
  chequeos: Chequeo[]
  latenciaMs: number
  consultas: number | null
  llamadasModelo: number | null
  verificador: { afirmaciones: number; sin_rastro: number; reparado: boolean; marcados: number } | null
}

export interface Resumen {
  total: number
  evaluadas: number
  aprobadas: number
  exactitud: number
  porCategoria: Record<string, { evaluadas: number; aprobadas: number; omitidas: number }>
  trampasFallidas: string[]
  omitidas: string[]
  /** Omitidas porque el chat no respondió (no por falta de datos). */
  fallasInfra: string[]
  verificador: { reparadas: number; conMarcas: number }
}

export function resumir(rs: ResultadoPregunta[]): Resumen {
  const evaluadas = rs.filter(r => r.estado !== 'omitida')
  const aprobadas = evaluadas.filter(r => r.estado === 'aprobada')
  const porCategoria: Resumen['porCategoria'] = {}
  for (const r of rs) {
    const c = (porCategoria[r.categoria] ||= { evaluadas: 0, aprobadas: 0, omitidas: 0 })
    if (r.estado === 'omitida') c.omitidas++
    else { c.evaluadas++; if (r.estado === 'aprobada') c.aprobadas++ }
  }
  return {
    total: rs.length,
    evaluadas: evaluadas.length,
    aprobadas: aprobadas.length,
    exactitud: evaluadas.length > 0 ? aprobadas.length / evaluadas.length : 0,
    porCategoria,
    trampasFallidas: rs.filter(r => r.categoria === 'trampa' && r.estado === 'fallida').map(r => r.id),
    omitidas: rs.filter(r => r.estado === 'omitida').map(r => r.id),
    fallasInfra: rs.filter(r => r.estado === 'omitida' && (r.motivo || '').startsWith(MOTIVO_INFRA)).map(r => r.id),
    verificador: {
      reparadas: rs.filter(r => r.verificador?.reparado).length,
      conMarcas: rs.filter(r => (r.verificador?.marcados ?? 0) > 0).length,
    },
  }
}

/**
 * ¿Pasa la compuerta de CI? Exactitud ≥ umbral, ninguna trampa fallida (= dato inventado)
 * y no más de 10% de preguntas sin respuesta por infraestructura.
 */
export function pasaCompuerta(r: Resumen, umbral: number): { ok: boolean; motivos: string[] } {
  const motivos: string[] = []
  if (r.evaluadas === 0) motivos.push('ninguna pregunta se pudo evaluar')
  if (r.exactitud < umbral) motivos.push(`exactitud ${(r.exactitud * 100).toFixed(1)}% < umbral ${(umbral * 100).toFixed(1)}%`)
  if (r.trampasFallidas.length > 0) motivos.push(`trampas fallidas (dato inventado): ${r.trampasFallidas.join(', ')}`)
  if (r.total > 0 && r.fallasInfra.length / r.total > MAX_FRACCION_INFRA) {
    motivos.push(`corrida no válida: ${r.fallasInfra.length} de ${r.total} preguntas sin respuesta del chat (infraestructura)`)
  }
  return { ok: motivos.length === 0, motivos }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 300)

export function reporteMarkdown(rs: ResultadoPregunta[], r: Resumen, meta: { tenant: string; mes: string; ahora: string; umbral: number; modelo: string }): string {
  const compuerta = pasaCompuerta(r, meta.umbral)
  const l: string[] = []
  l.push(`# Eval IA del dueño — ${compuerta.ok ? 'PASA' : 'NO PASA'}`)
  l.push('')
  l.push(`Tenant \`${meta.tenant}\` · mes ${meta.mes} · reloj fijado ${meta.ahora} · modelo ${meta.modelo}`)
  l.push('')
  l.push(`**Exactitud: ${pct(r.exactitud)}** (${r.aprobadas}/${r.evaluadas} evaluadas; umbral ${pct(meta.umbral)}). Omitidas: ${r.omitidas.length}.`)
  if (!compuerta.ok) l.push(`\nMotivos: ${compuerta.motivos.join('; ')}`)
  l.push('')
  l.push('| Categoría | Aprobadas | Evaluadas | Omitidas |')
  l.push('|---|---|---|---|')
  for (const [c, v] of Object.entries(r.porCategoria)) l.push(`| ${c} | ${v.aprobadas} | ${v.evaluadas} | ${v.omitidas} |`)
  l.push('')
  l.push(`Verificador de números: ${r.verificador.reparadas} respuestas necesitaron reparación; ${r.verificador.conMarcas} quedaron con "[sin verificar]".`)
  if (r.fallasInfra.length > 0) l.push(`\nSin respuesta del chat (infraestructura, omitidas): ${r.fallasInfra.join(', ')}.`)
  l.push('')
  l.push('| id | estado | chequeos fallidos / motivo | latencia | consultas | verificador |')
  l.push('|---|---|---|---|---|---|')
  const fallo = (c: Chequeo) => (c.tipo === 'numero' ? `${c.campo} (esperado ${c.esperado}, obtenido ${c.obtenido ?? '—'})` : c.campo)
  for (const x of rs) {
    const fallidos = x.estado === 'omitida'
      ? `${x.motivo || ''}${x.errorClase ? ` [${x.errorClase}]` : ''}`
      : x.chequeos.filter(c => !c.ok).map(fallo).join('; ')
    const v = x.verificador ? `${x.verificador.sin_rastro} sin rastro${x.verificador.reparado ? ', reparada' : ''}${x.verificador.marcados ? `, ${x.verificador.marcados} marcadas` : ''}` : '—'
    l.push(`| ${x.id} | ${x.estado} | ${celda(fallidos)} | ${(x.latenciaMs / 1000).toFixed(1)} s | ${x.consultas ?? '—'} | ${v} |`)
  }
  l.push('')
  l.push('> La exactitud se MIDE sobre este banco; no se garantiza. Lo que sí se garantiza en producción es que ningún número sin rastro en los datos llega al dueño (verificador).')
  return l.join('\n')
}
