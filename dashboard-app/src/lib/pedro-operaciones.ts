import type { OrderItem } from './pos-data'
import { leerCatalogoCaja } from './pedro-catalogo'
import { ejecutarComandoCaja } from './pedro-comandos'
import { autorizarOperacionConPinEnCaja } from './pedro-actor'

export interface CuentaParaGuardar {
  id: string; turnoId: string; revision: number; mesa: number; clienteNombre?: string
  personas: number; notas: string; items: OrderItem[]; discount: number
}
export interface OrdenConfirmada extends Record<string, unknown> {
  id: string; order_revision: number; items: OrderItem[]; total_cents: number; turno_id: string
}
/** Compare only the operator's draft intent. A receipt adds server metadata
 * and normalizes modifier notes; those changes are not a new user edit. */
export function firmaBorradorParaCaja(order: Pick<CuentaParaGuardar, 'items' | 'personas' | 'discount' | 'notas'>): string {
  return JSON.stringify({ personas: order.personas, discount: order.discount, notas: order.notas,
    items: order.items.filter(item => !item.cancelled).map(item => ({ id: item.id, product: item.menuItemId,
      quantity: item.cantidad, modifiers: [...(item.modifier_ids ?? [])].sort(),
      notes: [...item.modificadores.filter(m => m.startsWith('Sin ')), item.notas].filter(Boolean).join(' · '), seat: item.silla || 0,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })
}
function readOrder(value: unknown, orderId: string): OrdenConfirmada {
  const o = value as OrdenConfirmada | undefined
  if (!o || (o.id ?? o.order_id) !== orderId || !Number.isSafeInteger(o.order_revision) || !Number.isSafeInteger(o.total_cents)) throw new Error('Caja no confirmó la cuenta completa.')
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items
  if (!Array.isArray(items)) throw new Error('Caja no confirmó los productos de la cuenta.')
  return { ...o, id: orderId, items }
}
/** Send product identities and intent. Caja owns prices, tax, mandatory options,
 * revisions and delivery batches. No Supabase write follows this receipt. */
export class GuardadoAnteriorRecuperado extends Error {
  constructor(readonly orden: OrdenConfirmada) {
    super('Recuperamos el guardado anterior. Tu borrador más reciente sigue pendiente; revísalo y vuelve a guardar antes de enviar.')
  }
}
export async function guardarCuentaEnCaja(order: CuentaParaGuardar): Promise<OrdenConfirmada> {
  const catalog = await leerCatalogoCaja()
  if (!catalog.catalog_revision) throw new Error('Vuelve a preparar el catálogo de Caja antes de guardar.')
  if (order.discount !== 0) throw new Error('El descuento requiere autorización en Caja antes de guardar esta cuenta.')
  const request = {
    order_id: order.id, turno_id: order.turnoId, expected_revision: order.revision,
    catalog_revision: catalog.catalog_revision, mesa: order.mesa || null,
    ...(order.clienteNombre ? { customer_name: order.clienteNombre } : {}),
    personas: order.personas, notas: order.notas,
    items: order.items.filter(i => !i.cancelled).map(item => ({ line_id: item.id, product_id: item.menuItemId,
      quantity: item.cantidad, modifier_ids: item.modifier_ids ?? [],
      notes: [...item.modificadores.filter(m => m.startsWith('Sin ')), item.notas].filter(Boolean).join(' · '),
      ...(item.silla ? { seat: item.silla } : {}) })),
  }
  const receipt = await ejecutarComandoCaja(`save:${order.id}`, 'ORDER_SAVE', request)
  const confirmed = readOrder(receipt.result.operational_order, order.id)
  // A retry journal may contain an older save. Recover its receipt, but never
  // treat that as approval to discard or send the operator's newer draft.
  const comparable = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(
    Object.entries(value).filter(([key]) => !['command_id', 'command_type', 'expected_revision', 'catalog_revision'].includes(key)).sort(([a], [b]) => a.localeCompare(b))))
  if (receipt.recovered && comparable(receipt.command) !== comparable(request)) throw new GuardadoAnteriorRecuperado(confirmed)
  return confirmed
}
export async function enviarCuentaEnCaja(order: OrdenConfirmada): Promise<OrdenConfirmada> {
  const receipt = await ejecutarComandoCaja(`send:${order.id}`, 'ORDER_SEND', {
    order_id: order.id, turno_id: order.turno_id, expected_revision: order.order_revision,
  })
  const confirmed = readOrder(receipt.result.operational_order, order.id)
  if (receipt.recovered && receipt.command.expected_revision !== order.order_revision) {
    throw new Error('Recuperamos el envío anterior. Los cambios guardados después siguen pendientes de enviar; revisa y vuelve a confirmar la ronda.')
  }
  return confirmed
}

/** Move and void use a fresh one-command approval; the returned actor token is
 * passed in a header, never as order data, and never changes the logged-in user. */
export async function moverCuentaEnCaja(order: OrdenConfirmada, mesa: number, pin: string): Promise<OrdenConfirmada> {
  if (!Number.isSafeInteger(mesa) || mesa < 1) throw new Error('Ingresa un número de mesa válido.')
  const actor = await autorizarOperacionConPinEnCaja(pin)
  const receipt = await ejecutarComandoCaja(`move:${order.id}`, 'ORDER_MOVE', {
    order_id: order.id, turno_id: order.turno_id, expected_revision: order.order_revision, mesa,
  }, { actor })
  return readOrder(receipt.result.operational_order, order.id)
}
export async function anularCuentaEnCaja(order: OrdenConfirmada, reason: string, pin: string): Promise<OrdenConfirmada> {
  if (!reason.trim()) throw new Error('Escribe el motivo de anulación.')
  const actor = await autorizarOperacionConPinEnCaja(pin)
  const receipt = await ejecutarComandoCaja(`void:${order.id}`, 'ORDER_VOID', {
    order_id: order.id, turno_id: order.turno_id, expected_revision: order.order_revision, reason: reason.trim(),
  }, { actor })
  const result = readOrder(receipt.result.operational_order, order.id)
  if (result.status !== 'cancelada') throw new Error('Caja no confirmó la anulación. Conservamos la cuenta.')
  return result
}
