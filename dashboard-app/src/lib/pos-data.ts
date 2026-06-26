// POS Menu Data — AMALAY real menu (Wansoft)
//
// SQL for Supabase (run in SQL Editor):
//
// CREATE TABLE pos_orders (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   mesa INTEGER,
//   mesero TEXT,
//   personas INTEGER DEFAULT 1,
//   status TEXT DEFAULT 'abierta',
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   descuento NUMERIC DEFAULT 0,
//   metodo_pago TEXT,
//   notas TEXT,
//   items JSONB,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   closed_at TIMESTAMPTZ
// );
//
// -- 2026-06-12: pago mixto multi-forma + corte por turno (correr en SQL Editor):
// ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS pagos JSONB;
// ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS turno_id TEXT;
//
// -- BLINDAJE: Immutable audit log (nothing deleteable)
// CREATE TABLE pos_audit_log (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   order_id TEXT,
//   action TEXT NOT NULL,
//   actor TEXT NOT NULL,
//   mesa INTEGER,
//   details JSONB,
//   reason TEXT,
//   approved_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_audit_order ON pos_audit_log(order_id);
// CREATE INDEX idx_audit_action ON pos_audit_log(action);
// CREATE INDEX idx_audit_created ON pos_audit_log(created_at DESC);
//
// -- Actions: order_created, order_sent_kitchen, order_closed, order_cancelled,
// --          item_added, item_modified, item_cancelled, quantity_changed,
// --          discount_applied, discount_removed, status_changed, payment_processed
//
// -- INVENTARIO: Ingredients + Recipes + Stock
// CREATE TABLE pos_ingredients (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   name TEXT NOT NULL,
//   unit TEXT NOT NULL,            -- 'g', 'ml', 'pz', 'kg', 'lt'
//   cost_per_unit NUMERIC DEFAULT 0,
//   category TEXT,                 -- 'proteina', 'lacteo', 'vegetal', 'pan', 'bebida', 'condimento', 'otro'
//   active BOOLEAN DEFAULT true,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_recipes (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   menu_item_id TEXT NOT NULL,     -- references MENU_CATEGORIES item id
//   menu_item_name TEXT NOT NULL,
//   ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
//   quantity NUMERIC NOT NULL,      -- amount of ingredient per 1 unit of platillo
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(client_id, menu_item_id, ingredient_id)
// );
//
// CREATE TABLE pos_inventory (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
//   stock NUMERIC NOT NULL DEFAULT 0,
//   reorder_point NUMERIC DEFAULT 0,
//   reorder_quantity NUMERIC DEFAULT 0,
//   last_restock TIMESTAMPTZ,
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(client_id, ingredient_id)
// );
//
// CREATE TABLE pos_inventory_movements (
//   id BIGSERIAL PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   product_id BIGINT REFERENCES pos_inventory_products(id),  -- target column (nullable during compat bridge)
//   ingredient_id TEXT,              -- COMPAT BRIDGE: temporary, maps to pos_ingredients.id
//   movement_type TEXT NOT NULL,     -- 'deduction', 'restock', 'adjustment', 'waste'
//   quantity NUMERIC NOT NULL,
//   order_id UUID,
//   actor TEXT,
//   notes TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_inv_mov_product ON pos_inventory_movements(product_id);
// CREATE INDEX idx_inv_mov_created ON pos_inventory_movements(created_at DESC);
// CREATE INDEX idx_inv_mov_type ON pos_inventory_movements(movement_type);
// -- See docs/INVENTORY-MIGRATION.md for migration plan
//
// -- COMPRAS: Purchase Orders + Facturas
// CREATE TABLE pos_purchase_orders (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   supplier TEXT NOT NULL,
//   status TEXT DEFAULT 'borrador',   -- borrador, enviada, recibida, facturada, pagada, cancelada
//   created_by TEXT NOT NULL,
//   approved_by TEXT,
//   notes TEXT,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   ai_suggested BOOLEAN DEFAULT false,
//   sent_at TIMESTAMPTZ,
//   received_at TIMESTAMPTZ,
//   received_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_purchase_order_items (
//   id BIGSERIAL PRIMARY KEY,
//   order_id TEXT NOT NULL REFERENCES pos_purchase_orders(id),
//   ingredient_id TEXT NOT NULL,
//   ingredient_name TEXT NOT NULL,
//   quantity_ordered NUMERIC NOT NULL,
//   quantity_received NUMERIC,
//   unit TEXT NOT NULL,
//   unit_cost NUMERIC DEFAULT 0,
//   total_cost NUMERIC DEFAULT 0,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_facturas (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   purchase_order_id TEXT REFERENCES pos_purchase_orders(id),
//   supplier TEXT NOT NULL,
//   folio TEXT,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   status TEXT DEFAULT 'capturada',  -- capturada, aprobada, pagada
//   captured_by TEXT NOT NULL,
//   approved_by TEXT,
//   paid_at TIMESTAMPTZ,
//   notes TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

export interface MenuItem {
  id: string
  name: string
  price: number
  promo?: boolean
  barcode?: string
}

export interface MenuCategory {
  id: string
  name: string
  color?: string  // Tailwind color for group tab
  items: MenuItem[]
}

export interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  modificadores: string[]  // ["Sin cebolla", "Extra queso +$25"]
  notas: string
  precioExtra: number      // sum of extra modifiers
  subtotal: number         // (precio + precioExtra) * cantidad
  silla?: number           // seat/person number (1, 2, 3...)
  station?: 'cocina' | 'barra' | 'caja'  // estación de ruteo, fijada al agregar (por categoría)
  courseId?: number         // 1=Tiempo 1, 2=Tiempo 2, etc. Assigned when tiempo separator is added
  courseStatus?: 'pending' | 'fired' | 'preparing' | 'ready' | 'served'
}

// Keep legacy alias for any other pages that import the old shape
export interface OrderItemLegacy {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: string
  status: 'pendiente' | 'preparando' | 'listo' | 'entregado'
  createdAt: Date
}

export interface ModificadorAgregar {
  name: string
  price: number
}

export const MODIFIERS_QUITAR = [
  'Sin cebolla', 'Sin chile', 'Sin crema', 'Sin queso',
  'Sin pan', 'Sin salsa', 'Sin jitomate', 'Sin aguacate'
]

// Extras by category type
export const MODIFIERS_AGREGAR_FOOD: ModificadorAgregar[] = [
  { name: 'Extra queso', price: 25 },
  { name: 'Extra aguacate', price: 35 },
  { name: 'Extra proteina', price: 45 },
  { name: 'Extra huevo', price: 20 },
  { name: 'Extra salsa', price: 0 },
]

export const MODIFIERS_AGREGAR_COFFEE: ModificadorAgregar[] = [
  { name: 'Shot extra', price: 20 },
  { name: 'Leche de almendra', price: 15 },
  { name: 'Leche de avena', price: 15 },
  { name: 'Leche deslactosada', price: 10 },
  { name: 'Jarabe de vainilla', price: 15 },
  { name: 'Crema batida', price: 10 },
]

export const MODIFIERS_AGREGAR_DRINKS: ModificadorAgregar[] = [
  { name: 'Leche de almendra', price: 15 },
  { name: 'Leche de avena', price: 15 },
  { name: 'Extra fruta', price: 20 },
  { name: 'Proteina whey', price: 25 },
]

export const MODIFIERS_AGREGAR_NONE: ModificadorAgregar[] = []

// Legacy export for compatibility
export const MODIFIERS_AGREGAR = MODIFIERS_AGREGAR_FOOD

// Beverage categories (no "quitar" options, drink-specific extras)
const BEVERAGE_CATEGORIES = ['coffee', 'tea', 'fresh', 'smoothies', 'frappes', 'signature', 'alcohol']
const COFFEE_CATEGORIES = ['coffee', 'tea']
// Items with no modifiers at all (no extras)
const NO_MODIFIER_CATEGORIES = ['sodas', 'cerveza', 'vinos', 'licores']
// Bakery/market — no food extras (no queso/aguacate on conchas)
const BAKERY_CATEGORIES = ['bakery', 'toast', 'postres', 'mkt-cafe', 'mkt-healthy', 'mkt-vitaminas', 'mkt-regalos', 'mkt-amalay']

// Category name → modifier type (for DB categories with UUID ids)
// Mapping validated against AMALAY categories (June 2026):
//   NONE:     Cerveza, Vinos, Licores 2oz, Sodas, Bebidas OH
//   COFFEE:   Coffee Hot/Ice, Tea & Tisanas
//   BEVERAGE: Jugos, Fresh Drinks, Frappes, Smoothies, Signature, Ice Cream
//   BAKERY:   Bakery, Toast & Bagels, Desserts, Market:*, Croissants Breakfast
//   FOOD:     Chilaquiles, Eggs & Keto, Bowls, Ceviche, Paninis, Pizzas & Pastas,
//             Pancakes & Waffles, Appetizers, Everyday Specials, Evento/Menu Temp
export function getModifierTypeFromCategoryName(catName: string): 'none' | 'coffee' | 'beverage' | 'bakery' | 'food' {
  const lower = catName.toLowerCase()
  // NO modifiers at all (packaged/bottled/canned — nothing to customize)
  if (['soda', 'cerveza', 'beer', 'vino', 'licor', '2oz', 'bebidas oh'].some(kw => lower.includes(kw))) return 'none'
  // Coffee modifiers (shots, leches, jarabes)
  if (['coffee', 'café', 'cafe', 'tea', 'tisana'].some(kw => lower.includes(kw))) return 'coffee'
  // Drink modifiers (leches, fruta, proteina)
  if (['jugo', 'fresh drink', 'smoothie', 'frappe', 'signature', 'ice cream', 'helado'].some(kw => lower.includes(kw))) return 'beverage'
  // No food modifiers (no queso/aguacate/proteina — these are bread/retail/sweets)
  if (['bakery', 'panadería', 'toast', 'bagel', 'dessert', 'postre', 'croissant',
       'market', 'healthy', 'vitamina', 'suplemento', 'regalo', 'detalle',
       'marca propia', 'semilla', 'dulce', 'abarrote'].some(kw => lower.includes(kw))) return 'bakery'
  // Food modifiers (extra queso, aguacate, proteina, huevo, salsa)
  // Applies to: Chilaquiles, Eggs, Bowls, Ceviche, Paninis, Pizzas, Pancakes, Appetizers, Specials
  return 'food'
}

// Cache of category id → name (populated by POS on menu load via setCategoryNameCache)
import { _categoryNameCache } from '@/lib/pos-constants'

export function getModifiersForCategory(categoryId: string): {
  quitarOptions: string[]
  agregarOptions: ModificadorAgregar[]
} {
  // Static category ID match first
  if (NO_MODIFIER_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
  }
  if (BAKERY_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
  }
  if (COFFEE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_COFFEE }
  }
  if (BEVERAGE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_DRINKS }
  }
  // DB category name match (UUID ids)
  const catName = _categoryNameCache[categoryId]
  if (catName) {
    const type = getModifierTypeFromCategoryName(catName)
    if (type === 'none' || type === 'bakery') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
    if (type === 'coffee') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_COFFEE }
    if (type === 'beverage') return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_DRINKS }
  }
  // Food items — use recipe ingredients for "quitar", food extras for "agregar"
  return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_FOOD }
}

