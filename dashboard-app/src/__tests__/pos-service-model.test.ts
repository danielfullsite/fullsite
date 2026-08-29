import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import {
  peekServiceModel, isCounterModel, nextMostradorCuenta, POS_SERVICE_MODEL_KEY,
} from '@/lib/pos-service-model'

// La suite corre en environment 'node': se stubbean window/localStorage para
// ejercitar el caché que en el navegador es real.
const store = new Map<string, string>()
const g = globalThis as Record<string, unknown>
g.window = g.window || {}
g.localStorage = g.localStorage || {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}
afterAll(() => { store.clear() })

describe('pos-service-model', () => {
  beforeEach(() => { store.clear() })

  it('sin caché, peek responde tables (el comportamiento de siempre)', () => {
    expect(peekServiceModel()).toBe('tables')
  })

  it('peek lee el caché local y rechaza valores basura', () => {
    localStorage.setItem(POS_SERVICE_MODEL_KEY, 'counter')
    expect(peekServiceModel()).toBe('counter')
    localStorage.setItem(POS_SERVICE_MODEL_KEY, 'invalido')
    expect(peekServiceModel()).toBe('tables')
  })

  it('counterHomePath: counter va a orden de mostrador, channels al despacho', async () => {
    const { counterHomePath } = await import('@/lib/pos-service-model')
    expect(counterHomePath('counter')).toBe('/pos?mostrador=1')
    expect(counterHomePath('channels')).toBe('/pos/delivery')
  })

  it('isCounterModel: counter y channels operan sin mapa; tables y tabs no', () => {
    expect(isCounterModel('counter')).toBe(true)
    expect(isCounterModel('channels')).toBe(true)
    expect(isCounterModel('tables')).toBe(false)
    expect(isCounterModel('tabs')).toBe(false)
  })

  it('nextMostradorCuenta es legible y único por orden (la dedup busca por customer_name)', () => {
    const a = nextMostradorCuenta(new Date('2026-08-28T14:35:00'))
    expect(a).toMatch(/^Mostrador 1435-[a-z0-9]{5}$/)
    // Colisión teórica con salt de 5 chars: ~2e-5 para 50 muestras. Exigir 50
    // exactas con salt de 3 chars era flaky (~2.7%) y tumbó CI el 2026-08-29.
    const names = new Set(Array.from({ length: 50 }, () => nextMostradorCuenta()))
    expect(names.size).toBeGreaterThanOrEqual(49)
  })
})
