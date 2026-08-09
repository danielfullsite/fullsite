import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── W1-B — ledger canónico: idempotencia por columna, sin clamp, dos piernas ─
//
// Cubre el contrato nuevo de recordMovement()/recordTransfer():
//   1. Idempotencia por columna idempotency_key (match exacto, no LIKE en notes)
//   2. Carrera entre procesos: INSERT 409 (UNIQUE en BD) → duplicado exitoso
//   3. Sin clamp a cero: el stock sigue la cantidad exacta (reconstruibilidad),
//      cruzar bajo cero emite alerta underflow_prevented (detección, no bloqueo)
//   4. Promedio ponderado intacto en entradas
//   5. opening_balance es tipo entrada válido
//   6. Transferencia: dos piernas balanceadas con keys derivadas _out/_in;
//      retry tras falla parcial completa la pierna faltante sin duplicar

import {
  recordMovement,
  recordTransfer,
  type MovementRequest,
} from '@/lib/inventory'

interface MockState {
  existingKeys: Set<string>
  stock: Record<string, number>
  cost: Record<string, number>
  insertedMovements: Record<string, unknown>[]
  stockPatches: { url: string; body: Record<string, unknown> }[]
  costPatches: { url: string; body: Record<string, unknown> }[]
  failInsertWith409: boolean
  failInsertForKeySuffix: string | null
}

let state: MockState

function mockFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (method === 'GET' && url.includes('/pos_inventory_movements?')) {
      const m = url.match(/idempotency_key=eq\.([^&]+)/)
      const key = m ? decodeURIComponent(m[1]) : ''
      const found = state.existingKeys.has(key)
      return new Response(JSON.stringify(found ? [{ id: 1 }] : []), { status: 200 })
    }
    if (method === 'GET' && url.includes('/pos_inventory?')) {
      const rows = Object.entries(state.stock).map(([ingredient_id, stock], i) => ({ id: i + 1, ingredient_id, stock }))
      return new Response(JSON.stringify(rows), { status: 200 })
    }
    if (method === 'GET' && url.includes('/pos_ingredients?')) {
      const rows = Object.entries(state.cost).map(([id, cost_per_unit]) => ({ id, cost_per_unit }))
      return new Response(JSON.stringify(rows), { status: 200 })
    }
    if (method === 'POST' && url.includes('/pos_inventory_movements')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>[]
      const key = String(body[0]?.idempotency_key ?? '')
      if (state.failInsertWith409) return new Response('duplicate key', { status: 409 })
      if (state.failInsertForKeySuffix && key.endsWith(state.failInsertForKeySuffix)) {
        return new Response('boom', { status: 500 })
      }
      state.insertedMovements.push(...body)
      if (key) state.existingKeys.add(key)
      return new Response(null, { status: 201 })
    }
    if (method === 'PATCH' && url.includes('/pos_inventory?')) {
      state.stockPatches.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH' && url.includes('/pos_ingredients?')) {
      state.costPatches.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 204 })
    }
    return new Response('[]', { status: 200 })
  }) as unknown as typeof fetch
}

const baseReq = (over: Partial<MovementRequest> = {}): MovementRequest => ({
  client_id: 'test-client',
  movement_type: 'waste',
  actor: 'test',
  idempotency_key: 'key-1',
  lines: [{ ingredient_id: 'ing_a', quantity: -5 }],
  ...over,
})

beforeEach(() => {
  state = {
    existingKeys: new Set(),
    stock: { ing_a: 10, ing_b: 0 },
    cost: { ing_a: 10, ing_b: 0 },
    insertedMovements: [],
    stockPatches: [],
    costPatches: [],
    failInsertWith409: false,
    failInsertForKeySuffix: null,
  }
  vi.stubGlobal('fetch', mockFetch())
})

describe('W1-B — idempotencia por columna', () => {
  it('escribe idempotency_key como columna en cada fila del ledger', async () => {
    const r = await recordMovement(baseReq())
    expect(r.success).toBe(true)
    expect(state.insertedMovements[0].idempotency_key).toBe('key-1')
    expect(String(state.insertedMovements[0].notes)).not.toContain('[key:')
  })

  it('pre-check por match exacto: key existente → was_duplicate, cero mutación', async () => {
    state.existingKeys.add('key-1')
    const r = await recordMovement(baseReq())
    expect(r.was_duplicate).toBe(true)
    expect(r.success).toBe(true)
    expect(state.insertedMovements).toHaveLength(0)
    expect(state.stockPatches).toHaveLength(0)
  })

  it('carrera entre procesos: INSERT 409 (UNIQUE BD) → duplicado exitoso sin PATCH', async () => {
    state.failInsertWith409 = true
    const r = await recordMovement(baseReq())
    expect(r.was_duplicate).toBe(true)
    expect(r.success).toBe(true)
    expect(state.stockPatches).toHaveLength(0)
  })
})

