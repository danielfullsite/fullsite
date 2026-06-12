import { describe, it, expect } from 'vitest'
import {
  calcItemSubtotal,
  calcOrderTotals,
  splitCuenta,
  getPayingItems,
  calcSplitPayment,
  calcPropina,
  totalConPropina,
  splitPersonas,
  getActiveItems,
  formatMXN,
} from '@/lib/pos-calculations'
import { IVA_RATE } from '@/lib/pos-data'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeItem(id: string, precio: number, cantidad: number, precioExtra = 0) {
  const subtotal = (precio + precioExtra) * cantidad
  return { id, menuItemId: id, nombre: `Item ${id}`, precio, cantidad, modificadores: [] as string[], notas: '', precioExtra, subtotal }
}

// ─── calcItemSubtotal ──────────────────────────────────────────────────────

describe('calcItemSubtotal', () => {
  it('calculates base price * quantity', () => {
    expect(calcItemSubtotal(292, 0, 1)).toBe(292)
    expect(calcItemSubtotal(292, 0, 3)).toBe(876)
  })

  it('includes extra modifiers in the price', () => {
    // Chilaquiles $292 + Extra queso $25 = $317 each
    expect(calcItemSubtotal(292, 25, 1)).toBe(317)
    expect(calcItemSubtotal(292, 25, 2)).toBe(634)
  })

  it('handles multiple extras', () => {
    // $292 + Extra queso $25 + Extra aguacate $35 = $352 each
    expect(calcItemSubtotal(292, 60, 1)).toBe(352)
  })

  it('handles zero price items', () => {
    // Market items with $0 price
    expect(calcItemSubtotal(0, 0, 1)).toBe(0)
    expect(calcItemSubtotal(0, 0, 5)).toBe(0)
  })

  it('handles zero quantity', () => {
    expect(calcItemSubtotal(292, 0, 0)).toBe(0)
  })

  it('handles negative quantity gracefully (no crash)', () => {
    // Should just do the math — validation is upstream
    expect(calcItemSubtotal(292, 0, -1)).toBe(-292)
  })
})

// ─── calcOrderTotals ───────────────────────────────────────────────────────

describe('calcOrderTotals', () => {
  it('calculates subtotal, IVA, and total for a single item', () => {
    const items = [makeItem('c1', 292, 1)]
    const result = calcOrderTotals(items)

    expect(result.subtotal).toBe(292)
    expect(result.subtotalAfterDiscount).toBe(292)
    expect(result.iva).toBeCloseTo(292 * 0.16)
    expect(result.total).toBeCloseTo(292 * 1.16)
  })

  it('sums multiple items correctly', () => {
    const items = [
      makeItem('c1', 292, 1),  // Chilaquiles Verdes
      makeItem('cf1', 48, 2),  // 2x Cafe Americano
      makeItem('t1', 252, 1),  // Avocado Toast
    ]
    const expectedSubtotal = 292 + 96 + 252 // = 640
    const result = calcOrderTotals(items)

    expect(result.subtotal).toBe(expectedSubtotal)
    expect(result.iva).toBeCloseTo(expectedSubtotal * 0.16)
    expect(result.total).toBeCloseTo(expectedSubtotal * 1.16)
  })

  it('applies discount before IVA', () => {
    const items = [makeItem('c1', 292, 1)]
    const discount = 50
    const result = calcOrderTotals(items, discount)

    expect(result.subtotal).toBe(292)
    expect(result.subtotalAfterDiscount).toBe(242)
    expect(result.iva).toBeCloseTo(242 * 0.16)
    expect(result.total).toBeCloseTo(242 * 1.16)
  })

  it('does not go negative when discount exceeds subtotal', () => {
    const items = [makeItem('c1', 100, 1)]
    const result = calcOrderTotals(items, 200)

    expect(result.subtotalAfterDiscount).toBe(0)
    expect(result.iva).toBe(0)
    expect(result.total).toBe(0)
  })

  it('returns zeros for empty order', () => {
    const result = calcOrderTotals([])

    expect(result.subtotal).toBe(0)
    expect(result.subtotalAfterDiscount).toBe(0)
    expect(result.iva).toBe(0)
    expect(result.total).toBe(0)
  })

  it('handles items with extras correctly', () => {
    const items = [makeItem('c1', 292, 1, 25)] // +Extra queso
    const result = calcOrderTotals(items)

    expect(result.subtotal).toBe(317)
    expect(result.total).toBeCloseTo(317 * 1.16)
  })

  it('uses the correct IVA rate (16%)', () => {
    expect(IVA_RATE).toBe(0.16)
  })
})

