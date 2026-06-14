// Promos MVP — evalúa promos activas de pos_promotions contra una orden.
// Se carga una vez al montar el POS y se re-evalúa cuando cambia la orden.

import type { OrderItem } from './pos-data'

// ── Types ─────────────────────────────────────────────────────────────────

export interface Promotion {
  id: string
  name: string
  type: 'percentage' | 'fixed' | '2x1' | 'combo'
  value: number
  applies_to: 'order' | 'category' | 'item'
  category_ids: string[]
  item_ids: string[]
  schedule: {
    days: number[]       // 0=Dom … 6=Sab
    start_time: string   // "14:00"
    end_time: string     // "18:00"
    start_date: string   // "2026-06-01" or ""
    end_date: string     // "2026-06-30" or ""
  }
  auto_apply: boolean
  max_per_day: number | null
  active: boolean
}

export interface AppliedPromo {
  promo: Promotion
  discount: number       // monto en $ que se descuenta
  affectedItems: string[] // ids de OrderItems afectados (para UI highlight)
  label: string          // ej. "Happy Hour -20%" o "2x1 Café"
}

// ── Fetch ─────────────────────────────────────────────────────────────────

let _cache: Promotion[] | null = null
let _cacheTime = 0
const CACHE_TTL = 5 * 60_000 // 5 min

export async function getActivePromos(clientId: string): Promise<Promotion[]> {
  const now = Date.now()
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache

  try {
    const sbUrl = typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_SUPABASE_URL!
      : ''
    const sbKey = typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      : ''
    if (!sbUrl) return _cache ?? []

    const res = await fetch(
      `${sbUrl}/rest/v1/pos_promotions?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=*`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' },
    )
    if (!res.ok) return _cache ?? []
    const rows = await res.json()
    _cache = Array.isArray(rows) ? rows : []
    _cacheTime = now
    return _cache!
  } catch {
    return _cache ?? []
  }
}

export function clearPromoCache() {
  _cache = null
  _cacheTime = 0
}

// ── Evaluation ────────────────────────────────────────────────────────────

/** Is this promo active right now (day + time + date range)? */
function isActiveNow(p: Promotion): boolean {
  if (!p.active) return false

  // schedule may come as JSON string from Supabase
  const sched = typeof p.schedule === 'string' ? (() => { try { return JSON.parse(p.schedule) } catch { return {} } })() : (p.schedule || {})
  const days: number[] = Array.isArray(sched.days) ? sched.days : []
  const startDate: string = sched.start_date || ''
  const endDate: string = sched.end_date || ''
  const startTime: string = sched.start_time || ''
  const endTime: string = sched.end_time || ''

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const dayOfWeek = now.getDay() // 0=Dom

  // Date range
  if (startDate && today < startDate) return false
  if (endDate && today > endDate) return false

  // Day of week (empty = all days)
  if (days.length > 0 && !days.includes(dayOfWeek)) return false

  // Time window (empty = all day)
  if (startTime && endTime) {
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm < startTime || hhmm > endTime) return false
  }

  return true
}

/** Get items that match this promo's scope. */
function matchingItems(p: Promotion, items: OrderItem[], categoryMap: Map<string, string>): OrderItem[] {
  if (p.applies_to === 'order') return items
  if (p.applies_to === 'category') {
    return items.filter(i => {
      const cat = categoryMap.get(i.menuItemId)
      return cat && p.category_ids.includes(cat)
    })
  }
  if (p.applies_to === 'item') {
    return items.filter(i => p.item_ids.includes(i.menuItemId))
  }
  return []
}

/**
 * Evaluate all active promos against the current order.
 * Returns applicable promos sorted by discount (largest first).
 * categoryMap: menuItemId → categoryId (built from MENU_CATEGORIES).
 */
export function evaluatePromos(
  promos: Promotion[],
  items: OrderItem[],
  subtotal: number,
  categoryMap: Map<string, string>,
): AppliedPromo[] {
  const results: AppliedPromo[] = []

  for (const p of promos) {
    if (!isActiveNow(p)) continue

    const matched = matchingItems(p, items, categoryMap)
    if (matched.length === 0) continue

    const matchedSubtotal = matched.reduce((s, i) => s + i.subtotal, 0)
    let discount = 0
    let label = p.name

    switch (p.type) {
      case 'percentage': {
        const base = p.applies_to === 'order' ? subtotal : matchedSubtotal
        discount = Math.round(base * (p.value / 100) * 100) / 100
        label = `${p.name} -${p.value}%`
        break
      }
      case 'fixed': {
        discount = Math.min(p.value, p.applies_to === 'order' ? subtotal : matchedSubtotal)
        label = `${p.name} -$${p.value}`
        break
      }
      case '2x1': {
        // Same logic as the manual 2x1: expand units, sort desc, every 2nd is free
        const units: number[] = []
        for (const it of matched) {
          const unitPrice = it.precio + it.precioExtra
          for (let u = 0; u < it.cantidad; u++) units.push(unitPrice)
        }
        units.sort((a, b) => b - a)
        discount = units.filter((_, idx) => idx % 2 === 1).reduce((s, p) => s + p, 0)
        label = `${p.name} 2×1`
        break
      }
      case 'combo': {
        // Combo = fixed price for the matched items (value = combo price)
        discount = Math.max(0, matchedSubtotal - p.value)
        label = `${p.name} $${p.value}`
        break
      }
    }

    if (discount > 0) {
      results.push({
        promo: p,
        discount: Math.round(discount * 100) / 100,
        affectedItems: matched.map(i => i.id),
        label,
      })
    }
  }

  // Sort by discount amount descending
  results.sort((a, b) => b.discount - a.discount)
  return results
}

/**
 * Build categoryMap from MENU_CATEGORIES (or DB categories).
 * Maps menuItemId → categoryId for promo matching.
 */
export function buildCategoryMap(categories: { id: string; items: { id: string }[] }[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const cat of categories) {
    for (const item of cat.items) {
      map.set(item.id, cat.id)
    }
  }
  return map
}
