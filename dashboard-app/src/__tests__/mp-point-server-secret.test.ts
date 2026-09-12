import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let auth = { clientId: 'tenant-a', role: 'cajero' }

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: async () => auth,
  unauthorized: () => Response.json({}, { status: 401 }),
  POS_ROLE_LVL: { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, 'dueño': 6 },
}))

function req(body: Record<string, unknown>) {
  return new NextRequest('https://app.example.test/api/mp-point', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('Mercado Pago conserva secretos y tenant en servidor', () => {
  beforeEach(() => {
    vi.resetModules()
    auth = { clientId: 'tenant-a', role: 'cajero' }
    delete process.env.MP_ACCESS_TOKEN
    delete process.env.MP_CLIENT_ID
    vi.stubGlobal('fetch', vi.fn())
  })

  it('rechaza un access token enviado por el navegador', async () => {
    const { POST } = await import('@/app/api/mp-point/route')
    const res = await POST(req({ action: 'payment', accessToken: 'token-del-browser', deviceId: 'd1', amount: 10, orderId: 'o1' }))
    expect(res.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rechaza usar la cuenta MP de otro tenant', async () => {
    process.env.MP_ACCESS_TOKEN = 'server-only'
    process.env.MP_CLIENT_ID = 'tenant-b'
    const { POST } = await import('@/app/api/mp-point/route')
    const res = await POST(req({ action: 'payment', deviceId: 'd1', amount: 10, orderId: 'o1' }))
    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('un mesero no puede cobrar ni reembolsar desde el proxy', async () => {
    process.env.MP_ACCESS_TOKEN = 'server-only'
    process.env.MP_CLIENT_ID = 'tenant-a'
    auth = { clientId: 'tenant-a', role: 'mesero' }
    const { POST } = await import('@/app/api/mp-point/route')
    expect((await POST(req({ action: 'payment', deviceId: 'd1', amount: 10, orderId: 'o1' }))).status).toBe(403)
    expect((await POST(req({ action: 'refund', paymentId: 'p1' }))).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cobra con el secreto de servidor, tenant exacto y referencia estable', async () => {
    process.env.MP_ACCESS_TOKEN = 'server-only'
    process.env.MP_CLIENT_ID = 'tenant-a'
    const upstream = vi.fn(async () => Response.json({ id: 'intent-1' }))
    vi.stubGlobal('fetch', upstream)
    const { POST } = await import('@/app/api/mp-point/route')
    const res = await POST(req({ action: 'payment', deviceId: 'device/a', amount: 10.25, orderId: 'order-1' }))
    expect(res.status).toBe(200)
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/devices/device%2Fa/payment-intents')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-only')
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 1025,
      additional_info: { external_reference: 'order-1' },
    })
  })

  it('propaga el fallo upstream y rechaza montos inválidos de reembolso', async () => {
    process.env.MP_ACCESS_TOKEN = 'server-only'
    process.env.MP_CLIENT_ID = 'tenant-a'
    auth = { clientId: 'tenant-a', role: 'gerente' }
    const upstream = vi.fn(async () => Response.json({ message: 'forbidden' }, { status: 403 }))
    vi.stubGlobal('fetch', upstream)
    const { POST } = await import('@/app/api/mp-point/route')
    expect((await POST(req({ action: 'devices' }))).status).toBe(403)
    expect((await POST(req({ action: 'refund', paymentId: 'p1', amount: -5 }))).status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
