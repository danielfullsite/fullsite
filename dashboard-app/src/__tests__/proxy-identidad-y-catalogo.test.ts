import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const auth = vi.hoisted(() => ({ clientId: 'tenant-lab', role: 'mesero' }))
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => auth, unauthorized: () => new Response(null, { status: 401 }) }))
let writes: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9999'
  auth.role = 'mesero'; writes = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    writes.push({ url: String(url), body: JSON.parse(init?.body || '{}') })
    return new Response('[]', { headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => vi.unstubAllGlobals())
for (const proxy of ['query', 'path']) describe(`identidad y catálogo por ${proxy}`, () => {
  async function patch(table: string, data: unknown, method = 'PATCH') {
    const path = `${table}?id=eq.fixture`
    const url = proxy === 'query' ? `http://localhost/api/pos/db?path=${encodeURIComponent(path)}` : `http://localhost/api/pos/db/rest/v1/${path}`
    const req = new NextRequest(url, { method, body: JSON.stringify(data) })
    if (proxy === 'query') {
      const route = await import('@/app/api/pos/db/route')
      return method === 'POST' ? route.POST(req) : route.PATCH(req)
    }
    const route = await import('@/app/api/pos/db/[...path]/route')
    return route.PATCH(req, { params: Promise.resolve({ path: ['rest', 'v1', table] }) })
  }
  it('mesero puede marcar cocina sin rechazar el tenant inyectado', async () => {
    expect((await patch('pos_orders', { kds_item_status: '{}' })).status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(new URL(writes[0].url).searchParams.get('client_id')).toBe('eq.tenant-lab')
  })
  it('mesero no modifica el dinero', async () => {
    expect((await patch('pos_orders', { total: 1 })).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it.each(['gerente', 'admin'])('%s no cambia restaurante', async role => {
    auth.role = role
    expect((await patch('pos_orders', { client_id: 'otro', mesero: 'Ana' })).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it('gerente no cambia clave primaria', async () => {
    auth.role = 'gerente'
    expect((await patch('pos_orders', { id: 'otra-orden' })).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it('POST estampa tenant y conserva identidad nueva', async () => {
    auth.role = 'gerente'
    expect((await patch('pos_customers', { id: 'cliente-nuevo', client_id: 'otro', name: 'Ana' }, 'POST')).status).toBe(200)
    expect(writes[0].body).toMatchObject({ id: 'cliente-nuevo', client_id: 'tenant-lab' })
  })
  it.each(['pos_modifiers', 'pos_sizes', 'pos_price_types', 'pos_combos', 'pos_inventory', 'pos_ingredients', 'pos_recipes'])('mesero no altera %s', async table => {
    expect((await patch(table, { price: 1, stock: 999 })).status).toBe(403)
    expect(writes).toHaveLength(0)
  })
  it.each([null, [], 1, 'texto'])('rechaza actualización inválida: %j', async data => {
    auth.role = 'gerente'
    expect((await patch('pos_customers', data)).status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})