// ── DB-backed menu loading (fallback to static MENU_CATEGORIES) ─────────────

const _SUPABASE_URL = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL || '' : ''
const _SUPABASE_KEY = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' : ''
const _SB_HEADERS = { apikey: _SUPABASE_KEY, Authorization: `Bearer ${_SUPABASE_KEY}` }

/** Get current client ID from localStorage (set by AuthContext on login). Falls back to 'amalay'. */
function _getClientId(): string {
  if (typeof window === 'undefined') return 'amalay'
  try {
    return localStorage.getItem('fullsite_client_id') || 'amalay'
  } catch { return 'amalay' }
}

/** Public accessor for pages that query Supabase directly (e.g. corte). */
export function getClientId(): string {
  return _getClientId()
}

export async function getMenuCategoriesFromDB(): Promise<MenuCategory[]> {
  try {
    const [catRes, itemsRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_menu_categories?client_id=eq.${_getClientId()}&active=eq.true&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${_getClientId()}&active=eq.true&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])
    if (!catRes.ok || !itemsRes.ok) return MENU_CATEGORIES

    const cats = await catRes.json()
    const items = await itemsRes.json()
    if (!cats.length || !items.length) return MENU_CATEGORIES

    const itemsByCat = new Map<string, MenuItem[]>()
    for (const item of items) {
      const arr = itemsByCat.get(item.category_id) || []
      arr.push({ id: item.id, name: item.name, price: Number(item.price), promo: item.promo, barcode: item.barcode })
      itemsByCat.set(item.category_id, arr)
    }

    return cats.map((cat: { id: string; name: string; color: string }) => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      items: itemsByCat.get(cat.id) || [],
    }))
  } catch {
    return MENU_CATEGORIES
  }
}

/** Forma de pago custom (catálogo pos_payment_methods, estilo Wansoft: Rappi, Ubereats, Cortesía...) */
export interface PaymentMethodDB {
  id: string
  name: string
  /** 'cash' (cuenta para arqueo de efectivo) | 'card' (comisión) | 'other' */
  type: string
  commission_pct?: number
}

export async function getPaymentMethodsFromDB(): Promise<PaymentMethodDB[]> {
  try {
    const res = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_payment_methods?client_id=eq.${_getClientId()}&active=eq.true&select=id,name,type,commission_pct&order=name.asc`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

/** Turno activo (pos_turnos sin closed_at). Devuelve null si no hay turno abierto. */
export async function getActiveTurno(): Promise<{ id: string; fondo_inicial: number; opened_by: string; opened_at: string } | null> {
  try {
    const res = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_turnos?client_id=eq.${_getClientId()}&closed_at=is.null&select=id,fondo_inicial,opened_by,opened_at&order=opened_at.desc&limit=1`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!res.ok) return null
    const rows = await res.json()
    return rows[0] || null
  } catch { return null }
}

// ── Modificadores multinivel (estilo Wansoft: "NIVEL 1: PROTEINA, opcional, máx 2") ──

export interface ModifierGroupDef {
  id: string
  name: string
  /** Nivel Wansoft (1, 2, 3...) — define orden de render */
  level: number
  minSelections: number
  /** null = sin límite */
  maxSelections: number | null
  required: boolean
  options: ModificadorAgregar[]
}

// Modifier groups that should NEVER appear for certain category types
// "Término" (medio/bien cocido) only makes sense for food with meat
const MEAT_ONLY_KEYWORDS = ['término', 'termino', 'cocción', 'coccion', 'bien cocido', 'tres cuartos', 'medio']
function isGroupCompatible(groupName: string, categoryId: string): boolean {
  const catName = _categoryNameCache[categoryId] || ''
  const catType = catName ? getModifierTypeFromCategoryName(catName) : 'food'
  const lowerGroup = groupName.toLowerCase()
  // Meat cooking terms should only appear for food categories
  if (MEAT_ONLY_KEYWORDS.some(kw => lowerGroup.includes(kw))) {
    return catType === 'food'
  }
  // Coffee-specific groups (shots, leches) shouldn't appear for food
  if (['shot', 'leche', 'jarabe', 'syrup'].some(kw => lowerGroup.includes(kw))) {
    return catType === 'coffee' || catType === 'beverage'
  }
  return true
}

/**
 * Grupos de modificadores multinivel para un producto.
 * Asignación por item (pos_item_modifier_groups) + por categoría (pos_category_modifiers).
 * Devuelve [] si no hay grupos configurados — el modal cae al sistema legacy.
 */
export async function getModifierGroupsForItem(itemId: string, categoryId: string): Promise<ModifierGroupDef[]> {
  try {
    const cid = _getClientId()
    const [itemAssignRes, catAssignRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_item_modifier_groups?client_id=eq.${cid}&item_id=eq.${encodeURIComponent(itemId)}&select=group_id`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_category_modifiers?client_id=eq.${cid}&category_id=eq.${encodeURIComponent(categoryId)}&select=modifier_group_id`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])

    const groupIds = new Set<string>()
    if (itemAssignRes.ok) {
      for (const a of await itemAssignRes.json() as { group_id: string }[]) groupIds.add(a.group_id)
    }
    if (catAssignRes.ok) {
      for (const a of await catAssignRes.json() as { modifier_group_id: string }[]) groupIds.add(a.modifier_group_id)
    }
    groupIds.delete('quitar') // legacy group, manejado aparte
    if (groupIds.size === 0) return []

    const idList = [...groupIds].map(encodeURIComponent).join(',')
    const [groupsRes, optsRes] = await Promise.all([
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifier_groups?client_id=eq.${cid}&active=eq.true&id=in.(${idList})&order=level.asc,sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
      fetch(`${_SUPABASE_URL}/rest/v1/pos_modifiers?client_id=eq.${cid}&active=eq.true&group_id=in.(${idList})&order=sort_order.asc`, { headers: _SB_HEADERS, cache: 'no-store' }),
    ])
    if (!groupsRes.ok || !optsRes.ok) return []

    const groups: { id: string; name: string; level: number; min_selections: number; max_selections: number | null; required: boolean }[] = await groupsRes.json()
    const opts: { group_id: string; name: string; price: number }[] = await optsRes.json()

    const optsByGroup = new Map<string, ModificadorAgregar[]>()
    for (const o of opts) {
      const arr = optsByGroup.get(o.group_id) || []
      arr.push({ name: o.name, price: Number(o.price) })
      optsByGroup.set(o.group_id, arr)
    }

    return groups
      .map(g => ({
        id: g.id,
        name: g.name,
        level: Number(g.level) || 1,
        minSelections: Number(g.min_selections) || 0,
        maxSelections: g.max_selections === null ? null : Number(g.max_selections),
        required: Boolean(g.required),
        options: optsByGroup.get(g.id) || [],
      }))
      .filter(g => g.options.length > 0)
      // Filter out incompatible groups (e.g. "Término" on coffee, "Shot" on food)
      .filter(g => isGroupCompatible(g.name, categoryId))
  } catch {
    return []
  }
}

