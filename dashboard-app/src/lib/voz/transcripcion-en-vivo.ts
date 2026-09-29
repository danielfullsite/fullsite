// Subtítulo EN VIVO de lo que el dueño va diciendo, sólo para la pantalla.
//
// Usa el reconocimiento de voz del navegador (Chrome/Edge: `webkitSpeechRecognition`,
// gratis) con resultados intermedios. NO es la fuente de verdad: la pregunta que se
// manda al chat sigue saliendo de Whisper (/api/transcribe). Si el navegador no lo
// tiene, o es Safari/iOS (pide otro permiso y en iPhone pelea por la sesión de
// audio), simplemente no hay subtítulo en vivo: se muestra "Te escucho…".
//
// Nota de privacidad: en Chrome el audio de este subtítulo lo procesa el servicio de
// voz de Google (como el dictado del propio Chrome). No se guarda nada de nuestro lado.

interface ReconocedorLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((ev: { error?: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type CtorReconocedor = new () => ReconocedorLike

export function ctorReconocedor(
  w: Record<string, unknown> | undefined = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined,
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): CtorReconocedor | null {
  if (!w) return null
  // Safari (macOS/iOS) expone webkitSpeechRecognition vía Siri: otro permiso y, en
  // iPhone, cambia la sesión de audio. Sólo Chromium.
  const esSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)
  if (esSafari || /iPhone|iPad|iPod/.test(ua)) return null
  const C = (w.SpeechRecognition || w.webkitSpeechRecognition) as CtorReconocedor | undefined
  return typeof C === 'function' ? C : null
}

/** Junta los resultados (finales + intermedio actual) en un solo texto. */
export function textoDeResultados(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  let t = ''
  for (let i = 0; i < results.length; i++) t += results[i]?.[0]?.transcript ?? ''
  return t.replace(/\s+/g, ' ').trim()
}

export interface TranscripcionEnVivo {
  readonly soportada: boolean
  iniciar(): void
  detener(): void
}

export function crearTranscripcionEnVivo(alTexto: (texto: string) => void, Ctor: CtorReconocedor | null = ctorReconocedor()): TranscripcionEnVivo {
  let rec: ReconocedorLike | null = null
  let quiere = false
  let ultimoInicio = 0
  let reintento: ReturnType<typeof setTimeout> | null = null

  const arrancar = () => {
    if (!Ctor || !quiere || rec) return
    try {
      const r = new Ctor()
      r.lang = 'es-MX'
      r.continuous = true
      r.interimResults = true
      r.onresult = ev => { if (rec === r) alTexto(textoDeResultados(ev.results)) }
      r.onerror = ev => {
        // Sin permiso o sin servicio: se apaga para toda la sesión.
        if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') Ctor = null
      }
      r.onend = () => {
        if (rec !== r) return
        rec = null
        // Chrome lo termina solo tras un rato de silencio: se reanuda (máx. 1 por segundo).
        if (quiere && Ctor) reintento = setTimeout(arrancar, Math.max(0, 1000 - (Date.now() - ultimoInicio)))
      }
      rec = r
      ultimoInicio = Date.now()
      r.start()
    } catch {
      rec = null
    }
  }

  return {
    get soportada() { return !!Ctor },
    iniciar() {
      quiere = true
      arrancar()
    },
    detener() {
      quiere = false
      if (reintento) { clearTimeout(reintento); reintento = null }
      const r = rec
      rec = null
      if (r) { r.onresult = null; r.onend = null; r.onerror = null; try { r.abort() } catch { /* */ } }
    },
  }
}
