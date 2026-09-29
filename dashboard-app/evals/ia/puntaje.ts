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
/** Omisión de la pregunta en la que Groq agotó la cuota diaria (la corrida se detiene ahí). */
export const MOTIVO_CUOTA = `${MOTIVO_INFRA}: cuota diaria de Groq agotada (no es error del modelo)`
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
  /** Plantilla del generador (sólo preguntas generadas; su id es fijo, no es dato). */
  plantilla?: string
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

/** Cómo terminó la corrida (paro ordenado por cuota o tiempo, reemplazos de degeneradas). */
export interface InfoCorrida {
  detenida: 'cuota' | 'tiempo' | null
  /** Preguntas de la lista que ya no se corrieron por el paro (no cuentan en nada). */
  noCorridas: number
  /** Generadas degeneradas / sin datos cambiadas por otra de la reserva. */
  reemplazos: number
  /** Reintentos por 429 de Groq. */
  esperas429: number
}

export interface Conteo { evaluadas: number; aprobadas: number; omitidas: number }

export interface Resumen {
  total: number
  evaluadas: number
  aprobadas: number
  exactitud: number
  /** Intervalo de confianza de 95% (Wilson) de la exactitud. */
  ic95: [number, number]
  porCategoria: Record<string, Conteo>
  /** Por plantilla del generador; las del banco escrito a mano van juntas en `banco`. */
  porPlantilla: Record<string, Conteo>
  corrida: InfoCorrida | null
  trampasFallidas: string[]
  omitidas: string[]
  /** Omitidas porque el chat no respondió (no por falta de datos). */
  fallasInfra: string[]
  verificador: { reparadas: number; conMarcas: number }
}

/**
 * Intervalo de Wilson (95% por defecto) para k aciertos de n. Con n chico no se sale de
 * [0, 1] ni colapsa a un punto como el intervalo normal. n = 0 → [0, 1].
 */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1]
  const p = k / n
  const z2 = z * z
  const den = 1 + z2 / n
  const centro = (p + z2 / (2 * n)) / den
  const margen = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den
  return [Math.max(0, centro - margen), Math.min(1, centro + margen)]
}

export const PLANTILLA_BANCO = 'banco'

