/**
 * POS Payment Calculations — Pure functions for order totals, splits, tips, and payments.
 *
 * Extracted from pos/page.tsx so they can be tested independently.
 */

import { IVA_RATE } from './pos-data'
import type { OrderItem } from './pos-data'

// ─── Item subtotal ─────────────────────────────────────────────────────────

/** Calculate line-item subtotal: (base price + extras) * quantity */
export function calcItemSubtotal(precio: number, precioExtra: number, cantidad: number): number {
  return (precio + precioExtra) * cantidad
}

// ─── Order totals ──────────────────────────────────────────────────────────

export interface OrderTotals {
  subtotal: number
  subtotalAfterDiscount: number
  iva: number
  total: number
}

/** Calculate full order totals from active items, applying discount before IVA. */
export function calcOrderTotals(items: Pick<OrderItem, 'subtotal'>[], discount = 0): OrderTotals {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const subtotalAfterDiscount = Math.max(0, subtotal - discount)
  const iva = subtotalAfterDiscount * IVA_RATE
  const total = subtotalAfterDiscount + iva
  return { subtotal, subtotalAfterDiscount, iva, total }
}

// ─── Split de cuenta ───────────────────────────────────────────────────────

export interface SplitResult {
  cuenta1Items: Pick<OrderItem, 'id' | 'subtotal'>[]
  cuenta2Items: Pick<OrderItem, 'id' | 'subtotal'>[]
  total1: number
  total2: number
}

/**
 * Split items into two cuentas based on assignments.
 * Unassigned items default to cuenta 1 (matches POS behavior).
 */
export function splitCuenta(
  items: Pick<OrderItem, 'id' | 'subtotal'>[],
  assignments: Record<string, number>,
): SplitResult {
  const cuenta1Items = items.filter(i => (assignments[i.id] || 1) === 1)
  const cuenta2Items = items.filter(i => assignments[i.id] === 2)
  const total1 = cuenta1Items.reduce((s, i) => s + i.subtotal, 0)
  const total2 = cuenta2Items.reduce((s, i) => s + i.subtotal, 0)
  return { cuenta1Items, cuenta2Items, total1, total2 }
}

/**
 * Get items for a specific cuenta being paid.
 * cuenta=0 means no split (all items), 1 or 2 selects the split group.
 */
export function getPayingItems(
  items: Pick<OrderItem, 'id' | 'subtotal'>[],
  assignments: Record<string, number>,
  cuenta: 0 | 1 | 2,
): Pick<OrderItem, 'id' | 'subtotal'>[] {
  if (cuenta === 0) return items
  if (cuenta === 1) return items.filter(i => (assignments[i.id] || 1) === 1)
  return items.filter(i => assignments[i.id] === 2)
}

/**
 * Calculate totals for a specific split cuenta payment.
 * During split, discount is NOT applied (only on full-order payments).
 */
export function calcSplitPayment(
  items: Pick<OrderItem, 'id' | 'subtotal'>[],
  assignments: Record<string, number>,
  cuenta: 0 | 1 | 2,
  discount = 0,
): OrderTotals {
  const payingItems = getPayingItems(items, assignments, cuenta)
  // Discount only applies when paying full order (cuenta === 0)
  const effectiveDiscount = cuenta === 0 ? discount : 0
  return calcOrderTotals(payingItems, effectiveDiscount)
}

// ─── Propinas (tips) ───────────────────────────────────────────────────────

/** Calculate tip from a percentage of the total. Result is rounded to nearest peso. */
export function calcPropina(total: number, percentage: number): number {
  if (percentage <= 0) return 0
  return Math.round(total * percentage / 100)
}

/** Total with tip included. */
export function totalConPropina(total: number, propina: number): number {
  return total + propina
}

// ─── Payment split personas ────────────────────────────────────────────────

/** When splitting, each cuenta gets half the personas (rounded up). */
export function splitPersonas(personas: number): number {
  return Math.ceil(personas / 2)
}

// ─── Active items filter ───────────────────────────────────────────────────

/** Filter out cancelled items from the order. */
export function getActiveItems<T extends { id: string }>(
  items: T[],
  cancelledIds: Set<string>,
): T[] {
  return items.filter(i => !cancelledIds.has(i.id))
}

// ─── Format ────────────────────────────────────────────────────────────────

/** Format amount as MXN string: $1,234.56 */
export function formatMXN(amount: number): string {
  return `$${amount.toFixed(2)}`
}
