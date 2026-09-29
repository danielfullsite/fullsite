// ── Contrato de las gráficas del chat (lado compartido cliente/servidor) ─────────
//
// Una gráfica del chat es un `GraficaSpec`: lo arma el SERVIDOR (lib/graficas-chat.ts)
// sólo con datos que la ruta ya leyó. El modelo nunca escribe datos: pone un marcador
// `<!--grafica:ID-->` y el servidor lo sustituye por el bloque
//
//   <!--chart
//   {"v":2,"id":"ventas_diarias_30d",...}
//   chart-->
//
// Este módulo es puro (sin fetch ni APIs del servidor) para que el widget lo use:
// valida un spec, separa texto y gráficas de una respuesta, y formatea números/fechas.
// Un bloque que no pasa `validarSpec` (p. ej. el formato viejo `{type,data}` que
// escribía el modelo) NO se dibuja.

export const VERSION_SPEC = 2

export const IDS_GRAFICA = [
  'ventas_diarias_30d',
  'ventas_por_mes',
  'hoy_vs_semana_pasada',
  'semana_vs_anterior',
  'franjas',
  'top_platillos',
  'meseros',
  'metodos_pago',
  'ventas_por_hora',
  // Gráfica armada por el servidor con las filas de una consulta a los datos
  // (ia_consulta) hecha en ESTA respuesta. El modelo la pide con
  // `<!--grafica:consulta-N-->`; nunca escribe sus valores.
  'consulta',
] as const
export type IdGrafica = typeof IDS_GRAFICA[number]

/**
 * - barra:         columnas de UNA serie (tendencia/magnitud en el tiempo)
 * - barra_agrupada: dos series lado a lado (periodo vs periodo anterior)
 * - linea / area:  tendencia de una serie
 * - comparacion:   dos líneas en UN solo eje (hoy vs semana pasada, acumulado)
 * - barra_apilada: parte-del-todo por categoría (comida/bebida por franja)
 * - ranking:       barras horizontales ordenadas (platillos, meseros)
 * - dona:          parte-del-todo con ≤5 partes
 */
export type TipoGrafica = 'barra' | 'barra_agrupada' | 'linea' | 'area' | 'comparacion' | 'barra_apilada' | 'ranking' | 'dona'
export type UnidadGrafica = 'MXN' | 'ordenes' | 'pct' | 'piezas' | 'numero'
export type EjeX = 'fecha' | 'mes' | 'hora' | 'categoria'

export interface SerieGrafica {
  clave: string
  nombre: string
  /** principal = color de serie; contexto = gris de-énfasis (periodo anterior). */
  rol?: 'principal' | 'contexto'
}

export interface FilaGrafica {
  /** Clave del eje X: YYYY-MM-DD, YYYY-MM, HH:00 o nombre de categoría. */
  x: string
  /** Valor por serie. `null` = SIN DATOS (hueco), nunca se dibuja como cero. */
  v: Record<string, number | null>
  /** Periodo en curso / incompleto (hoy, mes actual): se dibuja más tenue. */
  parcial?: boolean
  /** Nota corta para tooltip y tabla ("en curso", "12 días con datos"). */
  nota?: string
}

export interface GraficaSpec {
  v: typeof VERSION_SPEC
  id: IdGrafica
  tipo: TipoGrafica
  titulo: string
  /** Rango real de los datos, p. ej. "2026-08-30 a 2026-09-28". */
  rango: string
  unidad: UnidadGrafica
  ejeX: EjeX
  series: SerieGrafica[]
  filas: FilaGrafica[]
  fuente: string
  /** Última fecha (o fecha y hora) que cubren los datos. */
  datosHasta: string
  /** Días del eje sin datos (se muestran como hueco). */
  huecos?: number
  /** Aviso honesto (muestra chica, tope de lectura, cobertura desigual…). */
  aviso?: string
}

const TIPOS: TipoGrafica[] = ['barra', 'barra_agrupada', 'linea', 'area', 'comparacion', 'barra_apilada', 'ranking', 'dona']
const UNIDADES: UnidadGrafica[] = ['MXN', 'ordenes', 'pct', 'piezas', 'numero']
const EJES: EjeX[] = ['fecha', 'mes', 'hora', 'categoria']
const MAX_FILAS = 120

const esTexto = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length <= max

