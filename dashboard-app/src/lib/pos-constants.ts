// Shared POS constants — single source of truth

export const IVA_RATE = 0.16

export const MESAS_COUNT = 16

export const KITCHEN_ARCHIVE_HOURS = 4

export const POLL_INTERVAL_KITCHEN = 5000  // 5 seconds
export const POLL_INTERVAL_KDS = 3000

// Beverage keywords — used by both Cocina (to exclude) and Barra (to include)
export const BEBIDA_KEYWORDS = [
  'cafe', 'café', 'cappuccino', 'capuchino', 'latte', 'americano', 'mocca', 'matcha', 'chai',
  'smoothie', 'frappe', 'jugo', 'limonada', 'fresco',
  'soda', 'coca', 'agua', 'te ', 'té ', 'tisana',
  'mimosa', 'chamoyada', 'cerveza', 'vino',
]

export const BARRA_CATEGORIES = [
  'coffee', 'jugos', 'fresh', 'smoothies', 'frappes', 'sodas', 'tea', 'alcohol', 'signature',
]

export function isBebida(name: string): boolean {
  const lower = name.toLowerCase()
  return BEBIDA_KEYWORDS.some(kw => lower.includes(kw))
}

// ─── CATEGORY COLORS (safelist) ─────────────────────────────────────────────
// Los colores de categorías viven en Supabase (pos_menu_categories.color), pero
// Tailwind solo compila clases que aparecen literalmente en el código fuente.
// Esta lista garantiza que todas las clases usadas en la BD existan en el CSS.
export const CATEGORY_COLOR_SAFELIST = [
  'bg-rose-700', 'bg-rose-600', 'bg-rose-500',
  'bg-red-600',
  'bg-orange-600', 'bg-orange-500',
  'bg-amber-700', 'bg-amber-500',
  'bg-yellow-600', 'bg-yellow-500', 'bg-yellow-400',
  'bg-lime-600',
  'bg-green-700', 'bg-green-500',
  'bg-emerald-600',
  'bg-teal-600',
  'bg-cyan-500',
  'bg-sky-600', 'bg-sky-400',
  'bg-blue-500',
  'bg-indigo-600', 'bg-indigo-500',
  'bg-violet-700',
  'bg-purple-700', 'bg-purple-600',
  'bg-fuchsia-600', 'bg-fuchsia-500',
  'bg-pink-500',
  'bg-slate-600',
]

// ─── STATION ROUTING ────────────────────────────────────────────────────────

export type StationName = 'cocina' | 'barra' | 'caja'

// Category IDs (from MENU_CATEGORIES) routed to each station
export const STATION_CATEGORIES: Record<StationName, string[]> = {
  cocina: [
    'chilaquiles', 'eggs', 'croissants', 'pancakes', 'paninis',
    'pizzas', 'bowls', 'ceviche',
    // Grupos Wansoft (AMALAY): comida → cocina
    'promos', 'keto', 'kids', 'soups', 'munchies', 'extras', 'envios',
    'enchiladas-tacos', 'salads-ceviche', 'appetizers', 'evento',
  ],
  barra: [
    'coffee', 'signature', 'jugos', 'fresh', 'smoothies', 'frappes',
    'sodas', 'tea', 'alcohol', 'activaciones',
    'vinos', 'cerveza', 'licores', 'icecream',
  ],
  caja: [
    'toast', 'bakery', 'postres', 'mkt-cafe',
    // Market consolidado Wansoft (junio 2026)
    'mkt-healthy', 'mkt-vitaminas', 'mkt-regalos', 'mkt-amalay',
  ],
}

// Build reverse lookup: category id -> station
export const CATEGORY_TO_STATION: Record<string, StationName> = (() => {
  const map: Record<string, StationName> = {}
  for (const [station, cats] of Object.entries(STATION_CATEGORIES)) {
    for (const cat of cats) {
      map[cat] = station as StationName
    }
  }
  return map
})()

// Fallback: determine station from item name using BEBIDA_KEYWORDS
export function getStationForItem(categoryId: string, itemName: string): StationName {
  // Try category-based routing first
  if (CATEGORY_TO_STATION[categoryId]) {
    return CATEGORY_TO_STATION[categoryId]
  }
  // Fallback: use beverage detection
  if (isBebida(itemName)) return 'barra'
  return 'cocina'
}

export const STATION_LABELS: Record<StationName, string> = {
  cocina: 'COCINA',
  barra: 'BARRA',
  caja: 'MARKET',
}

// Keywords for caja/market items (used when we only have the item name, no category)
const CAJA_KEYWORDS = [
  'toast', 'bagel', 'concha', 'bakery', 'crunchy', 'galleta', 'brownie',
  'cheesecake', 'carrot cake', 'tiramisu', 'tiramisú', 'pastel de choc',
  'cafe grano', 'cafe molido', 'vaso cafe refill', 'semilla', 'dulce',
]

/**
 * Classify an item by station using only its name (for kitchen display where
 * we don't have category IDs).
 */
export function getStationByName(name: string): StationName {
  if (isBebida(name)) return 'barra'
  const lower = name.toLowerCase()
  if (CAJA_KEYWORDS.some(kw => lower.includes(kw))) return 'caja'
  return 'cocina'
}

// ── Tiempos de platillo (estilo Wansoft: separador "XX TIEMPO: N XX" como partida $0.00) ──
export const TIEMPO_ITEM_ID = '__tiempo__'

export function isTiempoItem(item: { menuItemId: string }): boolean {
  return item.menuItemId === TIEMPO_ITEM_ID
}

// Payment methods available
export const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo', icon: 'Banknote', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'tarjeta', label: 'Tarjeta', icon: 'CreditCard', color: 'bg-blue-600 hover:bg-blue-500' },
  { id: 'transferencia', label: 'Transferencia', icon: 'Send', color: 'bg-purple-600 hover:bg-purple-500' },
  { id: 'mixto', label: 'Mixto (Efectivo + Tarjeta)', icon: 'Banknote', color: 'bg-[var(--line)] hover:bg-[var(--line-soft)]' },
] as const
