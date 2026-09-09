import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { fetchCompletePosCatalog } from '@/lib/pos-menu-catalog'
import { GET } from '@/app/api/pos/menu/route'
import { withPOSAuth } from '@/lib/api-auth'
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: vi.fn(), unauthorized: () => Response.json({}, { status: 401 }) }))
const tables: Record<string, Record<string, unknown>[]> = {
  clients: [{ id: 'lab', display_name: 'Laboratorio', iva_rate: '0', mesas: 0, timezone: 'America/Monterrey',
    pos_settings: { 'pos.kds_stations': ['barra'], private_provider_key: 'must-not-escape' }, service_password: 'must-not-escape' }],
  pos_menu_categories: [{ id: 'drinks', name: 'Bebidas' }],
  pos_menu_items: Array.from({ length: 5 }, (_, i) => ({ id: `coffee-${i}`, name: `Café ${i}`, price: '50.00', category_id: 'drinks' })),
  pos_modifier_groups: [{ id: 'milk', name: 'Leche', level: 1, min_selections: 1, max_selections: 1, required: true }],
  pos_modifiers: [{ id: 'oat', group_id: 'milk', name: 'Avena', price: '15.00' }],
  pos_item_modifier_groups: [{ item_id: 'coffee-0', group_id: 'milk' }],
  pos_category_modifiers: [], pos_payment_methods: [{ id: 'cash', name: 'Efectivo', type: 'cash', commission_pct: '0' }],
}
const options = { clientId: 'lab', supabaseUrl: 'https://synthetic.invalid', serviceKey: 'synthetic-key', pageSize: 2 }
function fetcher() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), table = url.pathname.split('/').pop()!
    expect(url.searchParams.get(table === 'clients' ? 'id' : 'client_id')).toBe('eq.lab')
    expect(init?.signal).toBeTruthy()
    const offset = Number(url.searchParams.get('offset')), size = Number(url.searchParams.get('limit'))
    return Response.json((tables[table] || []).slice(offset, offset + size))
  })
}
beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })
it('paginates all data, preserves zero IVA and exposes only public POS config', async () => {
  const fetchImpl = fetcher()
  const catalog = await fetchCompletePosCatalog({ ...options, fetchImpl })
  expect(catalog.categories[0].items).toHaveLength(5)
  expect(catalog.config.iva_rate).toBe(0)
  expect(catalog.config.mesas).toBe(0)
  expect(catalog.modifiers.mods[0].price).toBe(15)
  expect(catalog.complete).toBe(true)
  expect(JSON.stringify(catalog)).not.toContain('must-not-escape')
  expect(new Set(fetchImpl.mock.calls.map(c => c[1]?.signal)).size).toBe(1)
})
it('a later page failure or page limit rejects the entire acquisition', async () => {
  const normal = fetcher()
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('pos_menu_items') && url.searchParams.get('offset') === '2') return Response.json({}, { status: 503 })
    return normal(input, init)
  })
  await expect(fetchCompletePosCatalog({ ...options, fetchImpl })).rejects.toThrow('HTTP 503')
  await expect(fetchCompletePosCatalog({ ...options, fetchImpl: fetcher(), maxPages: 1 })).rejects.toThrow('lista parcial')
})
it('empty configuration is an acquisition failure, never default tax', async () => {
  const normal = fetcher()
  await expect(fetchCompletePosCatalog({ ...options, fetchImpl: async (url, init) =>
    String(url).includes('/clients?') ? Response.json([]) : normal(url, init) })).rejects.toThrow('configuración')
})
it('missing prices never turn into free products', async () => {
  const normal = fetcher()
  await expect(fetchCompletePosCatalog({ ...options, fetchImpl: async (url, init) => {
    const response = await normal(url, init)
    const rows = await response.json()
    return Response.json(String(url).includes('/pos_menu_items?') ? rows.map((r: Record<string, unknown>) => ({ ...r, price: null })) : rows)
  } })).rejects.toThrow('ausente o inválida')
})
it('menu endpoint requires authentication and ignores a client-selected restaurant', async () => {
  vi.mocked(withPOSAuth).mockResolvedValue(null)
  const req = { headers: new Headers({ 'x-client-id': 'another' }) } as unknown as import('next/server').NextRequest
  const cloud = fetcher(); vi.stubGlobal('fetch', cloud)
  expect((await GET(req)).status).toBe(401)
  expect(cloud).not.toHaveBeenCalled()
  vi.mocked(withPOSAuth).mockResolvedValue({ clientId: 'lab', staffId: 'one', staffName: 'Empleado', role: 'mesero', authType: 'shift_token' })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  const response = await GET(req)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await response.json()).restaurant_id).toBe('lab')
})
