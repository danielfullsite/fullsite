import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: async () => ({ clientId: 'tenant-lab', role: 'gerente' }), unauthorized: () => new Response(null, { status: 401 }) }))
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.invalid'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('pos_scoped_child') ? { rows: [{ id: 1, order_id: 'own' }], total: 1 } : [{ id: 'same', client_id: 'tenant-lab', pin: 'synthetic' }])))
})
afterEach(() => vi.unstubAllGlobals())
for (const mode of ['query','path']) describe(`scoped SQL ${mode}`, () => {
  async function call(table: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', data?: object, query='', prefer='') {
    const resource = `${table}${query}`
    const url = mode === 'query' ? `http://localhost/api/pos/db?path=${encodeURIComponent(resource)}` : `http://localhost/api/pos/db/rest/v1/${resource}`
    const req = new NextRequest(url, { method, headers: { Prefer: prefer }, ...(data ? { body: JSON.stringify(data) } : {}) })
    if (mode === 'query') { const route = await import('@/app/api/pos/db/route'); return route[method](req) }
    const route = await import('@/app/api/pos/db/[...path]/route')
    return route[method](req, { params: Promise.resolve({ path: ['rest','v1',table] }) })
  }
  it('merge con ID global usa conflicto atómico por tenant y redacta el recibo', async () => {
    const response = await call('pos_staff','POST',{ id: 'same', client_id: 'foreign', name: 'Ana' },'', 'resolution=merge-duplicates,return=representation')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: 'same', client_id: 'tenant-lab' }])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/rpc\/pos_scoped_upsert$/)
    expect(JSON.parse(init!.body as string)).toMatchObject({ p_client_id: 'tenant-lab', p_table: 'pos_staff', p_rows: { id: 'same', client_id: 'tenant-lab' }, p_conflict: ['id'] })
  })
  it.each(['GET','POST','PATCH','DELETE'] as const)('tabla hija %s sólo usa contrato SQL con parent scope', async method => {
    const response = await call('pos_purchase_order_items',method, method === 'GET' || method === 'DELETE' ? undefined : { order_id: 'own', quantity_ordered: 1 }, '?id=eq.1')
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/rpc\/pos_scoped_child$/)
    expect(JSON.parse(init!.body as string)).toMatchObject({ p_client_id: 'tenant-lab', p_method: method, p_id: '1' })
  })
  it('migración ausente no vuelve a REST sin scope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: 'PGRST202' }, { status: 404 }))
    expect((await call('pos_sessions','POST',{ id: 'same' },'', 'resolution=merge-duplicates')).status).toBe(503)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('no permite conflictos globales arbitrarios', async () => {
    expect((await call('pos_staff','POST',{ name: 'Ana' },'?on_conflict=name', 'resolution=merge-duplicates')).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
})