// ─── splitCuenta ───────────────────────────────────────────────────────────

describe('splitCuenta', () => {
  const items = [
    makeItem('a', 292, 1), // $292
    makeItem('b', 48, 2),  // $96
    makeItem('c', 252, 1), // $252
  ]

  it('puts all items in cuenta 1 when no assignments', () => {
    const result = splitCuenta(items, {})

    expect(result.cuenta1Items).toHaveLength(3)
    expect(result.cuenta2Items).toHaveLength(0)
    expect(result.total1).toBe(640)
    expect(result.total2).toBe(0)
  })

  it('splits items between two cuentas', () => {
    const assignments = { 'b': 2, 'c': 2 }
    const result = splitCuenta(items, assignments)

    expect(result.cuenta1Items).toHaveLength(1) // only 'a'
    expect(result.cuenta2Items).toHaveLength(2) // 'b' and 'c'
    expect(result.total1).toBe(292)
    expect(result.total2).toBe(348) // 96 + 252
  })

  it('defaults unassigned items to cuenta 1', () => {
    const assignments = { 'c': 2 }
    const result = splitCuenta(items, assignments)

    // 'a' and 'b' default to cuenta 1
    expect(result.cuenta1Items.map(i => i.id)).toEqual(['a', 'b'])
    expect(result.cuenta2Items.map(i => i.id)).toEqual(['c'])
  })

  it('handles all items in cuenta 2', () => {
    const assignments = { 'a': 2, 'b': 2, 'c': 2 }
    const result = splitCuenta(items, assignments)

    expect(result.cuenta1Items).toHaveLength(0)
    expect(result.cuenta2Items).toHaveLength(3)
    expect(result.total1).toBe(0)
    expect(result.total2).toBe(640)
  })

  it('handles empty order', () => {
    const result = splitCuenta([], {})

    expect(result.cuenta1Items).toHaveLength(0)
    expect(result.cuenta2Items).toHaveLength(0)
    expect(result.total1).toBe(0)
    expect(result.total2).toBe(0)
  })

  it('sum of split totals equals full total', () => {
    const assignments = { 'b': 2 }
    const result = splitCuenta(items, assignments)
    const fullTotal = items.reduce((s, i) => s + i.subtotal, 0)

    expect(result.total1 + result.total2).toBe(fullTotal)
  })
})

// ─── getPayingItems ────────────────────────────────────────────────────────

