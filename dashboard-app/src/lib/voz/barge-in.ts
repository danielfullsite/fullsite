// Interrumpir HABLANDO ("barge-in"): mientras la voz natural responde, el micrófono
// sigue abierto (con cancelación de eco del navegador) y esta máquina decide si lo
// que entra es el dueño hablando o el eco de la propia bocina.
//
// PURA, igual que ./vad: recibe por cuadro (50 ms) el RMS del micrófono, el RMS de
// lo que está sonando, el piso de ruido del lugar y la hora de inicio de la frase.
//
//   'posible'     → algo pasó el umbral: el hook arranca a GRABAR ya (para no perder
//                   el inicio de lo que dice el dueño)
//   'descartar'   → no se sostuvo (un golpe, eco de una sílaba fuerte): se tira
//   'interrumpir' → voz sostenida ≥ 300 ms: se calla la respuesta y lo grabado se
//                   queda como el inicio del turno del dueño
//
// Contra el eco (que la bocina se "interrumpa" sola):
//   - umbral ADAPTATIVO = máx(mínimo, ruido × factor, salida × acople × margen);
//     `acople` es cuánto de la salida se cuela al micrófono DESPUÉS del cancelador
//     de eco, aprendido mientras nadie habla (sube rápido, baja lento)
//   - ventana sorda de 250 ms al inicio de cada frase (el cancelador tarda en
//     reajustarse cuando arranca audio nuevo)
//   - 300 ms SOSTENIDOS, con huecos de ≤ 120 ms entre sílabas

export interface ConfigBargeIn {
  umbralMin: number
  factorRuido: number
  margenEco: number
  acopleInicial: number
  acopleMax: number
  sordoMs: number
  sostenidoMs: number
  huecoMs: number
  alfaSube: number
  alfaBaja: number
  /** Sólo se aprende el acople cuando la salida suena al menos esto. */
  salidaMinAprender: number
}

export const BARGE_IN_POR_DEFECTO: ConfigBargeIn = {
  umbralMin: 0.04,
  factorRuido: 3,
  margenEco: 2.5,
  acopleInicial: 0.3,
  acopleMax: 2,
  sordoMs: 250,
  sostenidoMs: 300,
  huecoMs: 120,
  alfaSube: 0.3,
  alfaBaja: 0.08,
  salidaMinAprender: 0.02,
}

export interface EstadoBargeIn {
  acople: number
  candidato: null | { desde: number; vozMs: number; ultimoCuadro: number; ultimaVoz: number }
}

export interface EntradaBargeIn {
  /** RMS del micrófono (0‥1). */
  rms: number
  /** RMS de lo que está sonando (0‥1). */
  salida: number
  /** Piso de ruido del lugar (el del VAD). */
  ruido: number
  ahora: number
  /** Cuándo empezó a sonar la frase actual. */
  fraseDesde: number
}

export type EventoBargeIn = 'posible' | 'descartar' | 'interrumpir' | null

export interface PasoBargeIn {
  estado: EstadoBargeIn
  evento: EventoBargeIn
  /** Con 'interrumpir': cuándo empezó la voz y cuánta voz se juntó. */
  inicioVoz?: number
  vozMs?: number
}

export function estadoInicialBargeIn(cfg: ConfigBargeIn = BARGE_IN_POR_DEFECTO, acople = cfg.acopleInicial): EstadoBargeIn {
  return { acople, candidato: null }
}

const num = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0)

export function umbralBargeIn(ruido: number, salida: number, acople: number, cfg: ConfigBargeIn = BARGE_IN_POR_DEFECTO): number {
  return Math.max(cfg.umbralMin, num(ruido) * cfg.factorRuido, num(salida) * acople * cfg.margenEco)
}

export function pasoBargeIn(estado: EstadoBargeIn, e: EntradaBargeIn, cfg: ConfigBargeIn = BARGE_IN_POR_DEFECTO): PasoBargeIn {
  const rms = num(e.rms)
  const salida = num(e.salida)
  const umbral = umbralBargeIn(e.ruido, salida, estado.acople, cfg)
  const hayVoz = rms >= umbral
  const c = estado.candidato

  if (!c) {
    // Aprender cuánto eco se cuela (sólo con salida audible y sin voz del dueño).
    let acople = estado.acople
    if (salida >= cfg.salidaMinAprender && !hayVoz) {
      const razon = rms / salida
      const alfa = razon > acople ? cfg.alfaSube : cfg.alfaBaja
      acople = Math.min(cfg.acopleMax, Math.max(0, acople + alfa * (razon - acople)))
    }
    const sordo = e.ahora - e.fraseDesde < cfg.sordoMs
    if (hayVoz && !sordo) {
      return { estado: { acople, candidato: { desde: e.ahora, vozMs: 0, ultimoCuadro: e.ahora, ultimaVoz: e.ahora } }, evento: 'posible' }
    }
    return { estado: acople === estado.acople ? estado : { acople, candidato: null }, evento: null }
  }

  const dt = Math.min(Math.max(0, e.ahora - c.ultimoCuadro), 200)
  const vozMs = c.vozMs + (hayVoz ? dt : 0)
  const ultimaVoz = hayVoz ? e.ahora : c.ultimaVoz
  if (!hayVoz && e.ahora - ultimaVoz > cfg.huecoMs) {
    return { estado: { acople: estado.acople, candidato: null }, evento: 'descartar' }
  }
  if (vozMs >= cfg.sostenidoMs) {
    return { estado: { acople: estado.acople, candidato: null }, evento: 'interrumpir', inicioVoz: c.desde, vozMs }
  }
  return { estado: { acople: estado.acople, candidato: { desde: c.desde, vozMs, ultimoCuadro: e.ahora, ultimaVoz } }, evento: null }
}
