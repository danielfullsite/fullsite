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
//   ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
//   movement_type TEXT NOT NULL,    -- 'deduction', 'restock', 'adjustment', 'waste'
//   quantity NUMERIC NOT NULL,
//   order_id TEXT,
//   actor TEXT,
//   notes TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_inv_mov_ingredient ON pos_inventory_movements(ingredient_id);
// CREATE INDEX idx_inv_mov_created ON pos_inventory_movements(created_at DESC);
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
// Items with no modifiers at all
const NO_MODIFIER_CATEGORIES = ['sodas']

export function getModifiersForCategory(categoryId: string): {
  quitarOptions: string[]
  agregarOptions: ModificadorAgregar[]
} {
  if (NO_MODIFIER_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_NONE }
  }
  if (COFFEE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_COFFEE }
  }
  if (BEVERAGE_CATEGORIES.includes(categoryId)) {
    return { quitarOptions: [], agregarOptions: MODIFIERS_AGREGAR_DRINKS }
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

export interface Order {
  id: string
  mesa: number
  mesero: string
  personas: number
  status: 'abierta' | 'enviada' | 'cerrada' | 'cancelada'
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  descuento: number
  propina?: number
  metodoPago?: string
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
    id: 'promos', name: 'Especiales', color: 'bg-red-600', items: [
      { id: 'promo1', name: 'Combo Amalay', price: 360, promo: true },
      { id: 'promo2', name: 'Half & Half Combo', price: 287, promo: true },
      { id: 'promo3', name: 'Egg and Pancake Combo', price: 277, promo: true },
      { id: 'promo4', name: 'French Toast', price: 220, promo: true },
    ]
  },
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
  'Christopher Antonio Sanchez',
  'Mario Garcia Ramirez',
]

export const IVA_RATE = 0.16

// Mesa config — supports non-consecutive numbers (AMALAY uses 10, 20, 30, 40, 70, etc)
// Default: common restaurant layout with sections
const DEFAULT_MESA_NUMBERS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,20,30,40,50,60,70,80]
export const MESAS_CONFIG: Mesa[] = DEFAULT_MESA_NUMBERS.map(n => ({
  number: n,
  capacity: n <= 4 ? 2 : n <= 10 ? 4 : 6,
  status: 'disponible' as const,
}))

export function formatMXN(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

// ─── Supabase persistence ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function saveOrder(order: Order): Promise<boolean> {
  const orderData: Record<string, unknown> = {
    client_id: _getClientId(),
    mesa: order.mesa,
    mesero: order.mesero,
    personas: order.personas,
    status: order.status,
    subtotal: order.subtotal,
    iva: order.iva,
    total: order.total,
    descuento: order.descuento,
    propina: order.propina ?? 0,
    metodo_pago: order.metodoPago ?? null,
    notas: order.notas ?? null,
    items: JSON.stringify(order.items),
    closed_at: order.closedAt ? order.closedAt.toISOString() : null,
    updated_at: new Date().toISOString(),
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_orders`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ id: order.id, ...orderData }),
    })
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
        await cacheOrder({ id: order.id, ...orderData })
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
  const orders: KitchenOrderFromDB[] = await res.json()

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
  | 'merma_registered'

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
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_audit_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        client_id: event.client_id || _getClientId(),
        order_id: event.order_id,
        action: event.action,
        actor: event.actor,
        mesa: event.mesa,
        details: event.details ? JSON.stringify(event.details) : null,
        reason: event.reason,
        approved_by: event.approved_by,
      }),
    })
    if (!res.ok) {
      console.warn(`[audit] Failed to log "${event.action}" for order ${event.order_id}: ${res.status} ${res.statusText}`)
    }
    return res.ok
  } catch {
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
    `${SUPABASE_URL}/rest/v1/pos_audit_log?order=created_at.desc&limit=${limit}&offset=${offset}`,
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
    `${SUPABASE_URL}/rest/v1/pos_audit_log?order_id=eq.${orderId}&order=created_at.asc`,
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

// Manager PINs for approval — loaded from env to keep secrets out of source code
// Format: "PIN:Name,PIN:Name,PIN:Name"  e.g. "1234:Eduardo,5678:Monica,9012:Daniel"
function parseManagerPins(): Record<string, string> {
  const raw = process.env.NEXT_PUBLIC_MANAGER_PINS || ''
  if (!raw) return {}
  const pins: Record<string, string> = {}
  for (const entry of raw.split(',')) {
    const [pin, name] = entry.split(':')
    if (pin && name) pins[pin.trim()] = name.trim()
  }
  return pins
}
export const MANAGER_PINS: Record<string, string> = parseManagerPins()

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
    `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&order=name.asc&limit=1000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

// ─── Recipes CRUD ───────────────────────────────────────────────────────────

export async function getRecipes(): Promise<RecipeRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes?client_id=eq.${_getClientId()}&order=menu_item_name.asc&limit=2000`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function getRecipeForItem(menuItemId: string): Promise<RecipeRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_recipes?client_id=eq.${_getClientId()}&menu_item_id=eq.${encodeURIComponent(menuItemId)}&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function saveRecipeRow(row: { menu_item_id: string; menu_item_name: string; ingredient_id: string; quantity: number; unit: string }): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_recipes`, {
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
    `${SUPABASE_URL}/rest/v1/pos_recipes?id=eq.${id}`,
    { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  return res.ok
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export async function getInventory(): Promise<InventoryItem[]> {
  // Get inventory + join ingredient info client-side
  const [invRes, ingRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_inventory?client_id=eq.${_getClientId()}&order=ingredient_id.asc&limit=500`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/pos_ingredients?client_id=eq.${_getClientId()}&active=eq.true&limit=500`,
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
      ingredient_cost: ingredient?.cost_per_unit ?? 0,
    }
  })
}

export async function updateInventoryStock(ingredientId: string, newStock: number): Promise<boolean> {
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
  return res.ok
}

export async function logInventoryMovement(movement: {
  ingredient_id: string; movement_type: string; quantity: number;
  order_id?: string; actor?: string; notes?: string;
}): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_movements`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ client_id: _getClientId(), ...movement }),
  })
  return res.ok
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
  const recipesByName = new Map<string, typeof recipes>()
  for (const r of recipes) {
    const key = r.menu_item_name.toLowerCase()
    if (!recipesByName.has(key)) recipesByName.set(key, [])
    recipesByName.get(key)!.push(r)
  }

  for (const item of items) {
    const itemName = item.nombre.toLowerCase()
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

    // Priority 3: best single partial match
    if (recipeRows.length === 0) {
      let bestMatch: { name: string; rows: typeof recipes } | null = null
      for (const [name, rows] of recipesByName) {
        if (name.includes(itemName) || itemName.includes(name)) {
          if (!bestMatch || Math.abs(name.length - itemName.length) < Math.abs(bestMatch.name.length - itemName.length)) {
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

export async function getInventoryMovements(limit = 50): Promise<InventoryMovement[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_inventory_movements?client_id=eq.${_getClientId()}&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
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
    `${SUPABASE_URL}/rest/v1/pos_orders?status=eq.cerrada&created_at=gte.${date}T00:00:00&created_at=lte.${date}T23:59:59&order=closed_at.desc&limit=50`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function reopenOrder(orderId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`,
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
