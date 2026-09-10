import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/pos/kitchen/route'
import { mismoDiaDeVenta } from '@/lib/dia-de-venta'

// PR-2 KDS — regresión del "empalme": órdenes de días anteriores mezcladas con
// las del turno nuevo en el tablero (junta 2026-09-01; campo AMALAY 2026-08-27).

const req = () => new NextRequest('http://localhost/api/pos/kitchen?client_id=testtenant&location_id=branch-a')

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

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

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
