import { describe, it, expect } from 'vitest'
import { formatMXN } from '@/lib/pos-data'
import {
  getStationForItem,
  getStationByName,
  isBebida,
  STATION_CATEGORIES,
  CATEGORY_TO_STATION,
  STATION_LABELS,
  BEBIDA_KEYWORDS,
  BARRA_CATEGORIES,
} from '@/lib/pos-constants'

// ─── formatMXN (used in all ticket printing) ─────────────────────────────

describe('formatMXN', () => {
  it('formats zero', () => {
    expect(formatMXN(0)).toBe('$0.00')
  })

  it('formats integer amounts', () => {
    expect(formatMXN(100)).toBe('$100.00')
  })

  it('formats decimals with 2 places', () => {
    expect(formatMXN(99.5)).toBe('$99.50')
  })

  it('rounds to 2 decimal places', () => {
    expect(formatMXN(99.999)).toBe('$100.00')
  })

  it('handles negative amounts', () => {
    expect(formatMXN(-50)).toBe('$-50.00')
  })

  it('handles very large amounts', () => {
    expect(formatMXN(999999.99)).toBe('$999999.99')
  })

  it('handles very small amounts', () => {
    expect(formatMXN(0.01)).toBe('$0.01')
  })

  it('handles fractional cents (0.005)', () => {
    expect(formatMXN(0.005)).toBe('$0.01')
  })

  it('includes dollar sign prefix', () => {
    expect(formatMXN(50)).toMatch(/^\$/)
  })

  it('handles NaN gracefully', () => {
    expect(formatMXN(NaN)).toBe('$NaN')
  })

  it('formats 1234.56 correctly', () => {
    expect(formatMXN(1234.56)).toBe('$1234.56')
  })

  it('formats one cent', () => {
    expect(formatMXN(0.01)).toBe('$0.01')
  })

  it('formats typical ticket total', () => {
    expect(formatMXN(450.00)).toBe('$450.00')
  })

  it('formats typical restaurant bill', () => {
    expect(formatMXN(2850.50)).toBe('$2850.50')
  })
})

// ─── Station routing (getStationForItem) ─────────────────────────────────

describe('getStationForItem', () => {
  it('routes cocina category to cocina', () => {
    expect(getStationForItem('chilaquiles', 'Chilaquiles Rojos')).toBe('cocina')
  })

  it('routes eggs to cocina', () => {
    expect(getStationForItem('eggs', 'Huevos Rancheros')).toBe('cocina')
  })

  it('routes pancakes to cocina', () => {
    expect(getStationForItem('pancakes', 'Pancake Stack')).toBe('cocina')
  })

  it('routes paninis to cocina', () => {
    expect(getStationForItem('paninis', 'Panini de Pollo')).toBe('cocina')
  })

  it('routes bowls to cocina', () => {
    expect(getStationForItem('bowls', 'Buddha Bowl')).toBe('cocina')
  })

  it('routes ceviche to cocina', () => {
    expect(getStationForItem('ceviche', 'Ceviche Clasico')).toBe('cocina')
  })

  it('routes coffee category to barra', () => {
    expect(getStationForItem('coffee', 'Americano')).toBe('barra')
  })

  it('routes signature to barra', () => {
    expect(getStationForItem('signature', 'Dirty Chai')).toBe('barra')
  })

  it('routes jugos to barra', () => {
    expect(getStationForItem('jugos', 'Jugo Verde')).toBe('barra')
  })

  it('routes fresh to barra', () => {
    expect(getStationForItem('fresh', 'Limonada')).toBe('barra')
  })

  it('routes smoothies to barra', () => {
    expect(getStationForItem('smoothies', 'Berry Smoothie')).toBe('barra')
  })

  it('routes frappes to barra', () => {
    expect(getStationForItem('frappes', 'Frappe Mocha')).toBe('barra')
  })

  it('routes sodas to barra', () => {
    expect(getStationForItem('sodas', 'Coca Cola')).toBe('barra')
  })

  it('routes tea to barra', () => {
    expect(getStationForItem('tea', 'Matcha Latte')).toBe('barra')
  })

  it('routes toast to caja', () => {
    expect(getStationForItem('toast', 'Avocado Toast')).toBe('caja')
  })

  it('routes bakery to caja', () => {
    expect(getStationForItem('bakery', 'Croissant')).toBe('caja')
  })

  it('routes postres to caja', () => {
    expect(getStationForItem('postres', 'Cheesecake')).toBe('caja')
  })

  it('routes mkt-cafe to caja', () => {
    expect(getStationForItem('mkt-cafe', 'Café en grano')).toBe('caja')
  })

  it('falls back to barra for unknown category with beverage name', () => {
    expect(getStationForItem('unknown', 'Café Americano')).toBe('barra')
  })

  it('falls back to cocina for unknown category with food name', () => {
    expect(getStationForItem('unknown', 'Tacos de Birria')).toBe('cocina')
  })

  it('falls back to cocina for empty category and non-beverage', () => {
    expect(getStationForItem('', 'Hamburguesa')).toBe('cocina')
  })

  it('falls back to barra for empty category with beverage', () => {
    expect(getStationForItem('', 'Jugo de Naranja')).toBe('barra')
  })

  it('routes promos to cocina', () => {
    expect(getStationForItem('promos', 'Promo Familiar')).toBe('cocina')
  })

  it('routes croissants to cocina', () => {
    expect(getStationForItem('croissants', 'Croissant Ham & Cheese')).toBe('cocina')
  })

  it('routes pizzas to cocina', () => {
    expect(getStationForItem('pizzas', 'Pizza Margherita')).toBe('cocina')
  })

  it('routes alcohol to barra', () => {
    expect(getStationForItem('alcohol', 'Mimosa')).toBe('barra')
  })
})

