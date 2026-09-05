import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { getActiveClientSlug } from './data'
import type { ClientConfig } from './client-config'
import type { MenuCategory, PaymentMethodDB, ModifierGroupDef } from './pos-data'

export interface CatalogoDeCaja {
  schema_version: 1; complete: true; restaurant_id: string; catalog_scope: 'restaurant'; refreshed_at: string
  categories: MenuCategory[]; payment_methods: PaymentMethodDB[]; config: ClientConfig
  settings: Record<string, unknown>
  modifiers: {
    groups: { id: string; name: string; level: number; min_selections: number; max_selections: number | null; required: boolean }[]
    mods: { id: string; group_id: string; name: string; price: number }[]
    item_links: { item_id: string; group_id: string }[]
    category_links: { category_id: string; modifier_group_id: string }[]
  }
}
const pending = new Map<string, Promise<CatalogoDeCaja>>()
const cached = new Map<string, { catalog: CatalogoDeCaja; at: number }>()

/** Caja owns the complete catalog. Never silently replace it with independent
 * cloud reads, another branch's cache, or default tax on a configured terminal. */
export async function leerCatalogoCaja(clientId = getActiveClientSlug()): Promise<CatalogoDeCaja> {
  const bridge = getBridgeUrl()
  const branch = localStorage.getItem('FULLSITE_LOCATION_ID') || null
  const key = JSON.stringify([bridge, clientId, branch])
  const previous = cached.get(key)
  if (previous && Date.now() - previous.at < 3000) return previous.catalog
  if (!pending.has(key)) {
    const read = async () => {
      const response = await localNetworkFetch(`${bridge}/catalog`, { cache: 'no-store', signal: AbortSignal.timeout(7000) })
      const body = await response.json()
      if (!response.ok || body.ready !== true || body.restaurant_id !== clientId || body.location_id !== branch ||
          body.catalog?.schema_version !== 1 || body.catalog?.complete !== true || body.catalog?.restaurant_id !== clientId ||
          !Array.isArray(body.catalog?.categories) || !Array.isArray(body.catalog?.payment_methods) ||
          !body.catalog?.modifiers || body.catalog?.config?.id !== clientId || !Number.isFinite(body.catalog.config.iva_rate)) {
        throw new Error('Catálogo sin preparar en Caja. Conecta internet e ingresa con PIN para prepararlo.')
      }
      cached.set(key, { catalog: body.catalog, at: Date.now() })
      return body.catalog as CatalogoDeCaja
    }
    pending.set(key, read().finally(() => { pending.delete(key) }))
  }
  return pending.get(key)!
}

export function gruposDelCatalogo(catalog: CatalogoDeCaja, itemId: string, categoryId: string): ModifierGroupDef[] {
  const data = catalog.modifiers
  const ids = new Set([...data.item_links.filter(l => l.item_id === itemId).map(l => l.group_id),
    ...data.category_links.filter(l => l.category_id === categoryId).map(l => l.modifier_group_id)])
  ids.delete('quitar') // Existing separate removal control.
  return data.groups.filter(g => ids.has(g.id)).map(g => ({ id: g.id, name: g.name, level: g.level,
    minSelections: g.min_selections, maxSelections: g.max_selections, required: g.required,
    options: data.mods.filter(m => m.group_id === g.id).map(m => ({ name: m.name, price: m.price })) }))
}