describe('getPayingItems', () => {
  const items = [
    makeItem('a', 100, 1),
    makeItem('b', 200, 1),
    makeItem('c', 300, 1),
  ]

  it('returns all items when cuenta is 0 (no split)', () => {
    const result = getPayingItems(items, {}, 0)
    expect(result).toHaveLength(3)
  })

  it('returns cuenta 1 items (unassigned default to 1)', () => {
    const assignments = { 'c': 2 }
    const result = getPayingItems(items, assignments, 1)
    expect(result.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('returns cuenta 2 items', () => {
    const assignments = { 'c': 2 }
    const result = getPayingItems(items, assignments, 2)
    expect(result.map(i => i.id)).toEqual(['c'])
  })
})

// ─── calcSplitPayment ──────────────────────────────────────────────────────

describe('calcSplitPayment', () => {
  const items = [
    makeItem('a', 200, 1), // $200
    makeItem('b', 300, 1), // $300
  ]
  const assignments = { 'b': 2 }

  it('calculates full order with discount when cuenta=0', () => {
    const result = calcSplitPayment(items, assignments, 0, 50)

    expect(result.subtotal).toBe(500)
    expect(result.subtotalAfterDiscount).toBe(450)
    expect(result.total).toBeCloseTo(450 * 1.16)
  })

  it('calculates cuenta 1 WITHOUT discount during split', () => {
    const result = calcSplitPayment(items, assignments, 1, 50)

    // Discount should NOT apply during split
    expect(result.subtotal).toBe(200)
    expect(result.subtotalAfterDiscount).toBe(200)
    expect(result.total).toBeCloseTo(200 * 1.16)
  })

  it('calculates cuenta 2 WITHOUT discount during split', () => {
    const result = calcSplitPayment(items, assignments, 2, 50)

    expect(result.subtotal).toBe(300)
    expect(result.subtotalAfterDiscount).toBe(300)
    expect(result.total).toBeCloseTo(300 * 1.16)
  })

  it('split cuenta IVA totals equal full-order IVA (no discount case)', () => {
    const full = calcSplitPayment(items, assignments, 0, 0)
    const c1 = calcSplitPayment(items, assignments, 1, 0)
    const c2 = calcSplitPayment(items, assignments, 2, 0)

    // Due to floating point, use toBeCloseTo
    expect(c1.total + c2.total).toBeCloseTo(full.total)
  })
})

// ─── calcPropina ───────────────────────────────────────────────────────────

describe('calcPropina', () => {
  it('calculates 10% tip', () => {
    const total = 1000
    expect(calcPropina(total, 10)).toBe(100)
  })

  it('calculates 15% tip', () => {
    const total = 640 * 1.16 // $742.40
    const tip = calcPropina(total, 15)
    expect(tip).toBe(Math.round(total * 15 / 100))
  })

  it('calculates 20% tip', () => {
    expect(calcPropina(500, 20)).toBe(100)
  })

  it('rounds to nearest peso', () => {
    // $742.40 * 10% = $74.24 → rounds to $74
    expect(calcPropina(742.40, 10)).toBe(74)
    // $742.40 * 15% = $111.36 → rounds to $111
    expect(calcPropina(742.40, 15)).toBe(111)
  })

  it('returns 0 for 0% tip', () => {
    expect(calcPropina(1000, 0)).toBe(0)
  })

  it('returns 0 for negative percentage', () => {
    expect(calcPropina(1000, -5)).toBe(0)
  })

  it('handles zero total', () => {
    expect(calcPropina(0, 15)).toBe(0)
  })
})

// ─── totalConPropina ───────────────────────────────────────────────────────

describe('totalConPropina', () => {
  it('adds propina to total', () => {
    expect(totalConPropina(742.40, 100)).toBeCloseTo(842.40)
  })

  it('returns total when propina is 0', () => {
    expect(totalConPropina(742.40, 0)).toBeCloseTo(742.40)
  })
})

// ─── splitPersonas ─────────────────────────────────────────────────────────

describe('splitPersonas', () => {
  it('splits even number of personas', () => {
    expect(splitPersonas(4)).toBe(2)
    expect(splitPersonas(6)).toBe(3)
  })

  it('rounds up for odd number', () => {
    expect(splitPersonas(3)).toBe(2)
    expect(splitPersonas(5)).toBe(3)
  })

  it('handles 1 persona', () => {
    expect(splitPersonas(1)).toBe(1)
  })

  it('handles 2 personas', () => {
    expect(splitPersonas(2)).toBe(1)
  })
})

// ─── getActiveItems ────────────────────────────────────────────────────────

describe('getActiveItems', () => {
  const items = [
    makeItem('a', 100, 1),
    makeItem('b', 200, 1),
    makeItem('c', 300, 1),
  ]

  it('returns all items when none cancelled', () => {
    const result = getActiveItems(items, new Set())
    expect(result).toHaveLength(3)
  })

  it('filters out cancelled items', () => {
    const result = getActiveItems(items, new Set(['b']))
    expect(result).toHaveLength(2)
    expect(result.map(i => i.id)).toEqual(['a', 'c'])
  })

  it('returns empty when all cancelled', () => {
    const result = getActiveItems(items, new Set(['a', 'b', 'c']))
    expect(result).toHaveLength(0)
  })
})

// ─── formatMXN ─────────────────────────────────────────────────────────────

describe('formatMXN', () => {
  it('formats with $ and two decimals', () => {
    expect(formatMXN(292)).toBe('$292.00')
  })

  it('formats with centavos', () => {
    expect(formatMXN(742.40)).toBe('$742.40')
  })

  it('formats zero', () => {
    expect(formatMXN(0)).toBe('$0.00')
  })

  it('formats large amounts', () => {
    expect(formatMXN(12345.67)).toBe('$12345.67')
  })
})

// ─── Real-world scenario tests ─────────────────────────────────────────────

describe('Real-world scenarios', () => {
  it('Typical mesa: 2 chilaquiles + 2 cafes + 1 jugo, 10% tip', () => {
    const items = [
      makeItem('c1a', 292, 2),     // 2x Chilaquiles Verdes = $584
      makeItem('cf1', 48, 2),      // 2x Cafe Americano = $96
      makeItem('j1', 78, 1),       // 1x Jugo de Naranja = $78
    ]
    const totals = calcOrderTotals(items)
    const expectedSubtotal = 584 + 96 + 78 // = 758
    expect(totals.subtotal).toBe(expectedSubtotal)
    expect(totals.total).toBeCloseTo(expectedSubtotal * 1.16)

    const tip = calcPropina(totals.total, 10)
    const finalTotal = totalConPropina(totals.total, tip)
    expect(finalTotal).toBeCloseTo(totals.total + tip)
  })

  it('Split: couple shares — she gets food, he gets drinks', () => {
    const items = [
      makeItem('food1', 292, 1), // Her food $292
      makeItem('food2', 252, 1), // Her toast $252
      makeItem('drink1', 48, 1), // His cafe $48
      makeItem('drink2', 95, 1), // His beer $95
    ]

    const assignments = {
      'food1': 1, 'food2': 1,  // cuenta 1
      'drink1': 2, 'drink2': 2, // cuenta 2
    }

    const c1 = calcSplitPayment(items, assignments, 1)
    const c2 = calcSplitPayment(items, assignments, 2)

    expect(c1.subtotal).toBe(544)  // 292 + 252
    expect(c2.subtotal).toBe(143)  // 48 + 95
    expect(c1.total).toBeCloseTo(544 * 1.16)
    expect(c2.total).toBeCloseTo(143 * 1.16)

    // Together they equal the full order
    const full = calcOrderTotals(items)
    expect(c1.total + c2.total).toBeCloseTo(full.total)
  })

  it('Discount + tip: $100 off + 15% tip on a $1000 subtotal', () => {
    const items = [makeItem('big', 1000, 1)]
    const totals = calcOrderTotals(items, 100)

    expect(totals.subtotalAfterDiscount).toBe(900)
    expect(totals.iva).toBeCloseTo(144) // 900 * 0.16
    expect(totals.total).toBeCloseTo(1044) // 900 + 144

    const tip = calcPropina(totals.total, 15)
    expect(tip).toBe(Math.round(1044 * 0.15)) // 157
    expect(totalConPropina(totals.total, tip)).toBeCloseTo(1044 + 157)
  })

  it('Edge: order with only $0 market items', () => {
    const items = [
      makeItem('mk1', 0, 3), // 3x Cafe Grano 300g at $0
      makeItem('mk2', 0, 1), // 1x Cafe Grano 500g at $0
    ]
    const totals = calcOrderTotals(items)

    expect(totals.subtotal).toBe(0)
    expect(totals.iva).toBe(0)
    expect(totals.total).toBe(0)
  })

  it('Edge: single item with extras and modifiers', () => {
    // Chilaquiles $292 + Extra queso $25 + Extra aguacate $35
    const precioExtra = 25 + 35
    const subtotal = calcItemSubtotal(292, precioExtra, 1)
    expect(subtotal).toBe(352)

    const items = [makeItem('c1', 292, 1, precioExtra)]
    const totals = calcOrderTotals(items)
    expect(totals.subtotal).toBe(352)
    expect(totals.total).toBeCloseTo(352 * 1.16)
  })

  it('Edge: discount equal to subtotal results in $0 total', () => {
    const items = [makeItem('c1', 292, 1)]
    const totals = calcOrderTotals(items, 292)

    expect(totals.subtotalAfterDiscount).toBe(0)
    expect(totals.total).toBe(0)
  })

  it('Edge: cancelled items do not affect totals', () => {
    const items = [
      makeItem('a', 292, 1),
      makeItem('b', 48, 1),
      makeItem('c', 252, 1),
    ]
    const active = getActiveItems(items, new Set(['b']))
    const totals = calcOrderTotals(active)

    expect(totals.subtotal).toBe(544) // 292 + 252, no 48
  })

  it('Propina during split: only applied on cuenta 2 payment', () => {
    // This matches POS behavior: propina is set to 0 after paying cuenta 1
    const items = [
      makeItem('a', 200, 1),
      makeItem('b', 300, 1),
    ]
    const assignments = { 'b': 2 }

    const c1Totals = calcSplitPayment(items, assignments, 1)
    const c2Totals = calcSplitPayment(items, assignments, 2)

    // Tip of 15% applied after paying cuenta 2
    const tip = calcPropina(c2Totals.total, 15)
    const c2WithTip = totalConPropina(c2Totals.total, tip)

    expect(c2WithTip).toBeCloseTo(c2Totals.total + tip)
    // Cuenta 1 should have no tip
    expect(totalConPropina(c1Totals.total, 0)).toBeCloseTo(c1Totals.total)
  })
})

// ─── calcSplitParejo (split parejo N-way, cierre de centavos) ───────────────

import { calcSplitParejo, calcSplitItems, round2 } from '@/lib/pos-calculations'

describe('calcSplitParejo', () => {
  it('splits an even total exactly', () => {
    const items = [makeItem('a', 100, 2)] // subtotal 200
    const r1 = calcSplitParejo(items, 0, 2, 1)
    const r2 = calcSplitParejo(items, 0, 2, 2)
    expect(r1.subtotal).toBe(100)
    expect(r2.subtotal).toBe(100)
    expect(r1.total).toBeCloseTo(116)
    expect(r2.total).toBeCloseTo(116)
  })

  it('closes centavos on the last cuenta (total/3 with repeating decimals)', () => {
    const items = [makeItem('a', 100, 1)] // subtotal 100, total 116
    const n = 3
    const rs = [1, 2, 3].map(c => calcSplitParejo(items, 0, n, c))
    // Cuentas 1-2 pay round2(116/3) = 38.67; last pays remainder 38.66
    expect(rs[0].total).toBe(38.67)
    expect(rs[1].total).toBe(38.67)
    expect(rs[2].total).toBe(38.66)
    const sum = rs.reduce((s, r) => s + r.total, 0)
    expect(round2(sum)).toBe(116)
  })

  it('sum of N cuentas always equals full total (fuzz over odd amounts)', () => {
    const amounts = [99.99, 123.45, 287.31, 1.01, 777.77]
    for (const amount of amounts) {
      for (const n of [2, 3, 4, 5, 7]) {
        const items = [makeItem('a', amount, 1)]
        const fullAfter = Math.max(0, amount)
        const fullTotal = round2(fullAfter + fullAfter * IVA_RATE)
        const sum = round2(
          Array.from({ length: n }, (_, i) => calcSplitParejo(items, 0, n, i + 1).total)
            .reduce((s, t) => s + t, 0)
        )
        expect(sum).toBeCloseTo(fullTotal, 2)
      }
    }
  })

  it('splits discount evenly and sums back to full discount', () => {
    const items = [makeItem('a', 300, 1)]
    const discount = 50
    const rs = [1, 2, 3].map(c => calcSplitParejo(items, discount, 3, c))
    const discSum = round2(rs.reduce((s, r) => s + r.discount, 0))
    expect(discSum).toBe(50)
    // Full total: (300-50)*1.16 = 290 → cuentas suman 290
    const totalSum = round2(rs.reduce((s, r) => s + r.total, 0))
    expect(totalSum).toBe(290)
  })

  it('n=1 (sin split real) paga el total completo', () => {
    const items = [makeItem('a', 250, 1)]
    const r = calcSplitParejo(items, 0, 1, 1)
    expect(r.total).toBeCloseTo(290)
  })
})

// ─── calcSplitItems (split por items, descuento prorrateado) ────────────────

describe('calcSplitItems', () => {
  it('assigns unassigned items to cuenta 1 by default', () => {
    const items = [makeItem('a', 200, 1), makeItem('b', 300, 1)]
    const r = calcSplitItems(items, { b: 2 }, 1, 0)
    expect(r.payingItems.map(i => i.id)).toEqual(['a'])
    expect(r.subtotal).toBe(200)
  })

  it('prorates global discount by subtotal share', () => {
    // a=200 (40%), b=300 (60%), discount=100
    const items = [makeItem('a', 200, 1), makeItem('b', 300, 1)]
    const r1 = calcSplitItems(items, { b: 2 }, 1, 100)
    const r2 = calcSplitItems(items, { b: 2 }, 2, 100)
    expect(r1.discount).toBe(40)
    expect(r2.discount).toBe(60)
    // Totals: (200-40)*1.16 + (300-60)*1.16 = 185.60 + 278.40 = 464 = (500-100)*1.16
    expect(round2(r1.total + r2.total)).toBe(464)
  })

  it('discount proration sums to full discount across cuentas', () => {
    const items = [makeItem('a', 99.5, 1), makeItem('b', 151.25, 1), makeItem('c', 48, 1)]
    const assignments = { a: 1, b: 2, c: 3 }
    const discount = 33.33
    const ds = [1, 2, 3].map(c => calcSplitItems(items, assignments, c, discount).discount)
    const sum = round2(ds.reduce((s, d) => s + d, 0))
    // Puede diferir por 1 centavo de redondeo como máximo
    expect(Math.abs(sum - discount)).toBeLessThanOrEqual(0.01)
  })

  it('handles zero subtotal without dividing by zero', () => {
    const items: { id: string; subtotal: number }[] = []
    const r = calcSplitItems(items, {}, 1, 50)
    expect(r.discount).toBe(0)
    expect(r.total).toBe(0)
  })

  it('cuenta with no assigned items pays $0', () => {
    const items = [makeItem('a', 200, 1)]
    const r = calcSplitItems(items, { a: 1 }, 2, 0)
    expect(r.payingItems).toHaveLength(0)
    expect(r.total).toBe(0)
  })

  it('discount never exceeds cuenta subtotal (clamped at 0)', () => {
    const items = [makeItem('a', 10, 1), makeItem('b', 990, 1)]
    // Descuento gigante: prorrateo de cuenta 1 = 10, after-discount clamped >= 0
    const r = calcSplitItems(items, { b: 2 }, 1, 1000)
    expect(r.subtotalAfterDiscount).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeGreaterThanOrEqual(0)
  })
})