export async function getModifiersForCategoryFromDB(categoryId: string): Promise<{
  quitarOptions: string[]
  agregarOptions: ModificadorAgregar[]
}> {
  try {
    const assignRes = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_category_modifiers?client_id=eq.${_getClientId()}&category_id=eq.${categoryId}&select=modifier_group_id`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!assignRes.ok) return getModifiersForCategory(categoryId)

    const assignments: { modifier_group_id: string }[] = await assignRes.json()
    if (!assignments.length) return { quitarOptions: [], agregarOptions: [] }

    const groupIds = assignments.map(a => a.modifier_group_id)
    const modRes = await fetch(
      `${_SUPABASE_URL}/rest/v1/pos_modifiers?client_id=eq.${_getClientId()}&active=eq.true&group_id=in.(${groupIds.join(',')})&order=sort_order.asc`,
      { headers: _SB_HEADERS, cache: 'no-store' }
    )
    if (!modRes.ok) return getModifiersForCategory(categoryId)

    const mods: { group_id: string; name: string; price: number }[] = await modRes.json()
    return {
      quitarOptions: mods.filter(m => m.group_id === 'quitar').map(m => m.name),
      agregarOptions: mods.filter(m => m.group_id !== 'quitar').map(m => ({ name: m.name, price: Number(m.price) })),
    }
  } catch {
    return getModifiersForCategory(categoryId)
  }
}

// Map POS menu item names → recipe names in database
// This connects every platillo to its recipe for dynamic modifiers + inventory deduction
export const RECIPE_ALIASES: Record<string, string[]> = {
  // Chilaquiles & Enchiladas
  'chilaquiles verdes': ['chilaquiles verdes'],
  'chilaquiles rojos': ['chilaquiles rojos'],
  'chilaquiles light': ['chilaquiles ligth', 'chilaquiles light'],
  'enchiladas suizas': ['enchiladas suizas'],
  // Eggs & Keto
  'machacado con huevo': ['machacado con huevo', 'machaca con huevo'],
  'half & half combo': ['half & half combo'],
  'garden omelet': ['garden omelet', 'garden omelette'],
  'combo fit': ['combo fit'],
  'egg and pancake combo': ['combo kids pancake & eggs'],
  'miss benedict': ['miss. benedict', 'miss benedict- salmon', 'miss benedict panela wallander'],
  // Coffee
  'cafe americano': ['cafe americano'],
  'capuchino caliente': ['capuchino'],
  'cafe latte caliente': ['cafe latte'],
  'latte frio': ['latte frio'],
  'matcha latte frio': ['matcha latte'],
  'chai latte frio': ['chai latte'],
  'mocca latte caliente': ['mocca latte'],
  // Toast & Bagels
  'avocado toast': ['avo toast'],
  'amalay salmon special toast': ['amalay smoked salmon & avocado toast'],
  'el mexicano toast': ['el mexicano toast', 'mexicano'],
  'salmon bagel': ['salmon bagel'],
  // Everyday Specials
  'combo amalay': ['combo amalay'],
  'french toast': ['french toast'],
  // Signature
  'mimosa clasica': ['mimosa clasica'],
  'chamoyada de mango': ['chamoyada de mango'],
  // Croissants
  'croque madame amalay': ['croque madame', 'mumma"s breakfast croissant', "mumy's breakfast croissant"],
  'croissant nutella': ['croissant nutella'],
  'turkey & swiss croissant': ['turkey & swiss croisaint', "nell's turkey & swiss"],
  'croissant almendra': ['croissant almendra'],
  // Jugos
  'jugo de naranja natural': ['jugo de naranja'],
  'jugo verde de la casa': ['jugo verde'],
  'jugo be inmune': ['jugo be inmune'],
  'jugo dr detox': ['jugo dr detox'],
  'jugo u glow': ['jugo u glow'],
  // Fresh Drinks
  'limonada natural': ['limonada natural'],
  'limonada de frutos rojos': ['limonada de frutos rojos'],
  // Smoothies
  'smoothie mango-matcha': ['smoothie mango matcha'],
  'smoothie pink flamingo': ['smoothie pink flamingo'],
  'smoothie tropical coconut': ['smoothie tropical coconut'],
  // Frappes
  'frappe matcha': ['frappe matcha'],
  'frappe mango-maracuya': ['frappe mango maracuya'],
  // Pancakes & Waffles
  'classic pancakes': ['classic buttermilk pancakes', 'classic butermilk pancakes'],
  // Paninis
  'chicken panini': ['turkey pannini', 'turkey panini'],
  // Pizzas & Pastas
  'pasta mamarosa': ['pasta pacceri al pesto'],
  'pizza pepperoni': ['pizza pepperoni'],
  'pizza margarita': ['pizza margarita'],
  // Bowls
  'acai love bowl': ['acai love'],
  'fruit bowl': ['plato de berrys', 'plato granola con berries'],
  // Postres
  'cheesecake': ['cheesecake'],
  'carrot cake': ['carrot cake', 'coffe cake'],
  // Bakery
  'concha de mantequilla': ['concha de mantequilla'],
  'healthy crunchy mix': ['healthy & crunchy', 'healty munchies'],
  // Tea
  'te chai': ['te chai'],
  'te verde': ['te verde'],
}

/** Un pago dentro de una cuenta (pago mixto multi-forma, estilo Wansoft) */
export interface PagoForma {
  metodo: string
  monto: number
}

export interface Order {
  id: string
  mesa: number
  /** Cuenta por nombre (sin mesa, estilo Wansoft "#SR RAUL") — mesa queda en 0 */
  clienteNombre?: string
  mesero: string
  personas: number
  status: 'abierta' | 'enviada' | 'preparando' | 'lista' | 'entregada' | 'cerrada' | 'cancelada'
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  descuento: number
  propina?: number
  metodoPago?: string
  /** Desglose multi-forma del pago (suma = total + propina). Si es pago simple, 1 elemento. */
  pagos?: PagoForma[]
  /** Turno activo (pos_turnos.id) al momento de cerrar */
  turnoId?: string
  notas?: string
  createdAt: Date
  closedAt?: Date
}

export interface Mesa {
  number: number
  capacity: number
  status: 'disponible' | 'ocupada' | 'cuenta'
  orderId?: string
  mesero?: string
  personas?: number
  total?: number
}

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'chilaquiles', name: 'Chilaquiles', color: 'bg-rose-700', items: [
      { id: 'c1a', name: 'Chilaquiles Verdes', price: 292 },
      { id: 'c1b', name: 'Chilaquiles Rojos', price: 292 },
      { id: 'c2', name: 'Chilaquiles Light', price: 304 },
      { id: 'c3', name: 'Enchiladas Suizas', price: 261 },
      { id: 'c4', name: 'Taquitos Amalay', price: 279 },
    ]
  },
  {
    id: 'eggs', name: 'Huevos', color: 'bg-yellow-500', items: [
      { id: 'e1', name: 'Machacado con Huevo', price: 274 },
      { id: 'e2', name: 'Half & Half Combo', price: 287 },
      { id: 'e3', name: 'Garden Omelet', price: 264 },
      { id: 'e4', name: 'Combo Fit', price: 264 },
      { id: 'e5', name: 'Egg and Pancake Combo', price: 277 },
      { id: 'e6', name: 'Miss Benedict', price: 310 },
      { id: 'e7', name: 'Miss Benedict Keto-Panela Wallander', price: 389 },
      { id: 'e8', name: 'Mr. Benedict', price: 351 },
      { id: 'e9', name: 'Benedict Omelet', price: 283 },
    ]
  },
  {
    id: 'coffee', name: 'Café', color: 'bg-amber-700', items: [
      { id: 'cf1', name: 'Cafe Americano', price: 48 },
      { id: 'cf2', name: 'Capuchino Caliente', price: 89 },
      { id: 'cf3', name: 'Cafe Latte Caliente', price: 94 },
      { id: 'cf4', name: 'Latte Frio', price: 102 },
      { id: 'cf5', name: 'Matcha Latte Frio', price: 127 },
      { id: 'cf6', name: 'Chai Latte Frio', price: 122 },
      { id: 'cf7', name: 'Mocca Latte Caliente', price: 100 },
      { id: 'cf8', name: 'Chai Latte Caliente', price: 122 },
      { id: 'cf9', name: 'Mocca Latte Frio', price: 108 },
    ]
  },
  {
    id: 'toast', name: 'Pan & Toast', color: 'bg-orange-500', items: [
      { id: 't1', name: 'Avocado Toast', price: 252 },
      { id: 't2', name: 'Amalay Salmon Special Toast', price: 402 },
      { id: 't3', name: 'El Mexicano Toast', price: 183 },
      { id: 't4', name: 'Salmon Bagel', price: 350 },
    ]
  },
  {
    id: 'signature', name: 'Signature', color: 'bg-purple-600', items: [
      { id: 'sg1', name: 'Mimosa Clasica', price: 160 },
      { id: 'sg2', name: 'Chamoyada de Mango', price: 120 },
    ]
  },
  {
    id: 'croissants', name: 'Croissants', color: 'bg-yellow-600', items: [
      { id: 'cr1', name: 'Croque Madame Amalay', price: 308 },
      { id: 'cr2', name: 'Croissant Nutella', price: 99 },
      { id: 'cr3', name: 'Turkey & Swiss Croissant', price: 285 },
      { id: 'cr4', name: 'Croissant Almendra', price: 99 },
      { id: 'cr5', name: "Mumma's Breakfast Croissant", price: 268 },
    ]
  },
  {
    id: 'jugos', name: 'Jugos', color: 'bg-green-500', items: [
      { id: 'j1', name: 'Jugo de Naranja Natural', price: 78 },
      { id: 'j2', name: 'Jugo Verde de la Casa', price: 98 },
      { id: 'j3', name: 'Jugo Be Inmune', price: 115 },
      { id: 'j4', name: 'Jugo Dr Detox', price: 115 },
      { id: 'j5', name: 'Jugo U Glow', price: 115 },
    ]
  },
  {
    id: 'fresh', name: 'Frescos', color: 'bg-cyan-500', items: [
      { id: 'f1', name: 'Limonada Natural', price: 63 },
      { id: 'f2', name: 'Limonada de Frutos Rojos', price: 62 },
      { id: 'f3', name: 'Limonada de Pepino', price: 62 },
      { id: 'f4', name: 'Jamaica Natural', price: 49 },
      { id: 'f5', name: 'Horchata Natural', price: 49 },
    ]
  },
  {
    id: 'smoothies', name: 'Smoothies', color: 'bg-pink-500', items: [
      { id: 'sm1', name: 'Smoothie Mango-Matcha', price: 221 },
      { id: 'sm2', name: 'Smoothie Pink Flamingo', price: 152 },
      { id: 'sm3', name: 'Smoothie Tropical Coconut', price: 139 },
      { id: 'sm4', name: 'Smoothie Morning Blast', price: 207 },
      { id: 'sm5', name: 'Smoothie Choco-Peanut Butter', price: 175 },
    ]
  },
  {
    id: 'frappes', name: 'Frappes', color: 'bg-indigo-500', items: [
      { id: 'fr1', name: 'Frappe Matcha', price: 124 },
      { id: 'fr2', name: 'Frappe Mango-Maracuya', price: 120 },
      { id: 'fr3', name: 'Frapuccino', price: 135 },
      { id: 'fr4', name: 'Frappe Oreo', price: 132 },
    ]
  },
  {
    id: 'pancakes', name: 'Pancakes', color: 'bg-yellow-400', items: [
      { id: 'pw1', name: 'Classic Pancakes', price: 215 },
      { id: 'pw2', name: 'Paradise Buttermilk Blueberry Pancakes', price: 265 },
      { id: 'pw3', name: 'Red Velvet Pancakes', price: 250 },
    ]
  },
  {
    id: 'paninis', name: 'Paninis', color: 'bg-lime-600', items: [
      { id: 'pn1', name: 'Chicken Panini', price: 296 },
      { id: 'pn2', name: 'Caprese Panini', price: 275 },
    ]
  },
  {
    id: 'pizzas', name: 'Pizzas & Pastas', color: 'bg-rose-600', items: [
      { id: 'pz1', name: 'Pasta Mamarosa', price: 287 },
      { id: 'pz2', name: 'Pizza Pepperoni', price: 245 },
      { id: 'pz3', name: 'Pizza Margarita', price: 220 },
      { id: 'pz4', name: 'Pasta Bolognese', price: 232 },
      { id: 'pz5', name: 'Ribeye Smash Burger', price: 252 },
    ]
  },
  {
    id: 'bowls', name: 'Bowls', color: 'bg-emerald-600', items: [
      { id: 'bw1', name: 'Acai Love Bowl', price: 232 },
      { id: 'bw2', name: 'Fruit Bowl', price: 150 },
    ]
  },
  {
    id: 'postres', name: 'Postres', color: 'bg-fuchsia-500', items: [
      { id: 'ds1', name: 'New York Cheesecake', price: 130 },
      { id: 'ds2', name: 'Carrot Cake', price: 135 },
      { id: 'ds3', name: 'Dark Chocolate Brownie', price: 130 },
      { id: 'ds4', name: 'Tiramisú', price: 145 },
      { id: 'ds5', name: 'Pastel de Chocolate', price: 130 },
    ]
  },
  {
    id: 'ceviche', name: 'Ceviche', color: 'bg-sky-600', items: [
      { id: 'cv1', name: 'Ceviche de Salmon', price: 395 },
      { id: 'cv2', name: 'Ceviche Clasico', price: 320 },
    ]
  },
  {
    id: 'bakery', name: 'Panadería', color: 'bg-amber-500', items: [
      { id: 'bk1', name: 'Concha de Mantequilla', price: 37 },
      { id: 'bk2', name: 'Healthy Crunchy Mix', price: 170 },
    ]
  },
  {
    id: 'sodas', name: 'Sodas', color: 'bg-blue-500', items: [
      { id: 'sd1', name: 'Coca Cola Regular 355ml', price: 34 },
      { id: 'sd2', name: 'Coca Cola Sin Azucar 355ml', price: 60 },
      { id: 'sd3', name: 'Coca Cola Light 355ml', price: 60 },
      { id: 'sd4', name: 'Agua Amalay 500ml', price: 44 },
      { id: 'sd5', name: 'Agua de Piedra Mineral', price: 57 },
      { id: 'sd6', name: 'Agua de Piedra Natural', price: 57 },
    ]
  },
  {
    id: 'tea', name: 'Té', color: 'bg-green-700', items: [
      { id: 'te1', name: 'Te Chai', price: 75 },
      { id: 'te2', name: 'Te Verde', price: 65 },
    ]
  },
  {
    id: 'alcohol', name: 'Bebidas OH', color: 'bg-violet-700', items: [
      { id: 'al1', name: 'Cerveza Artesanal', price: 95 },
      { id: 'al2', name: 'Vino Copa Tinto', price: 150 },
    ]
  },
  {
    id: 'mkt-cafe', name: 'Mkt: Cafe', items: [
      { id: 'mk1', name: 'Cafe Grano 300g', price: 0 },
      { id: 'mk2', name: 'Cafe Grano 500g', price: 0 },
      { id: 'mk3', name: 'Cafe Molido 300g', price: 0 },
      { id: 'mk4', name: 'Cafe Molido 500g', price: 0 },
      { id: 'mk5', name: 'Vaso Cafe Refill', price: 0 },
      { id: 'mk6', name: 'Termo Chico Cafe', price: 0 },
    ]
  },
  {
    id: 'mkt-galletas', name: 'Mkt: Galletas', items: [
      { id: 'mk10', name: 'Galletas Bote Chico 20pz', price: 0 },
      { id: 'mk11', name: 'Galletas Bote 420g', price: 0 },
      { id: 'mk12', name: 'Galletas Bote Mediano 180g', price: 0 },
      { id: 'mk13', name: 'Galletas Paq 3pzs', price: 0 },
      { id: 'mk14', name: 'Galleta Sin Gluten', price: 0 },
      { id: 'mk15', name: 'Nucelli Brownie Vegan', price: 0 },
      { id: 'mk16', name: 'Nucelli Galleta Chocochips', price: 0 },
      { id: 'mk17', name: 'Brule Brownie Brittle', price: 0 },
      { id: 'mk18', name: 'Brule Galleta GF Chocolate', price: 0 },
      { id: 'mk19', name: 'Keto Cookie 120g', price: 0 },
    ]
  },
  {
    id: 'mkt-snacks', name: 'Mkt: Snacks', items: [
      { id: 'mk20', name: 'Healthy Crunch Mix 300g', price: 0 },
      { id: 'mk21', name: 'Healthy Crunch Mix 60g', price: 0 },
      { id: 'mk22', name: 'Mix Enchilado Chico', price: 0 },
      { id: 'mk23', name: 'Mix Enchilado Grande', price: 0 },
      { id: 'mk24', name: 'Mix Salud Omega 3 100g', price: 0 },
      { id: 'mk25', name: 'Pasa Chocolate Amargo 170g', price: 0 },
      { id: 'mk26', name: 'Manglo Mango Enchilado 120g', price: 0 },
      { id: 'mk27', name: 'Manglo Mango Enchilado 300g', price: 0 },
      { id: 'mk28', name: 'Mango Seco Natural 120g', price: 0 },
      { id: 'mk29', name: 'Mango Seco Natural 300g', price: 0 },
      { id: 'mk30', name: 'Chips Pepino Limon 200g', price: 0 },
      { id: 'mk31', name: 'Chips Pepino Salsa 200g', price: 0 },
      { id: 'mk32', name: 'Chips Jamaica 40g', price: 0 },
      { id: 'mk33', name: 'Granola Keto 125g', price: 0 },
      { id: 'mk34', name: 'Granola 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-amaranth', name: 'Mkt: Amaranth', items: [
      { id: 'mk40', name: 'Cacahuate Chipotle 142g', price: 0 },
      { id: 'mk41', name: 'Cacahuate Habanero 142g', price: 0 },
      { id: 'mk42', name: 'Cacahuate Limon 142g', price: 0 },
      { id: 'mk43', name: 'Cacahuate Sal Himalaya 142g', price: 0 },
      { id: 'mk44', name: 'Charris Chipotle 142g', price: 0 },
      { id: 'mk45', name: 'Charris Habanero 142g', price: 0 },
      { id: 'mk46', name: 'Charris Limon 142g', price: 0 },
      { id: 'mk47', name: 'Papas Desh Chipotle 100g', price: 0 },
      { id: 'mk48', name: 'Papas Desh Jalapeno 100g', price: 0 },
      { id: 'mk49', name: 'Obleas Dif Sabores 58g', price: 0 },
    ]
  },
  {
    id: 'mkt-smarty', name: 'Mkt: Smarty Chips', items: [
      { id: 'mk50', name: 'Jicama Adobada 170g', price: 0 },
      { id: 'mk51', name: 'Jicama Adobada 50g', price: 0 },
      { id: 'mk52', name: 'Jicama Habanero 170g', price: 0 },
      { id: 'mk53', name: 'Jicama Limon 170g', price: 0 },
      { id: 'mk54', name: 'Jicama Limon 50g', price: 0 },
      { id: 'mk55', name: 'Jicama Natural 170g', price: 0 },
      { id: 'mk56', name: 'Jicama Natural 50g', price: 0 },
      { id: 'mk57', name: 'Jicama Torito 170g', price: 0 },
      { id: 'mk58', name: 'Jicama Torito 50g', price: 0 },
    ]
  },
  {
    id: 'mkt-sanutri', name: 'Mkt: Sanutri', items: [
      { id: 'mk60', name: 'Churritos Chipotle 300g', price: 0 },
      { id: 'mk61', name: 'Churritos Fuego 300g', price: 0 },
      { id: 'mk62', name: 'Churritos Mix Crunch 300g', price: 0 },
      { id: 'mk63', name: 'Churritos Nopal 300g', price: 0 },
      { id: 'mk64', name: 'Churritos Sal y Limon 300g', price: 0 },
      { id: 'mk65', name: 'Churritos Chile Limon 300g', price: 0 },
      { id: 'mk66', name: 'Churritos Habanero 300g', price: 0 },
    ]
  },
  {
    id: 'mkt-dulces', name: 'Mkt: Dulces', items: [
      { id: 'mk70', name: 'Guayabate Guayaba 100g', price: 0 },
      { id: 'mk71', name: 'Guayabate Tabletas 100g', price: 0 },
      { id: 'mk72', name: 'Guayabate Tejocote 100g', price: 0 },
      { id: 'mk73', name: 'Nubits Tamarindo 30g', price: 0 },
      { id: 'mk74', name: 'Vamara Ciruela Enchilada 250g', price: 0 },
      { id: 'mk75', name: 'Vamara Datil Enchilado 220g', price: 0 },
      { id: 'mk76', name: 'Vamara Mix Enchilado 220g', price: 0 },
      { id: 'mk77', name: 'Vamara Manzana Enchilada 180g', price: 0 },
      { id: 'mk78', name: 'Duraznero Durazno/Chile 250g', price: 0 },
      { id: 'mk79', name: 'Duraznero Fresa/Chile 250g', price: 0 },
      { id: 'mk80', name: 'Duraznero Mango/Chile 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-proteina', name: 'Mkt: Proteina', items: [
      { id: 'mk90', name: 'Habits Cacao 488g', price: 0 },
      { id: 'mk91', name: 'Habits Vainilla 488g', price: 0 },
      { id: 'mk92', name: 'Habits Matcha-Vainilla 488g', price: 0 },
      { id: 'mk93', name: 'Habits Maca-Cacao 488g', price: 0 },
      { id: 'mk94', name: 'Habits Natural 488g', price: 0 },
      { id: 'mk95', name: 'Habits High Perf Cacao 578g', price: 0 },
      { id: 'mk96', name: 'Habits High Perf Vainilla 578g', price: 0 },
      { id: 'mk97', name: 'Habits Creatina 300g', price: 0 },
      { id: 'mk98', name: 'Habits Colageno 250g', price: 0 },
      { id: 'mk99', name: 'Birdman Falcon Chocolate 510g', price: 0 },
      { id: 'mk100', name: 'Birdman Falcon Vainilla 510g', price: 0 },
      { id: 'mk101', name: 'Birdman Fitmingo Moka 510g', price: 0 },
      { id: 'mk102', name: 'Birdman Creatina 450g', price: 0 },
      { id: 'mk103', name: 'Vital Proteins Collagen 567g', price: 0 },
    ]
  },
  {
    id: 'mkt-suplementos', name: 'Mkt: Suplementos', items: [
      { id: 'mk110', name: 'Olly Sleep 50 Gummies', price: 0 },
      { id: 'mk111', name: 'Olly Sleep Extra 70 Gummies', price: 0 },
      { id: 'mk112', name: 'Olly Kids Sleep 50 Gummies', price: 0 },
      { id: 'mk113', name: 'Olly Womens Multi 90pz', price: 0 },
      { id: 'mk114', name: 'Olly Glowing Skin 50 Gummies', price: 0 },
      { id: 'mk115', name: 'Olly Beauty 60 Gummies', price: 0 },
      { id: 'mk116', name: 'Calm Magnesium Raspberry 60pz', price: 0 },
      { id: 'mk117', name: 'Calm Magnesium Orange 453g', price: 0 },
      { id: 'mk118', name: 'Calm Sleep Gummies 240', price: 0 },
      { id: 'mk119', name: 'Force Factor Mushrooms 60pz', price: 0 },
      { id: 'mk120', name: 'Natrol Melatonine 150 Tab', price: 0 },
    ]
  },
  {
    id: 'mkt-te', name: 'Mkt: Te & Infusiones', items: [
      { id: 'mk130', name: 'Te Jengibre Limon 100g', price: 0 },
      { id: 'mk131', name: 'Te Mora de la Selva 220g', price: 0 },
      { id: 'mk132', name: 'Te Petalo Mio 100g', price: 0 },
      { id: 'mk133', name: 'Te Ponche Guayaba 150g', price: 0 },
      { id: 'mk134', name: 'Raices Matcha Mix 125g', price: 0 },
      { id: 'mk135', name: 'Raices Golden Mane 250g', price: 0 },
      { id: 'mk136', name: 'Raices Reishi Cacao 250g', price: 0 },
    ]
  },
  {
    id: 'mkt-lanona', name: 'Mkt: La Nona', items: [
      { id: 'mk140', name: 'Doraditas Keto/Almendras 120g', price: 0 },
      { id: 'mk141', name: 'Doraditas Vegana/Platano 130g', price: 0 },
      { id: 'mk142', name: 'Doraditas Avena/Stevia 130g', price: 0 },
      { id: 'mk143', name: 'Doraditas Chocolate/Avena 130g', price: 0 },
      { id: 'mk144', name: 'Gorditas Avena/Stevia 270g', price: 0 },
      { id: 'mk145', name: 'Gorditas Chocolate/Avena 270g', price: 0 },
    ]
  },
  {
    id: 'mkt-rojamaica', name: 'Mkt: Rojamaica', items: [
      { id: 'mk150', name: 'Chips de Rojamaica 40g', price: 0 },
      { id: 'mk151', name: 'Dip de Rojamaica 320g', price: 0 },
      { id: 'mk152', name: 'Jamaica Enchilada 50g', price: 0 },
      { id: 'mk153', name: 'Salsa Rojamaica 250g', price: 0 },
      { id: 'mk154', name: 'Salsa Rojamaica 520g', price: 0 },
    ]
  },
  {
    id: 'mkt-belleza', name: 'Mkt: Belleza', items: [
      { id: 'mk160', name: 'Hand & Body Lotion 500ml', price: 0 },
      { id: 'mk161', name: 'Hand Wash 500ml', price: 0 },
      { id: 'mk162', name: 'Mali Bronceador Cacao 100ml', price: 0 },
      { id: 'mk163', name: 'Mali Bronceador Carrot 100ml', price: 0 },
      { id: 'mk164', name: 'Mali Bronceador Sun 100ml', price: 0 },
      { id: 'mk165', name: 'Mali Tanning Foam 200ml', price: 0 },
      { id: 'mk166', name: 'Renew Jabon Corporal 355ml', price: 0 },
      { id: 'mk167', name: 'Renew Locion 237ml', price: 0 },
      { id: 'mk168', name: 'Melaleuca Gel', price: 0 },
      { id: 'mk169', name: 'Aceite Melaleuca 15ml', price: 0 },
    ]
  },
  {
    id: 'mkt-accesorios', name: 'Mkt: Accesorios', items: [
      { id: 'mk170', name: 'Taza Ceramica Blanca', price: 0 },
      { id: 'mk171', name: 'Taza Ceramica Verde', price: 0 },
      { id: 'mk172', name: 'Taza Termica', price: 0 },
      { id: 'mk173', name: 'Termo Grande 1.2L', price: 0 },
      { id: 'mk174', name: 'Totebag', price: 0 },
      { id: 'mk175', name: 'Libreta c/ Pluma', price: 0 },
      { id: 'mk176', name: 'Velita Decoracion', price: 0 },
      { id: 'mk177', name: 'Gift Card', price: 0 },
      { id: 'mk178', name: 'Tarjeta de Regalo', price: 0 },
      { id: 'mk179', name: 'Ramekin Corazon', price: 0 },
      { id: 'mk180', name: 'Jarra Infusora', price: 0 },
      { id: 'mk181', name: 'Planta Chica', price: 0 },
      { id: 'mk182', name: 'Planta Grande', price: 0 },
    ]
  },
  {
    id: 'mkt-libros', name: 'Mkt: Libros', items: [
      { id: 'mk190', name: 'Como Hacer Que Te Pasen Cosas Buenas', price: 0 },
      { id: 'mk191', name: 'Encuentra Tu Persona Vitamina', price: 0 },
      { id: 'mk192', name: 'Human Kind', price: 0 },
      { id: 'mk193', name: 'Kidness', price: 0 },
      { id: 'mk194', name: 'Las Cosas Que No Nos Dijeron', price: 0 },
      { id: 'mk195', name: 'Recupera Tu Mente', price: 0 },
      { id: 'mk196', name: 'The Hidden Power', price: 0 },
      { id: 'mk197', name: 'The War For Kidness', price: 0 },
    ]
  },
]

export const MESEROS = [
  'Omar Aguilera',
  'Hector Enrique Rodriguez Lopez',
  'Brayan Berlanga Solis',
  'Daniela Edith Rico Segura',
  'Julio Cesar Hernández Hernández',
  'Oscar Rios Alvarado',
  'Mauricio Rodriguez Rodriguez',
  'Alexis Alejandro Ocampo Vera',
  'Aldo Ruiz Ramirez',
  'Mariana Carolina Salas Alva',
  'Mario García Ramírez',
  'MESERO EVENTO',
]

// IVA_RATE lives in pos-constants.ts (single source of truth)

// Mesa config — layout real AMALAY (plano físico, foto 2026-06-10)
// Zonas: entrada (45,1-4), lámparas (5-9), pasillo (43,44), terraza (20,21,30-32,40-42),
// barra (10-12), toldo (50-55), privado (60-63)
const DEFAULT_MESA_NUMBERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  20, 21, 30, 31, 32, 40, 41, 42, 43, 44, 45,
  50, 51, 52, 53, 54, 55, 60, 61, 62, 63,
]
// Capacidades segun las sillas dibujadas en el plano fisico
const MESA_CAPACITY: Record<number, number> = {
  30: 8,                // redonda grande terraza (8 sillas)
  40: 6, 41: 6, 42: 6,  // rectangulares grandes terraza (6 sillas)
  // resto: 4 sillas
}
export const MESAS_CONFIG: Mesa[] = DEFAULT_MESA_NUMBERS.map(n => ({
  number: n,
  capacity: MESA_CAPACITY[n] ?? 4,
  status: 'disponible' as const,
}))

export function formatMXN(amount: number): string {
  const safe = typeof amount === 'number' && !isNaN(amount) ? Math.round(amount * 100) / 100 : 0
  return `$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`
}

// ─── Supabase persistence ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function saveOrder(order: Order): Promise<boolean> {
  const orderData: Record<string, unknown> = {
    client_id: _getClientId(),
    mesa: order.mesa,
    customer_name: order.clienteNombre ?? null,
    mesero: order.mesero,
    personas: order.personas,
    status: order.status,
    subtotal: order.subtotal,
    iva: order.iva,
    total: order.total,
    descuento: order.descuento,
    propina: order.propina ?? 0,
    metodo_pago: order.metodoPago ?? null,
    pagos: order.pagos && order.pagos.length > 0 ? order.pagos : null,
    turno_id: order.turnoId ?? null,
    notas: order.notas ?? null,
    items: JSON.stringify(order.items),
    closed_at: order.closedAt ? order.closedAt.toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  try {
    const post = (body: Record<string, unknown>) => fetch(`${SUPABASE_URL}/rest/v1/pos_orders`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
    })
    let res = await post({ id: order.id, ...orderData })
    if (!res.ok && res.status === 400) {
      // Columnas pagos/turno_id aún no existen en Supabase — reintenta sin ellas
      const { pagos: _p, turno_id: _t, ...legacy } = orderData
      res = await post({ id: order.id, ...legacy })
    }
    if (!res.ok) {
      console.warn(`[saveOrder] Failed: ${res.status} ${res.statusText}`)
    }
    return res.ok
  } catch {
    // Offline — save to IndexedDB queue (with localStorage fallback)
    if (typeof window !== 'undefined') {
      try {
        const { queueOperation, cacheOrder } = await import('@/lib/pos-offline-db')
        await queueOperation('pos_orders', 'POST', { id: order.id, ...orderData })
        // created_at local para que el KDS offline pueda mostrar tiempos
        await cacheOrder({ id: order.id, created_at: new Date().toISOString(), ...orderData })
      } catch {
        // Fallback to localStorage if IndexedDB fails
        const queue = JSON.parse(localStorage.getItem('fullsite_offline_queue') || '[]')
        queue.push({ table: 'pos_orders', data: { id: order.id, ...orderData }, timestamp: Date.now(), synced: false })
        localStorage.setItem('fullsite_offline_queue', JSON.stringify(queue))
      }
      console.log('[offline] Order saved to queue — will sync when online')
    }
    return true // Return true so the UI continues normally
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'cerrada') body.closed_at = new Date().toISOString()

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    )
    return res.ok
  } catch {
    // Offline — queue the update for sync
    if (typeof window !== 'undefined') {
      try {
        const { queueOperation, getCachedOrders, cacheOrder } = await import('@/lib/pos-offline-db')
        await queueOperation('pos_orders', 'PATCH', body, `pos_orders?id=eq.${orderId}`)
        // Reflejar el cambio en la caché local para que el KDS offline lo muestre
        const cached = (await getCachedOrders()).find(o => o.id === orderId)
        if (cached) await cacheOrder({ ...cached, ...body })
      } catch {
        const queue = JSON.parse(localStorage.getItem('fullsite_offline_queue') || '[]')
        queue.push({ table: 'pos_orders', method: 'PATCH', endpoint: `pos_orders?id=eq.${orderId}`, data: body, timestamp: Date.now(), synced: false })
        localStorage.setItem('fullsite_offline_queue', JSON.stringify(queue))
      }
      console.log(`[offline] Order ${orderId} status=${status} queued for sync`)
    }
    return true
  }
}

export interface KitchenOrderFromDB {
  id: string
  mesa: number
  mesero: string
  status: string
  items: string // JSON string of OrderItem[]
  created_at: string
  notas: string | null
}

export async function getKitchenOrders(): Promise<KitchenOrderFromDB[]> {
  // Only fetch today's orders (not ancient ones stuck in "enviada")
  const today = new Date()
  today.setHours(today.getHours() - 12) // Last 12 hours
  const cutoff = today.toISOString()

  let orders: KitchenOrderFromDB[]
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_orders?status=in.(enviada,preparando,lista)&client_id=eq.${_getClientId()}&created_at=gte.${cutoff}&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        cache: 'no-store',
      }
    )
    if (!res.ok) return []
    orders = await res.json()
  } catch {
    // Offline — mostrar las órdenes cacheadas en este dispositivo (IndexedDB)
    if (typeof window === 'undefined') return []
    try {
      const { getCachedOrders } = await import('@/lib/pos-offline-db')
      const cached = await getCachedOrders()
      orders = cached.filter(o =>
        ['enviada', 'preparando', 'lista'].includes(String(o.status)) &&
        String(o.created_at || o.updated_at || '') >= cutoff
      ) as unknown as KitchenOrderFromDB[]
    } catch {
      return []
    }
  }

  // Deduplicate by mesa+mesero+items (same order sent twice)
  const seen = new Set<string>()
  return orders.filter(o => {
    const key = `${o.mesa}-${o.mesero}-${o.items}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── BLINDAJE: Audit Trail (nothing deleteable) ────────────────────────────

export type AuditAction =
  | 'order_created'
  | 'order_sent_kitchen'
  | 'order_closed'
  | 'order_cancelled'
  | 'item_added'
  | 'item_modified'
  | 'item_cancelled'
  | 'quantity_changed'
  | 'discount_applied'
  | 'discount_removed'
  | 'status_changed'
  | 'payment_processed'
  | 'preticket_printed'
  | 'merma_registered'
  | 'inventory_adjusted'
  | 'tiempo_fired'
  | 'silla_changed'
  | 'delivery_created'
  | 'delivery_assigned'
  | 'delivery_status_changed'
  | 'delivery_closed'
  | 'comandas_print_off'
  | 'comandas_print_on'
  | 'mesa_transferred'
  | 'cash_retiro'
  | 'cash_deposito'
  | 'item_voided'
  | 'combo_added'
  | 'ticket_reprinted'

export interface AuditEvent {
  client_id?: string
  order_id?: string
  action: AuditAction
  actor: string
  mesa?: number
  details?: Record<string, unknown>
  reason?: string
  approved_by?: string
}

export async function logAudit(event: AuditEvent): Promise<boolean> {
  const payload = {
    client_id: event.client_id || _getClientId(),
    order_id: event.order_id || null,
    action: event.action,
    actor: event.actor,
    mesa: event.mesa ?? null,
    details: event.details ? JSON.stringify(event.details) : null,
    reason: event.reason || null,
    approved_by: event.approved_by || null,
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_audit_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    })
    if (res.ok) return true
    // HTTP error — queue for offline sync
    throw new Error(`${res.status}`)
  } catch {
    // Network error or HTTP error — queue for sync so audit events are never lost
    if (typeof window !== 'undefined') {
      try {
        const { queueOperation } = await import('@/lib/pos-offline-db')
        await queueOperation('pos_audit_log', 'POST', payload)
        console.log(`[audit] Queued for offline sync: ${event.action}`)
        return true
      } catch { /* IndexedDB unavailable */ }
    }
    return false
  }
}

