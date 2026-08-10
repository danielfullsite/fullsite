// BUG-019-B — public menu response contract + resolver format + no-leak guards.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shapePublicMenu, type RawMenuData } from '@/lib/public-menu'

const RAW: RawMenuData = {
  categories: [
    { id: 'cat1', name: 'Bebidas', color: 'bg-blue-500', sort_order: 0 },
    { id: 'cat2', name: 'Vacía', color: null, sort_order: 1 },
  ],
  items: [
    { id: 'it1', category_id: 'cat1', name: 'Latte', price: 55, sort_order: 0 },
    { id: 'it2', category_id: 'cat1', name: 'Market Zero', price: 0, sort_order: 1 }, // excluded (price<=0)
  ],
  groups: [{ id: 'g1', name: 'Leche', min_selections: 0, max_selections: 1, required: false, sort_order: 0 }],
  modifiers: [{ id: 'm1', group_id: 'g1', name: 'Deslactosada', price: 10, sort_order: 0 }],
  itemGroups: [{ item_id: 'it1', group_id: 'g1' }],
  catMods: [],
}

describe('shapePublicMenu', () => {
  it('builds categories→items→groups→modifiers with public fields only', () => {
    const menu = shapePublicMenu(7, RAW)
    expect(menu.mesa).toBe(7)
    expect(menu.categories).toHaveLength(1) // empty category dropped
    const cat = menu.categories[0]
    expect(cat).toEqual({
      id: 'cat1', name: 'Bebidas', color: 'bg-blue-500', sort_order: 0,
      items: [{
        id: 'it1', category_id: 'cat1', name: 'Latte', price: 55, sort_order: 0,
        modifier_groups: [{
          id: 'g1', name: 'Leche', min_selections: 0, max_selections: 1, required: false,
          modifiers: [{ id: 'm1', name: 'Deslactosada', price: 10 }],
        }],
      }],
    })
  })

  it('excludes zero/negative-price items (market parity)', () => {
    const names = shapePublicMenu(1, RAW).categories.flatMap(c => c.items.map(i => i.name))
    expect(names).toContain('Latte')
    expect(names).not.toContain('Market Zero')
  })

  it('SENSITIVE FIELD CONTRACT: no internal field ever appears in the shaped menu', () => {
    // Inject internal fields onto raw rows; the shaper must drop them.
    const tainted = JSON.parse(JSON.stringify(RAW))
    tainted.items[0].recipe_ref = 'RCP-SECRET'
    tainted.items[0].barcode = '123'
    tainted.items[0].aplica_2x1 = true
    tainted.items[0].client_id = 'amalay'
    tainted.categories[0].client_id = 'amalay'
    const blob = JSON.stringify(shapePublicMenu(1, tainted))
    for (const banned of ['recipe_ref', 'RCP-SECRET', 'barcode', 'aplica_2x1', 'client_id', 'cost', 'margin']) {
      expect(blob).not.toContain(banned)
    }
  })

  it('category-level modifiers attach to every item in the category', () => {
    const raw: RawMenuData = { ...RAW, itemGroups: [], catMods: [{ category_id: 'cat1', modifier_group_id: 'g1' }] }
    const menu = shapePublicMenu(1, raw)
    expect(menu.categories[0].items[0].modifier_groups.map(g => g.id)).toEqual(['g1'])
  })
})

describe('resolveTableByToken (format guard + fail-closed, no network)', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...OLD }; vi.restoreAllMocks() })

  it('returns null for malformed token WITHOUT hitting the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    const { resolveTableByToken } = await import('@/lib/public-menu')
    expect(await resolveTableByToken("' OR 1=1")).toBeNull()
    expect(await resolveTableByToken('SHORT')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled() // never queries the DB for junk input
  })

  it('throws PublicMenuConfigError (→503) when service key missing, never falls back to anon', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    delete process.env.SUPABASE_SERVICE_KEY
    const mod = await import('@/lib/public-menu')
    const validToken = 'a'.repeat(48)
    await expect(mod.resolveTableByToken(validToken)).rejects.toBeInstanceOf(mod.PublicMenuConfigError)
  })

  it('never places the raw token in the request when format-invalid (no token disclosure)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    const { resolveTableByToken } = await import('@/lib/public-menu')
    await resolveTableByToken('not-a-valid-token-value-here')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
