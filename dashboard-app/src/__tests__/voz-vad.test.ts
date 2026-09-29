// El detector de voz del modo "Habla con tu restaurante".
//
// Se alimenta con cuadros de RMS sintéticos cada 50 ms, igual que el hook en el
// navegador. Lo que importa en un restaurante: con ruido de fondo constante NO debe
// "empezar a hablar", un golpe corto no es una pregunta, y una pregunta de verdad
// se cierra ~1.2 s después de que el usuario se calla.
import { describe, it, expect } from 'vitest'
import {
  estadoCalibrando, estadoInicialVad, pasoVad, ruidoDe, umbralEfectivo, VAD_POR_DEFECTO, type EstadoVad, type EventoVad,
} from '@/lib/voz/vad'

const CUADRO = 50

/** Corre una secuencia de [rms, duraciónMs] y devuelve los eventos con su hora. */
function correr(tramos: [number, number][], inicio: EstadoVad = estadoCalibrando(0)) {
  let estado = inicio
  let t = 0
  const eventos: { evento: Exclude<EventoVad, null>; t: number }[] = []
  for (const [rms, dur] of tramos) {
    for (let i = 0; i < dur / CUADRO; i++) {
      t += CUADRO
      const r = pasoVad(estado, rms, t)
      estado = r.estado
      if (r.evento) eventos.push({ evento: r.evento, t })
    }
  }
  return { estado, eventos, nombres: eventos.map(e => e.evento) }
}

describe('calibración', () => {
  it('mide ~300 ms de ruido y arranca con ese piso', () => {
    const { estado, eventos } = correr([[0.03, 400]])
    expect(eventos[0]).toEqual({ evento: 'calibrado', t: 300 })
    expect(estado.fase).toBe('esperando')
    expect(ruidoDe(estado)).toBeCloseTo(0.03, 3)
  })

  it('no detecta voz mientras calibra, aunque el nivel sea alto', () => {
    const { nombres } = correr([[0.5, 250]])
    expect(nombres).toEqual([])
  })
})

describe('enunciados', () => {
  it('silencio → voz 1 s → silencio 1.2 s = inicio y fin', () => {
    const { eventos } = correr([[0.005, 400], [0.2, 1000], [0.005, 1500]])
    expect(eventos.map(e => e.evento)).toEqual(['calibrado', 'inicio', 'fin'])
    const inicio = eventos.find(e => e.evento === 'inicio')!.t
    const fin = eventos.find(e => e.evento === 'fin')!.t
    // Se cierra 1.2 s después del último cuadro con voz.
    expect(fin - (inicio + 1000 - CUADRO)).toBe(VAD_POR_DEFECTO.silencioFinMs)
  })

  it('un golpe de 150 ms se descarta, no se manda a transcribir', () => {
    const { nombres } = correr([[0.005, 400], [0.3, 150], [0.005, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'descartar'])
  })

  it('una pausa corta (0.6 s) a media frase NO la corta', () => {
    const { nombres } = correr([[0.005, 400], [0.2, 800], [0.005, 600], [0.2, 800], [0.005, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'fin'])
  })

  it('tope de 45 s: si no se calla, se cierra igual', () => {
    const { eventos } = correr([[0.005, 400], [0.2, 50_000]])
    const inicio = eventos.find(e => e.evento === 'inicio')!.t
    const fin = eventos.find(e => e.evento === 'fin')!
    expect(fin.t - inicio).toBe(VAD_POR_DEFECTO.maxVozMs)
  })
})

describe('restaurante ruidoso', () => {
  it('con piso de ruido alto (0.06), ese ruido NO cuenta como voz', () => {
    // Ruido que fluctúa alrededor de 0.06 (plática de fondo, cafetera).
    const ruido: [number, number][] = Array.from({ length: 40 }, (_, i) => [i % 2 ? 0.07 : 0.05, 100])
    const { nombres, estado } = correr([[0.06, 400], ...ruido])
    expect(nombres).toEqual(['calibrado'])
    expect(umbralEfectivo(ruidoDe(estado))).toBeGreaterThan(0.1)
  })

  it('con ese mismo ruido, una voz clara sí se detecta y se cierra', () => {
    const { nombres } = correr([[0.06, 400], [0.06, 1000], [0.3, 1200], [0.06, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'fin'])
  })

  it('el piso sólo se aprende mientras nadie habla', () => {
    const a = correr([[0.01, 400], [0.4, 800]])
    expect(a.estado.fase).toBe('hablando')
    expect(ruidoDe(a.estado)).toBeCloseTo(0.01, 3)
  })

  it('el umbral nunca baja del mínimo en un cuarto silencioso', () => {
    expect(umbralEfectivo(0)).toBe(VAD_POR_DEFECTO.umbralMin)
    const { nombres } = correr([[0, 400], [0.01, 2000]])
    expect(nombres).toEqual(['calibrado'])
  })
})

describe('robustez', () => {
  it('NaN / negativos cuentan como silencio', () => {
    const r = pasoVad(estadoInicialVad(0.01), Number.NaN, 100)
    expect(r.evento).toBeNull()
    expect(pasoVad(estadoInicialVad(0.01), -1, 100).evento).toBeNull()
  })

  it('al volver de hablar se conserva el piso de ruido', () => {
    const { estado } = correr([[0.04, 400], [0.3, 800], [0.04, 1500]])
    expect(estado.fase).toBe('esperando')
    expect(ruidoDe(estado)).toBeGreaterThan(0.03)
  })
})

describe('mínimo de 0.6 s CON voz antes de transcribir (cuota gratis de Whisper)', () => {
  it('el mínimo por omisión es 600 ms', () => {
    expect(VAD_POR_DEFECTO.minVozMs).toBe(600)
  })
  it('0.5 s de voz → se descarta sin transcribir', () => {
    const { nombres } = correr([[0.005, 400], [0.3, 500], [0.005, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'descartar'])
  })
  it('dos golpes separados (mucho lapso, poca voz) no suman un enunciado', () => {
    // 250 ms de voz + 900 ms de silencio + 250 ms de voz: el LAPSO pasa de 600 ms, la VOZ no.
    const { nombres } = correr([[0.005, 400], [0.3, 250], [0.005, 900], [0.3, 250], [0.005, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'descartar'])
  })
  it('0.8 s de voz → enunciado', () => {
    const { nombres } = correr([[0.005, 400], [0.3, 800], [0.005, 1500]])
    expect(nombres).toEqual(['calibrado', 'inicio', 'fin'])
  })
})