export interface AuditLogEntry {
  id: number
  client_id: string
  order_id: string | null
  action: string
  actor: string
  mesa: number | null
  details: string | null
  reason: string | null
  approved_by: string | null
  created_at: string
}

export async function getAuditLog(limit = 100, offset = 0): Promise<AuditLogEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_audit_log?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}&offset=${offset}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getAuditLogForOrder(orderId: string): Promise<AuditLogEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_audit_log?client_id=eq.${_getClientId()}&order_id=eq.${orderId}&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  return res.json()
}

// Simple hash for PIN cache keys — keeps plaintext out of localStorage.
// Uses btoa(pin) as a deterministic, non-reversible-enough obfuscation for cache keying.
// (Not cryptographic — purpose is to avoid storing raw PINs, not to resist an attacker
//  with full localStorage access; that threat is out of scope for an in-person POS.)
function _pinCacheKey(pin: string): string {
  return btoa(pin)
}

// Validación server-side de PIN de gerente (cancelaciones, descuentos, cortes).
// Antes venía de NEXT_PUBLIC_MANAGER_PINS (expuesto en el bundle) — ahora valida
// contra /api/pos/pin con manager=true (pos_staff admin/gerente + env server-only).
// Cachea éxitos en localStorage para fallback offline.
export async function verifyManagerPin(pin: string): Promise<string | null> {
  if (!pin) return null
  try {
    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: _getClientId(), manager: true }),
    })
    if (res.ok) {
      const { staff } = await res.json()
      if (staff?.name) {
        try {
          const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
          cached[_pinCacheKey(pin)] = { name: staff.name, role: staff.role || 'gerente', cached_at: Date.now() }
          localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
        } catch { /* ignore */ }
        return staff.name as string
      }
      return null
    }
    if (res.status === 401 || res.status === 400) return null
  } catch { /* offline → fallback al cache */ }
  // Fallback offline: PINs validados previamente (máx 8 horas — un turno)
  try {
    const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    const entry = cached[_pinCacheKey(pin)]
    if (entry?.name && Date.now() - (entry.cached_at || 0) < 15 * 60 * 1000) { // 15 min TTL
      return entry.name as string
    }
  } catch { /* ignore */ }
  return null
}

