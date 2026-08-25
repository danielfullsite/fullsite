// P0-2 — Offline, los grupos de modificadores OBLIGATORIOS no pueden desaparecer.
//
// Causa raíz: el Service Worker resuelve las peticiones offline a estas rutas con
// `new Response('Offline', { status: 503 })` (catch-all staleWhileRevalidate — no están
// en API_CACHE_PATTERNS ni en NEVER_CACHE_PATTERNS de public/sw.js). fetch() por lo tanto
// NO lanza: devuelve una respuesta con .ok === false. getModifierGroupsForItem salía por
// `return []` ANTES de llegar a su catch, así que _getModifierGroupsFromCache era código
// muerto siempre que hubiera SW instalado — o sea, siempre en el Electron.
//
// Consecuencia en servicio: una arrachera con grupo obligatorio "Término" se agregaba a
// la orden sin pedirlo, y la comanda salía a cocina sin el término. Silencioso.
//
// Es el MISMO bug que 971ac498 diagnosticó y arregló en getActiveTurno; getMenuCategoriesFromDB
// y getPaymentMethodsFromDB ya lo tenían resuelto. Esta función era la que faltaba.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON'

const ITEM = 'item-arrachera'
const CAT = 'cat-carnes'

function stubEnv() {
  vi.stubGlobal('window', { location: { origin: 'https://pos.local' }, dispatchEvent: () => true })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k === 'fullsite_client_id' ? 'tenantA' : null),
    setItem: () => {}, removeItem: () => {},
  })
}

// El SW offline: responde 503, NO lanza. Ésta es la clave del bug.
function swOffline(match: (url: string) => boolean) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (match(String(url))) {
      return { ok: false, status: 503, json: async () => [], text: async () => 'Offline' } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as unknown as Response
  })
}

async function seedCache() {
  const db = await import('@/lib/pos-offline-db')
  await db.cacheModifierData(
    [{ id: 'g-termino', name: 'Término', level: 1, min_selections: 1, max_selections: 1, required: true, sort_order: 1 }],
    [
      { id: 'm1', group_id: 'g-termino', name: 'Medio', price: 0, sort_order: 1 },
      { id: 'm2', group_id: 'g-termino', name: 'Tres cuartos', price: 0, sort_order: 2 },
    ],
    [{ id: `item:${ITEM}:g-termino`, item_id: ITEM, group_id: 'g-termino' }],
  )
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
  stubEnv()
})

describe('P0-2 — grupos obligatorios offline', () => {
  it('503 del SW en las asignaciones → cae al caché IDB y CONSERVA el grupo obligatorio', async () => {
    swOffline((u) => u.includes('pos_item_modifier_groups') || u.includes('pos_category_modifiers'))
    await seedCache()
    const { getModifierGroupsForItem } = await import('@/lib/pos-data')
    const { setCategoryNameCache } = await import('@/lib/pos-constants')
    setCategoryNameCache({ [CAT]: 'Carnes' })

    const groups = await getModifierGroupsForItem(ITEM, CAT)

    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Término')
    expect(groups[0].required).toBe(true)          // el mesero NO puede saltárselo
    expect(groups[0].minSelections).toBe(1)
    expect(groups[0].options.map(o => o.name)).toEqual(['Medio', 'Tres cuartos'])
  })

  it('503 del SW en los grupos/opciones (segundo camino) → también cae al caché', async () => {
    swOffline((u) => u.includes('pos_modifier_groups') || u.includes('pos_modifiers?'))
    await seedCache()
    const { getModifierGroupsForItem } = await import('@/lib/pos-data')
    const { setCategoryNameCache } = await import('@/lib/pos-constants')
    setCategoryNameCache({ [CAT]: 'Carnes' })

    // Las asignaciones responden OK con el link, pero groups/opts dan 503.
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (u.includes('pos_item_modifier_groups')) return { ok: true, status: 200, json: async () => [{ group_id: 'g-termino' }] } as unknown as Response
      if (u.includes('pos_category_modifiers')) return { ok: true, status: 200, json: async () => [] } as unknown as Response
      return { ok: false, status: 503, json: async () => [], text: async () => 'Offline' } as unknown as Response
    })

    const groups = await getModifierGroupsForItem(ITEM, CAT)
    expect(groups.map(g => g.name)).toEqual(['Término'])
  })

  it('respuestas OK y vacías = el platillo NO tiene grupos → [] sin consultar el caché', async () => {
    // Regresión inversa: no inventar modificadores donde no los hay.
    await seedCache()
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => [], text: async () => '[]' } as unknown as Response))
    const { getModifierGroupsForItem } = await import('@/lib/pos-data')

    // 'otro-item' no está en el caché igualmente; lo que importa es que NO caiga al catch.
    expect(await getModifierGroupsForItem('item-cafe', 'cat-bebidas')).toEqual([])
  })
})
