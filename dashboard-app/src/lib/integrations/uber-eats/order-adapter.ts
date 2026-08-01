// Uber Eats → Fullsite canonical order normalization.
// Maps Uber Marketplace API v1 payload to CanonicalOrder.
// Never throws — returns best-effort values on partial payloads.

import type { CanonicalOrder, CanonicalOrderItem } from '../types'

type UberModifierGroup = {
  title?: string
  selected_items?: Array<{ title?: string; price?: { amount?: number } }>
}

type UberItem = {
  title?: string
  name?: string
  quantity?: number
  price?: { unit_price?: { amount?: number }; base_unit_price?: { amount?: number } }
  total_price?: { amount?: number }
  special_instructions?: string
  selected_modifier_groups?: UberModifierGroup[]
}

type UberOrderPayload = {
  id?: string
  order_id?: string
  cart?: { items?: UberItem[] }
  items?: UberItem[]
  eater?: { first_name?: string; last_name?: string; phone?: { number?: string } | string }
  customer?: { first_name?: string; last_name?: string; phone?: string }
  delivery_address?: { street_address?: string }
  payment?: { charges?: { total?: { amount?: number } } }
  total?: number | { amount?: number }
  delivery_fee?: { amount?: number }
  tip?: { amount?: number }
  special_instructions?: string
  estimated_ready_for_pickup_at?: string
}

function normalizeItems(raw: UberItem[]): CanonicalOrderItem[] {
  return raw.map(i => {
    const unitPrice = ((i.price?.unit_price?.amount ?? i.price?.base_unit_price?.amount ?? 0) / 100)
    const qty = i.quantity ?? 1
    const totalPrice = i.total_price?.amount != null ? i.total_price.amount / 100 : unitPrice * qty
    const modifiers = (i.selected_modifier_groups ?? []).flatMap(g =>
      (g.selected_items ?? []).map(m => ({
        group_name: g.title ?? '',
        name: m.title ?? '',
        price: (m.price?.amount ?? 0) / 100,
      }))
    )
    return { name: i.title ?? i.name ?? 'Item', quantity: qty, unit_price: unitPrice, total_price: totalPrice, notes: i.special_instructions ?? '', modifiers }
  })
}

export function normalizeUberOrder(
  payload: UberOrderPayload,
  storeId: string,
  clientId: string,
  correlationId: string
): CanonicalOrder {
  const orderId = payload.id ?? payload.order_id ?? ''
  const items = normalizeItems(payload.cart?.items ?? payload.items ?? [])
  const eater = payload.eater ?? payload.customer ?? {}
  const firstName = 'first_name' in eater ? (eater as { first_name?: string }).first_name : ''
  const lastName = 'last_name' in eater ? (eater as { last_name?: string }).last_name : ''
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'Cliente Uber'
  const rawPhone = 'phone' in eater ? (eater as { phone?: { number?: string } | string }).phone : undefined
  const customerPhone = typeof rawPhone === 'object' ? rawPhone?.number : rawPhone

  const subtotal = items.reduce((s, i) => s + i.total_price, 0)
  const deliveryFee = (payload.delivery_fee?.amount ?? 0) / 100
  const tip = (payload.tip?.amount ?? 0) / 100
  const total = (() => {
    if (payload.payment?.charges?.total?.amount != null) return payload.payment.charges.total.amount / 100
    if (typeof payload.total === 'object' && payload.total?.amount != null) return payload.total.amount / 100
    if (typeof payload.total === 'number') return payload.total
    return subtotal + deliveryFee + tip
  })()

  return {
    provider: 'ubereats',
    provider_order_id: orderId,
    provider_store_id: storeId,
    client_id: clientId,
    status: 'nueva',
    customer_name: customerName,
    customer_phone: customerPhone,
    delivery_address: payload.delivery_address?.street_address,
    items,
    subtotal,
    delivery_fee: deliveryFee,
    tip,
    total,
    notes: payload.special_instructions,
    estimated_pickup_at: payload.estimated_ready_for_pickup_at,
    correlation_id: correlationId,
    idempotency_key: `ubereats-order-${orderId}`,
    raw_payload: payload,
  }
}
