import { beforeEach, describe, expect, it, vi } from 'vitest'
// La ruta /api/dashboard/ocm-daily lee la vista viva ocm_daily (service_role):
// ~1 fila por día, sin paginación. Reemplaza la lectura pesada de 90 días de
// pos_orders crudo para el histórico del dashboard.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  process.env.SUPABASE_SERVICE_KEY = 'svc-key'
})
vi.mock('@/lib/api-auth', () => ({
  requireTenant: vi.fn(async (_req: unknown, cid: string | null) => ({ clientId: cid || 'restaurant-a' })),
}))
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/ocm-daily/route'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
const req = (qs: string) => new NextRequest(new URL(`https://synthetic.invalid/api/dashboard/ocm-daily?${qs}`))

describe('GET /api/dashboard/ocm-daily', () => {
  it('devuelve las filas agregadas por tenant y día, con no-store', async () => {
    const rows = [{ fecha: '2026-09-30', ventas_dia: 49761, tickets_count: 73 }]
    fetchMock.mockResolvedValue(Response.json(rows))
    const res = await GET(req('client_id=amalay&since=2026-09-01'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.days).toEqual(rows)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/rest/v1/ocm_daily')
    expect(url.searchParams.get('client_id')).toBe('eq.amalay')
    expect(url.searchParams.get('fecha')).toBe('gte.2026-09-01')
    expect(url.searchParams.get('order')).toBe('fecha.asc')
  })
  it('400 si falta since válido', async () => {
    const res = await GET(req('client_id=amalay'))
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it('502 si la lectura falla (no lista vacía silenciosa)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))
    const res = await GET(req('client_id=amalay&since=2026-09-01'))
    expect(res.status).toBe(502)
  })
})
