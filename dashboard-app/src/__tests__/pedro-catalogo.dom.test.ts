import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'lab' }))
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
const body = () => ({ ready: true, restaurant_id: 'lab', location_id: null, catalog: {
  schema_version: 1, complete: true, restaurant_id: 'lab', catalog_scope: 'restaurant', refreshed_at: '2026-09-05T00:00:00Z',
  config: { id: 'lab', iva_rate: 0 }, categories: [{ id: 'drinks', items: [{ id: 'coffee', price: 50 }] }], payment_methods: [], settings: {},
  modifiers: { groups: [{ id: 'milk', name: 'Leche', level: 1, min_selections: 1, max_selections: 1, required: true }],
    mods: [{ id: 'oat', name: 'Avena', group_id: 'milk', price: 15 }], item_links: [{ item_id: 'coffee', group_id: 'milk' }], category_links: [] },
} })
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear() })
afterEach(() => { vi.useRealTimers() })
it('menu, config and modifiers share one LAN read with required choices intact', async () => {
  vi.mocked(localNetworkFetch).mockResolvedValue(Response.json(body()))
  const { leerCatalogoCaja, gruposDelCatalogo } = await import('@/lib/pedro-catalogo')
  const [menu, config] = await Promise.all([leerCatalogoCaja(), leerCatalogoCaja()])
  expect(localNetworkFetch).toHaveBeenCalledOnce()
  expect(menu).toBe(config)
  expect(config.config.iva_rate).toBe(0)
  expect(gruposDelCatalogo(menu, 'coffee', 'drinks')).toEqual([{ id: 'milk', name: 'Leche', level: 1,
    minSelections: 1, maxSelections: 1, required: true, options: [{ name: 'Avena', price: 15 }] }])
})
it('rejects another branch and cannot use a previously cached tenant catalog after scope changes', async () => {
  vi.mocked(localNetworkFetch).mockImplementation(async () => Response.json(body()))
  const { leerCatalogoCaja } = await import('@/lib/pedro-catalogo')
  await leerCatalogoCaja()
  await expect(leerCatalogoCaja('other')).rejects.toThrow('Catálogo sin preparar')
  localStorage.setItem('FULLSITE_LOCATION_ID', 'another-branch')
  await expect(leerCatalogoCaja()).rejects.toThrow('Catálogo sin preparar')
  expect(localNetworkFetch).toHaveBeenCalledTimes(3)
})
it('retries after preparation and never interprets an unavailable catalog as empty valid data', async () => {
  vi.mocked(localNetworkFetch).mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json(body()))
  const { leerCatalogoCaja } = await import('@/lib/pedro-catalogo')
  await expect(leerCatalogoCaja()).rejects.toThrow('Catálogo sin preparar')
  expect((await leerCatalogoCaja()).categories).toHaveLength(1)
})
