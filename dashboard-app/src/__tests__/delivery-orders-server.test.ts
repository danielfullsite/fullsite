import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let auth: { clientId: string } | null = { clientId: 'tenant-server' }
let kitchenEnabled = true
let kitchenValid = true

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => auth),
  unauthorized: vi.fn(() => Response.json({ error: 'No autorizado' }, { status: 401 })),
}))
vi.mock('@/lib/kitchen-token', () => ({
  kitchenTokenEnabled: () => kitchenEnabled,
  verifyKitchenToken: () => kitchenValid,
}))

describe('/api/pos/delivery-orders', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.example.invalid'
    process.env.SUPABASE_SERVICE_KEY = 'service-key-test'
    auth = { clientId: 'tenant-server' }
    kitchenEnabled = true
    kitchenValid = true
  })

  it('GET permite un KDS sin shift sólo con tenant y HMAC válido', async () => {
    auth = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json([{ id: 'delivery-kds' }]))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('@/app/api/pos/delivery-orders/route')
    const response = await GET(new NextRequest('https://app.test/api/pos/delivery-orders?client_id=kds-tenant&status=nueva', {
      headers: { 'x-kitchen-token': 'valid-hmac' },
    }))
    expect(response.status).toBe(200)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('client_id=eq.kds-tenant')
    expect(url).toContain('select=id,platform,status,items,created_at,notes,customer_name,total')
    expect(url).not.toMatch(/address|phone|payment_method/)
  })

  it('GET KDS falla cerrado sin secreto o con token inválido', async () => {
    auth = null
    const { GET } = await import('@/app/api/pos/delivery-orders/route')
    kitchenEnabled = false
    expect((await GET(new NextRequest('https://app.test/api/pos/delivery-orders?client_id=kds'))).status).toBe(503)
    kitchenEnabled = true
    kitchenValid = false
    expect((await GET(new NextRequest('https://app.test/api/pos/delivery-orders?client_id=kds'))).status).toBe(401)
  })

  it('GET fuerza el tenant autenticado y usa service role', async () => {
    const fetchMock = vi.fn(async () => Response.json([{ id: 'd1' }]))
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('@/app/api/pos/delivery-orders/route')
    const response = await GET(new NextRequest('https://app.test/api/pos/delivery-orders?platform=rappi'))
    expect(response.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('client_id=eq.tenant-server')
    expect(url).not.toContain('client_id=eq.attacker')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer service-key-test')
  })

  it('PATCH no puede cambiar tenant/id', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { PATCH } = await import('@/app/api/pos/delivery-orders/route')
    const response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'foreign-order', patch: { status: 'lista', client_id: 'attacker', id: 'other' } }),
    }))
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('PATCH reporta una orden ajena como no encontrada', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const { PATCH } = await import('@/app/api/pos/delivery-orders/route')
    const response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'foreign-order', patch: { status: 'lista' } }),
    }))
    expect(response.status).toBe(404)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('id=eq.foreign-order&client_id=eq.tenant-server')
    expect(JSON.parse(String(init.body))).toEqual({ status: 'lista' })
  })

  it('PATCH rechaza campos, estados, fechas y textos inválidos', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { PATCH } = await import('@/app/api/pos/delivery-orders/route')
    let response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH', body: JSON.stringify({ id: 'd1', patch: { client_id: 'attacker' } }),
    }))
    expect(response.status).toBe(400)
    response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH', body: JSON.stringify({ id: 'd1', patch: { status: 'inventado' } }),
    }))
    expect(response.status).toBe(400)
    response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH', body: JSON.stringify({ id: 'd1', patch: { delivered_at: 'ayer', notes: 'x'.repeat(2001) } }),
    }))
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
})
