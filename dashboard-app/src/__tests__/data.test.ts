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

// getActiveClientSlug falls back to process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID in Node env
process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'amalay'

beforeEach(() => localStorageMock.clear())

// ─── Import after mocking ─────────────────────────────────────────────────

import {
  getActiveClientSlug,
  aggregatePayments,
  aggregateMeseros,
  aggregateGrupos,
} from '@/lib/data'

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

// ─── getActiveClientSlug ──────────────────────────────────────────────────

describe('getActiveClientSlug', () => {
  it('returns "amalay" when no localStorage value', () => {
    expect(getActiveClientSlug()).toBe('amalay')
  })

  it('returns "amalay" in Node env (no window)', () => {
    // In Node test environment, typeof window === 'undefined', so it always returns 'amalay'
    localStorageMock.setItem('fullsite_client_id', 'testclient')
    // The function checks typeof window first, returns 'amalay' in SSR/Node
    expect(getActiveClientSlug()).toBe('amalay')
  })

  it('returns "amalay" regardless of localStorage in Node env', () => {
    localStorageMock.setItem('fullsite_client_id', 'client1')
    expect(getActiveClientSlug()).toBe('amalay')
    localStorageMock.setItem('fullsite_client_id', 'client2')
    expect(getActiveClientSlug()).toBe('amalay')
  })

  it('returns "amalay" after clearing localStorage in Node env', () => {
    localStorageMock.setItem('fullsite_client_id', 'myclient')
    localStorageMock.clear()
    expect(getActiveClientSlug()).toBe('amalay')
  })
})

// ─── aggregatePayments ────────────────────────────────────────────────────

