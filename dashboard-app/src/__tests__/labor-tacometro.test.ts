import { describe, it, expect } from 'vitest'
import {
  isOperationalRole,
  zoneFor,
  buildTacometro,
  DEFAULT_THRESHOLDS,
  type LaborPayload,
} from '@/lib/labor'

describe('isOperationalRole', () => {
  it('incluye roles de operación (mesero, cocina, cajero, gerente)', () => {
    for (const r of ['mesero', 'cocina', 'cajero', 'gerente', 'barra', 'capitan']) {
      expect(isOperationalRole(r)).toBe(true)
    }
  })
  it('excluye corporativo/oficina/mantenimiento/chofer/admin (criterio Billy)', () => {
    for (const r of ['admin', 'Administrador', 'CORPORATIVO', 'oficina', 'mantenimiento', 'chofer', 'contador']) {
      expect(isOperationalRole(r)).toBe(false)
    }
  })
  it('rol vacío/nulo se asume operativo (mejor sobre-contar que ocultar)', () => {
    expect(isOperationalRole(null)).toBe(true)
    expect(isOperationalRole(undefined)).toBe(true)
    expect(isOperationalRole('')).toBe(true)
  })
})

describe('zoneFor', () => {
  it('clasifica por umbrales por defecto (22% / 30%)', () => {
    expect(zoneFor(0.14)).toBe('verde')     // fast food sano
    expect(zoneFor(0.22)).toBe('verde')     // borde verde inclusivo
    expect(zoneFor(0.27)).toBe('amarillo')  // atención
    expect(zoneFor(0.30)).toBe('amarillo')  // borde amarillo inclusivo
    expect(zoneFor(0.37)).toBe('rojo')      // fuera de rango
  })
  it('sin dato para null/negativo/NaN/Infinity', () => {
    expect(zoneFor(null)).toBe('sin-dato')
    expect(zoneFor(-0.1)).toBe('sin-dato')
    expect(zoneFor(NaN)).toBe('sin-dato')
    expect(zoneFor(Infinity)).toBe('sin-dato')
  })
  it('respeta umbrales personalizados', () => {
    expect(zoneFor(0.16, { green: 0.15, yellow: 0.20 })).toBe('amarillo')
  })
})

describe('buildTacometro', () => {
  const labor: LaborPayload = {
    days: 2,
    laborByDay: [
      { fecha: '2026-08-10', cost: 1500, hours: 30, headcount: 3 },
      { fecha: '2026-08-11', cost: 3000, hours: 30, headcount: 3 }, // venta baja → rojo
    ],
    employees: [
      { staff_id: 's1', name: 'Ana', role: 'cajero', hours: 40, cost: 2500 },
      { staff_id: 's2', name: 'Beto', role: 'mesero', hours: 20, cost: 2000 },
    ],
    totalCost: 4500,
    totalHours: 60,
    hasWageData: true,
  }
  const sales = [
    { fecha: '2026-08-10', ventas_dia: 15000 }, // 10% → verde
    { fecha: '2026-08-11', ventas_dia: 8000 },  // 37.5% → rojo
  ]

  it('cruza labor con venta y calcula % y zona por día', () => {
    const t = buildTacometro(labor, sales, DEFAULT_THRESHOLDS)
    expect(t.days).toHaveLength(2)
    expect(t.days[0].pct).toBeCloseTo(0.10, 5)
    expect(t.days[0].zone).toBe('verde')
    expect(t.days[1].pct).toBeCloseTo(0.375, 5)
    expect(t.days[1].zone).toBe('rojo')
  })

  it('totaliza costo/venta y saca el % y zona globales', () => {
    const t = buildTacometro(labor, sales, DEFAULT_THRESHOLDS)
    expect(t.totalCost).toBe(4500)
    expect(t.totalSales).toBe(23000)
    expect(t.pct).toBeCloseTo(4500 / 23000, 5) // ~19.6% → verde
    expect(t.zone).toBe('verde')
  })

  it('pct null (sin-dato) cuando la venta del día es 0', () => {
    const t = buildTacometro(labor, [{ fecha: '2026-08-10', ventas_dia: 0 }], DEFAULT_THRESHOLDS)
    const d = t.days.find(x => x.fecha === '2026-08-10')!
    expect(d.pct).toBeNull()
    expect(d.zone).toBe('sin-dato')
  })

  it('ordena los días ascendente por fecha', () => {
    const t = buildTacometro(labor, sales)
    expect(t.days.map(d => d.fecha)).toEqual(['2026-08-10', '2026-08-11'])
  })
})
