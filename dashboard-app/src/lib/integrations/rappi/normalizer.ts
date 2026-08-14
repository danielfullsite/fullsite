import type { CanonicalOrder, CanonicalOrderItem } from '@/lib/integrations/types'

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function cents(value: unknown): number {
  return Math.round((num(value) / 100) * 100) / 100
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const candidate = str(value)
    if (candidate) return candidate
  }
  return ''
}

function discountTotal(rawDiscounts: unknown): number {
  return arr(rawDiscounts).reduce<number>((sum, item) => {
    const d = obj(item)
    return sum + cents(d.value ?? d.amount ?? d.total ?? d.discount)
  }, 0)
}

function stringifyAddress(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const address = obj(value)
  return [
    address.street,
    address.street_number ?? address.number,
    address.neighborhood,
    address.city,
  ].map(str).filter(Boolean).join(', ')
}

function normalizeItem(rawItem: unknown): CanonicalOrderItem {
  const item = obj(rawItem)
  const quantity = Math.max(1, num(item.quantity ?? item.qty ?? 1))
  const unitPrice = cents(item.price ?? item.unit_price ?? item.unitPrice ?? 0)
  const modifiers = arr(item.subitems ?? item.modifiers).map(rawModifier => {
    const modifier = obj(rawModifier)
    return {
      group_name: str(modifier.group_name ?? modifier.groupName ?? modifier.category ?? ''),
      name: firstNonEmpty(modifier.name, modifier.title, modifier.sku, 'Modificador'),
      price: cents(modifier.price ?? modifier.unit_price ?? 0),
    }
  })

  const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.price, 0)
  return {
    sku: str(item.sku ?? item.id) || undefined,
    name: firstNonEmpty(item.name, item.title, item.sku, 'Producto Rappi'),
    quantity,
    unit_price: unitPrice,
    total_price: Math.round((unitPrice + modifierTotal) * quantity * 100) / 100,
    notes: str(item.comments ?? item.note ?? item.notes),
    modifiers,
  }
}

export function rappiProviderOrderId(rawOrder: unknown): string {
  const order = obj(rawOrder)
  return firstNonEmpty(order.order_id, order.id, order.orderId)
}

export function rappiProviderStoreId(rawOrder: unknown, fallback?: string | null): string {
  const order = obj(rawOrder)
  const store = obj(order.store)
  return firstNonEmpty(store.internal_id, store.external_id, store.id, order.store_id, fallback)
}

export function normalizeRappiOrder(rawOrder: unknown, options: {
  clientId: string
  correlationId: string
  storeIdFallback?: string | null
}): CanonicalOrder {
  const order = obj(rawOrder)
  const totals = obj(order.totals)
  const customer = obj(order.customer)
  const billing = obj(order.billing_information)
  const delivery = obj(order.delivery_information)

  const providerOrderId = rappiProviderOrderId(rawOrder)
  const providerStoreId = rappiProviderStoreId(rawOrder, options.storeIdFallback)
  if (!providerOrderId) throw new Error('RAPPI_ORDER_ID_MISSING')
  if (!providerStoreId) throw new Error('RAPPI_STORE_ID_MISSING')

  const items = arr(order.items).map(normalizeItem)
  const subtotal = cents(totals.products_subtotal ?? totals.subtotal ?? totals.items_subtotal)
  const deliveryFee = cents(totals.charges ?? totals.delivery_fee ?? totals.deliveryFee)
  const tip = cents(totals.tips ?? totals.tip)
  const discounts = discountTotal(totals.discounts)
  const explicitTotal = cents(totals.total ?? order.total)
  const total = explicitTotal > 0
    ? explicitTotal
    : Math.max(0, Math.round((subtotal + deliveryFee + tip - discounts) * 100) / 100)

  return {
    provider: 'rappi',
    provider_order_id: providerOrderId,
    provider_store_id: providerStoreId,
    client_id: options.clientId,
    status: 'nueva',
    customer_name: firstNonEmpty(customer.name, billing.name, 'Cliente Rappi'),
    customer_phone: firstNonEmpty(customer.contact, customer.phone, billing.contact) || undefined,
    delivery_address: stringifyAddress(delivery.address ?? delivery) || undefined,
    items,
    subtotal,
    delivery_fee: deliveryFee,
    tip,
    total,
    notes: str(order.comments ?? order.notes),
    estimated_pickup_at: str(order.estimated_pickup ?? order.eta ?? order.cooking_time) || undefined,
    correlation_id: options.correlationId,
    idempotency_key: `rappi-order-${providerOrderId}`,
    raw_payload: rawOrder,
  }
}
