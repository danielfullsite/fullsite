import { describe, it, expect } from 'vitest'
import {
  parseDateFilter,
  buildDailyContext,
  buildWaiterContext,
  needsExtendedHistory,
  type DailyRow,
  type WaiterCategoryRow,
} from '@/lib/chat-context'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-05-10'

function makeDailyRow(overrides: Partial<DailyRow> = {}): DailyRow {
  return {
    fecha: '2026-05-09',
    ventas_dia: 45000,
    ventas_brutas: 48000,
    descuentos: 3000,
    tickets_count: 85,
    personas_restaurant: 120,
    ticket_promedio_restaurant: 400,
    efectivo: 15000,
    tarjeta: 28000,
    meseros: [
      { nombre: 'Julio Cesar', total: 12000 },
      { nombre: 'Brayan Berlanga', total: 9500 },
      { nombre: 'Omar Aguilera', total: 8200 },
    ],
    ventas_por_grupo: [
      { nombre: 'CHILAQUILES & ENCHILADAS', total: 12500 },
      { nombre: 'COFFEE HOT/ICE', total: 8900 },
      { nombre: 'TOAST & BAGELS', total: 4200 },
    ],
    pago_metodos: [
      { nombre: 'Tarjeta de crédito', total: 20000 },
      { nombre: 'Efectivo', total: 15000 },
      { nombre: 'Transferencia electrónica', total: 5000 },
    ],
    platillos_top: [
      { nombre: 'CHILAQUILES VERDES', cantidad: 25, total: 5250 },
      { nombre: 'HALF HALF COMBO', cantidad: 18, total: 3600 },
      { nombre: 'LATTE', cantidad: 40, total: 3200 },
    ],
    ...overrides,
  }
}

