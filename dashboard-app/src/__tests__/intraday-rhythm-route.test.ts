import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  process.env.SUPABASE_SERVICE_KEY = 'svc-key'
})
vi.mock('@/lib/api-auth', () => ({
  requireTenant: vi.fn(async () => ({ clientId: 'amalay' })),
}))

import { NextRequest } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { GET } from '@/app/api/dashboard/intraday-rhythm/route'

const fetchMock = vi.fn()
const req = () => new NextRequest('https://synthetic.invalid/api/dashboard/intraday-rhythm?client_id=amalay')

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(requireTenant).mockResolvedValue({ clientId: 'amalay' } as never)
})

describe('GET /api/dashboard/intraday-rhythm', () => {
  it('usa tenant autenticado, cobros cerrados y deja clara la ausencia de muestra', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([{ timezone: 'America/Monterrey', business_day_start_local: '05:00:00' }]))
      .mockResolvedValueOnce(Response.json([]))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect((await res.json()).ritmo).toBeNull()
    const orders = new URL(fetchMock.mock.calls[1][0])
    expect(orders.pathname).toBe('/rest/v1/pos_orders')
    expect(orders.searchParams.get('client_id')).toBe('eq.amalay')
    expect(orders.searchParams.get('closed_at')).toBe('not.is.null')
    expect(orders.searchParams.get('select')).toBe('dia_venta,closed_at,total')
  })

  it('no consulta datos cuando no autoriza el tenant', async () => {
    vi.mocked(requireTenant).mockResolvedValueOnce(new Response('No autorizado', { status: 401 }) as never)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
