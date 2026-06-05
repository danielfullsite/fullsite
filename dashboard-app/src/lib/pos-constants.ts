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

// ─── STATION ROUTING ────────────────────────────────────────────────────────

export type StationName = 'cocina' | 'barra' | 'caja'

// Category IDs (from MENU_CATEGORIES) routed to each station
export const STATION_CATEGORIES: Record<StationName, string[]> = {
  cocina: [
    'chilaquiles', 'eggs', 'croissants', 'pancakes', 'paninis',
    'pizzas', 'bowls', 'ceviche',
  ],
  barra: [
    'coffee', 'signature', 'jugos', 'fresh', 'smoothies', 'frappes',
    'sodas', 'tea', 'alcohol',
  ],
  caja: [
    'toast', 'bakery', 'postres', 'mkt-cafe',
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

// Payment methods available
export const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo', icon: 'Banknote', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'tarjeta', label: 'Tarjeta', icon: 'CreditCard', color: 'bg-blue-600 hover:bg-blue-500' },
  { id: 'transferencia', label: 'Transferencia', icon: 'Send', color: 'bg-purple-600 hover:bg-purple-500' },
  { id: 'mixto', label: 'Mixto (Efectivo + Tarjeta)', icon: 'Banknote', color: 'bg-[var(--line)] hover:bg-[var(--line-soft)]' },
] as const
