import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/pos/kitchen/route'
import { mismoDiaDeVenta } from '@/lib/dia-de-venta'
import { mergeKdsItemStatus } from '@/hooks/useKdsWsClient'

// PR-2 KDS — regresión del "empalme": órdenes de días anteriores mezcladas con
// las del turno nuevo en el tablero (junta 2026-09-01; campo AMALAY 2026-08-27).

const req = () => new NextRequest('http://localhost/api/pos/kitchen?client_id=testtenant&location_id=branch-a')
const patchReq = (body: unknown) => new NextRequest('http://localhost/api/pos/kitchen?client_id=testtenant&location_id=branch-a', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: unknown }>) {
  const calls: string[] = []
  const fn = vi.fn(async (url: RequestInfo | URL) => {
    calls.push(String(url))
    const r = responses.shift() ?? { ok: true, json: [] }
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? [],
    } as Response
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /api/pos/kitchen — qué ve el tablero', () => {
  it('con turno abierto filtra por turno_id EXACTO (no updated_at, que recalificaba órdenes viejas al tocarlas)', async () => {
    const calls = mockFetchSequence([
      { ok: true, json: [{ id: 'turno-abierto-1' }] },
      { ok: true, json: [{ id: 'o1' }] },
    ])
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(calls[1]).toContain('turno_id=eq.turno-abierto-1')
    expect(calls[1]).not.toContain('updated_at=gte')
  })

  it('sin turno abierto el tablero queda VACÍO — la ventana de 12h resucitaba órdenes tras el Corte Z', async () => {
    const calls = mockFetchSequence([
      { ok: true, json: [] }, // el server CONFIRMA: no hay turno
    ])
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(calls.length).toBe(1) // ni siquiera consulta órdenes
  })

  it('turno irresoluble no amplía la consulta a órdenes de otros turnos', async () => {
    const calls = mockFetchSequence([
      { ok: false, status: 503 },
      { ok: true, json: [{ id: 'o1' }] },
    ])
    const res = await GET(req())
    expect(res.status).toBe(502)
    expect(calls).toHaveLength(1)
  })
})

describe('filtro cliente por día de venta (fuga de "lista" eterna)', () => {
  it('una orden lista de AYER no es del día de venta de hoy', () => {
    expect(mismoDiaDeVenta('2026-09-01T14:00:00', '2026-09-02T14:00:00', '05:00:00')).toBe(false)
  })
  it('los dos KDS aplican mismoDiaDeVenta antes del OR de lista', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    for (const p of ['app/pos/kds/page.tsx', 'app/kds/page.tsx']) {
      const src = readFileSync(join(__dirname, '..', p), 'utf8')
      expect(src, p).toContain('mismoDiaDeVenta(o.created_at, now, inicio)')
      expect(src, p).not.toContain("getCachedOrders('lista')")
    }
  })
})


describe('KDS con sucursales simultáneas', () => {
  it('filtra turnos y comandas por la misma sucursal aunque otra abrió después', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input.replace(/^.*?\/rest\/v1/, 'http://localhost/rest/v1')); seen.push(input)
      const branch = url.searchParams.get('location_id')
      if (url.pathname.endsWith('pos_turnos')) return Response.json(branch === 'eq.branch-a' ? [{ id: 'turn-a' }] : [{ id: 'turn-b-newer' }])
      return Response.json([{ id: 'order-a', mesa: 1 }])
    }))
    expect((await GET(req())).status).toBe(200)
    expect(seen).toHaveLength(2)
    for (const url of seen) expect(url).toContain('location_id=eq.branch-a')
    expect(seen[1]).toContain('turno_id=eq.turn-a')
  })
  it('dos turnos no se reducen silenciosamente al último', async () => {
    const calls = mockFetchSequence([{ ok: true, json: [{ id: 'a' }, { id: 'b' }] }])
    const res = await GET(new NextRequest('http://localhost/api/pos/kitchen?client_id=testtenant'))
    expect(res.status).toBe(409)
    expect(calls).toHaveLength(1)
  })
  it.each([{}, null, [{ id: '' }]])('respuesta inválida no equivale a turno cerrado: %j', async body => {
    const calls = mockFetchSequence([{ ok: true, json: body === null ? { invalid: true } : body }])
    expect((await GET(req())).status).toBe(502)
    expect(calls).toHaveLength(1)
  })
})

describe('PATCH /api/pos/kitchen — progreso concurrente por producto', () => {
  it('fusiona deltas recibidos por LAN sin borrar lo marcado por otra cocina', () => {
    const afterKitchenA = mergeKdsItemStatus(null, { item_index: 0, done: true })
    const afterKitchenB = mergeKdsItemStatus(afterKitchenA, { item_index: 1, done: true })
    expect(JSON.parse(String(afterKitchenB))).toEqual({ '0': true, '1': true })
  })

  it('manda un delta atómico y acotado por tenant/sucursal, no un mapa completo', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Response.json({ '0': true, '1': true })
    }))

    const res = await PATCH(patchReq({ order_id: 'order-1', item_index: 1, done: true }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/rest/v1/rpc/pos_apply_kds_item_delta')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      p_client_id: 'testtenant',
      p_location_id: 'branch-a',
      p_order_id: 'order-1',
      p_item_index: 1,
      p_done: true,
    })
  })

  it.each([
    {},
    { order_id: '', item_index: 0, done: true },
    { order_id: 'o', item_index: -1, done: true },
    { order_id: 'o', item_index: 0, done: 'yes' },
  ])('rechaza un delta inválido sin tocar la base: %j', async body => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await PATCH(patchReq(body))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falla cerrado si el servidor no tiene service key', async () => {
    vi.stubEnv('SUPABASE_SERVICE_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect((await PATCH(patchReq({ order_id: 'o', item_index: 0, done: true }))).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('las dos pantallas KDS emiten kds_item_delta y dejan de escribir Supabase directo', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    for (const p of ['app/pos/kds/page.tsx', 'app/kds/page.tsx']) {
      const src = readFileSync(join(__dirname, '..', p), 'utf8')
      expect(src, p).toContain("kds_item_delta: { item_index: itemIndex, done }")
      expect(src, p).toContain('updateKitchenItemStatus(orderId, itemIndex, done)')
      expect(src, p).not.toContain('/rest/v1/pos_orders?id=eq.${orderId}')
      expect(src, p).not.toContain('setDoneItems(prev => {')
    }
  })
})
