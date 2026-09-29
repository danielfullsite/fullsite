// Interrumpir HABLANDO: voz del dueño sostenida durante la respuesta calla a la voz;
// el eco de la propia bocina (lo que se cuela después del cancelador de eco) no.
import { describe, it, expect } from 'vitest'
import {
  BARGE_IN_POR_DEFECTO as CFG, estadoInicialBargeIn, pasoBargeIn, umbralBargeIn, type EstadoBargeIn, type EventoBargeIn,
} from '@/lib/voz/barge-in'

const CUADRO = 50

/** Corre tramos de [rmsMic, rmsSalida, ms] con la frase empezando en `fraseDesde`. */
function correr(tramos: [number, number, number][], opciones: { estado?: EstadoBargeIn; fraseDesde?: number; ruido?: number; t0?: number } = {}) {
  let estado = opciones.estado ?? estadoInicialBargeIn()
  let t = opciones.t0 ?? 1000
  const eventos: { evento: Exclude<EventoBargeIn, null>; t: number; inicioVoz?: number; vozMs?: number }[] = []
  for (const [rms, salida, dur] of tramos) {
    for (let i = 0; i < dur / CUADRO; i++) {
      t += CUADRO
      const r = pasoBargeIn(estado, { rms, salida, ruido: opciones.ruido ?? 0.005, ahora: t, fraseDesde: opciones.fraseDesde ?? 0 })
      estado = r.estado
      if (r.evento) eventos.push({ evento: r.evento, t, inicioVoz: r.inicioVoz, vozMs: r.vozMs })
      // Al interrumpir, el hook pasa a "escuchando": el barge-in deja de correr.
      if (r.evento === 'interrumpir') return { estado, eventos, nombres: eventos.map(e => e.evento) }
    }
  }
  return { estado, eventos, nombres: eventos.map(e => e.evento) }
}

describe('el dueño habla encima', () => {
  it('voz sostenida ≥ 300 ms → posible (grabar ya) y luego interrumpir, con la hora de inicio', () => {
    // Primero 1 s de respuesta con eco bajo (aprende el acople), luego el dueño habla.
    const { eventos, nombres } = correr([[0.01, 0.15, 1000], [0.2, 0.15, 500]])
    expect(nombres).toEqual(['posible', 'interrumpir'])
    const posible = eventos[0]
    const interrumpe = eventos[1]
    expect(interrumpe.inicioVoz).toBe(posible.t) // lo grabado desde "posible" es el inicio de su turno
    expect(interrumpe.t - posible.t).toBeGreaterThanOrEqual(CFG.sostenidoMs)
    expect(interrumpe.t - posible.t).toBeLessThanOrEqual(CFG.sostenidoMs + 2 * CUADRO)
  })

  it('huecos cortos entre sílabas (≤ 120 ms) no rompen la cuenta', () => {
    const silabas: [number, number, number][] = []
    for (let i = 0; i < 4; i++) silabas.push([0.2, 0.15, 150], [0.01, 0.15, 100])
    const { nombres } = correr([[0.01, 0.15, 1000], ...silabas])
    expect(nombres).toEqual(['posible', 'interrumpir'])
  })

  it('un golpe corto (150 ms) → posible y descartar, sin interrumpir', () => {
    const { nombres } = correr([[0.01, 0.15, 1000], [0.3, 0.15, 150], [0.01, 0.15, 500]])
    expect(nombres).toEqual(['posible', 'descartar'])
  })
})

describe('el eco NO interrumpe', () => {
  it('eco residual que sigue a la salida (30% de su nivel) nunca dispara, aunque la salida suba', () => {
    const tramos: [number, number, number][] = []
    for (let i = 0; i < 40; i++) {
      const salida = i % 3 === 0 ? 0.3 : 0.12 // sílabas fuertes y débiles de la voz
      tramos.push([salida * 0.3, salida, 100])
    }
    const { nombres, estado } = correr(tramos)
    expect(nombres).toEqual([])
    expect(estado.acople).toBeGreaterThan(0.2) // aprendió que se cuela ~30%
  })

  it('desde el PRIMER cuadro, un eco al nivel del acople inicial no dispara', () => {
    const salida = 0.2
    const eco = salida * CFG.acopleInicial * 1.2 // un poco más que el acople supuesto
    expect(eco).toBeLessThan(umbralBargeIn(0.005, salida, CFG.acopleInicial))
    expect(correr([[eco, salida, 600]]).nombres).toEqual([])
  })

  it('el acople sube RÁPIDO si el eco crece (bocina más fuerte) y baja más lento', () => {
    // Desde el acople inicial (conservador), ~2 s de respuesta con eco bajo lo aprenden.
    const bajo = correr([[0.005, 0.2, 2000]]).estado
    expect(bajo.acople).toBeLessThan(0.05)
    // Eco que crece pero sigue bajo el umbral mínimo (0.035 < 0.04): se aprende en 200 ms.
    const sube = correr([[0.035, 0.2, 200]], { estado: bajo }).estado
    expect(sube.acople).toBeGreaterThan(0.1)
    const baja = correr([[0.005, 0.2, 200]], { estado: sube }).estado
    expect(sube.acople - baja.acople).toBeLessThan(sube.acople - bajo.acople)
  })

  it('ventana sorda: una ráfaga en los primeros 250 ms de la frase no cuenta', () => {
    // La frase empieza en t=1000; la ráfaga fuerte llega de inmediato y dura 200 ms.
    const { nombres } = correr([[0.5, 0.2, 200], [0.005, 0.2, 400]], { fraseDesde: 1000, t0: 1000, estado: { acople: 0.05, candidato: null } })
    expect(nombres).toEqual([])
    // La misma ráfaga, ya fuera de la ventana y sostenida, sí cuenta.
    const despues = correr([[0.005, 0.2, 300], [0.5, 0.2, 500]], { fraseDesde: 1000, t0: 1000, estado: { acople: 0.05, candidato: null } })
    expect(despues.nombres).toEqual(['posible', 'interrumpir'])
  })

  it('ruido del lugar alto: el umbral nunca baja de ruido × factor', () => {
    expect(umbralBargeIn(0.05, 0, 0)).toBeCloseTo(0.05 * CFG.factorRuido)
    expect(correr([[0.12, 0.0, 800]], { ruido: 0.05 }).nombres).toEqual([])
  })

  it('NaN / negativos = silencio', () => {
    const r = pasoBargeIn(estadoInicialBargeIn(), { rms: Number.NaN, salida: -1, ruido: 0, ahora: 5000, fraseDesde: 0 })
    expect(r.evento).toBeNull()
  })
})