/** Spec válido y dibujable, o null. Nunca lanza. */
export function validarSpec(raw: unknown): GraficaSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.v !== VERSION_SPEC) return null
  if (!(IDS_GRAFICA as readonly string[]).includes(s.id as string)) return null
  if (!TIPOS.includes(s.tipo as TipoGrafica)) return null
  if (!UNIDADES.includes(s.unidad as UnidadGrafica)) return null
  if (!EJES.includes(s.ejeX as EjeX)) return null
  if (!esTexto(s.titulo) || !esTexto(s.rango, 120) || !esTexto(s.fuente, 160) || !esTexto(s.datosHasta, 40)) return null
  if (!Array.isArray(s.series) || s.series.length === 0 || s.series.length > 6) return null
  const series: SerieGrafica[] = []
  for (const x of s.series) {
    if (!x || typeof x !== 'object') return null
    const y = x as Record<string, unknown>
    if (!esTexto(y.clave, 40) || !esTexto(y.nombre, 80)) return null
    series.push({ clave: y.clave, nombre: y.nombre, ...(y.rol === 'contexto' || y.rol === 'principal' ? { rol: y.rol } : {}) })
  }
  if (!Array.isArray(s.filas) || s.filas.length === 0 || s.filas.length > MAX_FILAS) return null
  const filas: FilaGrafica[] = []
  let conValor = 0
  for (const f of s.filas) {
    if (!f || typeof f !== 'object') return null
    const g = f as Record<string, unknown>
    if (!esTexto(g.x, 80) || !g.v || typeof g.v !== 'object') return null
    const v: Record<string, number | null> = {}
    for (const se of series) {
      const val = (g.v as Record<string, unknown>)[se.clave]
      if (val === null || val === undefined) v[se.clave] = null
      else if (typeof val === 'number' && Number.isFinite(val)) { v[se.clave] = val; conValor++ }
      else return null
    }
    filas.push({ x: g.x, v, ...(g.parcial === true ? { parcial: true } : {}), ...(esTexto(g.nota, 80) ? { nota: g.nota } : {}) })
  }
  if (conValor === 0) return null
  if (s.tipo === 'dona' && (filas.length > 5 || series.length !== 1)) return null
  return {
    v: VERSION_SPEC,
    id: s.id as IdGrafica,
    tipo: s.tipo as TipoGrafica,
    titulo: s.titulo,
    rango: s.rango,
    unidad: s.unidad as UnidadGrafica,
    ejeX: s.ejeX as EjeX,
    series,
    filas,
    fuente: s.fuente,
    datosHasta: s.datosHasta,
    ...(typeof s.huecos === 'number' && s.huecos > 0 ? { huecos: Math.round(s.huecos) } : {}),
    ...(esTexto(s.aviso, 240) ? { aviso: s.aviso } : {}),
  }
}

// ── Bloques en el texto ─────────────────────────────────────────────────────

/** Cualquier bloque `<!--chart … chart-->` (formato nuevo o el viejo del modelo). */
export const RE_BLOQUE_CHART = /<!--\s*chart\s*([\s\S]*?)\s*chart\s*-->/g
/** Marcador que escribe el modelo: `<!--grafica:ID-->` (o `<!--grafica:consulta-N-->`). */
export const RE_MARCADOR = /<!--\s*grafica\s*:\s*([a-z0-9_-]{1,60})\s*-->/gi

export function bloqueDeSpec(spec: GraficaSpec): string {
  // `-->` dentro del JSON cerraría el comentario: se escapa (JSON sigue siendo válido).
  return `<!--chart\n${JSON.stringify(spec).replace(/-->/g, '--\\u003e')}\nchart-->`
}

// Cache por texto del bloque: el mismo bloque devuelve el MISMO objeto spec, así la
// máquina de escribir (un tick cada 15 ms) no re-dibuja las gráficas (React.memo).
const MAX_CACHE = 64
const cacheSpecs = new Map<string, GraficaSpec | null>()
function specDeBloque(json: string): GraficaSpec | null {
  if (cacheSpecs.has(json)) return cacheSpecs.get(json) ?? null
  let spec: GraficaSpec | null = null
  try { spec = validarSpec(JSON.parse(json)) } catch { spec = null }
  if (cacheSpecs.size >= MAX_CACHE) cacheSpecs.delete(cacheSpecs.keys().next().value as string)
  cacheSpecs.set(json, spec)
  return spec
}

export type ParteMensaje = { tipo: 'texto'; texto: string } | { tipo: 'grafica'; spec: GraficaSpec }

/**
 * Separa una respuesta en texto y gráficas, en orden. Los bloques inválidos o del
 * formato viejo se QUITAN (no se dibuja un dato que no armó el servidor). Los
 * marcadores sueltos que no se sustituyeron también se quitan.
 */
