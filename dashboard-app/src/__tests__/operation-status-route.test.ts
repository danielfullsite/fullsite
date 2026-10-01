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
import { GET } from '@/app/api/dashboard/operation-status/route'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(requireTenant).mockResolvedValue({ clientId: 'amalay' } as never)
})
const req = () => new NextRequest('https://synthetic.invalid/api/dashboard/operation-status?client_id=amalay')

describe('GET /api/dashboard/operation-status', () => {
  it('emite día de negocio y turno desde datos del servidor, sin cache', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([{ timezone: 'America/Monterrey', business_day_start_local: '05:00:00' }]))
      .mockResolvedValueOnce(Response.json([{ id: 'turno-a', opened_by: 'Dueño', opened_at: '2026-10-01T22:00:00Z', fondo_inicial: 1700 }]))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const body = await res.json()
    expect(body.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.turnoAbierto).toMatchObject({ id: 'turno-a', abiertoPor: 'Dueño', fondoInicial: 1700 })
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/rest/v1/clients')
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/rest/v1/pos_turnos')
  })

  it('falla cerrado si no puede confirmar configuración o turno', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const res = await GET(req())
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('DASHBOARD_OPERATION_STATUS_UNAVAILABLE')
  })

  it('no lee datos operativos cuando la autorización del tenant falla', async () => {
    vi.mocked(requireTenant).mockResolvedValueOnce(new Response('No autorizado', { status: 401 }) as never)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
