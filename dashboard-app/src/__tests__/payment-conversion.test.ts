import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WansoftDaily } from '@/lib/types'

// ─── localStorage mock ────────────────────────────────────────────────────

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => localStorageMock.clear())

import { aggregatePayments } from '@/lib/data'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeDaily(overrides: Partial<WansoftDaily> = {}): WansoftDaily {
  return {
    fecha: '2026-05-20',
    ventas_dia: 50000,
    ventas_brutas: 55000,
    descuentos: 5000,
    devoluciones: 0,
    tickets_count: 80,
    personas_restaurant: 100,
    ticket_promedio_restaurant: 500,
    efectivo: 20000,
    tarjeta: 30000,
    mesas_atendidas: 25,
    ordenes_llevar: 5,
    propinas_total: 3000,
    meseros: [],
    platillos_top: [],
    ventas_por_grupo: [],
    pago_métodos: [],
    ...overrides,
  }
}

// ─── aggregatePayments ───────────────────────────────────────────────────

describe('aggregatePayments', () => {
  it('returns empty array for empty input', () => {
    expect(aggregatePayments([])).toEqual([])
  })

  it('returns empty array when no pago_métodos', () => {
    const data = [makeDaily({ pago_métodos: [] })]
    expect(aggregatePayments(data)).toEqual([])
  })

  it('treats total as raw MXN amount', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [{ nombre: 'Efectivo', total: 21000 }],
    })]
    const result = aggregatePayments(data)
    expect(result).toHaveLength(1)
    expect(result[0].nombre).toBe('Efectivo')
    expect(result[0].total).toBe(21000)
  })

  it('sums multiple MXN methods correctly', () => {
    const data = [makeDaily({
      ventas_dia: 100000,
      pago_métodos: [
        { nombre: 'Tarjeta de crédito', total: 42000 },
        { nombre: 'Tarjeta de débito', total: 24900 },
        { nombre: 'Efectivo', total: 25100 },
        { nombre: 'Transferencia electrónica', total: 8000 },
      ],
    })]
    const result = aggregatePayments(data)
    const credito = result.find(r => r.nombre === 'Tarjeta de crédito')
    expect(credito?.total).toBe(42000)
    const debito = result.find(r => r.nombre === 'Tarjeta de débito')
    expect(debito?.total).toBe(24900)
    const efectivo = result.find(r => r.nombre === 'Efectivo')
    expect(efectivo?.total).toBe(25100)
    const transferencia = result.find(r => r.nombre === 'Transferencia electrónica')
    expect(transferencia?.total).toBe(8000)
  })

  it('treats large values as MXN', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [{ nombre: 'Efectivo', total: 25000 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(25000)
  })

  it('value of exactly 100 is treated as MXN', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [{ nombre: 'Efectivo', total: 100 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(100)
  })

  it('handles 0 ventas_dia', () => {
    const data = [makeDaily({
      ventas_dia: 0,
      pago_métodos: [{ nombre: 'Efectivo', total: 500 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(500)
  })

  it('aggregates across multiple days', () => {
    const data = [
      makeDaily({
        ventas_dia: 50000,
        pago_métodos: [{ nombre: 'Efectivo', total: 20000 }],
      }),
      makeDaily({
        fecha: '2026-05-21',
        ventas_dia: 60000,
        pago_métodos: [{ nombre: 'Efectivo', total: 30000 }],
      }),
    ]
    const result = aggregatePayments(data)
    // Day 1: 20000, Day 2: 30000, Total: 50000
    expect(result[0].total).toBe(50000)
  })

  it('aggregates same method name across days', () => {
    const data = [
      makeDaily({
        ventas_dia: 100000,
        pago_métodos: [
          { nombre: 'Tarjeta de crédito', total: 60000 },
          { nombre: 'Efectivo', total: 40000 },
        ],
      }),
      makeDaily({
        fecha: '2026-05-21',
        ventas_dia: 80000,
        pago_métodos: [
          { nombre: 'Tarjeta de crédito', total: 40000 },
          { nombre: 'Efectivo', total: 40000 },
        ],
      }),
    ]
    const result = aggregatePayments(data)
    // Credito: 60000 + 40000 = 100000
    const credito = result.find(r => r.nombre === 'Tarjeta de crédito')
    expect(credito?.total).toBe(100000)
    // Efectivo: 40000 + 40000 = 80000
    const efectivo = result.find(r => r.nombre === 'Efectivo')
    expect(efectivo?.total).toBe(80000)
  })

  it('results are sorted by total descending', () => {
    const data = [makeDaily({
      ventas_dia: 100000,
      pago_métodos: [
        { nombre: 'Transferencia', total: 10000 },
        { nombre: 'Tarjeta', total: 60000 },
        { nombre: 'Efectivo', total: 30000 },
      ],
    })]
    const result = aggregatePayments(data)
    expect(result[0].nombre).toBe('Tarjeta')
    expect(result[1].nombre).toBe('Efectivo')
    expect(result[2].nombre).toBe('Transferencia')
  })

  it('results are rounded to integers', () => {
    const data = [makeDaily({
      ventas_dia: 33333,
      pago_métodos: [{ nombre: 'Efectivo', total: 11110.0889 }],
    })]
    const result = aggregatePayments(data)
    // 11110.0889 → rounded to 11110
    expect(result[0].total).toBe(11110)
  })

  it('skips entries without nombre', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [
        { nombre: '', total: 50.0 },
        { nombre: 'Efectivo', total: 50.0 },
      ],
    })]
    const result = aggregatePayments(data)
    expect(result).toHaveLength(1)
    expect(result[0].nombre).toBe('Efectivo')
  })

  it('handles undefined total in payment method', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [{ nombre: 'Efectivo' }] as any,
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(0)
  })

  it('handles null pago_métodos', () => {
    const data = [makeDaily({
      pago_métodos: null as any,
    })]
    const result = aggregatePayments(data)
    expect(result).toEqual([])
  })

  it('handles pago_métodos as JSON string', () => {
    const data = [makeDaily({
      ventas_dia: 100000,
      pago_métodos: JSON.stringify([{ nombre: 'Efectivo', total: 50000 }]) as any,
    })]
    const result = aggregatePayments(data)
    expect(result[0].nombre).toBe('Efectivo')
    expect(result[0].total).toBe(50000)
  })

  it('handles a single day with a single method', () => {
    const data = [makeDaily({
      ventas_dia: 75000,
      pago_métodos: [{ nombre: 'Efectivo', total: 74925 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(74925)
  })

  it('handles Ubereats as a payment method', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [
        { nombre: 'Efectivo', total: 20000 },
        { nombre: 'Ubereats', total: 5000 },
      ],
    })]
    const result = aggregatePayments(data)
    const uber = result.find(r => r.nombre === 'Ubereats')
    expect(uber?.total).toBe(5000)
  })

  it('handles 7 days of data correctly', () => {
    const data = Array.from({ length: 7 }, (_, i) =>
      makeDaily({
        fecha: `2026-05-${20 + i}`,
        ventas_dia: 50000,
        pago_métodos: [{ nombre: 'Efectivo', total: 25000 }],
      })
    )
    const result = aggregatePayments(data)
    // 25000 * 7 = 175000
    expect(result[0].total).toBe(175000)
  })

  it('handles mixed small and large MXN values across days', () => {
    const data = [
      makeDaily({
        ventas_dia: 50000,
        pago_métodos: [{ nombre: 'Efectivo', total: 20000 }],
      }),
      makeDaily({
        fecha: '2026-05-21',
        ventas_dia: 50000,
        pago_métodos: [{ nombre: 'Efectivo', total: 500 }],
      }),
    ]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(20500)
  })

  it('handles small MXN values', () => {
    const data = [makeDaily({
      ventas_dia: 100000,
      pago_métodos: [{ nombre: 'Otro', total: 500 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(500)
  })
})
