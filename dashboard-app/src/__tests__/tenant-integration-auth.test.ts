import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  auth: null as null | {
    clientId: string
    staffId: string
    staffName: string
    role: string
    authType: 'shift_token'
  },
  adminSecret: false,
  builtState: '',
  adapter: {
    acceptOrder: vi.fn(async () => ({ ok: true })),
    denyOrder: vi.fn(async () => ({ ok: true })),
    cancelOrder: vi.fn(async () => ({ ok: true })),
    markOrderReady: vi.fn(async () => ({ ok: true })),
  },
  rappiAction: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
}))

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => state.auth),
  requireTenant: vi.fn(async (_request: NextRequest, requested?: string | null) => {
    if (!state.auth) return Response.json({ error: 'Se requiere sesión' }, { status: 401 })
    if (requested && requested !== state.auth.clientId) {
      return Response.json({ error: 'tenant mismatch' }, { status: 403 })
    }
    return state.auth
  }),
  unauthorized: vi.fn((message = 'No autorizado') => Response.json({ error: message }, { status: 401 })),
}))

vi.mock('@/lib/integrations/admin-auth', () => ({
  checkAdminAuth: vi.fn(() => ({ ok: state.adminSecret })),
}))

vi.mock('@/lib/integrations/audit-logger', () => ({ auditLog: vi.fn(async () => undefined) }))

vi.mock('@/lib/integrations/uber-eats/oauth', () => ({
  buildUberAuthUrl: vi.fn((oauthState: string) => {
    state.builtState = oauthState
    return `https://sandbox-login.uber.test/oauth?state=${encodeURIComponent(oauthState)}`
  }),
}))

vi.mock('@/lib/integrations/uber-eats/adapter-factory', () => ({
  getOrderAdapter: vi.fn(() => state.adapter),
}))

vi.mock('@/lib/integrations/uber-eats/adapter', () => ({
  getOrderDetails: vi.fn(async () => ({ ok: true, order: {} })),
}))

vi.mock('@/lib/integrations/rappi/order-sync', () => ({
  syncRappiOrderAction: (...args: unknown[]) => state.rappiAction(...args),
}))

function auth(role = 'mesero', clientId = 'tenant-a') {
  state.auth = {
    clientId,
    staffId: `staff-${role}`,
    staffName: role,
    role,
    authType: 'shift_token',
  }
}

function request(url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('autorización de integraciones por tenant y rol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.auth = null
    state.adminSecret = false
    state.builtState = ''
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
    process.env.SUPABASE_SERVICE_KEY = 'service-test'
    process.env.UBER_CLIENT_ID = 'uber-client-test'
    process.env.UBER_CLIENT_SECRET = 'uber-secret-test'
  })

  it('Uber OAuth no inicia sin sesión ni para un tenant ajeno', async () => {
    const { GET } = await import('@/app/api/integrations/uber-eats/auth/initiate/route')

    let response = await GET(request('https://app.test/api/integrations/uber-eats/auth/initiate?store_id=store-1&client_id=victim'))
    expect(response.status).toBe(401)
    expect(state.builtState).toBe('')

    auth('admin', 'tenant-a')
    response = await GET(request('https://app.test/api/integrations/uber-eats/auth/initiate?store_id=store-1&client_id=victim'))
    expect(response.status).toBe(403)
    expect(state.builtState).toBe('')
  })

  it('Uber OAuth fija el tenant de la sesión y rechaza delimitadores en store_id', async () => {
    auth('admin', 'tenant-a')
    const { GET } = await import('@/app/api/integrations/uber-eats/auth/initiate/route')

    let response = await GET(request('https://app.test/api/integrations/uber-eats/auth/initiate?store_id=store-1%7Cvictim'))
    expect(response.status).toBe(400)
    expect(state.builtState).toBe('')

    response = await GET(request('https://app.test/api/integrations/uber-eats/auth/initiate?store_id=store-1'))
    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    expect(state.builtState.split('|')).toHaveLength(3)
    expect(state.builtState.endsWith('|tenant-a')).toBe(true)
  })

  it('reconcile siempre consulta y audita el tenant autenticado aunque el body lo omita', async () => {
    auth('admin', 'tenant-a')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/integrations/uber-eats/reconcile/route')

    const response = await POST(request('https://app.test/api/integrations/uber-eats/reconcile', {}))
    expect(response.status).toBe(200)
    const queried = String(fetchMock.mock.calls[0][0])
    expect(queried).toContain('client_id=eq.tenant-a')
  })

  it('un POS no puede resolver ni actuar sobre una orden Uber de otro tenant', async () => {
    auth('capitan', 'tenant-a')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('client_id=eq.tenant-a')) return Response.json([])
      return Response.json([{ raw_payload: { channel: 'eats', store: { store_id: 'foreign-store' } } }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/integrations/uber-eats/order/route')

    const response = await POST(request('https://app.test/api/integrations/uber-eats/order', {
      order_id: 'foreign-order', action: 'ready',
    }))
    expect(response.status).toBe(404)
    expect(state.adapter.markOrderReady).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toContain('client_id=eq.tenant-a')
  })

  it('un mesero no puede cancelar/rechazar pedidos Uber ni Rappi', async () => {
    auth('mesero', 'tenant-a')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ raw_payload: { channel: 'eats' } }])))

    const uber = await import('@/app/api/integrations/uber-eats/order/route')
    let response = await uber.POST(request('https://app.test/api/integrations/uber-eats/order', {
      order_id: 'order-1', action: 'cancel', reason: 'ITEM_UNAVAILABLE',
    }))
    expect(response.status).toBe(403)
    expect(state.adapter.cancelOrder).not.toHaveBeenCalled()

    const rappi = await import('@/app/api/integrations/rappi/order/route')
    response = await rappi.POST(request('https://app.test/api/integrations/rappi/order', {
      order_id: 'order-2', action: 'cancel', reason: 'ITEM_UNAVAILABLE',
    }))
    expect(response.status).toBe(403)
    expect(state.rappiAction).not.toHaveBeenCalled()
  })

  it('un mesero no puede disfrazar una cancelación con status o closed_at', async () => {
    auth('mesero', 'tenant-a')
    const fetchMock = vi.fn(async () => Response.json([{ id: 'order-1' }]))
    vi.stubGlobal('fetch', fetchMock)
    const { PATCH } = await import('@/app/api/pos/delivery-orders/route')

    let response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH', body: JSON.stringify({ id: 'order-1', patch: { status: 'cancelada' } }),
    }))
    expect(response.status).toBe(403)
    response = await PATCH(new NextRequest('https://app.test/api/pos/delivery-orders', {
      method: 'PATCH', body: JSON.stringify({ id: 'order-1', patch: { closed_at: new Date().toISOString() } }),
    }))
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

})