export function separarGraficas(texto: string): ParteMensaje[] {
  const partes: ParteMensaje[] = []
  let ultimo = 0
  const empujarTexto = (t: string) => {
    const limpio = t.replace(RE_MARCADOR, '').replace(/\n{3,}/g, '\n\n')
    if (limpio.trim()) partes.push({ tipo: 'texto', texto: limpio })
  }
  for (const m of texto.matchAll(RE_BLOQUE_CHART)) {
    const i = m.index ?? 0
    empujarTexto(texto.slice(ultimo, i))
    ultimo = i + m[0].length
    const spec = specDeBloque(m[1].trim())
    if (spec) partes.push({ tipo: 'grafica', spec })
  }
  // Un bloque ABIERTO sin cerrar (texto a medias) no se muestra como JSON crudo.
  const cola = texto.slice(ultimo)
  const abierto = cola.search(/<!--/)
  empujarTexto(abierto >= 0 && !cola.slice(abierto).includes('-->') ? cola.slice(0, abierto) : cola)
  return partes.map(p => (p.tipo === 'texto' ? { tipo: 'texto', texto: p.texto.trim() } : p))
}

/**
 * Máquina de escribir: si el corte `idx` cae DENTRO de un comentario `<!-- … -->`,
 * lo avanza hasta el final del comentario. Así el JSON de una gráfica (miles de
 * caracteres) no se "teclea" letra por letra ni se ve crudo a medias.
 */
export function corteSinPartirBloques(texto: string, idx: number): number {
  const abre = texto.lastIndexOf('<!--', idx)
  if (abre === -1) return idx
  const cierra = texto.indexOf('-->', abre)
  if (cierra === -1) return texto.length
  if (cierra + 3 > idx) return cierra + 3
  return idx
}

// ── Formato (es-MX) ─────────────────────────────────────────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** $12,534.00 */
export function mxnCompleto(n: number): string {
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** $12.5k · $1.2M · $950 (ticks de eje) */
export function mxnCorto(n: number): string {
  const a = Math.abs(n)
  const s = n < 0 ? '-' : ''
  const corto = (x: number) => (Math.round(x * 10) / 10).toLocaleString('es-MX', { maximumFractionDigits: 1 })
  if (a >= 1e6) return `${s}$${corto(a / 1e6)}M`
  if (a >= 1e3) return `${s}$${corto(a / 1e3)}k`
  return `${s}$${Math.round(a).toLocaleString('es-MX')}`
}

export function valorCompleto(n: number | null, unidad: UnidadGrafica): string {
  if (n === null) return 'sin datos'
  if (unidad === 'MXN') return mxnCompleto(n)
  if (unidad === 'pct') return `${n.toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`
  if (unidad === 'numero') return n.toLocaleString('es-MX', { maximumFractionDigits: 2 })
  const u = unidad === 'ordenes' ? 'órdenes' : 'pzas'
  return `${Math.round(n).toLocaleString('es-MX')} ${u}`
}

export function valorCorto(n: number, unidad: UnidadGrafica): string {
  if (unidad === 'MXN') return mxnCorto(n)
  if (unidad === 'pct') return `${Math.round(n)}%`
  if (unidad === 'numero' && Math.abs(n) < 10 && !Number.isInteger(n)) return (Math.round(n * 10) / 10).toLocaleString('es-MX')
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString('es-MX')}k` : Math.round(n).toLocaleString('es-MX')
}

/** Etiqueta corta para el eje: "28 sep", "sep", "sep '25", "14:00", o el nombre. */
export function etiquetaEje(x: string, eje: EjeX, conAnio = false): string {
  if (eje === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(x)) return `${Number(x.slice(8, 10))} ${MESES[Number(x.slice(5, 7)) - 1] ?? ''}`
  if (eje === 'mes' && /^\d{4}-\d{2}$/.test(x)) return `${MESES[Number(x.slice(5, 7)) - 1] ?? x}${conAnio ? ` '${x.slice(2, 4)}` : ''}`
  return x
}

/** Etiqueta larga (tooltip, tabla): "dom 28 sep 2026 (2026-09-28)". */
export function etiquetaLarga(x: string, eje: EjeX): string {
  if (eje === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(x)) {
    const d = new Date(`${x}T12:00:00Z`)
    return `${DIAS[d.getUTCDay()]} ${etiquetaEje(x, 'fecha')} · ${x}`
  }
  if (eje === 'mes' && /^\d{4}-\d{2}$/.test(x)) return `${MESES[Number(x.slice(5, 7)) - 1] ?? ''} ${x.slice(0, 4)}`
  return x
}