/** Like verifyManagerPin but also returns the role — used for permission checks */
export async function verifyManagerPinWithRole(pin: string): Promise<{ name: string; role: string } | null> {
  if (!pin) return null
  try {
    const { apiUrl } = await import('./api-base')
    const res = await fetch(apiUrl('/api/pos/pin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: _getClientId(), manager: true }),
    })
    if (res.ok) {
      const { staff } = await res.json()
      if (staff?.name) {
        const role = staff.role || 'gerente'
        try {
          const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
          cached[_pinCacheKey(pin)] = { name: staff.name, role, cached_at: Date.now() }
          localStorage.setItem('pos_manager_pin_cache', JSON.stringify(cached))
        } catch { /* ignore */ }
        return { name: staff.name, role }
      }
      return null
    }
    if (res.status === 401 || res.status === 400) return null
  } catch { /* offline → fallback al cache */ }
  // Fallback offline (máx 8 horas — un turno)
  try {
    const cached = JSON.parse(localStorage.getItem('pos_manager_pin_cache') || '{}')
    const entry = cached[_pinCacheKey(pin)]
    if (entry?.name && Date.now() - (entry.cached_at || 0) < 15 * 60 * 1000) { // 15 min TTL
      return { name: entry.name, role: entry.role || 'gerente' }
    }
  } catch { /* ignore */ }
  return null
}

