// Convierte la respuesta del chat (markdown ligero, links internos, bloques de
// gráfica, montos "$12,533") en texto que suena bien en voz alta en español.
//
// El prompt en modo voz ya le pide al modelo hablar así; esto es la red de
// seguridad: si el modelo manda una tabla o "$12,533", la voz no dice "asterisco
// asterisco" ni "dólar doce coma quinientos".

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
]
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function menorQueMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c])
  if (r > 0) {
    if (r < 30) partes.push(UNIDADES[r])
    else {
      const d = Math.floor(r / 10)
      const u = r % 10
      partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d])
    }
  }
  return partes.join(' ')
}

/** "uno" → "un", "veintiuno" → "veintiún" antes de un sustantivo (mil, millones, pesos). */
function apocope(texto: string): string {
  return texto.replace(/veintiuno$/, 'veintiún').replace(/(^|\s)uno$/, '$1un')
}

/**
 * Entero no negativo a palabras en español ("doce mil quinientos").
 * `antesDeSustantivo` aplica el apócope: "veintiún pesos", "un peso".
 * Fuera de rango (≥ 10¹²) o no entero → los dígitos tal cual.
 */
export function numeroEnPalabras(n: number, antesDeSustantivo = false): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n >= 1e12) return String(n)
  if (n === 0) return 'cero'

  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  const partes: string[] = []

  if (millones > 0) {
    partes.push(millones === 1 ? 'un millón' : `${apocope(numeroEnPalabras(millones, true))} millones`)
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'mil' : `${apocope(menorQueMil(miles))} mil`)
  }
  if (resto > 0) {
    const t = menorQueMil(resto)
    partes.push(antesDeSustantivo ? apocope(t) : t)
  }
  return partes.join(' ')
}

/** "$12,533.50" → "doce mil quinientos treinta y tres pesos con cincuenta centavos". */
export function montoEnPalabras(monto: number): string {
  if (!Number.isFinite(monto)) return String(monto)
  const negativo = monto < 0
  const abs = Math.abs(monto)
  let pesos = Math.floor(abs)
  let centavos = Math.round((abs - pesos) * 100)
  if (centavos === 100) { pesos += 1; centavos = 0 }

  let texto: string
  if (pesos === 1) texto = 'un peso'
  else if (pesos > 0 && pesos % 1_000_000 === 0) texto = `${numeroEnPalabras(pesos, true)} de pesos`
  else texto = `${numeroEnPalabras(pesos, true)} pesos`

  if (centavos > 0) {
    texto += ` con ${centavos === 1 ? 'un centavo' : `${numeroEnPalabras(centavos, true)} centavos`}`
  }
  return negativo ? `menos ${texto}` : texto
}

