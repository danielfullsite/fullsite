// Tubería de voz natural: sintetiza y reproduce FRASE POR FRASE, traslapadas.
//
//   sintetiza 1 ─┐
//                ├─ suena 1 ──────────┐
//                └─ sintetiza 2 ─┐    ├─ suena 2 ──────┐
//                                └────┘  sintetiza 3 ──┴─ suena 3 …
//
// Así el dueño oye la primera frase en cuanto está lista (no la respuesta entera) y
// no hay silencios entre frases mientras la síntesis vaya más rápido que el habla.
//
// PURA: la síntesis y la reproducción se inyectan (en el navegador son el worker de
// Piper y Web Audio; en las pruebas, dobles con tiempos controlados).

export type FinTuberia = 'completo' | 'abortado' | 'lento' | 'error'

export interface ResultadoTuberia {
  fin: FinTuberia
  /** Frase donde se detuvo (la que no se pudo sintetizar, o la última que sonó). */
  indice: number
  /** ms que tardó la síntesis de la primera frase (si se llegó a medir). */
  primeraMs?: number
  error?: unknown
}

export interface DepsTuberia<A> {
  sintetizar: (texto: string, indice: number) => Promise<A>
  /** Resuelve al terminar de sonar o al abortar. */
  reproducir: (audio: A, indice: number, signal: AbortSignal) => Promise<void>
  /** Justo antes de que empiece a sonar la frase `indice`. */
  alFrase?: (indice: number) => void
  signal?: AbortSignal
  /** Si la PRIMERA síntesis tarda más que esto → `lento` (el llamador cambia de motor). */
  limitePrimeraMs?: number
  /** Tope de cualquier otra frase (un motor colgado no deja la voz muda para siempre). */
  limiteFraseMs?: number
  /** Cuántas frases sintetizar por delante de la que suena (1 basta con un solo worker). */
  adelanto?: number
  /** Empezar en esta frase. */
  desde?: number
  ahora?: () => number
}

const LENTO = Symbol('lento')
const ABORTADO = Symbol('abortado')

function esperar<A>(p: Promise<A>, signal: AbortSignal | undefined, limiteMs?: number): Promise<A | typeof LENTO | typeof ABORTADO> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { resolve(ABORTADO); return }
    let listo = false
    const fin = (f: () => void) => {
      if (listo) return
      listo = true
      if (tope) clearTimeout(tope)
      signal?.removeEventListener('abort', alAbortar)
      f()
    }
    const alAbortar = () => fin(() => resolve(ABORTADO))
    const tope = limiteMs && limiteMs > 0 ? setTimeout(() => fin(() => resolve(LENTO)), limiteMs) : null
    signal?.addEventListener('abort', alAbortar, { once: true })
    p.then(v => fin(() => resolve(v)), e => fin(() => reject(e)))
  })
}

export async function hablarEnTuberia<A>(frases: readonly string[], deps: DepsTuberia<A>): Promise<ResultadoTuberia> {
  const n = frases.length
  const desde = Math.max(0, deps.desde ?? 0)
  const adelanto = Math.max(1, deps.adelanto ?? 1)
  const ahora = deps.ahora ?? (() => Date.now())
  const controlador = new AbortController()
  const alAbortarFuera = () => controlador.abort()
  if (deps.signal?.aborted) return { fin: 'abortado', indice: desde }
  deps.signal?.addEventListener('abort', alAbortarFuera, { once: true })
  const signal = controlador.signal

  const pendientes: (Promise<A> | undefined)[] = []
  const pedir = (i: number) => {
    if (i >= n || pendientes[i] || signal.aborted) return
    const p = deps.sintetizar(frases[i], i)
    p.catch(() => { /* se reporta al esperarla */ })
    pendientes[i] = p
  }

  let primeraMs: number | undefined
  try {
    const t0 = ahora()
    pedir(desde)
    for (let i = desde; i < n; i++) {
      pedir(i)
      const esPrimera = i === desde
      let audio: A | typeof LENTO | typeof ABORTADO
      try {
        audio = await esperar(pendientes[i]!, signal, esPrimera ? deps.limitePrimeraMs : deps.limiteFraseMs)
      } catch (error) {
        if (signal.aborted) return { fin: 'abortado', indice: i }
        return { fin: 'error', indice: i, error, primeraMs }
      }
      if (audio === ABORTADO) return { fin: 'abortado', indice: i, primeraMs }
      if (audio === LENTO) {
        if (esPrimera) return { fin: 'lento', indice: i }
        return { fin: 'error', indice: i, error: new Error('síntesis colgada'), primeraMs }
      }
      if (esPrimera) primeraMs = ahora() - t0
      // Mientras suena ésta, se sintetiza la(s) siguiente(s).
      for (let k = 1; k <= adelanto; k++) pedir(i + k)
      deps.alFrase?.(i)
      await deps.reproducir(audio, i, signal)
      if (signal.aborted) return { fin: 'abortado', indice: i, primeraMs }
    }
    return { fin: 'completo', indice: Math.max(desde, n - 1), primeraMs }
  } finally {
    deps.signal?.removeEventListener('abort', alAbortarFuera)
  }
}
