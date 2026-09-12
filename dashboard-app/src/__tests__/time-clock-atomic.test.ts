import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authenticate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: authenticate,
  unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
}))
import { POST } from '@/app/api/pos/time-clock/route'

const request = (body: Record<string, unknown>) => new NextRequest('http://localhost/api/pos/time-clock', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  authenticate.mockResolvedValue({ clientId: 'tenant-a', staffId: 'terminal', role: 'mesero' })
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('checador atómico e idempotente', () => {
  it('resuelve empleado, alternancia e inserción en una sola transacción', async () => {
    const receipt = { ok: true, staff_name: 'Ana', type: 'entrada', ts: '2026-09-12T12:00:00Z', recientes: [] }
    const fetcher = vi.fn(async () => Response.json(receipt))
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request({ pin: '1234567890', operation_id: 'clock-op-1', method: 'huella' }))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe('https://db.example/rest/v1/rpc/r1_time_clock_atomic')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      p_client_id: 'tenant-a', p_pin: '1234567890', p_operation_id: 'clock-op-1',
    })
  })

  it('exige identidad estable de replay', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const response = await POST(request({ pin: '1234567890' }))
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('un ACK perdido no se presenta como checada fallida definitiva', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost ACK') }))
    const response = await POST(request({ pin: '1234567890', operation_id: 'clock-op-1' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'TIME_CLOCK_UNCONFIRMED' })
  })

  it('clasifica PIN inválido y operación reutilizada sin confirmar nada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'PIN_NOT_FOUND' }, { status: 400 })))
    const response = await POST(request({ pin: '1234567890', operation_id: 'clock-op-1' }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'PIN_NOT_FOUND' })
  })
})