// ─── INVENTORY & RECIPES ────────────────────────────────────────────────────

export interface Ingredient {
  id: string
  client_id: string
  name: string
  unit: string
  cost_per_unit: number
  category: string
  supplier: string
  yield_factor: number
  active: boolean
}

export interface RecipeRow {
  id: number
  menu_item_id: string
  menu_item_name: string
  ingredient_id: string
  quantity: number
  unit: string
  // joined
  ingredient_name?: string
  ingredient_unit?: string
}

export interface InventoryItem {
  id: number
  ingredient_id: string
  stock: number
  reorder_point: number
  reorder_quantity: number
  last_restock: string | null
  updated_at: string
  // joined
  ingredient_name?: string
  ingredient_unit?: string
  ingredient_category?: string
  ingredient_cost?: number
}

export interface InventoryMovement {
  id: number
  ingredient_id: string
  movement_type: string
  quantity: number
  order_id: string | null
  actor: string | null
  notes: string | null
  created_at: string
}

// ─── Ingredients CRUD ───────────────────────────────────────────────────────

export async function getIngredients(): Promise<Ingredient[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&order=name.asc&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── Recipes CRUD ───────────────────────────────────────────────────────────

export async function getRecipes(): Promise<RecipeRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_getClientId()}&order=menu_item_name.asc&limit=5000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getRecipeForItem(menuItemId: string): Promise<RecipeRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes_old?client_id=eq.${_getClientId()}&menu_item_id=eq.${encodeURIComponent(menuItemId)}&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function saveRecipeRow(row: { menu_item_id: string; menu_item_name: string; ingredient_id: string; quantity: number; unit: string }): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes_old`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ client_id: _getClientId(), ...row }),
  })
  return res.ok
}

export async function deleteRecipeRow(id: number): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes_old?id=eq.${id}`,
    { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  return res.ok
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
  // Get inventory + join ingredient info client-side
  const [invRes, ingRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_getClientId()}&order=ingredient_id.asc&limit=2000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&limit=2000`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    ),
  ])
  if (!invRes.ok || !ingRes.ok) return []
  const inv: InventoryItem[] = await invRes.json()
  const ing: Ingredient[] = await ingRes.json()
  const ingMap = new Map(ing.map(i => [i.id, i]))
  return inv.map(item => {
    const ingredient = ingMap.get(item.ingredient_id)
    return {
      ...item,
      ingredient_name: ingredient?.name ?? item.ingredient_id,
      ingredient_unit: ingredient?.unit ?? '',
      ingredient_category: ingredient?.category ?? '',
      ingredient_cost: ingredient ? (ingredient.cost_per_unit / (ingredient.yield_factor || 1)) : 0,
      ingredient_yield: ingredient?.yield_factor ?? 1,
      ingredient_raw_cost: ingredient?.cost_per_unit ?? 0,
    }
  })
}

export async function updateInventoryStock(ingredientId: string, newStock: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_getClientId()}&ingredient_id=eq.${ingredientId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ stock: newStock, updated_at: new Date().toISOString() }),
      }
    )
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation(
        `pos_inventory?client_id=eq.${_getClientId()}&ingredient_id=eq.${ingredientId}`,
        'PATCH',
        { stock: newStock, updated_at: new Date().toISOString() },
      )
      console.warn(`[inventory] Offline: queued stock update for ${ingredientId} → ${newStock}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

// COMPAT BRIDGE: ingredient_id (TEXT) is a temporary compatibility column.
// pos_inventory_movements was migrated to product_id (BIGINT → pos_inventory_products),
// but all POS code still operates on the legacy pos_ingredients model.
// When the full inventory migration is complete, replace ingredient_id with product_id.
// See docs/INVENTORY-MIGRATION.md for the migration plan.
export async function logInventoryMovement(movement: {
  ingredient_id: string; movement_type: string; quantity: number;
  order_id?: string; actor?: string; notes?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ client_id: _getClientId(), ...movement }),
    })
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue movement for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_inventory_movements', 'POST', {
        client_id: _getClientId(), ...movement,
      })
      console.warn(`[inventory] Offline: queued movement for ${movement.ingredient_id}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

// ─── Auto-deduction: deduct recipe ingredients when order sent to kitchen ───

export async function deductIngredientsForOrder(
  items: OrderItem[],
  orderId: string,
  actor: string,
): Promise<{ success: boolean; deductions: { ingredient: string; amount: number; unit: string; newStock: number }[]; alerts: string[] }> {
  try {
  // 1. Get all recipes
  const recipes = await getRecipes()
  const inventory = await getInventory()
  const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

  const deductions: { ingredient: string; amount: number; unit: string; newStock: number }[] = []
  const alerts: string[] = []

  // 2. For each order item, find matching recipe and deduct
  // Normalize: strip prefixes, size suffixes, temperature variants
  const normalizeRecipeName = (n: string) => n.toLowerCase()
    .replace(/^sprw\s*-\s*/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*(14oz|16oz|12oz|360\s*ml|240\s*ml|180\s*ml|450\s*ml)\s*/gi, ' ')
    .replace(/\s*(caliente|frio|fría|helado|servido)\s*/gi, ' ')
    .replace(/\s*(media porción|para compartir|1\/2)\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim()

  const recipesByName = new Map<string, typeof recipes>()
  const recipesByNorm = new Map<string, typeof recipes>()
  for (const r of recipes) {
    const key = r.menu_item_name.toLowerCase()
    if (!recipesByName.has(key)) recipesByName.set(key, [])
    recipesByName.get(key)!.push(r)
    const norm = normalizeRecipeName(r.menu_item_name)
    if (!recipesByNorm.has(norm)) recipesByNorm.set(norm, [])
    recipesByNorm.get(norm)!.push(r)
  }

  for (const item of items) {
    const itemName = item.nombre.toLowerCase()
    const itemNorm = normalizeRecipeName(item.nombre)
    let recipeRows: typeof recipes = []

    // Priority 1: use alias map
    const aliases = RECIPE_ALIASES[itemName]
    if (aliases) {
      for (const alias of aliases) {
        const rows = recipesByName.get(alias.toLowerCase())
        if (rows && rows.length > 0) { recipeRows = rows; break }
      }
    }

    // Priority 2: exact match on recipe name
    if (recipeRows.length === 0) {
      recipeRows = recipesByName.get(itemName) ?? []
    }

    // Priority 3: normalized match (strips prefixes, sizes, temperature)
    if (recipeRows.length === 0) {
      recipeRows = recipesByNorm.get(itemNorm) ?? []
    }

    // Priority 4: best partial match (normalized)
    if (recipeRows.length === 0) {
      let bestMatch: { name: string; rows: typeof recipes } | null = null
      let bestScore = 0
      for (const [name, rows] of recipesByNorm) {
        if (name.length < 3 || itemNorm.length < 3) continue // skip very short names
        if (name.includes(itemNorm) || itemNorm.includes(name)) {
          // Score: prefer closest length match (avoid "HUEVO" matching "MACHACADO CON HUEVO")
          const score = Math.min(name.length, itemNorm.length) / Math.max(name.length, itemNorm.length)
          if (score > bestScore && score > 0.5) { // at least 50% overlap
            bestScore = score
            bestMatch = { name, rows }
          }
        }
      }
      if (bestMatch) recipeRows = bestMatch.rows
    }

    if (recipeRows.length === 0) continue

    for (const row of recipeRows) {
      const deductAmount = row.quantity * item.cantidad
      const inv = invMap.get(row.ingredient_id)
      if (!inv) continue

      const actualDeduction = Math.min(deductAmount, inv.stock) // never deduct more than available
      const newStock = Math.max(0, inv.stock - deductAmount)

      // Update stock
      await updateInventoryStock(row.ingredient_id, newStock)

      // Log movement (log actual amount deducted, not requested)
      await logInventoryMovement({
        ingredient_id: row.ingredient_id,
        movement_type: 'deduction',
        quantity: -actualDeduction,
        order_id: orderId,
        actor,
        notes: `${item.cantidad}x ${item.nombre}${actualDeduction < deductAmount ? ' (stock insuficiente)' : ''}`,
      })

      deductions.push({
        ingredient: inv.ingredient_name ?? row.ingredient_id,
        amount: actualDeduction,
        unit: row.unit || inv.ingredient_unit || '',
        newStock,
      })

      // Check reorder point
      if (newStock <= inv.reorder_point) {
        alerts.push(`${inv.ingredient_name}: ${newStock.toFixed(2)} ${inv.ingredient_unit} (punto de reorden: ${inv.reorder_point})`)
      }

      // Update local map
      inv.stock = newStock
    }
  }

  return { success: true, deductions, alerts }
  } catch (err) {
    console.warn('[deductIngredientsForOrder] Failed:', err)
    return { success: false, deductions: [], alerts: ['Error al descontar inventario'] }
  }
}

/** Reverse ingredient deduction for a cancelled item (return stock) */
export async function reverseIngredientDeduction(
  item: OrderItem,
  orderId: string,
  actor: string,
  reason: string,
): Promise<void> {
  try {
    const recipes = await getRecipes()
    const inventory = await getInventory()
    const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

    const normalizeRecipeName = (n: string) => n.toLowerCase()
      .replace(/^sprw\s*-\s*/i, '').replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s*(14oz|16oz|12oz|360\s*ml|240\s*ml|180\s*ml|450\s*ml)\s*/gi, ' ')
      .replace(/\s*(caliente|frio|fría|helado|servido)\s*/gi, ' ')
      .replace(/\s+/g, ' ').trim()

    const recipesByName = new Map<string, typeof recipes>()
    for (const r of recipes) {
      const key = r.menu_item_name.toLowerCase()
      if (!recipesByName.has(key)) recipesByName.set(key, [])
      recipesByName.get(key)!.push(r)
      const norm = normalizeRecipeName(r.menu_item_name)
      if (!recipesByName.has(norm)) recipesByName.set(norm, [])
      recipesByName.get(norm)!.push(r)
    }

    const itemName = item.nombre.toLowerCase()
    const aliases = RECIPE_ALIASES[itemName]
    let recipeRows: typeof recipes = []
    if (aliases) {
      for (const alias of aliases) {
        const rows = recipesByName.get(alias.toLowerCase())
        if (rows && rows.length > 0) { recipeRows = rows; break }
      }
    }
    if (recipeRows.length === 0) recipeRows = recipesByName.get(itemName) ?? []
    if (recipeRows.length === 0) recipeRows = recipesByName.get(normalizeRecipeName(item.nombre)) ?? []

    for (const row of recipeRows) {
      const qty = row.quantity * (item.cantidad || 1)
      const inv = invMap.get(row.ingredient_id)
      if (inv) {
        await updateInventoryStock(row.ingredient_id, inv.stock + qty)
        await logInventoryMovement({
          ingredient_id: row.ingredient_id,
          movement_type: 'adjustment',
          quantity: qty,
          order_id: orderId,
          actor,
          notes: `Cancelacion: ${item.nombre} — ${reason}`,
        })
      }
    }
  } catch (err) {
    console.warn('[reverseIngredientDeduction] Failed:', err)
  }
}

export async function getInventoryMovements(limit = 50): Promise<InventoryMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_inventory_movements?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── MARKET INVENTORY (retail 1:1 — categorías mkt-*) ───────────────────────
// El Market no usa recetas: vender 1 unidad descuenta 1 unidad de stock.
// Tablas: pos_market_stock (por menu_item_id) + pos_market_movements (audit).

export const MARKET_CATEGORY_PREFIX = 'mkt-'
// Categories that deduct 1:1 from pos_market_stock (no recipe needed — bottled/packaged)
// Categories that deduct 1:1 from pos_market_stock (no recipe needed — bottled/packaged/retail)
// Bebidas preparadas (coffee, frappes, jugos, smoothies, tea, fresh, alcohol) SÍ necesitan receta
// para descontar ingredientes — pero si no tienen receta, al menos deducen de market stock.
export const DIRECT_STOCK_CATEGORIES = [
  'mkt-healthy', 'mkt-vitaminas', 'mkt-regalos', 'mkt-amalay', // Market retail
  'cerveza', 'vinos', 'licores', 'sodas', 'icecream', 'bakery', // Embotellados/empacados
  'postres', // Postres pre-hechos
]

export interface MarketStockRow {
  id: number
  menu_item_id: string
  stock: number
  reorder_point: number
  reorder_quantity: number
  last_restock: string | null
  updated_at: string
  // joined desde pos_menu_items
  item_name?: string
  item_price?: number
  item_barcode?: string
  category_id?: string
}

export interface MarketMovement {
  id: number
  menu_item_id: string
  movement_type: string  // 'venta' | 'entrada' | 'merma' | 'ajuste'
  quantity: number
  order_id: string | null
  actor: string | null
  notes: string | null
  created_at: string
  item_name?: string
}

export interface MarketMenuItemLite {
  id: string
  name: string
  price: number
  barcode: string | null
  category_id: string
}

/** Lógica pura de descuento Market (testeable): agrega cantidades por item,
 *  floor en 0 (nunca stock negativo), alerta si cae al punto de reorden. */
export function computeMarketDeductions(
  items: { menuItemId: string; cantidad: number }[],
  marketIds: Set<string>,
  stockMap: Map<string, { stock: number; reorder_point: number }>,
): { menu_item_id: string; cantidad: number; newStock: number; alert: boolean; faltante: number }[] {
  const totals = new Map<string, number>()
  for (const it of items) {
    if (!marketIds.has(it.menuItemId)) continue
    totals.set(it.menuItemId, (totals.get(it.menuItemId) ?? 0) + it.cantidad)
  }
  const out: { menu_item_id: string; cantidad: number; newStock: number; alert: boolean; faltante: number }[] = []
  for (const [id, cantidad] of totals) {
    const row = stockMap.get(id) ?? { stock: 0, reorder_point: 0 }
    const newStock = Math.max(0, row.stock - cantidad)
    out.push({
      menu_item_id: id,
      cantidad,
      newStock,
      alert: newStock <= row.reorder_point,
      faltante: Math.max(0, cantidad - row.stock),
    })
  }
  return out
}

export async function getMarketMenuItems(): Promise<MarketMenuItemLite[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${_getClientId()}&category_id=like.${MARKET_CATEGORY_PREFIX}*&active=eq.true&select=id,name,price,barcode,category_id&order=name.asc&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  const rows = await res.json()
  return rows.map((r: { id: string; name: string; price: number; barcode: string | null; category_id: string }) => ({
    ...r, price: Number(r.price),
  }))
}

export async function getMarketStock(): Promise<MarketStockRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_market_stock?client_id=eq.${_getClientId()}&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

/** Upsert de stock por menu item (crea la fila si no existe). */
export async function upsertMarketStock(
  menuItemId: string,
  fields: { stock?: number; reorder_point?: number; reorder_quantity?: number; last_restock?: string },
): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_market_stock?on_conflict=client_id,menu_item_id`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          client_id: _getClientId(), menu_item_id: menuItemId,
          ...fields, updated_at: new Date().toISOString(),
        }),
      }
    )
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_market_stock?on_conflict=client_id,menu_item_id', 'POST', {
        client_id: _getClientId(), menu_item_id: menuItemId,
        ...fields, updated_at: new Date().toISOString(),
      })
      console.warn(`[market] Offline: queued stock update for ${menuItemId}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

export async function logMarketMovement(movement: {
  menu_item_id: string; movement_type: string; quantity: number;
  order_id?: string; actor?: string; notes?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_market_movements`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ client_id: _getClientId(), ...movement }),
    })
    if (!res.ok) throw new Error(`POST failed: ${res.status}`)
    return true
  } catch {
    // OFFLINE: queue movement for sync
    try {
      const { queueOperation } = await import('./pos-offline-db')
      await queueOperation('pos_market_movements', 'POST', {
        client_id: _getClientId(), ...movement,
      })
      console.warn(`[market] Offline: queued movement for ${movement.menu_item_id}`)
    } catch { /* IndexedDB unavailable */ }
    return false
  }
}