export function resumir(rs: ResultadoPregunta[], corrida: InfoCorrida | null = null): Resumen {
  const evaluadas = rs.filter(r => r.estado !== 'omitida')
  const aprobadas = evaluadas.filter(r => r.estado === 'aprobada')
  const porCategoria: Resumen['porCategoria'] = {}
  const porPlantilla: Resumen['porPlantilla'] = {}
  const contar = (m: Record<string, Conteo>, k: string, r: ResultadoPregunta) => {
    const c = (m[k] ||= { evaluadas: 0, aprobadas: 0, omitidas: 0 })
    if (r.estado === 'omitida') c.omitidas++
    else { c.evaluadas++; if (r.estado === 'aprobada') c.aprobadas++ }
  }
  for (const r of rs) {
    contar(porCategoria, r.categoria, r)
    contar(porPlantilla, r.plantilla ?? PLANTILLA_BANCO, r)
  }
  return {
    total: rs.length,
    evaluadas: evaluadas.length,
    aprobadas: aprobadas.length,
    exactitud: evaluadas.length > 0 ? aprobadas.length / evaluadas.length : 0,
    ic95: wilson(aprobadas.length, evaluadas.length),
    porCategoria,
    porPlantilla,
    corrida,
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
  // La pregunta en la que se agotó la cuota diaria no cuenta: la corrida se detuvo ahí a
  // propósito (reporte parcial), no es un chat que falla una y otra vez.
  const infra = r.fallasInfra.length - (r.corrida?.detenida === 'cuota' ? 1 : 0)
  if (r.total > 0 && infra / r.total > MAX_FRACCION_INFRA) {
    motivos.push(`corrida no válida: ${infra} de ${r.total} preguntas sin respuesta del chat (infraestructura)`)
  }
  return { ok: motivos.length === 0, motivos }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').slice(0, 300)

export interface MetaReporte {
  tenant: string; mes: string; ahora: string; umbral: number; modelo: string
  semilla?: string; muestra?: number; incluirBase?: boolean; stamp?: string
}

/** Info de la lista que el reporte muestra (sólo conteos). */
export interface InfoListaReporte {
  generadas: number; muestra: number; base: number; dominios: Record<string, number>; erroresDescubrimiento: Record<string, string>
}

const ic = (c: Conteo) => { const [a, b] = wilson(c.aprobadas, c.evaluadas); return c.evaluadas > 0 ? `${pct(a)}–${pct(b)}` : '—' }
const exac = (c: Conteo) => (c.evaluadas > 0 ? pct(c.aprobadas / c.evaluadas) : '—')

export function reporteMarkdown(rs: ResultadoPregunta[], r: Resumen, meta: MetaReporte, info?: InfoListaReporte): string {
  const compuerta = pasaCompuerta(r, meta.umbral)
  const l: string[] = []
  l.push(`# Eval IA del dueño — ${compuerta.ok ? 'PASA' : 'NO PASA'}${r.corrida?.detenida ? ' (CORRIDA PARCIAL)' : ''}`)
  l.push('')
  l.push(`Tenant \`${meta.tenant}\` · mes ${meta.mes} · reloj fijado ${meta.ahora} · modelo ${meta.modelo}`
    + (meta.semilla ? ` · semilla ${meta.semilla}` : ''))
  if (info) {
    l.push('')
    l.push(`Preguntas: ${info.base} del banco + ${info.muestra} generadas (muestra de ${info.generadas} posibles para este tenant).`
      + ` Dominios: ${Object.entries(info.dominios).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`
      + (Object.keys(info.erroresDescubrimiento).length ? ` Descubrimiento con error: ${Object.entries(info.erroresDescubrimiento).map(([k, v]) => `${k} [${v}]`).join(', ')}.` : ''))
  }
  l.push('')
  l.push(`**Exactitud: ${pct(r.exactitud)}** (IC 95%: ${pct(r.ic95[0])}–${pct(r.ic95[1])}; ${r.aprobadas}/${r.evaluadas} evaluadas; umbral ${pct(meta.umbral)}). Omitidas: ${r.omitidas.length}.`)
  if (r.corrida?.detenida) {
    l.push('')
    l.push(`**Corrida parcial:** se detuvo por ${r.corrida.detenida === 'cuota' ? 'cuota diaria de Groq agotada' : 'presupuesto de tiempo'}; `
      + `${r.corrida.noCorridas} preguntas no se corrieron (no cuentan). Es infraestructura, no error del modelo.`)
  }
  if (r.corrida && (r.corrida.reemplazos || r.corrida.esperas429)) {
    l.push('')
    l.push(`Reemplazos de generadas degeneradas/sin datos: ${r.corrida.reemplazos}. Reintentos por 429 de Groq: ${r.corrida.esperas429}.`)
  }
  if (!compuerta.ok) l.push(`\nMotivos: ${compuerta.motivos.join('; ')}`)
  l.push('')
  l.push('| Categoría | Aprobadas | Evaluadas | Omitidas | Exactitud | IC 95% |')
  l.push('|---|---|---|---|---|---|')
  for (const [c, v] of Object.entries(r.porCategoria)) l.push(`| ${c} | ${v.aprobadas} | ${v.evaluadas} | ${v.omitidas} | ${exac(v)} | ${ic(v)} |`)
  l.push('')
  const plantillas = Object.entries(r.porPlantilla).filter(([, v]) => v.evaluadas > 0)
  if (plantillas.length > 1 || (plantillas.length === 1 && plantillas[0][0] !== PLANTILLA_BANCO)) {
    const peores = plantillas
      .sort((a, b) => (a[1].aprobadas / a[1].evaluadas) - (b[1].aprobadas / b[1].evaluadas) || b[1].evaluadas - a[1].evaluadas || (a[0] < b[0] ? -1 : 1))
      .slice(0, 20)
    l.push('Plantillas que más fallan (hasta 20):')
    l.push('')
    l.push('| Plantilla | Aprobadas | Evaluadas | Exactitud |')
    l.push('|---|---|---|---|')
    for (const [k, v] of peores) l.push(`| ${k} | ${v.aprobadas} | ${v.evaluadas} | ${exac(v)} |`)
    l.push('')
  }
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

/**
 * Registro compacto para series de tiempo (una línea por corrida). Sin datos del
 * restaurante: sólo conteos, exactitudes e ids de plantillas/categorías.
 */
export function tendencia(r: Resumen, meta: MetaReporte) {
  const tasa = (c: Conteo) => ({ ...c, exactitud: c.evaluadas > 0 ? c.aprobadas / c.evaluadas : null })
  return {
    version: 1,
    stamp: meta.stamp ?? null,
    tenant: meta.tenant, mes: meta.mes, modelo: meta.modelo, semilla: meta.semilla ?? null, muestra: meta.muestra ?? null,
    total: r.total, evaluadas: r.evaluadas, aprobadas: r.aprobadas, exactitud: r.exactitud, ic95: r.ic95,
    trampasFallidas: r.trampasFallidas.length, omitidas: r.omitidas.length, fallasInfra: r.fallasInfra.length,
    corrida: r.corrida,
    porCategoria: Object.fromEntries(Object.entries(r.porCategoria).map(([k, v]) => [k, tasa(v)])),
    porPlantilla: Object.fromEntries(Object.entries(r.porPlantilla).map(([k, v]) => [k, tasa(v)])),
    pasa: pasaCompuerta(r, meta.umbral).ok,
  }
}
