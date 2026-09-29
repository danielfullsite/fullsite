// ── Verificador de números de la IA del dueño ─────────────────────────────────
//
// GARANTÍA: ningún número que no se pueda rastrear a los datos llega al dueño.
//
// Después de que el modelo contesta (texto o voz), se extrae cada cifra de la respuesta
// (montos "$12,534.50", "12.5k", "$1.3M", "13 mil", porcentajes "14.8%", conteos y, en
// voz, números escritos en palabras) y se busca en la EVIDENCIA de esa respuesta:
//   - los bloques de datos precalculados que vio el modelo,
//   - todas las celdas de los resultados de sus consultas (consultar_datos),
//   - la pregunta del usuario.
// No se aceptan valores derivados (sumas, restas, % calculados por el modelo): la regla
// es que las cuentas van EN SQL. La tolerancia sólo cubre la PRESENTACIÓN de un valor
// literal: redondeo o truncado a la precisión mostrada ("12,534.49" → "$12,534",
// "12.5k", "$12.5 mil") y el signo ("bajó 3%"). Por CLASE: un "$" sólo se rastrea con
// dinero, un "%" sólo con porcentajes (o proporciones de columnas pct/tasa/margen), un
// conteo con cualquier número. Lo que escribió el usuario sólo respalda conteos.
//
// No son afirmaciones (no se verifican): fechas y sus partes (días del mes, años), horas,
// duraciones ("últimos 7 días"), marcadores de lista ("1."), "top 3", ordinales y
// números pegados a letras ("2x1", "600ml", "AMA-5096"). En palabras, además, los
// números ≤ 10 sin unidad ("los dos meseros") y los artículos "un/una".
//
// Si hay cifras sin rastro: UNA ronda de reparación (el modelo recibe su respuesta y la
// lista; puede consultar) y se vuelve a verificar. Lo que siga sin rastro se reemplaza
// por "[sin verificar]" y se agrega una nota. Se registran CONTEOS, nunca valores.

export type TipoCifra = 'monto' | 'porcentaje' | 'numero'

export interface Cifra {
  inicio: number
  fin: number
  crudo: string
  /** Valor absoluto ya escalado (k, mil, M…). */
  valor: number
  /** Precisión mostrada, en las unidades del valor: "$12,534" → 1; "12.5k" → 100. */
  paso: number
  tipo: TipoCifra
  enPalabras: boolean
}

export const MARCA_SIN_VERIFICAR = '[sin verificar]'
export const NOTA_SIN_VERIFICAR = 'Algunos números no se pudieron verificar contra tus datos.'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'sept', 'oct', 'nov', 'dic']
const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const RE_MES = `(?:${MESES.join('|')})\\.?`
const RE_DIA_SEM = `(?:${DIAS_SEMANA.join('|')})`

/** minúsculas sin acentos, MISMA longitud que el original (las posiciones se conservan). */
function plano(s: string): string {
  let out = ''
  for (const ch of s) {
    const b = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    out += (b.length === ch.length ? b : ch).toLowerCase()
  }
  return out.length === s.length ? out : s.toLowerCase()
}

// ── Zonas que no se leen como cifras ────────────────────────────────────────

type Rango = [number, number]

function zonas(texto: string, patrones: RegExp[]): Rango[] {
  const out: Rango[] = []
  for (const re of patrones) {
    re.lastIndex = 0
    for (let m = re.exec(texto); m; m = re.exec(texto)) {
      out.push([m.index, m.index + m[0].length])
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return out
}
const dentro = (i: number, rs: Rango[]) => rs.some(([a, b]) => i >= a && i < b)

/** Comentarios HTML (marcadores/bloques de gráfica), destinos de links y URLs. */
const RE_NO_TEXTO = [
  /<!--[\s\S]*?(?:-->|$)/g,
  /\]\([^)]*\)/g,
  /https?:\/\/\S+/g,
]
/** Fechas y horas: sus números nunca son cifras (ni afirmaciones ni evidencia). */
const RE_FECHA_HORA = [
  /\b\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
  /\b\d{4}-\d{2}\b(?!-)/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}-\d{1,2}-\d{4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm|a\.\s?m\.|p\.\s?m\.|hrs?\b|h\b|horas\b))?/gi,
  /\b\d{1,2}\s?(?:am|pm|a\.\s?m\.|p\.\s?m\.)(?![a-z])/gi,
]

