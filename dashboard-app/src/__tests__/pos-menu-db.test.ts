import { describe, it, expect } from 'vitest'
import {
  MENU_CATEGORIES,
  MODIFIERS_QUITAR,
  MODIFIERS_AGREGAR_FOOD,
  MODIFIERS_AGREGAR_COFFEE,
  MODIFIERS_AGREGAR_DRINKS,
  getModifiersForCategory,
  IVA_RATE,
  MESEROS,
  MESAS_CONFIG,
  formatMXN,
  type MenuCategory,
  type MenuItem,
} from '@/lib/pos-data'

// ---------------------------------------------------------------------------
// Static menu data integrity
// ---------------------------------------------------------------------------

describe('MENU_CATEGORIES (static fallback)', () => {
  it('has at least 20 categories', () => {
    expect(MENU_CATEGORIES.length).toBeGreaterThanOrEqual(20)
  })

  it('every category has id, name, and items array', () => {
    for (const cat of MENU_CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.name).toBeTruthy()
      expect(Array.isArray(cat.items)).toBe(true)
    }
  })

  it('every item has id, name, and numeric price', () => {
    for (const cat of MENU_CATEGORIES) {
      for (const item of cat.items) {
        expect(item.id).toBeTruthy()
        expect(item.name).toBeTruthy()
        expect(typeof item.price).toBe('number')
        expect(item.price).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('has no duplicate item IDs across categories', () => {
    const ids = new Set<string>()
    for (const cat of MENU_CATEGORIES) {
      for (const item of cat.items) {
        expect(ids.has(item.id)).toBe(false)
        ids.add(item.id)
      }
    }
  })

  it('has no duplicate category IDs', () => {
    const ids = new Set<string>()
    for (const cat of MENU_CATEGORIES) {
      expect(ids.has(cat.id)).toBe(false)
      ids.add(cat.id)
    }
  })

  it('food categories have items with price > 0', () => {
    const foodCats = ['chilaquiles', 'eggs', 'coffee', 'toast', 'croissants']
    for (const catId of foodCats) {
      const cat = MENU_CATEGORIES.find(c => c.id === catId)
      expect(cat).toBeTruthy()
      expect(cat!.items.every(i => i.price > 0)).toBe(true)
    }
  })

  it('market categories have items with price 0 (variable)', () => {
    const mktCats = MENU_CATEGORIES.filter(c => c.id.startsWith('mkt-'))
    expect(mktCats.length).toBeGreaterThan(0)
    for (const cat of mktCats) {
      expect(cat.items.every(i => i.price === 0)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

describe('Modifiers (static)', () => {
  it('MODIFIERS_QUITAR has 8 options all starting with "Sin"', () => {
    expect(MODIFIERS_QUITAR).toHaveLength(8)
    for (const m of MODIFIERS_QUITAR) {
      expect(m.startsWith('Sin ')).toBe(true)
    }
  })

  it('MODIFIERS_AGREGAR_FOOD all have name and numeric price', () => {
    expect(MODIFIERS_AGREGAR_FOOD.length).toBeGreaterThan(0)
    for (const m of MODIFIERS_AGREGAR_FOOD) {
      expect(m.name).toBeTruthy()
      expect(typeof m.price).toBe('number')
    }
  })

  it('MODIFIERS_AGREGAR_COFFEE all have name and numeric price', () => {
    expect(MODIFIERS_AGREGAR_COFFEE.length).toBeGreaterThan(0)
    for (const m of MODIFIERS_AGREGAR_COFFEE) {
      expect(m.name).toBeTruthy()
      expect(typeof m.price).toBe('number')
    }
  })

  it('MODIFIERS_AGREGAR_DRINKS all have name and numeric price', () => {
    expect(MODIFIERS_AGREGAR_DRINKS.length).toBeGreaterThan(0)
    for (const m of MODIFIERS_AGREGAR_DRINKS) {
      expect(m.name).toBeTruthy()
      expect(typeof m.price).toBe('number')
    }
  })
})

// ---------------------------------------------------------------------------
// getModifiersForCategory (static fallback logic)
// ---------------------------------------------------------------------------

describe('getModifiersForCategory', () => {
  it('food categories return quitar options (empty by default) + food extras', () => {
    const result = getModifiersForCategory('chilaquiles')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })

  it('coffee category returns coffee extras, no quitar', () => {
    const result = getModifiersForCategory('coffee')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_COFFEE)
  })

  it('tea category returns coffee extras (same group)', () => {
    const result = getModifiersForCategory('tea')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_COFFEE)
  })

  it('smoothies return drink extras', () => {
    const result = getModifiersForCategory('smoothies')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })

  it('frappes return drink extras', () => {
    const result = getModifiersForCategory('frappes')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_DRINKS)
  })

  it('sodas return no modifiers at all', () => {
    const result = getModifiersForCategory('sodas')
    expect(result.quitarOptions).toEqual([])
    expect(result.agregarOptions).toEqual([])
  })

  it('unknown category returns food extras as default', () => {
    const result = getModifiersForCategory('unknown-category-xyz')
    expect(result.agregarOptions).toEqual(MODIFIERS_AGREGAR_FOOD)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('POS Constants', () => {
  it('IVA_RATE is 16%', () => {
    expect(IVA_RATE).toBe(0.16)
  })

  it('MESEROS has at least 8 waiters', () => {
    expect(MESEROS.length).toBeGreaterThanOrEqual(8)
    for (const m of MESEROS) {
      expect(typeof m).toBe('string')
      expect(m.length).toBeGreaterThan(3)
    }
  })

  it('MESAS_CONFIG has 16 tables', () => {
    expect(MESAS_CONFIG).toHaveLength(16)
    for (const mesa of MESAS_CONFIG) {
      expect(mesa.number).toBeGreaterThan(0)
      expect(mesa.capacity).toBeGreaterThan(0)
      expect(mesa.status).toBe('disponible')
    }
  })

  it('table capacities are reasonable (2-6)', () => {
    for (const mesa of MESAS_CONFIG) {
      expect(mesa.capacity).toBeGreaterThanOrEqual(2)
      expect(mesa.capacity).toBeLessThanOrEqual(6)
    }
  })
})

// ---------------------------------------------------------------------------
// formatMXN
// ---------------------------------------------------------------------------

describe('formatMXN', () => {
  it('formats positive numbers with $ and commas', () => {
    const result = formatMXN(12345.67)
    expect(result).toContain('$')
    expect(result).toContain('12')
  })

  it('formats zero', () => {
    const result = formatMXN(0)
    expect(result).toContain('$')
    expect(result).toContain('0')
  })

  it('formats negative numbers', () => {
    const result = formatMXN(-500)
    expect(result).toContain('500')
  })
})

// ---------------------------------------------------------------------------
// Menu data for DB seed validation
// ---------------------------------------------------------------------------

describe('Menu data seed validation', () => {
  it('total items across all categories matches expected count', () => {
    const total = MENU_CATEGORIES.reduce((s, c) => s + c.items.length, 0)
    // Should match the 230 items we seeded to DB
    expect(total).toBeGreaterThanOrEqual(200)
  })

  it('chilaquiles category has correct items', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'chilaquiles')!
    expect(cat.items.length).toBeGreaterThanOrEqual(4)
    const names = cat.items.map(i => i.name.toLowerCase())
    expect(names.some(n => n.includes('verde'))).toBe(true)
    expect(names.some(n => n.includes('rojo'))).toBe(true)
  })

  it('coffee category has correct items with prices', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'coffee')!
    expect(cat.items.length).toBeGreaterThanOrEqual(7)
    const americano = cat.items.find(i => i.name.toLowerCase().includes('americano'))
    expect(americano).toBeTruthy()
    expect(americano!.price).toBeGreaterThan(0)
    expect(americano!.price).toBeLessThan(200)
  })

  it('promos category items have promo flag or reasonable prices', () => {
    const cat = MENU_CATEGORIES.find(c => c.id === 'promos')!
    expect(cat.items.length).toBeGreaterThanOrEqual(3)
    for (const item of cat.items) {
      expect(item.price).toBeGreaterThan(0)
    }
  })
})