function makeWaiterRow(overrides: Partial<WaiterCategoryRow> = {}): WaiterCategoryRow {
  return {
    fecha: '2026-05-09',
    data: {
      'Julio Cesar': {
        KPIs: { bebidas_total: 3500, alimentos_total: 8500, personas: 30, tickets: 18 },
        'H&H': { qty: 12, total: 2400 },
        '2da Bebida': { qty: 5, total: 350 },
        'Pan': { qty: 8, total: 560 },
        'Postres': { qty: 3, total: 450 },
      },
      'Brayan Berlanga': {
        KPIs: { bebidas_total: 2800, alimentos_total: 6700, personas: 25, tickets: 14 },
        'H&H': { qty: 6, total: 1200 },
        '2da Bebida': { qty: 2, total: 140 },
        'Pan': { qty: 4, total: 280 },
        'Postres': { qty: 0, total: 0 },
      },
      // Excluded name - should NOT appear in rankings
      'MESERO EVENTO': {
        KPIs: { bebidas_total: 500, alimentos_total: 1000, personas: 5, tickets: 3 },
        'H&H': { qty: 1, total: 200 },
      },
      __por_mesero_grupo: {
        'Julio Cesar': { 'COFFEE': { qty: 15, total: 1500 } },
      },
      __por_mesero_platillo: {
        'Julio Cesar': { 'LATTE': { qty: 10, total: 800 } },
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseDateFilter
// ---------------------------------------------------------------------------

describe('parseDateFilter', () => {
  it('returns null when no date signal in query', () => {
    expect(parseDateFilter('cuanto vendimos de chilaquiles', TODAY)).toBeNull()
  })

  it('BUG: "mesero" triggers "mes" keyword (known false positive)', () => {
    // "mesero" contains "mes" so it matches month-to-date.
    // Documenting current behavior — fix would require word-boundary matching.
    const result = parseDateFilter('quien es el mejor mesero', TODAY)
    expect(result).toEqual({ start: '2026-05-01', end: '2026-05-10' })
  })

  it('parses "hoy"', () => {
    expect(parseDateFilter('como vamos hoy', TODAY)).toEqual({
      start: '2026-05-10',
      end: '2026-05-10',
    })
  })

  it('parses "ayer"', () => {
    expect(parseDateFilter('ventas de ayer', TODAY)).toEqual({
      start: '2026-05-09',
      end: '2026-05-09',
    })
  })

  it('parses "semana"', () => {
    const result = parseDateFilter('resumen de la semana', TODAY)
    expect(result).not.toBeNull()
    expect(result!.end).toBe('2026-05-10')
    expect(result!.start).toBe('2026-05-03')
  })

  it('parses "mes" (month-to-date)', () => {
    const result = parseDateFilter('ventas del mes', TODAY)
    expect(result).toEqual({ start: '2026-05-01', end: '2026-05-10' })
  })

  it('parses single month name "abril"', () => {
    const result = parseDateFilter('como nos fue en abril', TODAY)
    expect(result).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('parses explicit range "1 de mayo a 18 de mayo"', () => {
    const result = parseDateFilter('ventas del 1 de mayo a 18 de mayo', TODAY)
    expect(result).toEqual({ start: '2026-05-01', end: '2026-05-18' })
  })

  it('parses compact range "del 5 al 12 de mayo"', () => {
    const result = parseDateFilter('reporte del 5 al 12 de mayo', TODAY)
    expect(result).toEqual({ start: '2026-05-05', end: '2026-05-12' })
  })

  it('parses cross-month range "1 de abril a 15 de mayo"', () => {
    const result = parseDateFilter('ventas del 1 de abril a 15 de mayo', TODAY)
    expect(result).toEqual({ start: '2026-04-01', end: '2026-05-15' })
  })

  it('handles febrero (28/29 days) correctly', () => {
    const result = parseDateFilter('febrero', '2026-03-15')
    expect(result).toEqual({ start: '2026-02-01', end: '2026-02-28' })
  })
})

// ---------------------------------------------------------------------------
// buildDailyContext
// ---------------------------------------------------------------------------

describe('buildDailyContext', () => {
  it('returns placeholder when no data', () => {
    expect(buildDailyContext([])).toBe('No hay datos disponibles.')
  })

  it('returns placeholder for null/undefined', () => {
    expect(buildDailyContext(null as unknown as DailyRow[])).toBe('No hay datos disponibles.')
    expect(buildDailyContext(undefined as unknown as DailyRow[])).toBe('No hay datos disponibles.')
  })

  it('includes chilaquiles in Grupos when present', () => {
    const ctx = buildDailyContext([makeDailyRow()])
    expect(ctx).toContain('CHILAQUILES & ENCHILADAS')
    expect(ctx).toContain('$12500')
  })

  it('includes HALF HALF COMBO in Platillos when present', () => {
    const ctx = buildDailyContext([makeDailyRow()])
    expect(ctx).toContain('HALF HALF COMBO')
    expect(ctx).toContain('18pzas')
  })

  it('includes pago_metodos breakdown', () => {
    const ctx = buildDailyContext([makeDailyRow()])
    expect(ctx).toContain('Pagos:')
    expect(ctx).toContain('Tarjeta de crédito:$20000')
    expect(ctx).toContain('Efectivo:$15000')
    expect(ctx).toContain('Transferencia electrónica:$5000')
  })

  it('includes mesero rankings', () => {
    const ctx = buildDailyContext([makeDailyRow()])
    expect(ctx).toContain('Meseros:')
    expect(ctx).toContain('Julio Cesar:$12000')
    expect(ctx).toContain('Brayan Berlanga:$9500')
  })

  it('includes descuentos when > 0', () => {
    const ctx = buildDailyContext([makeDailyRow({ descuentos: 1500 })])
    expect(ctx).toContain('Descuentos $1500')
  })

  it('omits descuentos value in data line when 0', () => {
    const ctx = buildDailyContext([makeDailyRow({ descuentos: 0 })])
    // The word "Descuentos" appears in the header, but the data line should NOT have "Descuentos $0"
    const dataLine = ctx.split('\n').find(l => l.startsWith('2026-05-09'))!
    expect(dataLine).not.toContain('Descuentos')
  })

  it('handles meseros as JSON string', () => {
    const row = makeDailyRow({
      meseros: JSON.stringify([{ nombre: 'Omar', total: 5000 }]),
    })
    const ctx = buildDailyContext([row])
    expect(ctx).toContain('Omar:$5000')
  })

  it('handles empty JSONB arrays gracefully', () => {
    const row = makeDailyRow({
      meseros: [],
      ventas_por_grupo: [],
      pago_metodos: [],
      platillos_top: [],
    })
    const ctx = buildDailyContext([row])
    expect(ctx).toContain('2026-05-09')
    expect(ctx).toContain('Ventas $45000')
    // Should not crash — just have empty sections
    expect(ctx).not.toContain('undefined')
  })

  it('handles null JSONB fields gracefully', () => {
    const row = makeDailyRow({
      meseros: undefined as unknown as string,
      ventas_por_grupo: null as unknown as string,
      pago_metodos: undefined as unknown as string,
      platillos_top: undefined as unknown as string,
    })
    // Should not throw
    const ctx = buildDailyContext([row])
    expect(ctx).toContain('2026-05-09')
  })

  it('handles multiple days', () => {
    const rows = [
      makeDailyRow({ fecha: '2026-05-09', ventas_dia: 45000 }),
      makeDailyRow({ fecha: '2026-05-08', ventas_dia: 38000 }),
    ]
    const ctx = buildDailyContext(rows)
    expect(ctx).toContain('últimos 2 días')
    expect(ctx).toContain('2026-05-09')
    expect(ctx).toContain('2026-05-08')
  })

  it('handles malformed JSON string in meseros', () => {
    const row = makeDailyRow({ meseros: 'not-json' })
    // Should not throw
    const ctx = buildDailyContext([row])
    expect(ctx).toContain('2026-05-09')
  })

  it('sorts meseros by total descending (top 5)', () => {
    const row = makeDailyRow({
      meseros: [
        { nombre: 'Low', total: 1000 },
        { nombre: 'High', total: 9000 },
        { nombre: 'Mid', total: 5000 },
      ],
    })
    const ctx = buildDailyContext([row])
    const meseroSection = ctx.split('Meseros:')[1].split('|')[0]
    const highIdx = meseroSection.indexOf('High')
    const midIdx = meseroSection.indexOf('Mid')
    const lowIdx = meseroSection.indexOf('Low')
    expect(highIdx).toBeLessThan(midIdx)
    expect(midIdx).toBeLessThan(lowIdx)
  })
})

// ---------------------------------------------------------------------------
// buildWaiterContext
// ---------------------------------------------------------------------------

describe('buildWaiterContext', () => {
  it('returns empty string when no data', () => {
    expect(buildWaiterContext([])).toBe('')
    expect(buildWaiterContext(null as unknown as WaiterCategoryRow[])).toBe('')
  })

  it('includes H&H ranking', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('RANKING H&H POR MESERO')
    expect(ctx).toContain('Julio Cesar: 12 pzas ($2400)')
    expect(ctx).toContain('Brayan Berlanga: 6 pzas ($1200)')
  })

  it('includes 2da Bebida ranking', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('RANKING 2DA BEBIDA POR MESERO')
    expect(ctx).toContain('Julio Cesar: 5 pzas')
  })

  it('includes Bebidas/persona ranking', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('RANKING BEBIDAS POR PERSONA')
    // Julio: 3500/30 = 116.67
    expect(ctx).toContain('Julio Cesar: 116.67')
  })

  it('includes Pan ranking', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('RANKING PAN/TOAST/BAGEL POR MESERO')
    expect(ctx).toContain('Julio Cesar: 8 pzas ($560)')
  })

  it('includes Postres ranking (only non-zero)', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('RANKING POSTRES POR MESERO')
    expect(ctx).toContain('Julio Cesar: 3 pzas ($450)')
    // Brayan has 0 postres — should NOT appear in postres ranking
    expect(ctx).not.toMatch(/Brayan Berlanga.*\n.*RANKING POSTRES/)
  })

  it('excludes MESERO EVENTO from rankings', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    // MESERO EVENTO should not appear in any ranking line
    const rankingLines = ctx.split('\n').filter(l => l.startsWith('  '))
    const eventoLines = rankingLines.filter(l => l.includes('MESERO EVENTO'))
    expect(eventoLines).toHaveLength(0)
  })

  it('includes per-day category breakdown', () => {
    const ctx = buildWaiterContext([makeWaiterRow()])
    expect(ctx).toContain('DESGLOSE POR DIA Y CATEGORIA')
    expect(ctx).toContain('2026-05-09')
    expect(ctx).toContain('H&H')
  })

  it('aggregates across multiple days', () => {
    const day1 = makeWaiterRow({ fecha: '2026-05-08' })
    const day2 = makeWaiterRow({ fecha: '2026-05-09' })
    const ctx = buildWaiterContext([day1, day2])
    // H&H should be doubled: 12*2 = 24
    expect(ctx).toContain('Julio Cesar: 24 pzas ($4800)')
    // Both dates should appear
    expect(ctx).toContain('2026-05-08')
    expect(ctx).toContain('2026-05-09')
  })

  it('handles data as JSON string', () => {
    const row = makeWaiterRow()
    row.data = JSON.stringify(row.data)
    const ctx = buildWaiterContext([row])
    expect(ctx).toContain('RANKING H&H POR MESERO')
    expect(ctx).toContain('Julio Cesar')
  })

  it('handles row with empty data object', () => {
    const row: WaiterCategoryRow = { fecha: '2026-05-09', data: {} }
    // Should not throw
    const ctx = buildWaiterContext([row])
    expect(ctx).toContain('2026-05-09')
  })

  it('handles missing __por_mesero_grupo gracefully', () => {
    const row = makeWaiterRow()
    const data = typeof row.data === 'string' ? JSON.parse(row.data as string) : row.data
    delete data.__por_mesero_grupo
    delete data.__por_mesero_platillo
    row.data = data
    // Should not throw
    const ctx = buildWaiterContext([row])
    expect(ctx).toContain('Julio Cesar')
  })
})

