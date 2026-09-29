// Qué voz del navegador usar para leer las respuestas cuando NO hay voz natural
// (Piper) — ver ./voz-natural. Pura: recibe la lista de `speechSynthesis.getVoices()`
// (o cualquier cosa con la misma forma) y decide.
//
// Orden (queja real del dueño en Mac + Chrome: "la voz es demasiado robótica"):
//   1. Premium / Enhanced / Mejorada / Natural / Neural en es-MX (Paulina Premium,
//      Microsoft Dalia Online (Natural) en Edge)
//   2. Google en español latino ("Google español de Estados Unidos", es-US): son
//      voces EN LÍNEA de Chrome y suenan mucho mejor que las compactas del sistema
//   3. Premium/Natural de otra región latina (es-US / es-419)
//   4. "Google español" (es-ES) y cualquier otra voz de Google en español
//   5. es-MX normal (Paulina compacta), luego es-US/es-419, es-ES, cualquier es-*
// Las voces "de broma" de Apple (Grandma, Rocko, Eddy…) y las compactas van al final.

export interface VozDisponible {
  name: string
  lang: string
  localService?: boolean
  default?: boolean
  /** macOS/iOS: "com.apple.voice.compact.es-MX.Paulina" delata la voz compacta. */
  voiceURI?: string
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

const RE_PREMIUM = /premium|enhanced|natural|neural|mejorada|\(mejorada\)/i
const RE_BROMA = /\b(eloquence|grandma|grandpa|abuel[oa]|rocko|shelley|flo|reed|sandy|eddy)\b/i

/** Puntos de calidad (sin contar la región). */
export function puntajeCalidad(v: VozDisponible): number {
  const nombre = v.name || ''
  const uri = v.voiceURI || ''
  let p = 0
  if (RE_PREMIUM.test(nombre) || /\.(premium|enhanced)\./i.test(uri)) p += 4
  if (/google/i.test(nombre)) p += 2
  if (v.localService === false) p += 1
  if (/compact/i.test(uri) || /compact/i.test(nombre)) p -= 2
  // Voces "de broma" de macOS/iOS que existen en español y suenan fatal.
  if (RE_BROMA.test(nombre)) p -= 3
  return p
}

/**
 * Nivel de preferencia (mayor = mejor). Combina calidad y región como se explica
 * arriba; dentro del mismo nivel desempata `puntajeCalidad` y luego la región.
 */
export function nivelPreferencia(v: VozDisponible): number {
  const region = rangoRegion(v.lang)
  if (region < 0) return -1
  const nombre = v.name || ''
  if (RE_BROMA.test(nombre)) return 0
  const premium = RE_PREMIUM.test(nombre) || /\.(premium|enhanced)\./i.test(v.voiceURI || '')
  const google = /google/i.test(nombre)
  if (premium && region === 3) return 9
  if (google && (region === 2 || region === 3)) return 8
  if (premium && region === 2) return 7
  if (google) return 6
  if (premium) return 5
  return 1 + region // 4 = es-MX normal, 3 = es-US/419, 2 = es-ES, 1 = otro es-*
}

/** La mejor voz en español, o `null` si el navegador no tiene ninguna. */
export function elegirVoz<T extends VozDisponible>(voces: readonly T[] | null | undefined): T | null {
  if (!voces?.length) return null
  let mejor: T | null = null
  let clave: [number, number, number] = [-1, -Infinity, -1]
  for (const v of voces) {
    const nivel = nivelPreferencia(v)
    if (nivel < 0) continue
    const k: [number, number, number] = [nivel, puntajeCalidad(v), rangoRegion(v.lang)]
    if (k[0] > clave[0] || (k[0] === clave[0] && (k[1] > clave[1] || (k[1] === clave[1] && k[2] > clave[2])))) {
      mejor = v
      clave = k
    }
  }
  return mejor
}
