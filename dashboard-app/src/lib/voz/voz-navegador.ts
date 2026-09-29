// Voz de salida GRATIS: `speechSynthesis` del navegador.
//
// - Elige la mejor voz en español disponible (ver ./voces).
// - Limpia markdown/links/emojis y verbaliza montos antes de hablar (./texto-hablado).
// - Habla por trozos de una oración: Chrome corta en silencio los enunciados de más
//   de ~15 s y así también se puede interrumpir en cualquier momento.
// - iOS Safari sólo deja hablar si la PRIMERA síntesis nació de un toque del usuario:
//   `preparar()` dice un enunciado vacío y se llama dentro del onClick del botón.

import type { ProveedorVoz } from './proveedores'
import { partirParaHablar, textoParaHablar } from './texto-hablado'
import { elegirVoz } from './voces'

function sintesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  if (typeof SpeechSynthesisUtterance === 'undefined') return null
  return window.speechSynthesis
}

let vozCache: SpeechSynthesisVoice | null = null
let escuchandoCambios = false

function vozElegida(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (!escuchandoCambios) {
    escuchandoCambios = true
    // Chrome carga la lista de voces tarde: se vuelve a elegir cuando llega.
    try { s.addEventListener?.('voiceschanged', () => { vozCache = null }) } catch { /* Safari viejo */ }
  }
  if (!vozCache) {
    try { vozCache = elegirVoz(s.getVoices()) } catch { vozCache = null }
  }
  return vozCache
}

/** Un trozo. Resuelve al terminar, al fallar, al abortar, o por tope de tiempo. */
function hablarTrozo(s: SpeechSynthesis, texto: string, voz: SpeechSynthesisVoice | null, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(); return }
    const u = new SpeechSynthesisUtterance(texto)
    if (voz) { u.voice = voz; u.lang = voz.lang } else { u.lang = 'es-MX' }
    u.rate = 1
    u.pitch = 1

    let listo = false
    const terminar = () => {
      if (listo) return
      listo = true
      clearTimeout(tope)
      signal?.removeEventListener('abort', alAbortar)
      resolve()
    }
    const alAbortar = () => { try { s.cancel() } catch { /* */ } terminar() }
    // Chrome a veces nunca dispara `onend`: tope generoso por longitud (~110 ms/carácter).
    const tope = setTimeout(terminar, 4000 + texto.length * 110)
    u.onend = terminar
    u.onerror = terminar
    signal?.addEventListener('abort', alAbortar, { once: true })
    try {
      if (s.paused) s.resume() // Chrome se queda "pausado" tras un rato sin hablar
      s.speak(u)
    } catch {
      terminar()
    }
  })
}

export function crearVozNavegador(): ProveedorVoz {
  // Cada `hablar()` o `callar()` invalida lo que estuviera hablando antes.
  let turno = 0
  return {
    nombre: 'navegador',
    disponible: () => sintesis() !== null,
    preparar() {
      const s = sintesis()
      if (!s) return
      try {
        vozElegida(s)
        const u = new SpeechSynthesisUtterance(' ')
        u.volume = 0
        u.lang = 'es-MX'
        s.speak(u)
      } catch { /* sin voz: el texto sigue en pantalla */ }
    },
    async hablar(texto, signal) {
      const s = sintesis()
      if (!s) return
      const trozos = partirParaHablar(textoParaHablar(texto, { anioActual: new Date().getFullYear() }))
      const mio = ++turno
      try { s.cancel() } catch { /* */ }
      const voz = vozElegida(s)
      for (const t of trozos) {
        if (mio !== turno || signal?.aborted) return
        await hablarTrozo(s, t, voz, signal)
      }
    },
    callar() {
      turno++
      try { sintesis()?.cancel() } catch { /* */ }
    },
  }
}