// ─── getStationByName ────────────────────────────────────────────────────

describe('getStationByName', () => {
  it('classifies café as barra', () => {
    expect(getStationByName('Café Americano')).toBe('barra')
  })

  it('classifies latte as barra', () => {
    expect(getStationByName('Matcha Latte')).toBe('barra')
  })

  it('classifies cappuccino as barra', () => {
    expect(getStationByName('Cappuccino')).toBe('barra')
  })

  it('classifies frappe as barra', () => {
    expect(getStationByName('Frappe de Chocolate')).toBe('barra')
  })

  it('classifies jugo as barra', () => {
    expect(getStationByName('Jugo Verde Detox')).toBe('barra')
  })

  it('classifies smoothie as barra', () => {
    expect(getStationByName('Smoothie de Fresa')).toBe('barra')
  })

  it('classifies soda as barra', () => {
    expect(getStationByName('Soda Italiana')).toBe('barra')
  })

  it('classifies toast as caja', () => {
    expect(getStationByName('Avocado Toast')).toBe('caja')
  })

  it('classifies bagel as caja', () => {
    expect(getStationByName('Bagel con Cream Cheese')).toBe('caja')
  })

  it('classifies brownie as caja', () => {
    expect(getStationByName('Brownie de Chocolate')).toBe('caja')
  })

  it('classifies cheesecake as caja', () => {
    expect(getStationByName('Cheesecake de Fresa')).toBe('caja')
  })

  it('classifies galleta as caja', () => {
    expect(getStationByName('Galleta de Avena')).toBe('caja')
  })

  it('classifies chilaquiles as cocina', () => {
    expect(getStationByName('Chilaquiles Verdes')).toBe('cocina')
  })

  it('classifies huevos as cocina', () => {
    expect(getStationByName('Huevos Rancheros')).toBe('cocina')
  })

  it('classifies panini as cocina', () => {
    expect(getStationByName('Panini Caprese')).toBe('cocina')
  })

  it('classifies unknown food items as cocina', () => {
    expect(getStationByName('Tacos al Pastor')).toBe('cocina')
  })

  it('is case insensitive for beverages', () => {
    expect(getStationByName('CAFÉ AMERICANO')).toBe('barra')
  })

  it('is case insensitive for caja items', () => {
    expect(getStationByName('BROWNIE DE CHOCOLATE')).toBe('caja')
  })

  it('aguacate matches agua keyword and goes to barra', () => {
    // Known quirk: "aguacate" contains "agua" so isBebida wins
    expect(getStationByName('Toast de Aguacate')).toBe('barra')
  })

  it('classifies tiramisu as caja', () => {
    expect(getStationByName('Tiramisú')).toBe('caja')
  })

  it('classifies concha as caja', () => {
    expect(getStationByName('Concha de chocolate')).toBe('caja')
  })

  it('classifies cerveza as barra', () => {
    expect(getStationByName('Cerveza Artesanal')).toBe('barra')
  })

  it('classifies mimosa as barra', () => {
    expect(getStationByName('Mimosa de Mango')).toBe('barra')
  })

  it('classifies agua as barra', () => {
    expect(getStationByName('Agua de Jamaica')).toBe('barra')
  })

  it('classifies limonada as barra', () => {
    expect(getStationByName('Limonada con Chía')).toBe('barra')
  })

  it('classifies tisana as barra', () => {
    expect(getStationByName('Tisana de Manzanilla')).toBe('barra')
  })
})

// ─── isBebida ────────────────────────────────────────────────────────────

