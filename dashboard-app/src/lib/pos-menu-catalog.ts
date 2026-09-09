// The current menu schema is tenant-wide. Do not invent branch-specific prices.
import { POS_SETTING_KEYS } from './settings'
const CONFIG_FIELDS = ['id', 'display_name', 'plan', 'city', 'timezone', 'type', 'default_theme', 'accent_color',
  'mesas', 'meseros', 'features', 'iva_rate', 'data_source', 'logo_url', 'menu_categories', 'bebida_groups',
  'address', 'phone', 'rfc', 'receipt_footer', 'social_media', 'razon_social', 'pos_settings']
type Row = Record<string, any> // PostgREST boundary; validated before Caja persists it.
function numeric(value: unknown): number {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) || !Number.isFinite(Number(value))) throw new Error('Importe/configuración numérica ausente o inválida')
  return Number(value)
}

export async function fetchCompletePosCatalog({ clientId, supabaseUrl, serviceKey, fetchImpl = fetch, pageSize = 500, maxPages = 40 }: {
  clientId: string; supabaseUrl: string; serviceKey: string; fetchImpl?: typeof fetch; pageSize?: number; maxPages?: number
}) {
  const signal = AbortSignal.timeout(6000)
  async function read(table: string, select: string, order: string, active = true): Promise<Row[]> {
    const all: Row[] = []
    for (let page = 0; page < maxPages; page++) {
      const query = new URLSearchParams({ client_id: `eq.${clientId}`, select, order, limit: String(pageSize), offset: String(page * pageSize) })
      if (table === 'clients') { query.delete('client_id'); query.set('id', `eq.${clientId}`) }
      else if (active) query.set('active', 'eq.true')
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?${query}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: 'no-store', signal,
      })
      if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`)
      const rows: Row[] = await response.json()
      if (!Array.isArray(rows) || rows.length > pageSize || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error(`${table}: respuesta inválida`)
      all.push(...rows)
      if (rows.length < pageSize) return all
    }
    throw new Error(`${table}: catálogo excede el límite; no se publica una lista parcial`)
  }
  const [cats, items, groups, mods, itemLinks, catLinks, methods, configs] = await Promise.all([
    read('pos_menu_categories', 'id,name,color,sort_order', 'sort_order.asc,id.asc'),
    read('pos_menu_items', 'id,category_id,name,price,barcode,sort_order', 'sort_order.asc,id.asc'),
    read('pos_modifier_groups', 'id,name,level,min_selections,max_selections,required,sort_order', 'level.asc,sort_order.asc,id.asc'),
    read('pos_modifiers', 'id,group_id,name,price,sort_order', 'sort_order.asc,id.asc'),
    read('pos_item_modifier_groups', 'item_id,group_id', 'item_id.asc,group_id.asc', false),
    read('pos_category_modifiers', 'category_id,modifier_group_id', 'category_id.asc,modifier_group_id.asc', false),
    read('pos_payment_methods', 'id,name,type,commission_pct', 'name.asc,id.asc'),
    read('clients', CONFIG_FIELDS.join(','), 'id.asc', false),
  ])
  if (configs.length !== 1 || configs[0].id !== clientId) throw new Error('Falta configuración del restaurante')
  const raw = configs[0]
  if (raw.iva_rate == null || !Number.isFinite(Number(raw.iva_rate)) || !raw.timezone || raw.mesas == null) throw new Error('Falta configuración fiscal/operativa')
  // No credentials, recipients, AI context or arbitrary settings on every POS.
  const config = Object.fromEntries(CONFIG_FIELDS.filter(k => k !== 'pos_settings' && raw[k] !== undefined).map(k => [k, raw[k]]))
  config.iva_rate = numeric(raw.iva_rate)
  config.display_name = raw.display_name || clientId
  config.meseros = typeof raw.meseros === 'string' ? JSON.parse(raw.meseros) : raw.meseros || []
  config.features = typeof raw.features === 'string' ? JSON.parse(raw.features) : raw.features || {}
  const settings = Object.fromEntries(POS_SETTING_KEYS.filter(k => raw.pos_settings?.[k] !== undefined).map(k => [k, raw.pos_settings[k]]))
  const categoryIds = new Set(cats.map(c => c.id))
  const activeItems = items.filter(i => categoryIds.has(i.category_id))
  const itemIds = new Set(activeItems.map(i => i.id)), groupIds = new Set(groups.map(g => g.id))
  const byCategory = new Map<string, Row[]>()
  for (const item of activeItems) { const rows = byCategory.get(item.category_id) || []; rows.push(item); byCategory.set(item.category_id, rows) }
  const categories = cats.map(c => ({ id: c.id, name: c.name, color: c.color,
    items: (byCategory.get(c.id) || []).map(i => ({ id: i.id, name: i.name, price: numeric(i.price), barcode: i.barcode })) }))
  return { schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: clientId,
    refreshed_at: new Date().toISOString(), categories, config, settings,
    modifiers: { groups: groups.map(g => ({ ...g, level: numeric(g.level), min_selections: numeric(g.min_selections), max_selections: g.max_selections === null ? null : numeric(g.max_selections) })),
      mods: mods.filter(m => groupIds.has(m.group_id)).map(m => ({ ...m, price: numeric(m.price) })),
      item_links: itemLinks.filter(l => itemIds.has(l.item_id) && groupIds.has(l.group_id)),
      category_links: catLinks.filter(l => categoryIds.has(l.category_id) && groupIds.has(l.modifier_group_id)) },
    payment_methods: methods.map(m => ({ ...m, commission_pct: m.commission_pct == null ? null : numeric(m.commission_pct) })),
  }
}