describe('W1-B — stock sin clamp (reconstruibilidad)', () => {
  it('salida mayor al stock → stock_after negativo exacto + alerta underflow', async () => {
    const r = await recordMovement(baseReq({ lines: [{ ingredient_id: 'ing_a', quantity: -25 }] }))
    expect(r.success).toBe(true)
    expect(r.details[0].stock_after).toBe(-15)
    expect(state.stockPatches[0].body.stock).toBe(-15)
    const underflow = state.insertedMovements.filter(m => m.movement_type === 'underflow_prevented')
    expect(underflow).toHaveLength(1)
  })

  it('stock actual negativo NO bloquea movimientos (semántica R1)', async () => {
    state.stock.ing_a = -3
    const r = await recordMovement(baseReq({ lines: [{ ingredient_id: 'ing_a', quantity: -2 }] }))
    expect(r.success).toBe(true)
    expect(r.details[0].stock_after).toBe(-5)
  })
})

describe('W1-B — costeo y tipos', () => {
  it('promedio ponderado intacto: 10 @ $10 + entrada 10 @ $20 → $15', async () => {
    const r = await recordMovement(baseReq({
      movement_type: 'entry',
      lines: [{ ingredient_id: 'ing_a', quantity: 10, unit_cost: 20 }],
    }))
    expect(r.success).toBe(true)
    expect(r.details[0].cost_after).toBe(15)
    expect(state.costPatches[0].body.cost_per_unit).toBe(15)
  })

  it('opening_balance es tipo entrada válido', async () => {
    const r = await recordMovement(baseReq({
      movement_type: 'opening_balance',
      lines: [{ ingredient_id: 'ing_a', quantity: 42 }],
    }))
    expect(r.success).toBe(true)
    expect(state.insertedMovements[0].movement_type).toBe('opening_balance')
  })

  it('return (devolución a proveedor) baja stock por el ledger', async () => {
    const r = await recordMovement(baseReq({
      movement_type: 'return',
      lines: [{ ingredient_id: 'ing_a', quantity: -4 }],
    }))
    expect(r.success).toBe(true)
    expect(state.insertedMovements[0].movement_type).toBe('return')
    expect(state.stockPatches[0].body.stock).toBe(6)
  })
})

describe('W1-B — transferencia de dos piernas', () => {
  const transferParams = {
    client_id: 'test-client',
    source_warehouse: 'Cocina',
    destination_warehouse: 'Barra',
    lines: [{ ingredient_id: 'ing_a', quantity: 3 }],
    actor: 'test',
    idempotency_key: 'tr-1',
  }

  it('emite transfer_out (−) y transfer_in (+) con keys derivadas — neto cero', async () => {
    const r = await recordTransfer(transferParams)
    expect(r.success).toBe(true)
    const out = state.insertedMovements.find(m => m.movement_type === 'transfer_out')!
    const inn = state.insertedMovements.find(m => m.movement_type === 'transfer_in')!
    expect(out.quantity).toBe(-3)
    expect(inn.quantity).toBe(3)
    expect(out.idempotency_key).toBe('tr-1_out')
    expect(inn.idempotency_key).toBe('tr-1_in')
    expect(Number(out.quantity) + Number(inn.quantity)).toBe(0)
  })

  it('falla parcial (in falla) → UNBALANCED reportado; retry misma key completa sin duplicar', async () => {
    state.failInsertForKeySuffix = '_in'
    const r1 = await recordTransfer(transferParams)
    expect(r1.success).toBe(false)
    expect(r1.errors.join(' ')).toContain('UNBALANCED')
    expect(state.insertedMovements.filter(m => m.movement_type === 'transfer_out')).toHaveLength(1)

    state.failInsertForKeySuffix = null
    const r2 = await recordTransfer(transferParams)
    expect(r2.success).toBe(true)
    expect(r2.out.was_duplicate).toBe(true)
    expect(state.insertedMovements.filter(m => m.movement_type === 'transfer_out')).toHaveLength(1)
    expect(state.insertedMovements.filter(m => m.movement_type === 'transfer_in')).toHaveLength(1)
  })
})