describe('isBebida', () => {
  it('detects café', () => expect(isBebida('Café Americano')).toBe(true))
  it('detects cappuccino', () => expect(isBebida('Cappuccino Vainilla')).toBe(true))
  it('detects latte', () => expect(isBebida('Matcha Latte')).toBe(true))
  it('detects smoothie', () => expect(isBebida('Berry Smoothie')).toBe(true))
  it('detects frappe', () => expect(isBebida('Frappe Mocha')).toBe(true))
  it('detects jugo', () => expect(isBebida('Jugo Verde')).toBe(true))
  it('detects soda', () => expect(isBebida('Soda Italiana')).toBe(true))
  it('detects agua', () => expect(isBebida('Agua Natural')).toBe(true))
  it('detects cerveza', () => expect(isBebida('Cerveza IPA')).toBe(true))
  it('detects vino', () => expect(isBebida('Vino Tinto')).toBe(true))
  it('detects mimosa', () => expect(isBebida('Mimosa')).toBe(true))
  it('detects tisana', () => expect(isBebida('Tisana Herbal')).toBe(true))
  it('rejects chilaquiles', () => expect(isBebida('Chilaquiles Rojos')).toBe(false))
  it('rejects panini', () => expect(isBebida('Panini Caprese')).toBe(false))
  it('rejects pancakes', () => expect(isBebida('Pancake Stack')).toBe(false))
  it('rejects huevos', () => expect(isBebida('Huevos Rancheros')).toBe(false))
  it('rejects ensalada', () => expect(isBebida('Ensalada César')).toBe(false))
  it('is case insensitive', () => expect(isBebida('CAFÉ AMERICANO')).toBe(true))
})

// ─── STATION_LABELS ──────────────────────────────────────────────────────

describe('STATION_LABELS', () => {
  it('cocina label is COCINA', () => expect(STATION_LABELS.cocina).toBe('COCINA'))
  it('barra label is BARRA', () => expect(STATION_LABELS.barra).toBe('BARRA'))
  it('caja label is MARKET', () => expect(STATION_LABELS.caja).toBe('MARKET'))
  it('has exactly 3 stations', () => expect(Object.keys(STATION_LABELS)).toHaveLength(3))
})

// ─── STATION_CATEGORIES ──────────────────────────────────────────────────

describe('STATION_CATEGORIES', () => {
  it('has cocina, barra, caja keys', () => {
    expect(Object.keys(STATION_CATEGORIES).sort()).toEqual(['barra', 'caja', 'cocina'])
  })

  it('cocina has chilaquiles', () => {
    expect(STATION_CATEGORIES.cocina).toContain('chilaquiles')
  })

  it('barra has coffee', () => {
    expect(STATION_CATEGORIES.barra).toContain('coffee')
  })

  it('caja has bakery', () => {
    expect(STATION_CATEGORIES.caja).toContain('bakery')
  })

  it('no category appears in multiple stations', () => {
    const all = [
      ...STATION_CATEGORIES.cocina,
      ...STATION_CATEGORIES.barra,
      ...STATION_CATEGORIES.caja,
    ]
    const unique = new Set(all)
    expect(unique.size).toBe(all.length)
  })
})

// ─── CATEGORY_TO_STATION reverse lookup ──────────────────────────────────

describe('CATEGORY_TO_STATION', () => {
  it('maps chilaquiles to cocina', () => expect(CATEGORY_TO_STATION.chilaquiles).toBe('cocina'))
  it('maps coffee to barra', () => expect(CATEGORY_TO_STATION.coffee).toBe('barra'))
  it('maps toast to caja', () => expect(CATEGORY_TO_STATION.toast).toBe('caja'))
  it('maps bakery to caja', () => expect(CATEGORY_TO_STATION.bakery).toBe('caja'))
  it('maps eggs to cocina', () => expect(CATEGORY_TO_STATION.eggs).toBe('cocina'))
  it('maps signature to barra', () => expect(CATEGORY_TO_STATION.signature).toBe('barra'))

  it('every category from STATION_CATEGORIES has reverse mapping', () => {
    for (const [station, cats] of Object.entries(STATION_CATEGORIES)) {
      for (const cat of cats) {
        expect(CATEGORY_TO_STATION[cat]).toBe(station)
      }
    }
  })
})

// ─── BEBIDA_KEYWORDS ─────────────────────────────────────────────────────

describe('BEBIDA_KEYWORDS', () => {
  it('is a non-empty array', () => {
    expect(BEBIDA_KEYWORDS.length).toBeGreaterThan(0)
  })

  it('includes café', () => {
    expect(BEBIDA_KEYWORDS).toContain('café')
  })

  it('includes cappuccino', () => {
    expect(BEBIDA_KEYWORDS).toContain('cappuccino')
  })

  it('includes smoothie', () => {
    expect(BEBIDA_KEYWORDS).toContain('smoothie')
  })

  it('all keywords are lowercase', () => {
    for (const kw of BEBIDA_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase())
    }
  })
})

// ─── BARRA_CATEGORIES ────────────────────────────────────────────────────

describe('BARRA_CATEGORIES', () => {
  it('includes coffee', () => expect(BARRA_CATEGORIES).toContain('coffee'))
  it('includes jugos', () => expect(BARRA_CATEGORIES).toContain('jugos'))
  it('includes smoothies', () => expect(BARRA_CATEGORIES).toContain('smoothies'))
  it('includes frappes', () => expect(BARRA_CATEGORIES).toContain('frappes'))
  it('includes sodas', () => expect(BARRA_CATEGORIES).toContain('sodas'))
  it('includes tea', () => expect(BARRA_CATEGORIES).toContain('tea'))
})
