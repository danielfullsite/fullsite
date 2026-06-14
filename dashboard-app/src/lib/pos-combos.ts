// Combo system for POS — fetch combos from pos_combos, apply proportional pricing.
// A combo groups multiple menu items at a discounted total price.

import type { OrderItem } from './pos-data'
import { generateId } from './pos-data'

// ── Types ─────────────────────────────────────────────────────────────────

export interface ComboSubstitution {
  id: string
  name: string
}

export interface ComboItem {
  menu_item_id: string
  name: string
  substitutions: ComboSubstitution[]
}

export interface ComboUpsell {
  label: string      // e.g. "Agrandar combo"
  price_add: number  // e.g. 29
}

export interface ComboSchedule {
  days: number[]       // 0=Dom … 6=Sab
  start_time: string   // "14:00"
  end_time: string     // "18:00"
  start_date: string   // "2026-06-01" or ""
  end_date: string     // "2026-06-30" or ""
}

export interface Combo {
  id: string
  client_id: string
  name: string
  items: ComboItem[]
  price: number
  upsell: ComboUpsell | null
  active: boolean
  schedule: ComboSchedule | null
  created_at: string
}

// ── Fetch ─────────────────────────────────────────────────────────────────

let _cache: Combo[] | null = null
let _cacheTime = 0
const CACHE_TTL = 5 * 60_000 // 5 min

export async function getActiveCombos(clientId: string): Promise<Combo[]> {
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
      `${sbUrl}/rest/v1/pos_combos?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=*`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' },
    )
    if (!res.ok) return _cache ?? []
    const rows: Combo[] = await res.json()
    _cache = Array.isArray(rows) ? rows.filter(isActiveNow) : []
    _cacheTime = now
    return _cache
  } catch {
    return _cache ?? []
  }
}

export function clearComboCache() {
  _cache = null
  _cacheTime = 0
}

// ── Schedule check ────────────────────────────────────────────────────────

function isActiveNow(combo: Combo): boolean {
  if (!combo.active) return false

  const sched: ComboSchedule | null = typeof combo.schedule === 'string'
    ? (() => { try { return JSON.parse(combo.schedule as unknown as string) } catch { return null } })()
    : combo.schedule

  if (!sched) return true // no schedule = always active

  const mx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
  const day = mx.getDay()
  const hhmm = `${String(mx.getHours()).padStart(2, '0')}:${String(mx.getMinutes()).padStart(2, '0')}`
  const today = mx.toISOString().slice(0, 10)

  if (sched.days && sched.days.length > 0 && !sched.days.includes(day)) return false
  if (sched.start_time && hhmm < sched.start_time) return false
  if (sched.end_time && hhmm > sched.end_time) return false
  if (sched.start_date && today < sched.start_date) return false
  if (sched.end_date && today > sched.end_date) return false

  return true
}

// ── Apply combo ───────────────────────────────────────────────────────────

/**
 * Build OrderItems for a combo with proportional discount.
 *
 * Each item's price is scaled so the sum equals combo.price.
 * If an individual item price is unknown (not in menuPrices), it gets an
 * equal share of the combo price.
 *
 * @param combo      The combo definition
 * @param menuPrices Map of menu_item_id → unit price (from the loaded menu)
 * @param comboGroupId Optional shared id to group items visually
 * @param substitutions Map of comboItem index → chosen substitution (if any)
 */
export function applyCombo(
  combo: Combo,
  menuPrices: Map<string, number>,
  comboGroupId?: string,
  substitutions?: Map<number, ComboSubstitution>,
): OrderItem[] {
  const groupId = comboGroupId ?? generateId()

  // Resolve actual items (with substitutions applied)
  const resolved = combo.items.map((ci, idx) => {
    const sub = substitutions?.get(idx)
    return {
      menuItemId: sub?.id ?? ci.menu_item_id,
      nombre: sub?.name ?? ci.name,
      originalPrice: menuPrices.get(sub?.id ?? ci.menu_item_id) ?? 0,
    }
  })

  // Proportional pricing: distribute combo.price across items by their share
  // of the total original price. If total is 0, split equally.
  const totalOriginal = resolved.reduce((s, r) => s + r.originalPrice, 0)
  const comboPrice = combo.price

  const orderItems: OrderItem[] = resolved.map((r, idx) => {
    let itemPrice: number
    if (totalOriginal > 0) {
      itemPrice = Math.round((r.originalPrice / totalOriginal) * comboPrice * 100) / 100
    } else {
      itemPrice = Math.round((comboPrice / resolved.length) * 100) / 100
    }

    // Fix rounding: adjust last item so total matches exactly
    if (idx === resolved.length - 1) {
      const sumSoFar = resolved.slice(0, -1).reduce((s, _, i) => {
        const p = totalOriginal > 0
          ? Math.round((resolved[i].originalPrice / totalOriginal) * comboPrice * 100) / 100
          : Math.round((comboPrice / resolved.length) * 100) / 100
        return s + p
      }, 0)
      itemPrice = Math.round((comboPrice - sumSoFar) * 100) / 100
    }

    return {
      id: generateId(),
      menuItemId: r.menuItemId,
      nombre: r.nombre,
      precio: itemPrice,
      cantidad: 1,
      modificadores: [`COMBO: ${combo.name}`],
      notas: '',
      precioExtra: 0,
      subtotal: itemPrice,
      _comboGroupId: groupId,
      _comboId: combo.id,
    } as OrderItem & { _comboGroupId: string; _comboId: string }
  })

  return orderItems
}

// ── SQL reference ─────────────────────────────────────────────────────────
// See docs/pos-combos-schema.sql for the CREATE TABLE statement.