// ── Dígitos ─────────────────────────────────────────────────────────────────

const RE_NUM = new RegExp(
  '([-+\\u2212]\\s?)?(\\$\\s?)?'
  + '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{1,3}(?:\\.\\d{3}){2,}|\\d+(?:[.,]\\d+)?)'
  + '(?:\\s?(millones|mill[oó]n|mdp|mil|[kK]|M)(?![a-zA-ZáéíóúñÁÉÍÓÚÑ]))?'
  + '(\\s?%|\\s+por\\s+ciento)?'
  + '(\\s*(?:de\\s+)?(?:pesos|mxn|MXN)\\b)?',
  'g',
)

const ESCALAS: Record<string, number> = { k: 1e3, K: 1e3, mil: 1e3, M: 1e6, millones: 1e6, 'millón': 1e6, millon: 1e6, mdp: 1e6 }

/** "12,534.50" | "1.234.567" | "14,8" → { valor, decimales } (es-MX: coma de miles, punto decimal). */
export function leerNumero(s: string): { valor: number; decimales: number } | null {
  let t = s
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, '')
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.')
  const valor = Number(t)
  if (!Number.isFinite(valor)) return null
  const dec = t.includes('.') ? t.split('.')[1].length : 0
  return { valor, decimales: dec }
}

const UNIDAD_CONTEO = /^\s*(?:pesos|mxn|ordenes|tickets|piezas|pzas|unidades|personas|clientes|comensales|platillos|mesas|productos|ventas|veces|meseros|articulos)\b/
const UNIDAD_CONTEO_NO_PESOS = /^\s*(?:ordenes|tickets|piezas|pzas|unidades|personas|clientes|comensales|platillos|mesas|productos|veces|meseros|articulos)\b/
const UNIDAD_TIEMPO = /^\s*(?:dias?|semanas?|mes(?:es)?|anos?|horas?|hrs?|minutos?|mins?|segundos?|seg)\b/

type Modo = 'afirmacion' | 'evidencia'

function escanearDigitos(texto: string, modo: Modo, ignorar: Rango[]): Cifra[] {
  const p = plano(texto)
  const out: Cifra[] = []
  RE_NUM.lastIndex = 0
  for (let m = RE_NUM.exec(texto); m; m = RE_NUM.exec(texto)) {
    const [todo, signo = '', pesos = '', cuerpo, escala, pct, sufPesos] = m
    const inicioCuerpo = m.index + signo.length + pesos.length
    const antes = m.index > 0 ? texto[m.index - 1] : ''
    const despuesIdx = m.index + todo.length
    const despues = texto.slice(despuesIdx, despuesIdx + 1)
    // Continuación de otro número o de un identificador ("AMA-5096", "x2", "3.5.1").
    // Excepción: un rango con guion ("12-15%"): el "-" no es signo y el 15 sí se lee.
    if (/[\w.,]/.test(antes)) {
      if (signo && /\d/.test(antes) && signo.trim() === '-') { /* rango: se lee */ } else if (/[\d.,_]/.test(antes) || modo === 'afirmacion') continue
    }
    if (dentro(inicioCuerpo, ignorar)) continue
    const n = leerNumero(cuerpo)
    if (!n) continue
    const factor = escala ? ESCALAS[escala] ?? 1 : 1
    // "12.5k" / "$1.3M" / "13 mil" sin unidad de conteo = monto (así lo escribe el modelo para dinero).
    const escalaMonto = !!escala && !UNIDAD_CONTEO_NO_PESOS.test(p.slice(despuesIdx, despuesIdx + 30))
    const tipo: TipoCifra = pct ? 'porcentaje' : (pesos || sufPesos || escala === 'mdp' || escalaMonto) ? 'monto' : 'numero'
    const cifra: Cifra = {
      inicio: pesos ? m.index + signo.length : inicioCuerpo,
      fin: despuesIdx - (sufPesos ? sufPesos.length : 0),
      crudo: '',
      valor: Math.abs(n.valor * factor),
      paso: Math.pow(10, -n.decimales) * factor,
      tipo,
      enPalabras: false,
    }
    cifra.crudo = texto.slice(cifra.inicio, cifra.fin).trim()
    if (modo === 'afirmacion' && !esAfirmacion(p, cifra, n.valor, !!(pesos || pct || escala || sufPesos), despues, /^\d+$/.test(cuerpo))) continue
    out.push(cifra)
  }
  return out
}

