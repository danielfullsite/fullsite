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
 * Texto de la respuesta → texto para hablar.
 *  - quita bloques de gráfica y comentarios HTML
 *  - [etiqueta](/ruta) → etiqueta (sin "Ver detalle →" colgando)
 *  - quita **, __, `, #, >, viñetas, tablas y emojis
 *  - verbaliza montos, porcentajes y fechas
 */
export function textoParaHablar(md: string, opciones: { anioActual?: number } = {}): string {
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

  t = verbalizarNumeros(t, opciones.anioActual)

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