// ---------------------------------------------------------------------------
// needsExtendedHistory
// ---------------------------------------------------------------------------

describe('needsExtendedHistory', () => {
  it('returns true for "historial"', () => {
    expect(needsExtendedHistory('muéstrame el historial')).toBe(true)
  })

  it('returns true for "tendencia"', () => {
    expect(needsExtendedHistory('cuál es la tendencia de ventas')).toBe(true)
  })

  it('returns true for "semana"', () => {
    expect(needsExtendedHistory('ventas de la semana')).toBe(true)
  })

  it('returns true for "mes"', () => {
    expect(needsExtendedHistory('reporte del mes')).toBe(true)
  })

  it('returns true for "año pasado"', () => {
    expect(needsExtendedHistory('compara con año pasado')).toBe(true)
  })

  it('returns true for "yoy"', () => {
    expect(needsExtendedHistory('dame el yoy de mayo')).toBe(true)
  })

  it('returns false for simple today query', () => {
    expect(needsExtendedHistory('como vamos hoy')).toBe(false)
  })

  it('returns false for simple query without history keywords', () => {
    expect(needsExtendedHistory('cuanto vendimos de chilaquiles')).toBe(false)
  })

  it('BUG: "mesero" triggers "mes" keyword (false positive)', () => {
    // "mesero" contains substring "mes", triggering extended history unnecessarily.
    expect(needsExtendedHistory('quien es el mejor mesero')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(needsExtendedHistory('HISTORIAL de ventas')).toBe(true)
    expect(needsExtendedHistory('TENDENCIA semanal')).toBe(true)
  })
})