/** "12.5" → "doce punto cinco"; "1,234" → "mil doscientos treinta y cuatro". */
function decimalEnPalabras(crudo: string): string {
  const limpio = crudo.replace(/,/g, '')
  const [ent, dec] = limpio.split('.')
  const entero = Number(ent)
  if (!Number.isFinite(entero)) return crudo
  const base = numeroEnPalabras(entero)
  if (!dec || /^0+$/.test(dec)) return base
  // "12.05" → "doce punto cero cinco": dígito por dígito si empieza en cero.
  const parteDec = dec.startsWith('0')
    ? dec.split('').map(d => UNIDADES[Number(d)]).join(' ')
    : numeroEnPalabras(Number(dec))
  return `${base} punto ${parteDec}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Verbaliza montos, porcentajes, fechas ISO y números con separador de miles. */
export function verbalizarNumeros(texto: string, anioActual?: number): string {
  return texto
    // Fechas ISO: "2026-09-28" → "28 de septiembre" (+ año si no es el actual)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, a, mes, d) => {
      const mi = Number(mes) - 1
      if (mi < 0 || mi > 11) return m
      const dia = Number(d) === 1 ? 'primero' : String(Number(d))
      return anioActual && Number(a) === anioActual ? `${dia} de ${MESES[mi]}` : `${dia} de ${MESES[mi]} de ${a}`
    })
    // Montos: "$12,533", "$ 1,200.50", "-$300", "$12k"
    .replace(/(-?)\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s?[kK]\b)?/g, (_m, signo, ent, dec, k) => {
      let valor = Number(String(ent).replace(/,/g, '')) + (dec ? Number(`0.${dec}`) : 0)
      if (k) valor *= 1000
      return montoEnPalabras(signo ? -valor : valor)
    })
    // Porcentajes: "12.5%", "-3 %"
    .replace(/(-?)(\d+(?:[.,]\d+)?)\s?%/g, (_m, signo, num) => {
      const t = decimalEnPalabras(String(num).replace(',', '.'))
      return `${signo ? 'menos ' : ''}${t} por ciento`
    })
    // Números con separador de miles: "1,234", "12,533.5"
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => decimalEnPalabras(m))
}

// Pictogramas / emojis (incluye el selector de variación y el ZWJ que los une).
const RE_EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu

/**
 * Respuesta (markdown ligero) → texto limpio, SIN verbalizar números: lo que se
 * MUESTRA como subtítulo mientras se habla. Cada línea termina en puntuación.
 *  - quita bloques de gráfica y comentarios HTML
 *  - [etiqueta](/ruta) → etiqueta (sin "Ver detalle →" colgando)
 *  - quita **, __, `, #, >, viñetas, tablas y emojis
 */
export function textoLimpioParaVoz(md: string): string {
  if (!md) return ''
  let t = md
    .replace(/<!--\s*chart[\s\S]*?chart\s*-->/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    // Links del dashboard "[Ver ventas →](/ventas)": en voz no se puede hacer clic.
    .replace(/\[(?:ver|abrir)[^\]]*\]\([^)]*\)/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')

  // Tablas: se quitan las filas separadoras y las celdas se leen como lista.
  t = t.split('\n').map(linea => {
    const l = linea.trim()
    if (/^\|?[\s:|-]+\|?$/.test(l) && l.includes('-') && l.includes('|')) return ''
    if (l.startsWith('|') || (l.match(/\|/g) || []).length >= 2) {
      return l.split('|').map(c => c.trim()).filter(Boolean).join(', ')
    }
    return l
  }).join('\n')

  t = t
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~`#|]/g, ' ')
    .replace(/[→←↑↓⇒➜▶►]/g, ' ')
    .replace(RE_EMOJI, '')

  // Saltos de línea → pausa: cada línea termina en puntuación.
  return t
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(l => (/[.!?¿¡:;,]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\1+/g, '$1')
    .trim()
}

/**
 * Texto de la respuesta → texto para hablar: `textoLimpioParaVoz` + montos,
 * porcentajes y fechas dichos en palabras.
 */
export function textoParaHablar(md: string, opciones: { anioActual?: number } = {}): string {
  return verbalizarNumeros(textoLimpioParaVoz(md), opciones.anioActual).trim()
}

/** Una frase de la respuesta: lo que se muestra (con dígitos) y lo que se dice. */
export interface FraseHablada {
  mostrar: string
  hablar: string
}

/**
 * Parte una oración larga por comas / punto y coma y, si aún no cabe, por palabras.
 */
function partirOracionLarga(oracion: string, max: number): string[] {
  if (oracion.length <= max) return [oracion]
  const piezas: string[] = []
  for (const frase of oracion.split(/(?<=[,;:])\s+/)) {
    if (frase.length <= max) { piezas.push(frase); continue }
    let actual = ''
    for (const palabra of frase.split(' ')) {
      if (actual && (actual.length + 1 + palabra.length) > max) { piezas.push(actual); actual = palabra }
      else actual = actual ? `${actual} ${palabra}` : palabra
    }
    if (actual) piezas.push(actual)
  }
  return piezas
}

/**
 * Respuesta → frases para hablar UNA POR UNA (voz natural en tubería: mientras
 * suena la frase 1 se sintetiza la 2).
 *
 * - Se parte por oración: puntuación final SEGUIDA de espacio, así "$12,500.50" no
 *   se parte en el punto decimal.
 * - La PRIMERA frase se mantiene corta (`primeraMax`): es la que el dueño espera en
 *   silencio; si es larga se corta en la primera coma después de ~25 caracteres.
 * - Oraciones de más de `maxCaracteres` se parten por comas y luego por palabras.
 * - Trozos muy cortos (< 12 caracteres, "Va.") se juntan con el siguiente: un trozo suelto de medio
 *   segundo deja un hueco mientras se sintetiza el que sigue.
 *
 * `mostrar` conserva los dígitos (subtítulo); `hablar` los dice en palabras. El
 * cliente y el proveedor de voz llaman a esta función con el mismo texto, así el
 * índice de frase que reporta la voz es el mismo que resalta la pantalla.
 */
export function frasesParaHablar(
  md: string,
  opciones: { anioActual?: number; maxCaracteres?: number; primeraMax?: number; minCaracteres?: number } = {},
): FraseHablada[] {
  const limpio = textoLimpioParaVoz(md)
  if (!limpio) return []
  const max = Math.max(40, opciones.maxCaracteres ?? 200)
  const primeraMax = Math.max(30, opciones.primeraMax ?? 90)
  const min = Math.max(0, opciones.minCaracteres ?? 12)

  const oraciones = limpio.split(/(?<=[.!?…])\s+/).map(o => o.trim()).filter(Boolean)
  let piezas: string[] = []
  for (const o of oraciones) piezas.push(...partirOracionLarga(o, max))

  // Juntar trozos muy cortos con el siguiente.
  const juntas: string[] = []
  for (const p of piezas) {
    const ultimo = juntas[juntas.length - 1]
    if (ultimo !== undefined && ultimo.length < min && ultimo.length + 1 + p.length <= max) juntas[juntas.length - 1] = `${ultimo} ${p}`
    else juntas.push(p)
  }
  piezas = juntas

  // Primera frase corta: se corta en una coma después de ~25 caracteres.
  if (piezas.length && piezas[0].length > primeraMax) {
    const primera = piezas[0]
    const re = /,\s+/g
    let m: RegExpExecArray | null
    let corte = -1
    while ((m = re.exec(primera))) {
      if (m.index >= 25 && m.index <= primeraMax) { corte = m.index + 1; break }
    }
    if (corte > 0) piezas.splice(0, 1, primera.slice(0, corte).trim(), primera.slice(corte).trim())
  }

  return piezas.filter(Boolean).map(mostrar => ({
    mostrar,
    hablar: verbalizarNumeros(mostrar, opciones.anioActual).replace(/\s+/g, ' ').trim(),
  }))
}

/**
 * Parte el texto (ya limpio) en trozos para `speechSynthesis`.
 *
 * Chrome corta en silencio los enunciados de más de ~15 s, y en iOS un enunciado
 * largo no se puede interrumpir con precisión. Se parte por oración; oraciones
 * cortas se juntan hasta `maxCaracteres` y una oración larga se parte por comas y,
 * si aún no cabe, por palabras.
 */
export function partirParaHablar(texto: string, maxCaracteres = 200): string[] {
  const limpio = (texto || '').replace(/\s+/g, ' ').trim()
  if (!limpio) return []
  const max = Math.max(20, maxCaracteres)

  const oraciones = limpio.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map(o => o.trim()).filter(Boolean) ?? [limpio]

  const piezas: string[] = []
  for (const oracion of oraciones) {
    if (oracion.length <= max) { piezas.push(oracion); continue }
    // Oración larga: por comas / punto y coma, y luego por palabras.
    for (const frase of oracion.split(/(?<=[,;:])\s+/)) {
      if (frase.length <= max) { piezas.push(frase); continue }
      let actual = ''
      for (const palabra of frase.split(' ')) {
        if (actual && (actual.length + 1 + palabra.length) > max) { piezas.push(actual); actual = palabra }
        else actual = actual ? `${actual} ${palabra}` : palabra
      }
      if (actual) piezas.push(actual)
    }
  }

  // Juntar piezas cortas contiguas: menos cortes = voz más natural.
  const trozos: string[] = []
  for (const p of piezas) {
    const ultimo = trozos[trozos.length - 1]
    if (ultimo !== undefined && ultimo.length + 1 + p.length <= max) trozos[trozos.length - 1] = `${ultimo} ${p}`
    else trozos.push(p)
  }
  return trozos
}
