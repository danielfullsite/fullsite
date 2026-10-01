import { beforeEach, describe, expect, it, vi } from 'vitest'
// La ruta /api/dashboard/pos-daily lee pos_orders server-side (service_role) con
// paginación keyset por id.asc, dedupe y validación de día de venta — lo que antes
// vivía en el cliente (ver dashboard-pos-settled-sales.test.ts). Aquí se prueba eso.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  process.env.SUPABASE_SERVICE_KEY = 'svc-key'
})
vi.mock('@/lib/api-auth', () => ({
  requireTenant: vi.fn(async (_req: unknown, cid: string | null) => ({ clientId: cid || 'restaurant-a' })),
}))
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/dashboard/pos-daily/route'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, dia_venta: '2026-08-15', total: 100, status: 'cerrada', payment_status: 'pagada', ...extra })
const req = (qs: string) => new NextRequest(new URL(`https://synthetic.invalid/api/dashboard/pos-daily?${qs}`))
// PostgREST-like: aplica el cursor keyset id=gt."<after>" y topa a 1000 filas por página.
function servePages(rows: ReturnType<typeof row>[]) {
  fetchMock.mockImplementation(async (url: string) => {
    const m = new URL(url).searchParams.get('id')?.match(/^gt\."(.*)"$/)
    const after = m ? m[1] : ''
    return Response.json(rows.filter(r => !after || r.id > after).slice(0, 1000))
  })
}

describe('GET /api/dashboard/pos-daily', () => {
  it('lee >5000 filas con keyset estable y parámetros por tenant', async () => {
    servePages(Array.from({ length: 5107 }, (_, i) => row(String(i).padStart(6, '0'))))
    const res = await GET(req('client_id=restaurant-a&since=2026-08-01&location_id=branch-a'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toHaveLength(5107)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(fetchMock).toHaveBeenCalledTimes(6) // 1000*5 + 107
    for (const [url] of fetchMock.mock.calls) {
      const p = new URL(url)
      expect(p.pathname).toBe('/rest/v1/pos_orders')
      expect(p.searchParams.get('select')).toBe('id,dia_venta,mesa,mesero,personas,status,subtotal,iva,total,descuento,metodo_pago,items,pagos,propina,payment_status,turno_id,created_at,closed_at')
      expect(p.searchParams.get('select')).not.toContain('comanda_batches')
      expect(p.searchParams.get('client_id')).toBe('eq.restaurant-a')
      expect(p.searchParams.get('location_id')).toBe('eq.branch-a')
      expect(p.searchParams.get('dia_venta')).toBe('gte.2026-08-01')
      expect(p.searchParams.get('order')).toBe('id.asc')
      expect(p.searchParams.get('limit')).toBe('1000')
    }
  })
  it('400 si falta since válido', async () => {
    const res = await GET(req('client_id=restaurant-a'))
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it('502 ante una falla a media lectura (no devuelve parcial)', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(Array.from({ length: 1000 }, (_, i) => row(String(i).padStart(6, '0')))))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
    const res = await GET(req('client_id=restaurant-a&since=2026-08-01'))
    expect(res.status).toBe(502)
  })
  it('502 ante filas repetidas (dedupe)', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => row(String(i).padStart(6, '0')))
    fetchMock.mockResolvedValue(Response.json(page)) // ignora el cursor → repite ids
    const res = await GET(req('client_id=restaurant-a&since=2026-08-01'))
    expect(res.status).toBe(502)
  })
  it('502 ante un día de venta faltante', async () => {
    fetchMock.mockResolvedValue(Response.json([row('a', { dia_venta: null })]))
    const res = await GET(req('client_id=restaurant-a&since=2026-08-01'))
    expect(res.status).toBe(502)
  })
})