/** Contexto que hace de un número una fecha, hora, duración, posición o identificador. */
function esAfirmacion(p: string, c: Cifra, bruto: number, conUnidad: boolean, despues: string, simple: boolean): boolean {
  if (conUnidad) return true
  // Pegado a letras / ordinal ("2x1", "600ml", "3er", "1°").
  if (/[a-zA-ZáéíóúñÁÉÍÓÚÑ°º]/.test(despues)) return false
  const ent = Number.isInteger(bruto)
  const pre = p.slice(Math.max(0, c.inicio - 40), c.inicio)
  const post = p.slice(c.fin, c.fin + 40)
  // Marcador de lista al inicio de línea: "1. ", "2) ".
  if (ent && /(^|\n)\s*$/.test(pre) && /^[.)]\s/.test(post)) return false
  if (/[#№]\s*$/.test(pre)) return false
  if (ent && /\btop\s*$/.test(pre)) return false
  // Días del mes: "15 de agosto", "del 1 al 18 de agosto", "agosto 12", "lunes 5".
  if (ent && bruto >= 1 && bruto <= 31) {
    if (new RegExp(`^\\s*(?:de\\s+)?${RE_MES}(?![a-z])`).test(post)) return false
    if (new RegExp(`^\\s*(?:al|a|y|-|–|—)\\s*\\d{1,2}\\s*(?:de\\s+)?${RE_MES}(?![a-z])`).test(post)) return false
    if (new RegExp(`${RE_MES}\\s+(?:de\\s+)?$`).test(pre)) return false
    if (new RegExp(`\\b${RE_DIA_SEM}\\s+$`).test(pre)) return false
    if (/\b(?:dia|semana)\s+(?:del?\s+)?$/.test(pre)) return false
  }
  // Horas del día: "a las 3", "de 13 a 15 h", "entre las 2 y las 4".
  if (ent && bruto <= 24) {
    if (/\b(?:las?|a\s+las?)\s+$/.test(pre)) return false
    if (/^\s*(?:a|-|–|y)\s*(?:las\s+)?\d{1,2}(?::\d{2})?\s*(?:h|hrs?|horas|am|pm)\b/.test(post)) return false
    if (/^\s*(?:h|hrs?)\b/.test(post)) return false
  }
  // Años: 1990–2100 escritos sin separador y sin unidad.
  if (simple && bruto >= 1990 && bruto <= 2100 && !UNIDAD_CONTEO.test(post)) return false
  // Duraciones: "últimos 7 días", "hace 3 semanas", "12 horas".
  if (ent && bruto <= 400 && UNIDAD_TIEMPO.test(post)) return false
  return true
}

// ── Palabras (voz) ──────────────────────────────────────────────────────────

const PALABRA_VALOR: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400,
  quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
}
const ES_DECENA = (v: number) => v >= 30 && v <= 90 && v % 10 === 0

