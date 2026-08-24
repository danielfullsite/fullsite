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
    address.complete_address,
    address.street,
    address.street_name,
    address.street_number ?? address.number,
    address.neighborhood,
    address.city,
  ].map(str).filter(Boolean).join(', ')
}

function orderEnvelope(rawOrder: unknown): { envelope: Record<string, unknown>; detail: Record<string, unknown> } {
  const envelope = obj(rawOrder)
  const nested = obj(envelope.order_detail)
  return { envelope, detail: Object.keys(nested).length ? nested : envelope }
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
  const { envelope, detail } = orderEnvelope(rawOrder)
  return firstNonEmpty(detail.order_id, detail.id, detail.orderId, envelope.order_id, envelope.id, envelope.orderId)
}

export function rappiProviderStoreId(rawOrder: unknown, fallback?: string | null): string {
  const { envelope, detail } = orderEnvelope(rawOrder)
  const store = obj(envelope.store ?? detail.store)
  return firstNonEmpty(store.internal_id, store.external_id, store.id, detail.store_id, envelope.store_id, fallback)
}

export function normalizeRappiOrder(rawOrder: unknown, options: {
  clientId: string
  correlationId: string
  storeIdFallback?: string | null
}): CanonicalOrder {
  const { envelope, detail: order } = orderEnvelope(rawOrder)
  const totals = obj(order.totals)
  const customer = obj(envelope.customer ?? order.customer)
  const billing = obj(order.billing_information)
  const delivery = obj(order.delivery_information)
  const charges = obj(totals.charges)
  const otherTotals = obj(totals.other_totals)

  const providerOrderId = rappiProviderOrderId(rawOrder)
  const providerStoreId = rappiProviderStoreId(rawOrder, options.storeIdFallback)
  if (!providerOrderId) throw new Error('RAPPI_ORDER_ID_MISSING')
  if (!providerStoreId) throw new Error('RAPPI_STORE_ID_MISSING')

  const items = arr(order.items).map(normalizeItem)
  const subtotal = cents(totals.products_subtotal ?? totals.subtotal ?? totals.items_subtotal ?? totals.total_products)
  const deliveryFee = cents(totals.delivery_fee ?? totals.deliveryFee ?? charges.shipping ?? totals.charges)
  const tip = cents(totals.tips ?? totals.tip ?? otherTotals.tip)
  const discounts = discountTotal(order.discounts ?? totals.discounts)
  const explicitTotal = cents(totals.total ?? totals.total_order ?? order.total)
  const total = explicitTotal > 0
    ? explicitTotal
    : Math.max(0, Math.round((subtotal + deliveryFee + tip - discounts) * 100) / 100)

  return {
    provider: 'rappi',
    provider_order_id: providerOrderId,
    provider_store_id: providerStoreId,
    client_id: options.clientId,
    status: 'nueva',
    customer_name: firstNonEmpty(
      customer.name,
      [str(customer.first_name), str(customer.last_name)].filter(Boolean).join(' '),
      billing.name,
      'Cliente Rappi',
    ),
    customer_phone: firstNonEmpty(customer.contact, customer.phone, customer.phone_number, billing.contact, billing.phone) || undefined,
    delivery_address: stringifyAddress(delivery.address ?? delivery) || undefined,
    items,
    subtotal,
    delivery_fee: deliveryFee,
    tip,
    total,
    notes: str(order.comments ?? order.notes),
    estimated_pickup_at: str(order.estimated_pickup ?? order.estimated_pickup_at ?? order.eta) || undefined,
    correlation_id: options.correlationId,
    idempotency_key: `rappi-order-${providerOrderId}`,
    raw_payload: rawOrder,
  }
}
