import { describe, it, expect } from 'vitest'
import {
  VERTICAL_PRESETS, VERTICAL_IDS, isVerticalId, resolveVerticalPreset,
} from '@/lib/vertical-presets'
import { DEFAULT_ONBOARDING_TEMPLATE } from '@/lib/onboarding-template'

describe('vertical-presets', () => {
  it('expone los 8 verticales del diseño (BIBLE-SQUARE §3)', () => {
    expect(VERTICAL_IDS).toHaveLength(8)
    expect(VERTICAL_IDS).toContain('fast_food')
    expect(VERTICAL_IDS).toContain('fine_dining')
    expect(VERTICAL_IDS).toContain('hibrido_restaurante_tienda')
  })

  it('isVerticalId acepta ids válidos y rechaza todo lo demás', () => {
    expect(isVerticalId('fast_food')).toBe(true)
    expect(isVerticalId('sushi')).toBe(false)
    expect(isVerticalId('')).toBe(false)
    expect(isVerticalId(undefined)).toBe(false)
    expect(isVerticalId(42)).toBe(false)
  })

  it('cada preset está bien formado', () => {
    for (const id of VERTICAL_IDS) {
      const p = resolveVerticalPreset(id)
      expect(p.id).toBe(id)
      expect(p.label.length).toBeGreaterThan(0)
      expect(['tables', 'counter', 'tabs', 'channels']).toContain(p.serviceModel)
      expect(p.defaultMesas).toBeGreaterThanOrEqual(0)
    }
  })

  it('los presets de mostrador y dark kitchen nacen sin mesas', () => {
    expect(VERTICAL_PRESETS.fast_food.defaultMesas).toBe(0)
    expect(VERTICAL_PRESETS.dark_kitchen.defaultMesas).toBe(0)
  })

  it('dark_kitchen apaga el POS de piso y enciende canales delivery', () => {
    const f = VERTICAL_PRESETS.dark_kitchen.features
    expect(f.posRestaurant).toBe(false)
    expect(f.delivery).toBe(true)
    expect(f.ecommerce).toBe(true)
  })

  it('cafetería/panadería enciende tienda y estación de panadería', () => {
    const f = VERTICAL_PRESETS.cafeteria_panaderia.features
    expect(f.posTienda).toBe(true)
    expect(f.bakery_station).toBe(true)
  })

  it('los templates por vertical conservan pagos y roles del skeleton genérico', () => {
    for (const id of VERTICAL_IDS) {
      const tpl = VERTICAL_PRESETS[id].template
      if (!tpl) continue // sin template propio → usa el default completo
      expect(tpl.paymentMethods).toEqual(DEFAULT_ONBOARDING_TEMPLATE.paymentMethods)
      expect(tpl.roles).toEqual(DEFAULT_ONBOARDING_TEMPLATE.roles)
      expect(tpl.menu.length).toBeGreaterThan(0)
      // idSuffixes únicos dentro del template (los ids finales son `${clientId}-${suffix}`)
      const suffixes = tpl.menu.flatMap(c => [c.idSuffix, ...c.items.map(i => i.idSuffix)])
      expect(new Set(suffixes).size).toBe(suffixes.length)
    }
  })

  it('casual_dining es el default: sin parche de features ni template propio', () => {
    expect(VERTICAL_PRESETS.casual_dining.features).toEqual({})
    expect(VERTICAL_PRESETS.casual_dining.template).toBeUndefined()
  })
})
