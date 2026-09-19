import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as direct from '@/app/api/pos/db/route'
import * as nested from '@/app/api/pos/db/[...path]/route'
import { withPOSAuth } from '@/lib/api-auth'

vi.mock('@/lib/api-auth', () => ({ withPOSAuth: vi.fn(), unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }) }))
const upstream = vi.fn()
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sandbox.invalid')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'fixture-service-only')
  vi.mocked(withPOSAuth).mockResolvedValue({ clientId: 'tenant-a', role: 'mesero', staffId: 's1', staffName: 'Mesero', authType: 'shift_token' })
  upstream.mockReset().mockImplementation(async () => Response.json([]))
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
const role = (value: string) => vi.mocked(withPOSAuth).mockResolvedValue({ clientId: 'tenant-a', role: value, staffId: 's1', staffName: value, authType: 'shift_token' })

for (const variant of ['direct', 'nested'] as const) describe(`frontera real ${variant}`, () => {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', resource: string, body?: unknown) => {
    const [table, query = ''] = resource.split('?')
    const url = variant === 'direct' ? `http://local/api/pos/db?path=${encodeURIComponent(resource)}` : `http://local/api/pos/db/rest/v1/${table}?${query}`
    const request = new NextRequest(url, { method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) })
    return variant === 'direct' ? direct[method](request) : nested[method](request, { params: Promise.resolve({ path: ['rest', 'v1', table] }) })
  }
  it('sin sesión no lee ni escribe aunque presente tenant en body', async () => {
    vi.mocked(withPOSAuth).mockResolvedValue(null)
    expect((await call('POST', 'pos_orders', { client_id: 'tenant-a' })).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('mesero lee catálogo y comanda; no puede cambiar precios ni recetas', async () => {
    expect((await call('GET', 'pos_menu_items')).status).toBe(200)
    expect((await call('PATCH', 'pos_orders?id=eq.own', { notas: 'sin hielo' })).status).toBe(200)
    upstream.mockClear()
    for (const table of ['pos_menu_items', 'pos_menu_categories', 'pos_recipes', 'pos_recipe_lines', 'pos_ingredients', 'pos_purchase_orders']) {
      expect((await call('PATCH', table, { price: 1 })).status).toBe(403)
    }
    expect(upstream).not.toHaveBeenCalled()
  })
  it('gerente edita catálogo propio, sin bypass por rol de body', async () => {
    expect((await call('PATCH', 'pos_menu_items', { price: 99, role: 'admin' })).status).toBe(403)
    role('gerente')
    expect((await call('PATCH', 'pos_menu_items?id=eq.item', { price: 99 })).status).toBe(200)
    const [url, init] = upstream.mock.calls.at(-1)!
    expect(new URL(url).searchParams.get('client_id')).toBe('eq.tenant-a')
    expect(JSON.parse(init.body)).toEqual({ price: 99, client_id: 'tenant-a' })
  })
  it('no mueve identidad tenant/sucursal/PK ni pasa JSON malformado', async () => {
    role('admin')
    for (const body of [{ client_id: 'tenant-b' }, { restaurant_id: 'tenant-b' }, { location_id: 'other' }, { id: 'other' }]) {
      expect((await call('PATCH', 'pos_menu_items', body)).status).toBe(403)
    }
    expect((await call('PATCH', 'pos_menu_items', '{')).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('stock, movimientos y costo exigen dominio incluso para gerente', async () => {
    role('gerente')
    for (const table of ['pos_inventory', 'pos_inventory_movements']) expect((await call('POST', table, { stock: 999 })).status).toBe(403)
    expect((await call('PATCH', 'pos_ingredients', { cost_per_unit: 1 })).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
    expect((await call('POST', 'pos_ingredients', { name: 'Nuevo', cost_per_unit: 0 })).status).toBe(200)
  })
  it('upsert no puede reasignar un ID existente de otro tenant', async () => {
    role('gerente')
    upstream.mockResolvedValueOnce(Response.json([{ id: 'known-id', client_id: 'tenant-b' }]))
    expect((await call('POST', 'pos_menu_items?on_conflict=id', { id: 'known-id', name: 'Ataque' })).status).toBe(403)
    expect(upstream.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true)
  })
  it('hijas se filtran por padres propios y no admiten padre ajeno', async () => {
    role('gerente')
    upstream.mockImplementation(async (input: string) => new URL(input).pathname.endsWith('/pos_purchase_orders') ? Response.json([{ id: 'own-po' }]) : Response.json([]))
    expect((await call('GET', 'pos_purchase_order_items?order_id=eq.other')).status).toBe(200)
    const params = new URL(upstream.mock.calls.at(-1)![0]).searchParams
    expect(params.getAll('order_id')).toEqual(['eq.other', 'in.(own-po)'])
    upstream.mockClear()
    expect((await call('POST', 'pos_purchase_order_items', { order_id: 'other' })).status).toBe(403)
    expect(upstream.mock.calls.every(([, init]) => !init.method)).toBe(true)
  })
  it('paths con segmentos adicionales y conflictos sin scope no llegan a service_role', async () => {
    role('gerente')
    expect((await call('GET', 'pos_orders/../../clients')).status).toBe(403)
    expect((await call('POST', 'pos_menu_items?on_conflict=name', { name: 'Other' })).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
})
