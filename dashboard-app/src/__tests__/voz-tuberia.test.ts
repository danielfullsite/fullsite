// Tubería de la voz natural: la frase 1 suena mientras se sintetiza la 2, y los
// casos que obligan a cambiar de motor (primera frase lenta, síntesis que truena o
// se cuelga) se reportan con el índice donde quedó.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { hablarEnTuberia } from '@/lib/voz/tuberia'

afterEach(() => { vi.useRealTimers() })

/** Doble de motor + bocina con tiempos controlados; registra la línea de tiempo. */
function banco(opciones: { sintMs?: number | ((i: number) => number); playMs?: number; falla?: number } = {}) {
  const linea: string[] = []
  const sintMs = opciones.sintMs ?? 100
  const deps = {
    sintetizar: vi.fn((texto: string, i: number) => {
      linea.push(`sint-ini ${i}`)
      const ms = typeof sintMs === 'function' ? sintMs(i) : sintMs
      return new Promise<string>((resolve, reject) => setTimeout(() => {
        linea.push(`sint-fin ${i}`)
        if (opciones.falla === i) reject(new Error('boom'))
        else resolve(`audio-${texto}`)
      }, ms))
    }),
    reproducir: vi.fn((audio: string, i: number, signal: AbortSignal) => new Promise<void>(resolve => {
      linea.push(`play-ini ${i}`)
      const t = setTimeout(() => { linea.push(`play-fin ${i}`); resolve() }, opciones.playMs ?? 300)
      signal.addEventListener('abort', () => { clearTimeout(t); linea.push(`play-abort ${i}`); resolve() }, { once: true })
    })),
    alFrase: vi.fn(),
  }
  return { linea, deps }
}

describe('hablarEnTuberia — traslape', () => {
  it('sintetiza la frase 2 MIENTRAS suena la 1 (no espera a toda la respuesta)', async () => {
    vi.useFakeTimers()
    const { linea, deps } = banco({ sintMs: 100, playMs: 300 })
    const p = hablarEnTuberia(['uno', 'dos', 'tres'], deps)
    await vi.runAllTimersAsync()
    const r = await p
    expect(r.fin).toBe('completo')
    // La 2 se pide en cuanto la 1 empieza a sonar, antes de que termine.
    expect(linea.indexOf('sint-ini 1')).toBeLessThan(linea.indexOf('play-fin 0'))
    expect(linea.indexOf('play-ini 0')).toBeLessThan(linea.indexOf('sint-ini 2'))
    // Y la 1 empezó a sonar apenas terminó SU síntesis.
    expect(linea.slice(0, 3)).toEqual(['sint-ini 0', 'sint-fin 0', 'sint-ini 1'])
    expect(deps.alFrase.mock.calls.map(c => c[0])).toEqual([0, 1, 2])
    expect(deps.reproducir.mock.calls.map(c => c[0])).toEqual(['audio-uno', 'audio-dos', 'audio-tres'])
  })

  it('sin huecos si sintetizar es más rápido que hablar: la síntesis nunca va más de 1 adelante', async () => {
    vi.useFakeTimers()
    const { linea, deps } = banco({ sintMs: 50, playMs: 300 })
    const p = hablarEnTuberia(['a', 'b', 'c', 'd'], deps)
    await vi.runAllTimersAsync()
    await p
    // Nunca se pide la frase i+2 mientras todavía suena la i (máximo 1 por delante).
    for (let i = 0; i < 2; i++) expect(linea.indexOf(`sint-ini ${i + 2}`)).toBeGreaterThan(linea.indexOf(`play-fin ${i}`))
    expect(deps.sintetizar).toHaveBeenCalledTimes(4)
  })

  it('mide lo que tardó la primera frase', async () => {
    vi.useFakeTimers()
    const { deps } = banco({ sintMs: 400 })
    const p = hablarEnTuberia(['a'], { ...deps, ahora: () => Date.now() })
    await vi.runAllTimersAsync()
    expect((await p).primeraMs).toBe(400)
  })

  it('empieza desde la frase pedida (respaldo a media respuesta)', async () => {
    vi.useFakeTimers()
    const { deps } = banco()
    const p = hablarEnTuberia(['a', 'b', 'c'], { ...deps, desde: 1 })
    await vi.runAllTimersAsync()
    await p
    expect(deps.alFrase.mock.calls.map(c => c[0])).toEqual([1, 2])
  })
})

describe('hablarEnTuberia — cortes', () => {
  it('abortar a media frase: se calla ya y no pide ni suena nada más', async () => {
    vi.useFakeTimers()
    const { linea, deps } = banco({ sintMs: 50, playMs: 1000 })
    const ctrl = new AbortController()
    const p = hablarEnTuberia(['a', 'b', 'c'], { ...deps, signal: ctrl.signal })
    await vi.advanceTimersByTimeAsync(200) // suena la 0
    ctrl.abort()
    await vi.runAllTimersAsync()
    const r = await p
    expect(r.fin).toBe('abortado')
    expect(linea).toContain('play-abort 0')
    expect(linea).not.toContain('play-ini 1')
    expect(deps.sintetizar).toHaveBeenCalledTimes(2) // la 0 y la que iba adelantada
  })

  it('primera frase más lenta que el tope → "lento" sin sonar nada (el llamador cambia de motor)', async () => {
    vi.useFakeTimers()
    const { deps } = banco({ sintMs: 3000 })
    const p = hablarEnTuberia(['a', 'b'], { ...deps, limitePrimeraMs: 2500 })
    await vi.advanceTimersByTimeAsync(2600)
    const r = await p
    expect(r).toMatchObject({ fin: 'lento', indice: 0 })
    expect(deps.reproducir).not.toHaveBeenCalled()
  })

  it('el tope sólo aplica a la PRIMERA frase', async () => {
    vi.useFakeTimers()
    const { deps } = banco({ sintMs: i => (i === 0 ? 100 : 2000), playMs: 100 })
    const p = hablarEnTuberia(['a', 'b'], { ...deps, limitePrimeraMs: 1000 })
    await vi.runAllTimersAsync()
    expect((await p).fin).toBe('completo')
  })

  it('una síntesis que truena en la frase 2 → "error" en el índice 2, después de sonar 0 y 1', async () => {
    vi.useFakeTimers()
    const { deps } = banco({ falla: 2 })
    const p = hablarEnTuberia(['a', 'b', 'c'], deps)
    await vi.runAllTimersAsync()
    const r = await p
    expect(r).toMatchObject({ fin: 'error', indice: 2 })
    expect(deps.alFrase.mock.calls.map(c => c[0])).toEqual([0, 1])
  })

  it('una frase posterior colgada no deja la voz muda para siempre (limiteFraseMs)', async () => {
    vi.useFakeTimers()
    const { deps } = banco({ sintMs: i => (i === 1 ? 60_000 : 50), playMs: 100 })
    const p = hablarEnTuberia(['a', 'b'], { ...deps, limiteFraseMs: 5000 })
    await vi.advanceTimersByTimeAsync(6000)
    expect(await p).toMatchObject({ fin: 'error', indice: 1 })
  })

  it('ya abortado al empezar: no sintetiza nada', async () => {
    const { deps } = banco()
    const ctrl = new AbortController()
    ctrl.abort()
    expect((await hablarEnTuberia(['a'], { ...deps, signal: ctrl.signal })).fin).toBe('abortado')
    expect(deps.sintetizar).not.toHaveBeenCalled()
  })
})
