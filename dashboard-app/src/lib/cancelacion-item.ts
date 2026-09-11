/** Cancel unpaid consumption using the amounts already recorded on the order.
 * No terminal tax configuration or draft contributes to this accounting. */
export function prepararCancelacionItem(order: Record<string, any>, itemId: string, options: { prepared?: boolean; voided?: boolean; reason?: string } = {}) {
  const cents = (value: unknown): number => {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('INVALID_AMOUNTS')
    const amount = Number(value), rounded = Math.round(amount * 100)
    if (!Number.isFinite(amount) || !Number.isSafeInteger(rounded) || rounded < 0 || Math.abs(amount * 100 - rounded) > 0.000001) throw new Error('INVALID_AMOUNTS')
    return rounded
  }
  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items
  if (!Array.isArray(items) || items.some(i => !i || typeof i.id !== 'string')) throw new Error('INVALID_ITEMS')
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error('INVALID_ITEMS')
  if (!Number.isSafeInteger(order.order_revision) || order.order_revision < 0) throw new Error('INVALID_REVISION')
  const subtotal = cents(order.subtotal), discount = cents(order.descuento), tax = cents(order.iva), total = cents(order.total)
  const active = items.filter(i => !i.cancelled)
  if (active.reduce((sum, i) => sum + cents(i.subtotal), 0) !== subtotal || discount > subtotal || total !== subtotal - discount + tax) throw new Error('INVALID_AMOUNTS')
  const item = items.find(i => i.id === itemId)
  if (!item || item.cancelled) return { alreadyApplied: true, item, patch: null }
  const payments = typeof order.pagos === 'string' ? JSON.parse(order.pagos) : order.pagos
  if (payments != null && !Array.isArray(payments)) throw new Error('INVALID_PAYMENTS')
  if (['cerrada', 'pagada', 'cancelada', 'closed', 'paid'].includes(order.status) ||
    ['pagada', 'paid', 'partial', 'parcial', 'settled'].includes(order.payment_status) ||
    (payments || []).some((p: Record<string, unknown>) => !p || ((!p.estado || p.estado === 'aceptado') && cents(p.monto) > 0))) throw new Error('PAID_ORDER_REQUIRES_ADJUSTMENT')
  if (order.saldo != null && cents(order.saldo) < total) throw new Error('PAID_ORDER_REQUIRES_ADJUSTMENT')
  const gross = cents(item.subtotal)
  const proportional = (amount: number, portion: number, whole: number) =>
    Number((BigInt(2) * BigInt(amount) * BigInt(portion) + BigInt(whole)) / (BigInt(2) * BigInt(whole)))
  const removedDiscount = subtotal === 0 ? 0 : proportional(discount, gross, subtotal)
  const net = subtotal - discount
  if (net === 0 && tax !== 0) throw new Error('INVALID_AMOUNTS')
  const removedTax = net === 0 ? 0 : proportional(tax, gross - removedDiscount, net)
  const nextSubtotal = subtotal - gross, nextDiscount = discount - removedDiscount, nextTax = tax - removedTax
  const nextTotal = nextSubtotal - nextDiscount + nextTax
  if ([nextSubtotal, nextDiscount, nextTax, nextTotal].some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('INVALID_AMOUNTS')
  return { alreadyApplied: false, item, patch: {
    items: JSON.stringify(items.map(i => i.id === itemId ? { ...i, cancelled: true,
      // Sin respuesta explícita se conserva el consumo: cancel-item es para
      // renglones ya enviados, y 'pending' bloqueaba la conciliación de TODA la
      // orden (barrido 2026-09-10, inventario LENTE-2). Nunca se fabrica una
      // devolución; la merma queda registrada y un gerente la corrige a mano.
      inventory_disposition: options.prepared === true ? 'retain_consumption' : options.prepared === false ? 'return_stock' : 'retain_consumption',
      voided: options.voided === true, cancellation_reason: options.reason ?? null } : i)),
    subtotal: nextSubtotal / 100, descuento: nextDiscount / 100, iva: nextTax / 100,
    total: nextTotal / 100, saldo: nextTotal / 100,
  } }
}
