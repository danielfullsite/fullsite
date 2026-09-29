// Detector de voz (VAD) del modo "Habla con tu restaurante".
//
// Máquina de estados PURA: recibe el RMS de cada cuadro del micrófono y la hora, y
// devuelve el estado nuevo más, a lo sumo, un evento:
//
//   'calibrado' → terminó de medir el ruido del lugar; ya se puede escuchar
//   'inicio'    → empezó a hablar
//   'fin'       → terminó un enunciado de verdad (≥ minVozMs de voz y luego silencio)
//   'descartar' → fue un ruido corto (un golpe, una tos): se tira y se sigue escuchando
//
// El umbral se adapta al ruido del lugar. Un restaurante no es una oficina: con un
// umbral fijo, la plática de la mesa de al lado "empezaba a hablar" y nunca
// terminaba. Al abrir se calibra (~300 ms: promedio del RMS) y, mientras nadie
// habla, el piso de ruido se sigue ajustando (EMA). El umbral efectivo es el mayor
// entre el mínimo configurado y `factorRuido × piso`.
//
// Fin de turno ADAPTATIVO (antes 1.2 s fijos; se sentía lento, "de nota de voz"):
// si la voz se fue APAGANDO (el nivel de las últimas sílabas quedó por debajo de
// `caidaRelativa × pico`, como al terminar una pregunta), se cierra con
// `silencioFinCortoMs`; si se cortó con energía alta (una pausa para pensar a media
// frase), se espera `silencioFinMs`.

export interface ConfigVad {
  /** RMS mínimo para considerar que hay voz (0‥1). */
  umbralMin: number
  /** El umbral efectivo es al menos piso de ruido × este factor. */
  factorRuido: number
  /** Medición inicial del ruido del lugar. */
  calibracionMs: number
  /** Silencio continuo que cierra el enunciado (voz que se cortó con energía alta). */
  silencioFinMs: number
  /** Silencio que cierra cuando la voz terminó APAGÁNDOSE (fin natural de frase). */
  silencioFinCortoMs: number
  /** "Se fue apagando" = nivel final < pico × esto. */
  caidaRelativa: number
  /**
   * Enunciados con menos VOZ que esto (suma de cuadros POR ENCIMA del umbral, no el
   * lapso de inicio a fin) se descartan sin transcribir: cada nota gasta cuota gratis
   * de Whisper, y un "eh", una tos o un plato que suena no son preguntas.
   */
  minVozMs: number
  /** Tope duro por enunciado: al llegar se cierra aunque siga hablando. */
  maxVozMs: number
  /** Qué tan rápido sigue el piso de ruido (0‥1, EMA). */
  alfaRuido: number
}

export const VAD_POR_DEFECTO: ConfigVad = {
  umbralMin: 0.02,
  factorRuido: 2.5,
  calibracionMs: 300,
  silencioFinMs: 850,
  silencioFinCortoMs: 600,
  caidaRelativa: 0.45,
  minVozMs: 600,
  maxVozMs: 45_000,
  alfaRuido: 0.05,
}

export type EstadoVad =
  | { fase: 'calibrando'; desde: number; suma: number; cuadros: number }
  | { fase: 'esperando'; ruido: number }
  | {
    fase: 'hablando'; ruido: number; inicio: number; ultimaVoz: number; vozMs?: number; ultimoCuadro?: number
    /** Nivel máximo del enunciado y promedio móvil de las últimas sílabas con voz. */
    pico?: number; nivelFinal?: number
  }

export type EventoVad = 'calibrado' | 'inicio' | 'fin' | 'descartar' | null

/** Estado al abrir el micrófono: primero se mide el ruido. */
export function estadoCalibrando(ahora: number): EstadoVad {
  return { fase: 'calibrando', desde: ahora, suma: 0, cuadros: 0 }
}

/** Estado "esperando voz" con un piso de ruido ya conocido (p. ej. al volver de hablar). */
export function estadoInicialVad(ruido = 0): EstadoVad {
  return { fase: 'esperando', ruido }
}

export function umbralEfectivo(ruido: number, cfg: ConfigVad = VAD_POR_DEFECTO): number {
  return Math.max(cfg.umbralMin, ruido * cfg.factorRuido)
}

/** Piso de ruido actual (0 mientras calibra y aún no hay cuadros). */
export function ruidoDe(estado: EstadoVad): number {
  if (estado.fase === 'calibrando') return estado.cuadros ? estado.suma / estado.cuadros : 0
  return estado.ruido
}

/** Silencio que cierra ESTE enunciado: corto si la voz se fue apagando. */
export function silencioParaCerrar(estado: EstadoVad, cfg: ConfigVad = VAD_POR_DEFECTO): number {
  if (estado.fase !== 'hablando') return cfg.silencioFinMs
  const { pico, nivelFinal } = estado
  if (pico && nivelFinal !== undefined && nivelFinal < pico * cfg.caidaRelativa) return Math.min(cfg.silencioFinCortoMs, cfg.silencioFinMs)
  return cfg.silencioFinMs
}

export function pasoVad(
  estado: EstadoVad,
  rms: number,
  ahora: number,
  cfg: ConfigVad = VAD_POR_DEFECTO,
): { estado: EstadoVad; evento: EventoVad } {
  const nivel = Number.isFinite(rms) && rms > 0 ? rms : 0

  if (estado.fase === 'calibrando') {
    const suma = estado.suma + nivel
    const cuadros = estado.cuadros + 1
    if (ahora - estado.desde >= cfg.calibracionMs) {
      return { estado: estadoInicialVad(suma / cuadros), evento: 'calibrado' }
    }
    return { estado: { fase: 'calibrando', desde: estado.desde, suma, cuadros }, evento: null }
  }

  const umbral = umbralEfectivo(estado.ruido, cfg)
  const hayVoz = nivel >= umbral

  if (estado.fase === 'esperando') {
    if (hayVoz) {
      return { estado: { fase: 'hablando', ruido: estado.ruido, inicio: ahora, ultimaVoz: ahora, vozMs: 0, ultimoCuadro: ahora, pico: nivel, nivelFinal: nivel }, evento: 'inicio' }
    }
    // Sólo se aprende el ruido mientras nadie habla.
    const ruido = estado.ruido + cfg.alfaRuido * (nivel - estado.ruido)
    return { estado: { fase: 'esperando', ruido }, evento: null }
  }

  // hablando
  const ultimaVoz = hayVoz ? ahora : estado.ultimaVoz
  // Sólo cuenta el tiempo CON voz (un cuadro colgado no suma más de 200 ms).
  const dt = Math.min(Math.max(0, ahora - (estado.ultimoCuadro ?? estado.inicio)), 200)
  const vozMs = (estado.vozMs ?? 0) + (hayVoz ? dt : 0)
  if (ahora - estado.inicio >= cfg.maxVozMs) {
    return { estado: estadoInicialVad(estado.ruido), evento: 'fin' }
  }
  const pico = hayVoz ? Math.max(estado.pico ?? 0, nivel) : estado.pico
  const nivelFinal = hayVoz ? (estado.nivelFinal === undefined ? nivel : estado.nivelFinal + 0.3 * (nivel - estado.nivelFinal)) : estado.nivelFinal
  const siguiente = { ...estado, ultimaVoz, vozMs, ultimoCuadro: ahora, pico, nivelFinal }
  if (ahora - ultimaVoz >= silencioParaCerrar(siguiente, cfg)) {
    return { estado: estadoInicialVad(estado.ruido), evento: vozMs >= cfg.minVozMs ? 'fin' : 'descartar' }
  }
  return { estado: siguiente, evento: null }
}