interface Tok { w: string; i: number; f: number }

function escanearPalabras(texto: string, ignorar: Rango[]): Cifra[] {
  const p = plano(texto)
  const toks: Tok[] = []
  const re = /[a-zñ]+/g
  for (let m = re.exec(p); m; m = re.exec(p)) toks.push({ w: m[0], i: m.index, f: m.index + m[0].length })
  const esNum = (w: string) => w in PALABRA_VALOR || w === 'mil' || w === 'millon' || w === 'millones'
  const out: Cifra[] = []
  let k = 0
  while (k < toks.length) {
    if (!esNum(toks[k].w) || dentro(toks[k].i, ignorar)) { k++; continue }
    if (toks[k].w === 'ciento' && k > 0 && toks[k - 1].w === 'por') { k++; continue } // "por ciento" es unidad
    // Corrida de palabras numéricas (con "y" entre decena y unidad).
    const corrida: Tok[] = []
    let j = k
    let ultimoFin = -1
    while (j < toks.length) {
      const t = toks[j]
      if (ultimoFin >= 0 && /[^\s]/.test(p.slice(ultimoFin, t.i))) break
      if (esNum(t.w)) { corrida.push(t); ultimoFin = t.f; j++; continue }
      if (t.w === 'y' && corrida.length > 0 && j + 1 < toks.length) {
        const prev = PALABRA_VALOR[corrida[corrida.length - 1].w]
        const sig = PALABRA_VALOR[toks[j + 1].w]
        if (prev !== undefined && ES_DECENA(prev) && sig !== undefined && sig >= 1 && sig <= 9) { ultimoFin = t.f; j++; continue }
      }
      break
    }
    if (corrida.length === 0) { k = j + 1; continue }
    let valor = 0; let medio = 0; let cur = 0
    for (const t of corrida) {
      if (t.w === 'mil') { medio += (cur || 1) * 1000; cur = 0 } else if (t.w === 'millon' || t.w === 'millones') { valor += ((medio + cur) || 1) * 1e6; medio = 0; cur = 0 } else cur += PALABRA_VALOR[t.w]
    }
    valor += medio + cur
    let fin = corrida[corrida.length - 1].f
    let paso = 1
    // Decimales: "catorce punto ocho", "doce punto cero cinco".
    const tras = toks[j]
    if (tras && (tras.w === 'punto' || tras.w === 'coma') && !/[^\s]/.test(p.slice(fin, tras.i)) && toks[j + 1] && toks[j + 1].w in PALABRA_VALOR) {
      const dec: Tok[] = []
      let q = j + 1
      while (q < toks.length && toks[q].w in PALABRA_VALOR && !/[^\s]/.test(p.slice(toks[q - 1].f, toks[q].i))) { dec.push(toks[q]); q++ }
      const digitos = dec.every(t => PALABRA_VALOR[t.w] <= 9)
      if (digitos && dec.length > 1) {
        const s = dec.map(t => String(PALABRA_VALOR[t.w])).join('')
        valor += Number(`0.${s}`); paso = Math.pow(10, -s.length)
      } else {
        let dv = 0
        for (const t of dec) dv += PALABRA_VALOR[t.w]
        const s = String(dv)
        valor += Number(`0.${s}`); paso = Math.pow(10, -s.length)
      }
      fin = dec[dec.length - 1].f
      j = q
    }
    const post = p.slice(fin, fin + 40)
    const pre = p.slice(Math.max(0, corrida[0].i - 30), corrida[0].i)
    const pct = /^\s+por\s+ciento\b/.test(post)
    const monto = /^\s+(?:de\s+)?pesos\b/.test(post)
    const escalaPalabra = corrida.some(t => t.w === 'mil' || t.w === 'millon' || t.w === 'millones')
    let valida = true
    // ≤ 10 en palabras sólo cuenta como monto o %: "los dos", "tus tres platillos", "una orden" son prosa.
    if (!pct && !monto && !escalaPalabra && valor <= 10) valida = false
    if (valida && !pct && !monto) {
      const ent = Number.isInteger(valor)
      if (ent && valor >= 1 && valor <= 31 && (new RegExp(`^\\s+de\\s+${RE_MES}(?![a-z])`).test(post) || /\b(?:el|del|al)\s+$/.test(pre) && /^\s+(?:de|al|y)\b/.test(post))) valida = false
      if (ent && valor <= 24 && /\b(?:las?)\s+$/.test(pre)) valida = false
      if (ent && valor >= 1990 && valor <= 2100 && !UNIDAD_CONTEO.test(post)) valida = false
      if (ent && valor <= 400 && UNIDAD_TIEMPO.test(post)) valida = false
    }
    if (valida) {
      const inicio = corrida[0].i
      out.push({ inicio, fin, crudo: texto.slice(inicio, fin), valor, paso, tipo: pct ? 'porcentaje' : monto ? 'monto' : 'numero', enPalabras: true })
    }
    k = Math.max(j, k + 1)
  }
  return out
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Cifras que la respuesta AFIRMA (en el orden en que aparecen). */
export function extraerCifras(texto: string, opciones: { palabras?: boolean } = {}): Cifra[] {
  if (!texto) return []
  const ignorar = [...zonas(texto, RE_NO_TEXTO), ...zonas(texto, RE_FECHA_HORA)]
  const digitos = escanearDigitos(texto, 'afirmacion', ignorar)
  const palabras = opciones.palabras === false ? [] : escanearPalabras(texto, [...ignorar, ...digitos.map(c => [c.inicio, c.fin] as Rango)])
  return [...digitos, ...palabras].sort((a, b) => a.inicio - b.inicio)
}

/** Clase de un valor de evidencia: sólo un monto rastrea un "$", sólo un % rastrea un "%". */
export type ClaseEvidencia = 'monto' | 'porcentaje' | 'numero'

/** Columnas cuyo número es dinero (nombres en español e inglés, por fragmento). */
export const RE_COLUMNA_MONTO = /(total|venta|monto|importe|precio|costo|coste|propina|subtotal|descuento|pago|ticket|ingreso|gasto|efectivo|tarjeta|mxn|pesos|sueldo|salario|nomina|fondo|revenue|amount|price|cost|sales|tip|cash)/i
/** Columnas cuyo número es un porcentaje o una proporción. */
export const RE_COLUMNA_PCT = /(pct|porcentaje|percent|tasa|ratio|margen|proporci|share|particip)/i

class Conjunto {
  private vals: number[] = []
  private ordenado = true
  agregar(n: number) { this.vals.push(Math.abs(n)); this.ordenado = false }
  get tamano() { return this.vals.length }
  hayEntre(a: number, b: number): boolean {
    if (!this.ordenado) { this.vals.sort((x, y) => x - y); this.ordenado = true }
    let lo = 0; let hi = this.vals.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.vals[mid] < a) lo = mid + 1; else hi = mid }
    return lo < this.vals.length && this.vals[lo] <= b
  }
}