export async function getMarketMovements(limit = 50): Promise<MarketMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_market_movements?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

/** Entrada / merma / ajuste manual: actualiza stock y deja audit trail. */
export async function registerMarketMovement(
  menuItemId: string,
  type: 'entrada' | 'merma' | 'ajuste',
  quantity: number,  // entrada: +n | merma: n (se registra -n) | ajuste: stock final deseado
  actor: string,
  notes?: string,
): Promise<{ ok: boolean; newStock: number }> {
  const rows = await getMarketStock()
  const current = rows.find(r => r.menu_item_id === menuItemId)
  const stock = current?.stock ?? 0
  let newStock: number
  let delta: number
  if (type === 'entrada') { delta = Math.abs(quantity); newStock = stock + delta }
  else if (type === 'merma') { delta = -Math.abs(quantity); newStock = Math.max(0, stock + delta) }
  else { newStock = Math.max(0, quantity); delta = newStock - stock }

  const ok = await upsertMarketStock(menuItemId, {
    stock: newStock,
    ...(type === 'entrada' ? { last_restock: new Date().toISOString() } : {}),
  })
  if (ok) {
    await logMarketMovement({ menu_item_id: menuItemId, movement_type: type, quantity: delta, actor, notes })
  }
  return { ok, newStock }
}

/** Descuento automático al vender items Market (espejo de deductIngredientsForOrder). */
export async function deductMarketStockForOrder(
  items: OrderItem[],
  orderId: string,
  actor: string,
): Promise<{ success: boolean; deductions: { item: string; cantidad: number; newStock: number }[]; alerts: string[] }> {
  try {
    const ids = [...new Set(items.map(i => i.menuItemId).filter(Boolean))]
    if (ids.length === 0) return { success: true, deductions: [], alerts: [] }

    // 1. ¿Cuáles items de la orden son de stock directo (Market, cerveza, sodas, vinos, licores, bakery, ice cream)?
    const catFilter = DIRECT_STOCK_CATEGORIES.map(c => `category_id.eq.${c}`).join(',')
    const itemsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_menu_items?client_id=eq.${_getClientId()}&id=in.(${ids.join(',')})&or=(${catFilter})&select=id,name`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!itemsRes.ok) return { success: false, deductions: [], alerts: [] }
    const marketItems: { id: string; name: string }[] = await itemsRes.json()
    if (marketItems.length === 0) return { success: true, deductions: [], alerts: [] }
    const nameById = new Map(marketItems.map(m => [m.id, m.name]))

    // 2. Stock actual de esos items
    const stockRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_market_stock?client_id=eq.${_getClientId()}&menu_item_id=in.(${marketItems.map(m => m.id).join(',')})`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    const stockRows: MarketStockRow[] = stockRes.ok ? await stockRes.json() : []
    const stockMap = new Map(stockRows.map(r => [r.menu_item_id, { stock: r.stock, reorder_point: r.reorder_point }]))

    // 3. Descontar + audit
    const computed = computeMarketDeductions(
      items.map(i => ({ menuItemId: i.menuItemId, cantidad: i.cantidad })),
      new Set(marketItems.map(m => m.id)),
      stockMap,
    )
    const deductions: { item: string; cantidad: number; newStock: number }[] = []
    const alerts: string[] = []
    for (const d of computed) {
      const name = nameById.get(d.menu_item_id) ?? d.menu_item_id
      await upsertMarketStock(d.menu_item_id, { stock: d.newStock })
      await logMarketMovement({
        menu_item_id: d.menu_item_id,
        movement_type: 'venta',
        quantity: -d.cantidad,
        order_id: orderId,
        actor,
        notes: d.faltante > 0 ? `stock insuficiente (faltaban ${d.faltante})` : undefined,
      })
      deductions.push({ item: name, cantidad: d.cantidad, newStock: d.newStock })
      if (d.alert) alerts.push(`${name}: ${d.newStock} pzas (punto de reorden)`)
    }
    return { success: true, deductions, alerts }
  } catch (err) {
    console.warn('[deductMarketStockForOrder] Failed:', err)
    return { success: false, deductions: [], alerts: [] }
  }
}

