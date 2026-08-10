// BUG-019-B — server-only public menu access.
//
// SECURITY CONTRACT:
// - This module MUST only ever run on the server. It reads SUPABASE_SERVICE_KEY
//   (never NEXT_PUBLIC_*) inside functions, so the key never reaches the client
//   bundle. Client components may only `import type` from here.
// - Tenant identity is ALWAYS resolved server-side: from an opaque table token
//   (public route) or from the deployment's legacy client config + mesa number
//   (AMALAY numeric-QR compatibility). The browser never supplies client_id.
// - Every query is explicitly scoped by the resolved client_id.
// - Only intentionally-public menu fields are ever selected/returned. Internal
//   columns (recipe_ref, barcode, aplica_*, cost/margin, created_at, client_id)
//   are never selected into the response.
// - Fail-closed: any unresolved token/mesa yields null -> the caller returns a
//   generic 404. Missing service key throws PublicMenuConfigError -> 503.

import { isValidTableTokenFormat, type ResolvedTable } from './table-token'

export class PublicMenuConfigError extends Error {}

// ---- Public response contract (only these fields ever leave the server) ----
export interface PublicModifier { id: string; name: string; price: number }
export interface PublicModifierGroup {
  id: string; name: string; min_selections: number; max_selections: number | null; required: boolean
  modifiers: PublicModifier[]
}
export interface PublicMenuItem {
  id: string; category_id: string; name: string; price: number; sort_order: number
  modifier_groups: PublicModifierGroup[]
}
export interface PublicMenuCategory {
  id: string; name: string; color: string; sort_order: number; items: PublicMenuItem[]
}
export interface PublicMenu { mesa: number; categories: PublicMenuCategory[] }

// Raw row shapes (only the public columns we SELECT).
interface RawCategory { id: string; name: string; color: string | null; sort_order: number | null }
interface RawItem { id: string; category_id: string; name: string; price: number | null; sort_order: number | null }
interface RawGroup { id: string; name: string; min_selections: number | null; max_selections: number | null; required: boolean | null; sort_order: number | null }
interface RawModifier { id: string; group_id: string; name: string; price: number | null; sort_order: number | null }
interface RawItemGroup { item_id: string; group_id: string }
interface RawCatMod { category_id: string; modifier_group_id: string }

export interface RawMenuData {
  categories: RawCategory[]; items: RawItem[]; groups: RawGroup[]; modifiers: RawModifier[]
  itemGroups: RawItemGroup[]; catMods: RawCatMod[]
}

function sbConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_KEY || ''
  // Fail closed: never fall back to the anon key for a privileged server read.
  if (!url || !key) throw new PublicMenuConfigError('SUPABASE_SERVICE_KEY not configured')
  return { url, key }
}

async function sbGet<T>(path: string): Promise<T[]> {
  const { url, key } = sbConfig()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`supabase read failed: ${res.status}`)
  return (await res.json()) as T[]
}

/**
 * Resolve an opaque table token to its tenant, server-side. Returns null (fail
 * closed) for malformed, unknown, inactive, or location-less tokens.
 */
export async function resolveTableByToken(token: string): Promise<ResolvedTable | null> {
  if (!isValidTableTokenFormat(token)) return null
  const rows = await sbGet<{ client_id: string; location_id: string; number: number }>(
    `pos_mesas?public_token=eq.${token}&token_active=is.true&active=is.true&location_id=not.is.null` +
      `&select=client_id,location_id,number&limit=1`,
  )
  const r = rows[0]
  if (!r || !r.client_id || !r.location_id) return null
  return { client_id: r.client_id, location_id: r.location_id, mesa: r.number }
}

/**
 * LEGACY AMALAY numeric-QR compatibility ONLY. Tenant identity comes from the
 * server-side deployment config, never from the browser. The mesa number merely
 * validates the table exists/active for that tenant; it never selects the tenant.
 * This is deliberately isolated from the canonical token mechanism above and must
 * not be generalized as Fullsite's public-order identity.
 */
export function legacyClientId(): string {
  // Server-side deployment identity. LEGACY_PUBLIC_MENU_CLIENT_ID is preferred
  // (server-only); NEXT_PUBLIC_DEFAULT_CLIENT_ID is the existing deployment value.
  return (process.env.LEGACY_PUBLIC_MENU_CLIENT_ID || process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || '').toLowerCase().trim()
}