/**
 * Valores literales contra los que se verifica, por CLASE:
 *  - monto: números escritos como dinero en el contexto ("$12,533") o celdas de columnas de
 *    dinero (total, venta, importe, precio, propina…). Sólo esto rastrea una cifra con "$".
 *  - porcentaje: números escritos con "%" en el contexto, o celdas de columnas pct/tasa/
 *    margen/ratio (como vienen y ×100, por si son proporción). Sólo esto rastrea un "%".
 *    Una celda cualquiera 0.14 NO rastrea "14%".
 *  - todos: cualquier número (incluye los de arriba); rastrea conteos y números sin unidad.
 * Lo que escribió el usuario (pregunta, historial) sólo entra como conteo: su "$15,000" o
 * su "20%" no pueden respaldar un monto o un % de la respuesta.
 */
export class Evidencia {
  private todos = new Conjunto()
  private montos = new Conjunto()
  private pcts = new Conjunto()

  /** Números de un texto (bloques de datos), con su clase por formato; sin partes de fechas/horas. */
  agregarTexto(texto: string | null | undefined, opciones: { soloConteos?: boolean } = {}): this {
    if (!texto) return this
    const ignorar = zonas(texto, RE_FECHA_HORA)
    for (const c of escanearDigitos(texto, 'evidencia', ignorar)) this.agregarNumero(c.valor, opciones.soloConteos ? 'numero' : c.tipo)
    return this
  }

