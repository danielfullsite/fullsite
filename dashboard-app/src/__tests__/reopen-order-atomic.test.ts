import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => vi.fn())
const approve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: auth,
  unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
}))
vi.mock('@/lib/manager-approval', () => ({
  verifyManagerApproval: approve,
  apruebaSospechosa: () => false,
}))

import { POST } from '@/app/api/pos/reopen-order/route'

const request = (extra: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/pos/reopen-order', {
  method: 'POST',
  body: JSON.stringify({ order_id: 'order-1', operation_id: 'reopen:order-1:closed-at', approval_token: 'signed', ...extra }),
})

beforeEach(() => {
  auth.mockResolvedValue({ clientId: 'tenant-a', staffId: 'requester', staffName: 'Solicitante', role: 'mesero' })
  approve.mockResolvedValue({ ok: true, mode: 'online:gerente', solicitanteNivel: 1, approverId: 'manager-1', approverName: 'Gerente Uno' })
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('reapertura atómica de orden', () => {
  it('manda tenant, identidad estable y aprobador verificados a una sola transacción', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, revision: 8, already_applied: false }))
    vi.stubGlobal('fetch', fetcher)

    const response = await POST(request({ client_id: 'otro', manager: 'forjado' }))

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://db.example/rest/v1/rpc/r1_reopen_order_atomic')
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      p_client_id: 'tenant-a',
      p_order_id: 'order-1',
      p_operation_id: 'reopen:order-1:closed-at',
      p_actor: 'manager-1',
      p_approval_mode: 'online:gerente',
    })
  })

  it('no presenta como éxito una orden inexistente o una mesa ya ocupada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'ORDER_NOT_FOUND' }, { status: 400 })))
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: 'ORDER_NOT_FOUND' })
  })

  it('exige la identidad de replay antes de escribir', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request({ operation_id: '' }))
    expect(response.status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('un ACK perdido queda incierto y permite repetir la misma identidad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('lost ACK') }))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: 'REOPEN_UNCONFIRMED' })
  })
})
