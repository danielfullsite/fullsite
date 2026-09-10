import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => ({ clientId: 'tenant-lab', role: 'mesero' }), unauthorized: () => new Response(null, { status: 401 }) }))
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ name: 'Ana', pin: 'synthetic' }])))
})
afterEach(() => vi.unstubAllGlobals())
for (const mode of ['query', 'path']) describe(`resource boundary ${mode}`, () => {
  async function call(resource: string, query = '', method = 'GET') {
    const url = mode === 'query' ? `http://localhost/api/pos/db?path=${encodeURIComponent(resource + query)}` : `http://localhost/api/pos/db/rest/v1/pos_sessions${query}`
    const req = new NextRequest(url, { method, ...(method === 'PATCH' ? { body: JSON.stringify({ pin: 'synthetic' }) } : {}) })
    if (mode === 'query') {
      const route = await import('@/app/api/pos/db/route')
      return method === 'GET' ? route.GET(req) : route.PATCH(req)
    }
    const route = await import('@/app/api/pos/db/[...path]/route')
    return route.GET(req, { params: Promise.resolve({ path: ['rest', 'v1', ...resource.split('/')] }) })
  }
  it.each(['pos_sessions/../pos_staff', 'pos_sessions/%2e%2e/pos_staff', 'pos_sessions\\..\\pos_staff', 'pos_sessions#ignored', 'pos_sessions/pos_staff'])('rechaza recurso ambiguo %s antes de consultar', async resource => {
    expect((await call(resource, '?id=eq.test', 'PATCH')).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['?select=id,secret:pin', '?select=id,pos_staff(pin)', '?select=staff_id(*)', '?select=id&or=(pin.eq.1234,name.eq.Ana)', '?select=id&pin=eq.1234'])('no expone ni consulta secretos: %s', async query => {
    expect((await call('pos_staff', query)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('conserva lectura plana de staff y redacción', async () => {
    const response = await call('pos_staff', '?select=*&name=eq.José')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ name: 'Ana' }])
    expect(new URL(vi.mocked(fetch).mock.calls[0][0] as string).pathname).toBe('/rest/v1/pos_staff')
  })
})