export async function resolveLegacyTable(mesaNumber: number): Promise<ResolvedTable | null> {
  const clientId = legacyClientId()
  if (!clientId || !Number.isInteger(mesaNumber) || mesaNumber < 1) return null
  const rows = await sbGet<{ client_id: string; location_id: string | null; number: number }>(
    `pos_mesas?client_id=eq.${encodeURIComponent(clientId)}&number=eq.${mesaNumber}&active=is.true` +
      `&select=client_id,location_id,number&limit=1`,
  )
  const r = rows[0]
  if (!r) return null
  return { client_id: r.client_id, location_id: r.location_id ?? '', mesa: r.number }
}

/** Pure shaper: raw tenant-scoped rows -> public menu. No I/O; unit-testable. */
export function shapePublicMenu(mesa: number, raw: RawMenuData): PublicMenu {
  const modsByGroup = new Map<string, PublicModifier[]>()
  for (const m of raw.modifiers) {
    const list = modsByGroup.get(m.group_id) ?? []
    list.push({ id: m.id, name: m.name, price: Number(m.price ?? 0) })
    modsByGroup.set(m.group_id, list)
  }
  const groupById = new Map<string, PublicModifierGroup>()
  for (const g of raw.groups) {
    groupById.set(g.id, {
      id: g.id, name: g.name,
      min_selections: Number(g.min_selections ?? 0),
      max_selections: g.max_selections == null ? null : Number(g.max_selections),
      required: Boolean(g.required),
      modifiers: modsByGroup.get(g.id) ?? [],
    })
  }
  const itemGroupIds = new Map<string, Set<string>>()
  for (const ig of raw.itemGroups) {
    const s = itemGroupIds.get(ig.item_id) ?? new Set<string>()
    s.add(ig.group_id); itemGroupIds.set(ig.item_id, s)
  }
  const catGroupIds = new Map<string, Set<string>>()
  for (const cm of raw.catMods) {
    const s = catGroupIds.get(cm.category_id) ?? new Set<string>()
    s.add(cm.modifier_group_id); catGroupIds.set(cm.category_id, s)
  }

  const itemsByCat = new Map<string, PublicMenuItem[]>()
  for (const it of raw.items) {
    const price = Number(it.price ?? 0)
    if (price <= 0) continue // parity: hide market/zero-price items from the public menu
    const gids = new Set<string>([
      ...(itemGroupIds.get(it.id) ?? []),
      ...(catGroupIds.get(it.category_id) ?? []),
    ])
    const groups: PublicModifierGroup[] = []
    for (const gid of gids) { const g = groupById.get(gid); if (g) groups.push(g) }
    const list = itemsByCat.get(it.category_id) ?? []
    list.push({ id: it.id, category_id: it.category_id, name: it.name, price, sort_order: Number(it.sort_order ?? 0), modifier_groups: groups })
    itemsByCat.set(it.category_id, list)
  }

  const categories: PublicMenuCategory[] = []
  for (const c of raw.categories) {
    const items = itemsByCat.get(c.id) ?? []
    if (items.length === 0) continue // drop empty categories
    categories.push({ id: c.id, name: c.name, color: c.color ?? 'bg-slate-500', sort_order: Number(c.sort_order ?? 0), items })
  }
  return { mesa, categories }
}

/** Fetch + shape the public menu for a resolved tenant. client_id is server-trusted. */
export async function getPublicMenu(clientId: string, mesa: number): Promise<PublicMenu> {
  const cid = encodeURIComponent(clientId)
  const [categories, items, groups, modifiers, itemGroups, catMods] = await Promise.all([
    sbGet<RawCategory>(`pos_menu_categories?client_id=eq.${cid}&active=is.true&select=id,name,color,sort_order&order=sort_order.asc`),
    sbGet<RawItem>(`pos_menu_items?client_id=eq.${cid}&active=is.true&select=id,category_id,name,price,sort_order&order=sort_order.asc`),
    sbGet<RawGroup>(`pos_modifier_groups?client_id=eq.${cid}&active=is.true&select=id,name,min_selections,max_selections,required,sort_order`),
    sbGet<RawModifier>(`pos_modifiers?client_id=eq.${cid}&active=is.true&select=id,group_id,name,price,sort_order&order=sort_order.asc`),
    sbGet<RawItemGroup>(`pos_item_modifier_groups?client_id=eq.${cid}&select=item_id,group_id`),
    sbGet<RawCatMod>(`pos_category_modifiers?client_id=eq.${cid}&select=category_id,modifier_group_id`),
  ])
  return shapePublicMenu(mesa, { categories, items, groups, modifiers, itemGroups, catMods })
}