describe('aggregatePayments', () => {
  // CONTRATO (verificado contra prod en 0769a8f3 / PR #35):
  // `pago_métodos[].total` es SIEMPRE un monto en MXN. El porcentaje vive en un
  // campo `pct` aparte. Cero filas del dataset están bajo 100.
  //
  // Estos tests codificaban el heurístico viejo `total < 100 ? (total/100)*ventas_dia : total`,
  // que #35 eliminó por ser una mina latente: multiplicaba por miles cualquier monto
  // real bajo $100 (un día lento, una propina, o un tenant nuevo chico). El commit
  // actualizó chat-data-pipeline y payment-conversion, pero se saltó este archivo y
  // dedup-parserow — quedaron rojos desde el 2026-08-15 defendiendo el bug.

  it('suma los montos MXN tal cual, sin reinterpretarlos', () => {
    const data = [makeDaily({
      ventas_dia: 59258,
      pago_métodos: [
        { nombre: 'Tarjeta de crédito', total: 24888 },
        { nombre: 'Efectivo', total: 17777 },
        { nombre: 'Tarjeta de débito', total: 16593 },
      ],
    })]
    const result = aggregatePayments(data)

    expect(result.find(r => r.nombre === 'Tarjeta de crédito')!.total).toBe(24888)
    expect(result.find(r => r.nombre === 'Efectivo')!.total).toBe(17777)
    expect(result.find(r => r.nombre === 'Tarjeta de débito')!.total).toBe(16593)
  })

  // Ésta es LA prueba del bug que #35 quitó: con el heurístico viejo, $84 de
  // efectivo se convertían en 0.84 * 50000 = $42,000. Es el escenario del día
  // lento y del tenant nuevo chico — el que motivó el fix.
  it('un monto bajo $100 se respeta, NO se trata como porcentaje', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [{ nombre: 'Efectivo', total: 84 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(84)
    expect(result[0].total).not.toBe(Math.round(0.84 * 50000))
  })

  it('handles empty array', () => {
    const result = aggregatePayments([])
    expect(result).toEqual([])
  })

  it('handles days with no payment methods', () => {
    const data = [makeDaily({ pago_métodos: [] })]
    const result = aggregatePayments(data)
    expect(result).toEqual([])
  })

  it('aggregates across multiple days', () => {
    const data = [
      makeDaily({ fecha: '2026-05-20', ventas_dia: 50000, pago_métodos: [{ nombre: 'Efectivo', total: 25000 }] }),
      makeDaily({ fecha: '2026-05-21', ventas_dia: 40000, pago_métodos: [{ nombre: 'Efectivo', total: 24000 }] }),
    ]
    const result = aggregatePayments(data)
    expect(result.find(r => r.nombre === 'Efectivo')!.total).toBe(49000)
  })

  it('sorts results by total descending', () => {
    const data = [makeDaily({
      ventas_dia: 100000,
      pago_métodos: [
        { nombre: 'Transferencia', total: 10000 },
        { nombre: 'Efectivo', total: 50000 },
        { nombre: 'Tarjeta', total: 40000 },
      ],
    })]
    const result = aggregatePayments(data)
    expect(result.map(r => r.nombre)).toEqual(['Efectivo', 'Tarjeta', 'Transferencia'])
  })

  it('skips entries with no nombre', () => {
    const data = [makeDaily({
      ventas_dia: 50000,
      pago_métodos: [
        { nombre: '', total: 25000 },
        { nombre: 'Efectivo', total: 25000 },
      ] as any,
    })]
    const result = aggregatePayments(data)
    expect(result).toHaveLength(1)
    expect(result[0].nombre).toBe('Efectivo')
  })

  // ventas_dia ya no participa en el cálculo; que sea 0 no puede alterar el monto.
  it('handles zero ventas_dia gracefully', () => {
    const data = [makeDaily({
      ventas_dia: 0,
      pago_métodos: [{ nombre: 'Efectivo', total: 1250 }],
    })]
    const result = aggregatePayments(data)
    expect(result[0].total).toBe(1250)
  })

  it('handles single day with multiple payment methods', () => {
    const data = [makeDaily({
      ventas_dia: 80000,
      pago_métodos: [
        { nombre: 'Efectivo', total: 32000 },
        { nombre: 'Tarjeta', total: 48000 },
      ],
    })]
    const result = aggregatePayments(data)
    expect(result.reduce((s, r) => s + r.total, 0)).toBe(80000)
  })
})

// ─── aggregateMeseros ─────────────────────────────────────────────────────

describe('aggregateMeseros', () => {
  it('groups meseros across multiple days', () => {
    const data = [
      makeDaily({
        fecha: '2026-05-20',
        meseros: [
          { nombre: 'Omar Aguilera', total: 12000 },
          { nombre: 'Brayan Berlanga Solis', total: 8000 },
        ],
      }),
      makeDaily({
        fecha: '2026-05-21',
        meseros: [
          { nombre: 'Omar Aguilera', total: 10000 },
          { nombre: 'Julio Cesar', total: 9000 },
        ],
      }),
    ]
    const result = aggregateMeseros(data)

    const omar = result.find(r => r.nombre === 'Omar Aguilera')
    expect(omar).toBeDefined()
    expect(omar!.total).toBe(22000)
    expect(omar!.dias).toBe(2)
    expect(omar!.promedio).toBe(11000)
  })

  it('excludes MESERO EVENTO', () => {
    const data = [makeDaily({
      meseros: [
        { nombre: 'MESERO EVENTO', total: 50000 },
        { nombre: 'Omar Aguilera', total: 12000 },
      ],
    })]
    const result = aggregateMeseros(data)
    expect(result.find(r => r.nombre === 'MESERO EVENTO')).toBeUndefined()
    expect(result).toHaveLength(1)
  })

  it('excludes "Aplicaciones"', () => {
    const data = [makeDaily({
      meseros: [
        { nombre: 'Aplicaciones', total: 15000 },
        { nombre: 'Omar Aguilera', total: 12000 },
      ],
    })]
    const result = aggregateMeseros(data)
    expect(result.find(r => r.nombre.toLowerCase().includes('aplicaciones'))).toBeUndefined()
  })

  it('handles empty meseros array', () => {
    const data = [makeDaily({ meseros: [] })]
    const result = aggregateMeseros(data)
    expect(result).toEqual([])
  })

  it('handles empty dailyData array', () => {
    const result = aggregateMeseros([])
    expect(result).toEqual([])
  })

  it('sorts by total descending', () => {
    const data = [makeDaily({
      meseros: [
        { nombre: 'A', total: 5000 },
        { nombre: 'B', total: 15000 },
        { nombre: 'C', total: 10000 },
      ],
    })]
    const result = aggregateMeseros(data)
    expect(result[0].nombre).toBe('B')
    expect(result[1].nombre).toBe('C')
    expect(result[2].nombre).toBe('A')
  })

  it('calculates correct promedio', () => {
    const data = [
      makeDaily({ fecha: '2026-05-20', meseros: [{ nombre: 'Test', total: 10000 }] }),
      makeDaily({ fecha: '2026-05-21', meseros: [{ nombre: 'Test', total: 20000 }] }),
      makeDaily({ fecha: '2026-05-22', meseros: [{ nombre: 'Test', total: 15000 }] }),
    ]
    const result = aggregateMeseros(data)
    expect(result[0].total).toBe(45000)
    expect(result[0].dias).toBe(3)
    expect(result[0].promedio).toBe(15000)
  })

  it('counts unique days correctly (same day twice)', () => {
    const data = [
      makeDaily({ fecha: '2026-05-20', meseros: [{ nombre: 'Test', total: 5000 }] }),
      makeDaily({ fecha: '2026-05-20', meseros: [{ nombre: 'Test', total: 3000 }] }),
    ]
    const result = aggregateMeseros(data)
    expect(result[0].total).toBe(8000)
    expect(result[0].dias).toBe(1) // same fecha, counted once
    expect(result[0].promedio).toBe(8000)
  })

  it('skips meseros with missing nombre', () => {
    const data = [makeDaily({
      meseros: [
        { nombre: '', total: 5000 } as any,
        { nombre: 'Omar Aguilera', total: 12000 },
      ],
    })]
    const result = aggregateMeseros(data)
    expect(result).toHaveLength(1)
  })

  it('handles meseros with zero total', () => {
    const data = [makeDaily({
      meseros: [{ nombre: 'Nuevo', total: 0 }],
    })]
    const result = aggregateMeseros(data)
    expect(result[0].total).toBe(0)
    expect(result[0].promedio).toBe(0)
  })

  it('excludes known non-staff entries case-insensitively', () => {
    const data = [makeDaily({
      meseros: [
        { nombre: 'oscar ricardo Something', total: 5000 },
        { nombre: 'Rodrigo Chávez Garcia', total: 3000 },
        { nombre: 'Fany Elizabeth Lopez', total: 4000 },
        { nombre: 'Omar Aguilera', total: 12000 },
      ],
    })]
    const result = aggregateMeseros(data)
    expect(result).toHaveLength(1)
    expect(result[0].nombre).toBe('Omar Aguilera')
  })
})

// ─── aggregateGrupos ──────────────────────────────────────────────────────

describe('aggregateGrupos', () => {
  it('groups categories across multiple days', () => {
    const data = [
      makeDaily({
        ventas_por_grupo: [
          { nombre: 'CHILAQUILES & ENCHILADAS', total: 12500 },
          { nombre: 'COFFEE HOT/ICE', total: 8900 },
        ],
      }),
      makeDaily({
        ventas_por_grupo: [
          { nombre: 'CHILAQUILES & ENCHILADAS', total: 10000 },
          { nombre: 'TOAST & BAGELS', total: 4200 },
        ],
      }),
    ]
    const result = aggregateGrupos(data)

    const chilaquiles = result.find(r => r.nombre === 'CHILAQUILES & ENCHILADAS')
    expect(chilaquiles).toBeDefined()
    expect(chilaquiles!.total).toBe(22500)
  })

  it('handles empty array', () => {
    const result = aggregateGrupos([])
    expect(result).toEqual([])
  })

  it('handles days with empty ventas_por_grupo', () => {
    const data = [makeDaily({ ventas_por_grupo: [] })]
    const result = aggregateGrupos(data)
    expect(result).toEqual([])
  })

  it('sorts by total descending', () => {
    const data = [makeDaily({
      ventas_por_grupo: [
        { nombre: 'A', total: 1000 },
        { nombre: 'B', total: 5000 },
        { nombre: 'C', total: 3000 },
      ],
    })]
    const result = aggregateGrupos(data)
    expect(result[0].nombre).toBe('B')
    expect(result[1].nombre).toBe('C')
    expect(result[2].nombre).toBe('A')
  })

  it('skips entries with no nombre', () => {
    const data = [makeDaily({
      ventas_por_grupo: [
        { nombre: '', total: 5000 } as any,
        { nombre: 'COFFEE', total: 3000 },
      ],
    })]
    const result = aggregateGrupos(data)
    expect(result).toHaveLength(1)
  })

  it('handles entries with zero total', () => {
    const data = [makeDaily({
      ventas_por_grupo: [{ nombre: 'EXTRAS', total: 0 }],
    })]
    const result = aggregateGrupos(data)
    expect(result[0].total).toBe(0)
  })

  it('accumulates totals from many days', () => {
    const days = Array.from({ length: 7 }, (_, i) => makeDaily({
      fecha: `2026-05-${20 + i}`,
      ventas_por_grupo: [{ nombre: 'COFFEE', total: 1000 }],
    }))
    const result = aggregateGrupos(days)
    expect(result[0].total).toBe(7000)
  })
})

// ─── parseRow (tested indirectly via getActiveClientSlug and aggregation) ──

describe('parseRow edge cases (via aggregation)', () => {
  it('handles missing meseros field gracefully', () => {
    // aggregateMeseros uses parseJsonbField internally
    const data = [makeDaily({ meseros: undefined as any })]
    const result = aggregateMeseros(data)
    expect(result).toEqual([])
  })

  it('handles meseros as JSON string', () => {
    const data = [makeDaily({
      meseros: JSON.stringify([{ nombre: 'Test', total: 5000 }]) as any,
    })]
    // parseJsonbField should parse the string
    const result = aggregateMeseros(data)
    // The aggregateMeseros calls parseJsonbField internally
    expect(result).toHaveLength(1)
  })

  it('handles null pago_metodos', () => {
    const data = [makeDaily({ pago_métodos: null as any })]
    const result = aggregatePayments(data)
    expect(result).toEqual([])
  })
})
