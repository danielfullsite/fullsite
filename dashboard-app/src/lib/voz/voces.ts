// Qué voz del navegador usar para leer las respuestas. Pura: recibe la lista de
// `speechSynthesis.getVoices()` (o cualquier cosa con la misma forma) y decide.
//
// Orden: primero la región (es-MX > es-US/es-419 > es-ES > cualquier es-*), y dentro
// de la región, la calidad. Las voces "Premium/Enhanced/Natural/Neural" (Apple,
// Edge) y las de Google en Chrome suenan mucho mejor que las compactas del sistema.

export interface VozDisponible {
  name: string
  lang: string
  localService?: boolean
  default?: boolean
}

function normalizarLang(lang: string): string {
  return (lang || '').replace('_', '-').toLowerCase()
}

/** 3 = es-MX, 2 = es-US/es-419, 1 = es-ES, 0 = otro español, -1 = no es español. */
export function rangoRegion(lang: string): number {
  const l = normalizarLang(lang)
  if (!/^es(-|$)/.test(l)) return -1
  if (l === 'es-mx') return 3
  if (l === 'es-us' || l === 'es-419') return 2
  if (l === 'es-es') return 1
  return 0
}

/** Puntos de calidad dentro de la misma región. */
export function puntajeCalidad(v: VozDisponible): number {
  const nombre = v.name || ''
  let p = 0
  if (/premium|enhanced|natural|neural|mejorada/i.test(nombre)) p += 4
  if (/google/i.test(nombre)) p += 2
  if (v.localService === false) p += 1
  // Voces "de broma" de macOS/iOS que existen en español y suenan fatal.
  if (/\b(eloquence|grandma|grandpa|abuel[oa]|rocko|shelley|flo|reed|sandy|eddy)\b/i.test(nombre)) p -= 3
  return p
}

/** La mejor voz en español, o `null` si el navegador no tiene ninguna. */
export function elegirVoz<T extends VozDisponible>(voces: readonly T[] | null | undefined): T | null {
  if (!voces?.length) return null
  let mejor: T | null = null
  let mejorRegion = -1
  let mejorCalidad = -Infinity
  for (const v of voces) {
    const region = rangoRegion(v.lang)
    if (region < 0) continue
    const calidad = puntajeCalidad(v)
    if (region > mejorRegion || (region === mejorRegion && calidad > mejorCalidad)) {
      mejor = v
      mejorRegion = region
      mejorCalidad = calidad
    }
  }
  return mejor
}
