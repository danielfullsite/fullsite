import { describe, it, expect } from 'vitest'

// ── Reproduce parseJsonb from chat/route.ts ──
function parseJsonb(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val !== 'string') return []
  try {
    let parsed = JSON.parse(val)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// ── Reproduce date detection logic from chat/route.ts ──
const monthMap: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
}

function detectDateFilter(q: string, todayStr: string): { start: string; end: string } | null {
  const mxNow = new Date(todayStr + 'T12:00:00')
  const yesterday = new Date(mxNow.getTime() - 86400000).toISOString().split('T')[0]

  let dateFilter: { start: string; end: string } | null = null

  const rangeMatch = q.match(/(\d{1,2})\s*(?:de\s+)?(\w+)\s*(?:a|al|hasta|a\s+el)\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
  const rangeMatch2 = q.match(/del?\s*(\d{1,2})\s*al?\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)

  if (rangeMatch) {
    const [, d1, m1, d2, m2] = rangeMatch
    const mm1 = monthMap[m1.toLowerCase()]
    const mm2 = monthMap[m2.toLowerCase()]
    if (mm1 && mm2) {
      const year = todayStr.slice(0, 4)
      dateFilter = { start: `${year}-${mm1}-${d1.padStart(2, '0')}`, end: `${year}-${mm2}-${d2.padStart(2, '0')}` }
    }
  } else if (rangeMatch2) {
    const [, d1, d2, m] = rangeMatch2
    const mm = monthMap[m.toLowerCase()]
    if (mm) {
      const year = todayStr.slice(0, 4)
      dateFilter = { start: `${year}-${mm}-${d1.padStart(2, '0')}`, end: `${year}-${mm}-${d2.padStart(2, '0')}` }
    }
  }

  if (!dateFilter) {
    if (q.includes('ayer')) dateFilter = { start: yesterday, end: yesterday }
    else if (q.includes('hoy')) dateFilter = { start: todayStr, end: todayStr }
    else if (q.includes('semana')) {
      const weekAgo = new Date(mxNow.getTime() - 7 * 86400000).toISOString().split('T')[0]
      dateFilter = { start: weekAgo, end: todayStr }
    } else if (q.includes('mes')) {
      const monthStart = todayStr.slice(0, 8) + '01'
      dateFilter = { start: monthStart, end: todayStr }
    } else {
      for (const [name, num] of Object.entries(monthMap)) {
        if (q.includes(name)) {
          const year = todayStr.slice(0, 4)
          const lastDay = new Date(Number(year), Number(num), 0).getDate()
          dateFilter = { start: `${year}-${num}-01`, end: `${year}-${num}-${String(lastDay).padStart(2, '0')}` }
          break
        }
      }
    }
  }

  return dateFilter
}

// ── Reproduce keyword detection from chat/route.ts ──
function detectKeywords(q: string) {
  const lower = q.toLowerCase()
  const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'febrero', 'enero', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año'].some(kw => lower.includes(kw))
  const wantsDetail = ['mesero', 'quien', 'quién', 'platillo', 'grupo', 'categoria', 'categoría', 'pago', 'tarjeta', 'efectivo', 'desglose', 'detalle', 'top', 'chilaquil', 'cuantos', 'cuántos', 'vendieron', 'vendimos', 'mejor', 'peor', 'mas vendido', 'más vendido', 'coffee', 'cafe', 'café', 'pancake', 'waffle', 'bowl', 'pizza', 'smoothie', 'frappe', 'jugo'].some(kw => lower.includes(kw))
  const wantsMeseros = ['mesero', 'quien', 'quién', 'ranking', 'top', 'mejor', 'peor', 'h&h', 'half', 'bebida', 'postre', 'pan', 'toast', 'propina', 'vendio', 'vendió', 'omar', 'brayan', 'julio', 'daniela', 'mauricio', 'oscar', 'alexis', 'hector', 'crack', 'manco', 'chilaquil', 'cuantos', 'cuántos', 'vendieron', 'vendimos'].some(kw => lower.includes(kw))
  const wantsFoodCost = ['costo', 'cost', 'food cost', 'margen', 'insumo', 'ingrediente', 'receta', 'rentab', 'compra', 'comprado', 'precio', 'caro', 'barato'].some(kw => lower.includes(kw))
  return { wantsHistory, wantsDetail, wantsMeseros, wantsFoodCost }
}

// ── Reproduce formatting helpers from chat/route.ts ──
function formatMeseroLine(meseros: { nombre: string; total: number }[]): string {
  return meseros
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(m => `${m.nombre}:$${m.total}`)
    .join(', ')
}

function formatPlatilloLine(platillos: { nombre: string; cantidad: number; total: number }[]): string {
  return platillos
    .slice(0, 15)
    .map(p => `${p.nombre}:${p.cantidad || 0}pzas/$${Math.round(p.total || 0)}`)
    .join(', ')
}

function formatGrupoLine(grupos: { nombre: string; total: number }[]): string {
  return grupos
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map(g => `${g.nombre}:$${g.total}`)
    .join(', ')
}

function formatPagoLine(pagos: { nombre: string; total: number }[], ventasDia: number): string {
  return pagos.map(p => {
    const mxn = (p.total || 0) < 100 ? Math.round(((p.total || 0) / 100) * ventasDia) : Math.round(p.total || 0)
    return `${p.nombre}:$${mxn}`
  }).join(', ')
}

// ── Reproduce food cost formatting from chat/route.ts ──
function formatFoodCostItem(item: Record<string, unknown>) {
  const nombre = item.platillo || item.nombre || 'Sin nombre'
  const grupo = item.grupo || ''
  const qty = Number(item.cantidad || 0)
  const ventaTotal = Number(item.subtotal_venta || 0)
  const costoReal = Number(item.costo_real || 0)
  const costoPct = Number(item.costo_real_pct || 0)
  const costoIdealPct = Number(item.costo_ideal_pct || 0)
  const precioUnit = qty > 0 ? Math.round(ventaTotal / qty) : 0
  const costoUnit = qty > 0 ? Math.round(costoReal / qty) : 0
  return { nombre, grupo, qty, ventaTotal, costoReal, costoPct, costoIdealPct, precioUnit, costoUnit }
}

function calculateOverallFoodCost(items: Record<string, unknown>[]) {
  const totalVentas = items.reduce((s, i) => s + Number(i.subtotal_venta || 0), 0)
  const totalCosto = items.reduce((s, i) => s + Number(i.costo_real || 0), 0)
  const overallPct = totalVentas > 0 ? ((totalCosto / totalVentas) * 100) : 0
  return { totalVentas, totalCosto, overallPct }
}

// ── Reproduce aggregation logic from chat/route.ts ──
function sumField(arr: Record<string, unknown>[], key: string) {
  return arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
}

function computeTicketPromedio(ventasDia: number, personas: number): number {
  return personas > 0 ? Math.round(ventasDia / personas) : 0
}

// ═══════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════

describe('Chat Data Pipeline — parseJsonb', () => {
  it('returns array input as-is', () => {
    const input = [{ nombre: 'Omar', total: 12533 }]
    expect(parseJsonb(input)).toEqual(input)
  })

  it('parses JSON string of array', () => {
    const arr = [{ nombre: 'Omar', total: 12533 }]
    expect(parseJsonb(JSON.stringify(arr))).toEqual(arr)
  })

  it('parses double-encoded JSON (string of string of array)', () => {
    const arr = [{ nombre: 'Omar', total: 12533 }]
    const doubleEncoded = JSON.stringify(JSON.stringify(arr))
    expect(parseJsonb(doubleEncoded)).toEqual(arr)
  })

  it('returns [] for null', () => {
    expect(parseJsonb(null)).toEqual([])
  })

  it('returns [] for undefined', () => {
    expect(parseJsonb(undefined)).toEqual([])
  })

  it('returns [] for invalid JSON string', () => {
    expect(parseJsonb('{not valid json')).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(parseJsonb('')).toEqual([])
  })

  it('returns [] for number input', () => {
    expect(parseJsonb(42)).toEqual([])
    expect(parseJsonb(0)).toEqual([])
    expect(parseJsonb(-1)).toEqual([])
  })

  it('returns [] for boolean input', () => {
    expect(parseJsonb(true)).toEqual([])
    expect(parseJsonb(false)).toEqual([])
  })

  it('returns [] for JSON object (not array)', () => {
    expect(parseJsonb('{"key": "value"}')).toEqual([])
  })

  it('handles nested array elements correctly', () => {
    const arr = [{ nombre: 'CHILAQUILES', cantidad: 22, total: 5490 }]
    expect(parseJsonb(JSON.stringify(arr))).toEqual(arr)
  })

  it('handles empty array string', () => {
    expect(parseJsonb('[]')).toEqual([])
  })

  it('handles triple-encoded gracefully (fails to double-decoded object)', () => {
    const arr = [{ a: 1 }]
    const triple = JSON.stringify(JSON.stringify(JSON.stringify(arr)))
    // triple: '"\"[{\\\"a\\\":1}]\""' — after two parses, result is a string, not array → []
    expect(parseJsonb(triple)).toEqual([])
  })
})

describe('Chat Data Pipeline — data formatting: meseros', () => {
  it('formats mesero data as nombre:$total', () => {
    const meseros = [
      { nombre: 'Omar Aguilera', total: 12533 },
      { nombre: 'Mario Garcia', total: 9800 },
    ]
    const result = formatMeseroLine(meseros)
    expect(result).toBe('Omar Aguilera:$12533, Mario Garcia:$9800')
  })

  it('sorts meseros by total descending', () => {
    const meseros = [
      { nombre: 'Low', total: 1000 },
      { nombre: 'High', total: 5000 },
      { nombre: 'Mid', total: 3000 },
    ]
    const result = formatMeseroLine(meseros)
    expect(result).toBe('High:$5000, Mid:$3000, Low:$1000')
  })

  it('limits to top 10 meseros', () => {
    const meseros = Array.from({ length: 15 }, (_, i) => ({
      nombre: `Mesero ${i}`,
      total: (15 - i) * 1000,
    }))
    const result = formatMeseroLine(meseros)
    const parts = result.split(', ')
    expect(parts.length).toBe(10)
  })
})

describe('Chat Data Pipeline — data formatting: platillos', () => {
  it('formats platillo as nombre:cantidadpzas/$total', () => {
    const platillos = [{ nombre: 'CHILAQUILES', cantidad: 31, total: 9895 }]
    const result = formatPlatilloLine(platillos)
    expect(result).toBe('CHILAQUILES:31pzas/$9895')
  })

  it('handles missing cantidad as 0', () => {
    const platillos = [{ nombre: 'COFFEE', cantidad: 0, total: 1500 }]
    const result = formatPlatilloLine(platillos)
    expect(result).toBe('COFFEE:0pzas/$1500')
  })

  it('rounds total to integer', () => {
    const platillos = [{ nombre: 'BOWL', cantidad: 5, total: 1234.56 }]
    const result = formatPlatilloLine(platillos)
    expect(result).toBe('BOWL:5pzas/$1235')
  })
})

describe('Chat Data Pipeline — data formatting: grupos', () => {
  it('sorts grupos by total descending', () => {
    const grupos = [
      { nombre: 'COFFEE HOT/ICE', total: 5000 },
      { nombre: 'CHILAQUILES & ENCHILADAS', total: 8225 },
      { nombre: 'BOWLS', total: 3000 },
    ]
    const result = formatGrupoLine(grupos)
    expect(result.startsWith('CHILAQUILES & ENCHILADAS:$8225')).toBe(true)
  })

  it('limits to top 5 grupos', () => {
    const grupos = Array.from({ length: 10 }, (_, i) => ({
      nombre: `Grupo ${i}`,
      total: (10 - i) * 1000,
    }))
    const parts = formatGrupoLine(grupos).split(', ')
    expect(parts.length).toBe(5)
  })
})

describe('Chat Data Pipeline — data formatting: pagos (percentage conversion)', () => {
  it('converts values < 100 as percentage of ventasDia', () => {
    const pagos = [{ nombre: 'Tarjeta de crédito', total: 60 }]
    const ventasDia = 50000
    const result = formatPagoLine(pagos, ventasDia)
    // 60 < 100 → (60/100)*50000 = 30000
    expect(result).toBe('Tarjeta de crédito:$30000')
  })

  it('keeps values >= 100 as absolute MXN', () => {
    const pagos = [{ nombre: 'Efectivo', total: 25000 }]
    const result = formatPagoLine(pagos, 50000)
    expect(result).toBe('Efectivo:$25000')
  })

  it('handles mixed percentage and absolute values', () => {
    const pagos = [
      { nombre: 'Tarjeta', total: 55 },   // percentage
      { nombre: 'Efectivo', total: 20000 }, // absolute
    ]
    const result = formatPagoLine(pagos, 40000)
    expect(result).toBe('Tarjeta:$22000, Efectivo:$20000')
  })

  it('handles zero total gracefully', () => {
    const pagos = [{ nombre: 'Transferencia', total: 0 }]
    const result = formatPagoLine(pagos, 50000)
    // 0 < 100 → (0/100)*50000 = 0
    expect(result).toBe('Transferencia:$0')
  })

  it('boundary: total=99 treated as percentage', () => {
    const pagos = [{ nombre: 'Tarjeta', total: 99 }]
    const result = formatPagoLine(pagos, 10000)
    expect(result).toBe('Tarjeta:$9900')
  })

  it('boundary: total=100 treated as absolute', () => {
    const pagos = [{ nombre: 'Ubereats', total: 100 }]
    const result = formatPagoLine(pagos, 10000)
    expect(result).toBe('Ubereats:$100')
  })
})

describe('Chat Data Pipeline — date detection', () => {
  const today = '2026-06-09'

  it('"ayer" → yesterday', () => {
    const f = detectDateFilter('como nos fue ayer', today)
    expect(f).toEqual({ start: '2026-06-08', end: '2026-06-08' })
  })

  it('"hoy" → today', () => {
    const f = detectDateFilter('como vamos hoy', today)
    expect(f).toEqual({ start: '2026-06-09', end: '2026-06-09' })
  })

  it('"semana" → last 7 days', () => {
    const f = detectDateFilter('ventas de la semana', today)
    expect(f!.start).toBe('2026-06-02')
    expect(f!.end).toBe('2026-06-09')
  })

  it('"mes" → month start to today', () => {
    const f = detectDateFilter('reporte del mes', today)
    expect(f).toEqual({ start: '2026-06-01', end: '2026-06-09' })
  })

  it('"1 de mayo a 18 de mayo" → explicit range', () => {
    const f = detectDateFilter('ventas del 1 de mayo a 18 de mayo', today)
    expect(f).toEqual({ start: '2026-05-01', end: '2026-05-18' })
  })

  it('"del 1 al 18 de mayo" → range with del/al', () => {
    const f = detectDateFilter('ventas del 1 al 18 de mayo', today)
    expect(f).toEqual({ start: '2026-05-01', end: '2026-05-18' })
  })

  it('"mayo" → full month range', () => {
    const f = detectDateFilter('como estuvo mayo', today)
    expect(f).toEqual({ start: '2026-05-01', end: '2026-05-31' })
  })

  it('"febrero" → full month (28 days in non-leap 2026)', () => {
    const f = detectDateFilter('ventas de febrero', today)
    expect(f).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })

  it('"enero" → full month range', () => {
    const f = detectDateFilter('enero fue bueno', today)
    expect(f).toEqual({ start: '2026-01-01', end: '2026-01-31' })
  })

  it('no date keyword → null', () => {
    const f = detectDateFilter('quien vendio mas', today)
    expect(f).toBeNull()
  })

  it('"5 de junio a 9 de junio" → same-month range', () => {
    const f = detectDateFilter('del 5 de junio a 9 de junio', today)
    expect(f).toEqual({ start: '2026-06-05', end: '2026-06-09' })
  })

  it('"del 15 al 28 de abril" → falls through to full month (regex limitation)', () => {
    // The "del X al Y de month" regex doesn't match when "de" precedes the month.
    // It falls through to the single-month "abril" match instead.
    const f = detectDateFilter('del 15 al 28 de abril', today)
    expect(f).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('"del 5 al 12 mayo" (no "de") → correct range via rangeMatch2', () => {
    const f = detectDateFilter('del 5 al 12 mayo', today)
    expect(f).toEqual({ start: '2026-05-05', end: '2026-05-12' })
  })
})

describe('Chat Data Pipeline — keyword detection', () => {
  it('"chilaquiles vendió omar" triggers wantsDetail AND wantsMeseros', () => {
    const kw = detectKeywords('chilaquiles vendió omar')
    expect(kw.wantsDetail).toBe(true)
    expect(kw.wantsMeseros).toBe(true)
  })

  it('"costo de comida" triggers wantsFoodCost', () => {
    const kw = detectKeywords('cual es el costo de comida')
    expect(kw.wantsFoodCost).toBe(true)
  })

  it('"tarjeta" triggers wantsDetail', () => {
    const kw = detectKeywords('cuanto cobramos en tarjeta')
    expect(kw.wantsDetail).toBe(true)
  })

  it('"semana" triggers wantsHistory', () => {
    const kw = detectKeywords('como fue la semana')
    expect(kw.wantsHistory).toBe(true)
  })

  it('"cuantos" triggers wantsMeseros', () => {
    const kw = detectKeywords('cuantos h&h vendimos')
    expect(kw.wantsMeseros).toBe(true)
  })

  it('"food cost" triggers wantsFoodCost', () => {
    const kw = detectKeywords('dame el food cost')
    expect(kw.wantsFoodCost).toBe(true)
  })

  it('"ranking" triggers wantsMeseros but not wantsHistory', () => {
    const kw = detectKeywords('ranking de ventas')
    expect(kw.wantsMeseros).toBe(true)
    expect(kw.wantsHistory).toBe(false)
  })

  it('"tendencia" triggers wantsHistory', () => {
    const kw = detectKeywords('cual es la tendencia')
    expect(kw.wantsHistory).toBe(true)
  })

  it('"margen" triggers wantsFoodCost', () => {
    const kw = detectKeywords('cual es el margen de ganancia')
    expect(kw.wantsFoodCost).toBe(true)
  })

  it('"omar" triggers wantsMeseros (mesero name)', () => {
    const kw = detectKeywords('cuanto vendio omar')
    expect(kw.wantsMeseros).toBe(true)
  })

  it('"crack" triggers wantsMeseros (slang for best)', () => {
    const kw = detectKeywords('quien es el crack')
    expect(kw.wantsMeseros).toBe(true)
  })

  it('"pizza" triggers wantsDetail (menu item)', () => {
    const kw = detectKeywords('cuantas pizzas vendimos')
    expect(kw.wantsDetail).toBe(true)
  })

  it('neutral question does not trigger anything', () => {
    const kw = detectKeywords('hola como estas')
    expect(kw.wantsHistory).toBe(false)
    expect(kw.wantsDetail).toBe(false)
    expect(kw.wantsMeseros).toBe(false)
    expect(kw.wantsFoodCost).toBe(false)
  })

  it('"abril" triggers wantsHistory (month name used as history signal)', () => {
    const kw = detectKeywords('como estuvo abril')
    expect(kw.wantsHistory).toBe(true)
  })
})

describe('Chat Data Pipeline — food cost formatting', () => {
  it('calculates overall food cost percentage', () => {
    const items = [
      { subtotal_venta: 10000, costo_real: 3000 },
      { subtotal_venta: 5000, costo_real: 2000 },
    ]
    const { totalVentas, totalCosto, overallPct } = calculateOverallFoodCost(items)
    expect(totalVentas).toBe(15000)
    expect(totalCosto).toBe(5000)
    expect(overallPct).toBeCloseTo(33.33, 1)
  })

  it('handles zero ventas gracefully', () => {
    const { overallPct } = calculateOverallFoodCost([{ subtotal_venta: 0, costo_real: 0 }])
    expect(overallPct).toBe(0)
  })

  it('calculates per-platillo costoUnit = costo_real / cantidad', () => {
    const item = { platillo: 'CHILAQUILES', cantidad: 22, subtotal_venta: 5490, costo_real: 1100, costo_real_pct: 20, costo_ideal_pct: 18, grupo: 'CHILAQUILES & ENCHILADAS' }
    const result = formatFoodCostItem(item)
    expect(result.costoUnit).toBe(50) // 1100/22 = 50
    expect(result.precioUnit).toBe(250) // 5490/22 ≈ 249.5 → 250
  })

  it('handles zero quantity (no division by zero)', () => {
    const item = { platillo: 'RARE ITEM', cantidad: 0, subtotal_venta: 0, costo_real: 0, costo_real_pct: 0, costo_ideal_pct: 0, grupo: 'VARIOS' }
    const result = formatFoodCostItem(item)
    expect(result.costoUnit).toBe(0)
    expect(result.precioUnit).toBe(0)
  })

  it('uses platillo field over nombre field', () => {
    const item = { platillo: 'LATTE', nombre: 'should not use', cantidad: 10, subtotal_venta: 1000, costo_real: 300, costo_real_pct: 30, costo_ideal_pct: 25, grupo: 'COFFEE' }
    const result = formatFoodCostItem(item)
    expect(result.nombre).toBe('LATTE')
  })

  it('falls back to nombre when platillo is missing', () => {
    const item = { nombre: 'CAPPUCCINO', cantidad: 5, subtotal_venta: 500, costo_real: 150, costo_real_pct: 30, costo_ideal_pct: 28, grupo: 'COFFEE' }
    const result = formatFoodCostItem(item)
    expect(result.nombre).toBe('CAPPUCCINO')
  })

  it('falls back to "Sin nombre" when both are missing', () => {
    const item = { cantidad: 1, subtotal_venta: 100, costo_real: 50, costo_real_pct: 50, costo_ideal_pct: 45, grupo: '' }
    const result = formatFoodCostItem(item)
    expect(result.nombre).toBe('Sin nombre')
  })

  it('sorts food cost items by venta total descending', () => {
    const items = [
      { platillo: 'LOW', subtotal_venta: 1000, costo_real: 300 },
      { platillo: 'HIGH', subtotal_venta: 9000, costo_real: 2700 },
      { platillo: 'MID', subtotal_venta: 5000, costo_real: 1500 },
    ]
    const sorted = [...items].sort((a, b) => Number(b.subtotal_venta) - Number(a.subtotal_venta))
    expect(sorted[0].platillo).toBe('HIGH')
    expect(sorted[1].platillo).toBe('MID')
    expect(sorted[2].platillo).toBe('LOW')
  })
})

describe('Chat Data Pipeline — aggregation logic', () => {
  const sampleDays = [
    { fecha: '2026-06-01', ventas_dia: 50000, personas_restaurant: 120, tickets_count: 80 },
    { fecha: '2026-06-02', ventas_dia: 45000, personas_restaurant: 110, tickets_count: 75 },
    { fecha: '2026-06-03', ventas_dia: 55000, personas_restaurant: 130, tickets_count: 90 },
  ]

  it('monthly sum: total ventas', () => {
    const total = sumField(sampleDays, 'ventas_dia')
    expect(total).toBe(150000)
  })

  it('monthly sum: total personas', () => {
    const total = sumField(sampleDays, 'personas_restaurant')
    expect(total).toBe(360)
  })

  it('weekly average = total / days', () => {
    const total = sumField(sampleDays, 'ventas_dia')
    const avg = Math.round(total / sampleDays.length)
    expect(avg).toBe(50000)
  })

  it('ticket promedio = ventas / personas (NOT ventas / tickets)', () => {
    const ventas = sumField(sampleDays, 'ventas_dia')
    const personas = sumField(sampleDays, 'personas_restaurant')
    const tickets = sumField(sampleDays, 'tickets_count')
    const tpPersonas = computeTicketPromedio(ventas, personas)
    const tpTickets = computeTicketPromedio(ventas, tickets)
    // Correct: per persona
    expect(tpPersonas).toBe(417) // 150000/360 ≈ 416.67 → 417
    // Wrong: per ticket (would give different value)
    expect(tpTickets).toBe(612) // 150000/245 ≈ 612.24 → 612
    expect(tpPersonas).not.toBe(tpTickets) // confirms they differ
  })

  it('ticket promedio returns 0 when personas is 0', () => {
    expect(computeTicketPromedio(50000, 0)).toBe(0)
  })

  it('sumField handles missing fields gracefully', () => {
    const data = [
      { fecha: '2026-06-01', ventas_dia: 5000 },
      { fecha: '2026-06-02' },
    ]
    expect(sumField(data, 'ventas_dia')).toBe(5000)
  })

  it('month filter by prefix works correctly', () => {
    const allDays = [
      { fecha: '2026-05-28', ventas_dia: 40000 },
      { fecha: '2026-05-31', ventas_dia: 42000 },
      { fecha: '2026-06-01', ventas_dia: 50000 },
      { fecha: '2026-06-02', ventas_dia: 45000 },
    ]
    const juneData = allDays.filter(d => d.fecha.startsWith('2026-06'))
    const mayData = allDays.filter(d => d.fecha.startsWith('2026-05'))
    expect(sumField(juneData, 'ventas_dia')).toBe(95000)
    expect(sumField(mayData, 'ventas_dia')).toBe(82000)
  })

  it('day-of-week name calculation is correct', () => {
    const dowNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    // 2026-06-09 is a Tuesday
    const dow = new Date('2026-06-09T12:00:00').getDay()
    expect(dowNames[dow]).toBe('martes')
  })

  it('per-line ticket promedio uses per-day personas, not tickets', () => {
    const d = { ventas_dia: 60000, personas_restaurant: 150, tickets_count: 100 }
    const ventasDia = Number(d.ventas_dia)
    const personas = Number(d.personas_restaurant)
    const tp = personas > 0 ? Math.round(ventasDia / personas) : 0
    expect(tp).toBe(400) // 60000/150 = 400
  })
})