// ─── PURCHASE ORDERS & FACTURAS ─────────────────────────────────────────────

export interface PurchaseOrder {
  id: string
  client_id: string
  supplier: string
  status: string
  created_by: string
  approved_by: string | null
  notes: string | null
  subtotal: number
  iva: number
  total: number
  ai_suggested: boolean
  sent_at: string | null
  received_at: string | null
  received_by: string | null
  created_at: string
  items?: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
  id: number
  order_id: string
  ingredient_id: string
  ingredient_name: string
  quantity_ordered: number
  quantity_received: number | null
  unit: string
  unit_cost: number
  total_cost: number
}

export interface Factura {
  id: string
  client_id: string
  purchase_order_id: string | null
  supplier: string
  folio: string | null
  subtotal: number
  iva: number
  total: number
  status: string
  captured_by: string
  approved_by: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
}

// Get unique suppliers from ingredients
export async function getSuppliers(): Promise<string[]> {
  const ingredients = await getIngredients()
  const suppliers = new Set(ingredients.map(i => i.supplier).filter(Boolean))
  return Array.from(suppliers).sort()
}

// AI-suggested OC: items below reorder point
export async function getSuggestedPurchaseItems(): Promise<{
  supplier: string
  items: { ingredient_id: string; name: string; unit: string; current_stock: number; reorder_point: number; suggested_qty: number; unit_cost: number }[]
}[]> {
  const inventory = await getInventory()
  const ingredients = await getIngredients()
  const ingMap = new Map(ingredients.map(i => [i.id, i]))

  const lowStock = inventory.filter(i => i.stock <= i.reorder_point)
  const bySupplier = new Map<string, typeof lowStock>()

  for (const item of lowStock) {
    const ing = ingMap.get(item.ingredient_id)
    const supplier = ing?.supplier || 'Sin proveedor'
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, [])
    bySupplier.get(supplier)!.push(item)
  }

  return Array.from(bySupplier.entries()).map(([supplier, items]) => ({
    supplier,
    items: items.map(item => ({
      ingredient_id: item.ingredient_id,
      name: item.ingredient_name ?? item.ingredient_id,
      unit: item.ingredient_unit ?? '',
      current_stock: item.stock,
      reorder_point: item.reorder_point,
      suggested_qty: item.reorder_quantity || item.reorder_point * 2,
      unit_cost: item.ingredient_cost ?? 0,
    })),
  }))
}

// CRUD for Purchase Orders
export async function createPurchaseOrder(po: {
  id: string; supplier: string; created_by: string; notes?: string;
  subtotal: number; iva: number; total: number; ai_suggested?: boolean;
  items: { ingredient_id: string; ingredient_name: string; quantity_ordered: number; unit: string; unit_cost: number; total_cost: number }[]
}): Promise<boolean> {
  // Insert order
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_orders`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: po.id, client_id: _getClientId(), supplier: po.supplier, status: 'borrador',
      created_by: po.created_by, notes: po.notes || null,
      subtotal: po.subtotal, iva: po.iva, total: po.total,
      ai_suggested: po.ai_suggested || false,
    }),
  })
  if (!res.ok) return false

  // Insert items
  const itemRows = po.items.map(item => ({
    order_id: po.id, ingredient_id: item.ingredient_id, ingredient_name: item.ingredient_name,
    quantity_ordered: item.quantity_ordered, unit: item.unit,
    unit_cost: item.unit_cost, total_cost: item.total_cost,
  }))
  const res2 = await fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_order_items`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(itemRows),
  })
  return res2.ok
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_orders?client_id=eq.${_getClientId()}&order=created_at.desc&limit=100`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getPurchaseOrderItems(orderId: string): Promise<PurchaseOrderItem[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_order_items?order_id=eq.${orderId}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function updatePurchaseOrderStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'enviada') body.sent_at = new Date().toISOString()
  if (status === 'recibida') body.received_at = new Date().toISOString()

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_purchase_orders?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

// Receive items at almacén (update quantity_received)
export async function receiveOrderItems(
  orderId: string, received: { item_id: number; quantity_received: number }[]
): Promise<boolean> {
  for (const r of received) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/pos_purchase_order_items?id=eq.${r.item_id}`,
      {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ quantity_received: r.quantity_received }),
      }
    )
  }
  return true
}

// Restock inventory when OC is received
export async function restockFromPurchaseOrder(
  orderId: string, items: PurchaseOrderItem[], actor: string
): Promise<void> {
  const inventory = await getInventory()
  const invMap = new Map(inventory.map(i => [i.ingredient_id, i]))

  for (const item of items) {
    const qty = item.quantity_received ?? item.quantity_ordered
    const inv = invMap.get(item.ingredient_id)
    if (inv) {
      const newStock = inv.stock + qty
      await updateInventoryStock(item.ingredient_id, newStock)
      await logInventoryMovement({
        ingredient_id: item.ingredient_id,
        movement_type: 'restock',
        quantity: qty,
        order_id: orderId,
        actor,
        notes: `OC ${orderId} - ${item.ingredient_name}`,
      })
    }
  }
}

// CRUD for Facturas
export async function createFactura(factura: {
  id: string; purchase_order_id?: string; supplier: string; folio?: string;
  subtotal: number; iva: number; total: number; captured_by: string; notes?: string;
}): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_facturas`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: factura.id, client_id: _getClientId(), purchase_order_id: factura.purchase_order_id || null,
      supplier: factura.supplier, folio: factura.folio || null,
      subtotal: factura.subtotal, iva: factura.iva, total: factura.total,
      status: 'capturada', captured_by: factura.captured_by, notes: factura.notes || null,
    }),
  })
  return res.ok
}

export async function getFacturas(): Promise<Factura[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_facturas?client_id=eq.${_getClientId()}&order=created_at.desc&limit=100`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── Recipe Details (presentation, elaboration, allergens) ──────────────────

export interface RecipeDetail {
  id: string
  name: string
  category: string | null
  portion_size: string | null
  prep_time: string | null
  cook_time: string | null
  serving_temp: string | null
  plate: string | null
  presentation: string | null
  elaboration: string | null
  equipment: string | null
  allergens: string[] | null
}

export async function getRecipeDetail(name: string): Promise<RecipeDetail | null> {
  // Search by name (partial match)
  const encoded = encodeURIComponent(name)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipe_details?name=ilike.*${encoded}*&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json()
  if (rows.length === 0) {
    // Try by id
    const id = name.toLowerCase().replace(/ /g, '_').replace(/'/g, '').slice(0, 40)
    const res2 = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_recipe_details?id=ilike.*${encodeURIComponent(id)}*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    )
    if (!res2.ok) return null
    const rows2 = await res2.json()
    return rows2[0] || null
  }
  return rows[0]
}

export async function getClosedOrders(date: string): Promise<{ id: string; mesa: number; mesero: string; total: number; metodo_pago: string; closed_at: string; items: string }[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_getClientId()}&status=eq.cerrada&created_at=gte.${date}T00:00:00&created_at=lte.${date}T23:59:59&order=closed_at.desc&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function reopenOrder(orderId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}&client_id=eq.${_getClientId()}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'enviada', closed_at: null, metodo_pago: null }),
    }
  )
  return res.ok
}

export async function updateFacturaStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'pagada') body.paid_at = new Date().toISOString()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_facturas?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

// ─── CFDI — Facturación electrónica SAT ─────────────────────────────────────
//
// CREATE TABLE pos_cfdi_requests (
//   id TEXT PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   order_id TEXT,                    -- optional: link to POS order
//   rfc TEXT NOT NULL,
//   razon_social TEXT NOT NULL,
//   regimen_fiscal TEXT NOT NULL,     -- clave SAT e.g. '601', '612', '616'
//   uso_cfdi TEXT NOT NULL,           -- e.g. 'G03', 'D10', 'S01'
//   codigo_postal TEXT NOT NULL,
//   email TEXT NOT NULL,
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   status TEXT DEFAULT 'pendiente',  -- pendiente, procesando, emitida, cancelada, error
//   folio_fiscal TEXT,               -- UUID SAT once emitted
//   pdf_url TEXT,
//   xml_url TEXT,
//   error_msg TEXT,
//   requested_by TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_cfdi_rfc ON pos_cfdi_requests(rfc);
// CREATE INDEX idx_cfdi_status ON pos_cfdi_requests(status);
// CREATE INDEX idx_cfdi_created ON pos_cfdi_requests(created_at DESC);

export interface CFDIRequest {
  id: string
  client_id: string
  order_id?: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  subtotal: number
  iva: number
  total: number
  status: 'pendiente' | 'procesando' | 'emitida' | 'cancelada' | 'error'
  folio_fiscal?: string
  pdf_url?: string
  xml_url?: string
  error_msg?: string
  requested_by?: string
  created_at: string
  updated_at: string
}

export const REGIMENES_FISCALES = [
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', nombre: 'Sueldos y Salarios' },
  { clave: '606', nombre: 'Arrendamiento' },
  { clave: '608', nombre: 'Demás ingresos' },
  { clave: '610', nombre: 'Residentes en el Extranjero' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', nombre: 'Ingresos por intereses' },
  { clave: '616', nombre: 'Sin obligaciones fiscales' },
  { clave: '620', nombre: 'Sociedades Cooperativas de Producción' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '622', nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '625', nombre: 'Régimen de las Actividades Empresariales (Plataformas)' },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza' },
]

export const USOS_CFDI = [
  { clave: 'G01', nombre: 'Adquisición de mercancías' },
  { clave: 'G03', nombre: 'Gastos en general' },
  { clave: 'D10', nombre: 'Pagos por servicios educativos' },
  { clave: 'I01', nombre: 'Construcciones' },
  { clave: 'P01', nombre: 'Por definir' },
  { clave: 'S01', nombre: 'Sin efectos fiscales' },
]

export async function createCFDIRequest(req: {
  order_id?: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  subtotal: number
  iva: number
  total: number
  requested_by?: string
}): Promise<{ ok: boolean; id?: string }> {
  const id = `CFDI-${generateId()}`
  const body = {
    id,
    client_id: _getClientId(),
    ...req,
    status: 'pendiente',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests`,
    {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return { ok: res.ok, id: res.ok ? id : undefined }
}

export async function getCFDIRequests(limit = 50): Promise<CFDIRequest[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!res.ok) return []
  return res.json()
}

export async function updateCFDIStatus(
  id: string, status: string, extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, updated_at: new Date().toISOString(), ...extra }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_cfdi_requests?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}
