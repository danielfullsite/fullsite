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

// Payment methods available
export const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo', icon: 'Banknote', color: 'bg-emerald-600 hover:bg-emerald-500' },
  { id: 'tarjeta', label: 'Tarjeta', icon: 'CreditCard', color: 'bg-blue-600 hover:bg-blue-500' },
  { id: 'transferencia', label: 'Transferencia', icon: 'Send', color: 'bg-purple-600 hover:bg-purple-500' },
  { id: 'mixto', label: 'Mixto (Efectivo + Tarjeta)', icon: 'Banknote', color: 'bg-[var(--line)] hover:bg-[var(--line-soft)]' },
] as const
