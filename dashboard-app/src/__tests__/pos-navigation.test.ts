import { describe, expect, it, vi } from 'vitest'

import { navigateToMesaMap, POS_MESA_EXIT_EVENT, POS_MESA_MAP_PATH, type PosMesaExitDetail } from '@/lib/pos-navigation'

import { POS_SERVICE_MODEL_KEY } from '@/lib/pos-service-model'

// Environment 'node': stub mínimo de window/localStorage para el caché de
// service model que consulta navigateToMesaMap.
const _store = new Map<string, string>()
const _g = globalThis as Record<string, unknown>
_g.window = _g.window || {}
_g.CustomEvent = _g.CustomEvent || class<T> extends Event {
  detail: T
  constructor(type: string, init: CustomEventInit<T> = {}) {
    super(type, { cancelable: init.cancelable })
    this.detail = init.detail as T
  }
}
_g.localStorage = _g.localStorage || {
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  setItem: (k: string, v: string) => { _store.set(k, v) },
  removeItem: (k: string) => { _store.delete(k) },
}

describe('POS table navigation', () => {
  it('leaves every order for the canonical table map with a hard replace', () => {
    const replace = vi.fn()

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>)

    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/pos/mesas')
    expect(POS_MESA_MAP_PATH).toBe('/pos/mesas')
  })

  it('en tenants de mostrador sale a la siguiente orden de mostrador, no al mapa', () => {
    try { localStorage.setItem(POS_SERVICE_MODEL_KEY, 'counter') } catch { /* jsdom */ }
    const replace = vi.fn()

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>)

    expect(replace).toHaveBeenCalledWith('/pos?mostrador=1')
    localStorage.removeItem(POS_SERVICE_MODEL_KEY)
  })

  it('con mesa válida y sin guardia no demora la salida de mostrador', () => {
    try { localStorage.setItem(POS_SERVICE_MODEL_KEY, 'counter') } catch { /* jsdom */ }
    const replace = vi.fn()
    const dispatchEvent = vi.fn(() => true)
    const previous = (_g.window as { dispatchEvent?: typeof dispatchEvent }).dispatchEvent
    ;(_g.window as { dispatchEvent: typeof dispatchEvent }).dispatchEvent = dispatchEvent

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>, 7)

    expect(dispatchEvent).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/pos?mostrador=1')
    ;(_g.window as { dispatchEvent?: typeof dispatchEvent }).dispatchEvent = previous
    localStorage.removeItem(POS_SERVICE_MODEL_KEY)
  })

  it('un valor basura en el caché de service model cae al mapa de siempre', () => {
    try { localStorage.setItem(POS_SERVICE_MODEL_KEY, 'garbage') } catch { /* jsdom */ }
    const replace = vi.fn()

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>)

    expect(replace).toHaveBeenCalledWith('/pos/mesas')
    localStorage.removeItem(POS_SERVICE_MODEL_KEY)
  })

  it('delega la salida a la guardia que posee el lock antes del hard replace', () => {
    const replace = vi.fn()
    let continuar!: () => void
    const dispatchEvent = vi.fn((raw: Event) => {
      const event = raw as CustomEvent<PosMesaExitDetail>
      expect(event.type).toBe(POS_MESA_EXIT_EVENT)
      expect(event.detail.mesa).toBe(7)
      event.preventDefault()
      continuar = event.detail.navigate
      return false
    })
    const previous = (_g.window as { dispatchEvent?: typeof dispatchEvent }).dispatchEvent
    ;(_g.window as { dispatchEvent: typeof dispatchEvent }).dispatchEvent = dispatchEvent

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>, 7)

    expect(replace).not.toHaveBeenCalled()
    continuar()
    expect(replace).toHaveBeenCalledWith('/pos/mesas')
    ;(_g.window as { dispatchEvent?: typeof dispatchEvent }).dispatchEvent = previous
  })
})