  agregarNumero(n: number, clase: ClaseEvidencia = 'numero'): this {
    if (typeof n !== 'number' || !Number.isFinite(n)) return this
    this.todos.agregar(n)
    if (clase === 'monto') this.montos.agregar(n)
    if (clase === 'porcentaje') this.pcts.agregar(n)
    return this
  }

  /**
   * Celdas de un resultado: la clase sale del NOMBRE de la columna (`clave`). Numéricos en
   * texto (PostgREST) cuentan como número; los números dentro de textos, por su formato.
   */
  agregarValor(v: unknown, clave = '', prof = 0): this {
    if (prof > 6 || v === null || v === undefined) return this
    let n: number | null = null
    if (typeof v === 'number') n = v
    else if (typeof v === 'string') {
      const t = v.trim()
      if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(t)) n = Number(t)
      else return this.agregarTexto(t)
    }
    if (n !== null) {
      if (RE_COLUMNA_PCT.test(clave)) {
        this.agregarNumero(n, 'porcentaje')
        this.agregarNumero(n * 100, 'porcentaje') // proporción → %
      } else this.agregarNumero(n, RE_COLUMNA_MONTO.test(clave) ? 'monto' : 'numero')
      return this
    }
    if (Array.isArray(v)) { for (const x of v) this.agregarValor(x, clave, prof + 1); return this }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) this.agregarValor(x, k, prof + 1) }
    return this
  }

  get tamano(): number { return this.todos.tamano }

  /** ¿Hay un valor de esa clase en [a, b]? Sin clase (o 'numero'): cualquier valor. */
  hayEntre(a: number, b: number, clase: ClaseEvidencia = 'numero'): boolean {
    const c = clase === 'monto' ? this.montos : clase === 'porcentaje' ? this.pcts : this.todos
    return c.hayEntre(a, b)
  }
}

/**
 * ¿La cifra es la presentación de un valor literal de la evidencia DE SU CLASE?
 * Redondeo a la precisión mostrada (±paso/2) o truncado (e ∈ [v, v+paso)).
 * "$" sólo contra montos; "%" sólo contra porcentajes (las proporciones ya entraron ×100
 * desde columnas pct/tasa/margen/ratio); conteos contra cualquier número.
 */
export function cifraRastreable(c: Cifra, ev: Evidencia): boolean {
  const eps = 1e-9 * Math.max(1, c.valor)
  // Redondeo: e ∈ [v − paso/2, v + paso/2]. Truncado de decimales (paso ≤ 1): e ∈ [v, v + paso).
  // Con escala ("13 mil") sólo redondeo: 13,900 dicho "13 mil" sería engañoso.
  const trunca = c.paso <= 1 && !c.enPalabras
  return ev.hayEntre(c.valor - c.paso / 2 - eps, c.valor + (trunca ? c.paso - eps : c.paso / 2 + eps), c.tipo)
}

export interface ResultadoVerificacion {
  cifras: Cifra[]
  sinRastro: Cifra[]
}

export function verificarNumeros(texto: string, ev: Evidencia, opciones: { palabras?: boolean } = {}): ResultadoVerificacion {
  const cifras = extraerCifras(texto, opciones)
  return { cifras, sinRastro: cifras.filter(c => !cifraRastreable(c, ev)) }
}

/** Reemplaza cada cifra sin rastro por "[sin verificar]" y agrega la nota. */
export function marcarSinVerificar(texto: string, sinRastro: Cifra[]): string {
  if (sinRastro.length === 0) return texto
  let t = texto
  for (const c of [...sinRastro].sort((a, b) => b.inicio - a.inicio)) {
    t = t.slice(0, c.inicio) + MARCA_SIN_VERIFICAR + t.slice(c.fin)
  }
  return `${t.trimEnd()}\n\n${NOTA_SIN_VERIFICAR}`
}

/** Instrucción de la ronda de reparación (las cifras son de la respuesta del propio modelo). */
export function mensajeReparacion(sinRastro: Cifra[], puedeConsultar: boolean): string {
  const lista = [...new Set(sinRastro.map(c => c.crudo))].slice(0, 20).map(s => `"${s}"`).join(', ')
  return 'VERIFICACIÓN AUTOMÁTICA DEL SISTEMA (no es del usuario): estos números de tu respuesta anterior NO aparecen '
    + `en el bloque de datos ni en los resultados de las consultas: ${lista}. `
    + 'Reescribe la respuesta COMPLETA usando sólo números que aparezcan tal cual en los datos o en resultados de consultas '
    + '(puedes redondearlos). No sumes, restes, promedies ni saques porcentajes tú. '
    + (puedeConsultar
      ? 'Si necesitas una cifra que no está, calcúlala EN SQL con consultar_datos. '
      : '')
    + 'Si no puedes obtenerla, quita esa cifra y di que no la tienes. No menciones esta verificación.'
}

export interface Reparacion {
  texto: string
  /** Evidencia nueva de la reparación (p. ej. resultados de consultas nuevas). */
  evidenciaExtra?: unknown[]
}

export interface ResultadoGarantia {
  texto: string
  afirmaciones: number
  sinRastroInicial: number
  reparado: boolean
  marcados: number
  msReparacion: number
}

/**
 * Verifica; si hay cifras sin rastro, UNA reparación y re-verificación; lo que quede se
 * marca "[sin verificar]". Nunca lanza: si la reparación falla, se marca la original.
 */
export async function garantizarNumeros(o: {
  texto: string
  evidencia: Evidencia
  palabras?: boolean
  reparar?: (texto: string, sinRastro: Cifra[]) => Promise<Reparacion>
  ahora?: () => number
}): Promise<ResultadoGarantia> {
  const ahora = o.ahora ?? Date.now
  const v1 = verificarNumeros(o.texto, o.evidencia, { palabras: o.palabras })
  const base = { afirmaciones: v1.cifras.length, sinRastroInicial: v1.sinRastro.length, msReparacion: 0 }
  if (v1.sinRastro.length === 0) return { ...base, texto: o.texto, reparado: false, marcados: 0 }
  if (o.reparar) {
    const t0 = ahora()
    try {
      const r = await o.reparar(o.texto, v1.sinRastro)
      for (const x of r.evidenciaExtra || []) o.evidencia.agregarValor(x)
      const ms = ahora() - t0
      if (r.texto && r.texto.trim()) {
        const v2 = verificarNumeros(r.texto, o.evidencia, { palabras: o.palabras })
        return { ...base, msReparacion: ms, texto: marcarSinVerificar(r.texto, v2.sinRastro), reparado: true, marcados: v2.sinRastro.length }
      }
      return { ...base, msReparacion: ms, texto: marcarSinVerificar(o.texto, v1.sinRastro), reparado: false, marcados: v1.sinRastro.length }
    } catch {
      return { ...base, msReparacion: ahora() - t0, texto: marcarSinVerificar(o.texto, v1.sinRastro), reparado: false, marcados: v1.sinRastro.length }
    }
  }
  return { ...base, texto: marcarSinVerificar(o.texto, v1.sinRastro), reparado: false, marcados: v1.sinRastro.length }
}
