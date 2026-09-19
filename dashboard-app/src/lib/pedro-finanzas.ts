import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { actorDeCaja } from './pedro-actor'
import { ejecutarComandoCaja, ErrorDeCaja } from './pedro-comandos'

export interface CuentaFinanciera { account_id: string; label?: string; total_cents: number; paid_cents: number; reserved_cents: number; balance_cents: number }
export interface PagoDeCaja {
  payment_id: string; account_id: string; amount_cents: number; tip_cents?: number
  method: 'cash' | 'manual' | 'external'; tender?: 'card' | 'transfer'; status: 'pending' | 'unknown' | 'accepted' | 'rejected'; change_cents?: number
  created_at?: string; resolved_at?: string; accepted_at?: string; evidence?: { source?: string; reference?: string }
}
export interface FinanzasDeCaja {
  order_id: string; turno_id: string; currency: 'MXN'; revision: number; order_revision: number
  total_cents: number; paid_cents: number; reserved_cents: number; balance_cents: number
  tip_cents?: number; reserved_tip_cents?: number
  status: 'open' | 'settled'; accounts: CuentaFinanciera[]; payments: PagoDeCaja[]
}
export const pesosDeCentavos = (cents: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100)
export function centavosDeTexto(text: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) throw new Error('Escribe un importe con hasta dos decimales.')
  const [whole, fraction = ''] = text.trim().split('.')
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Importe fuera de rango.')
  return value
}
function finanzas(value: unknown, orderId: string): FinanzasDeCaja {
  const f = value as FinanzasDeCaja | undefined
  if (!f || f.order_id !== orderId || f.currency !== 'MXN' || !Number.isSafeInteger(f.revision) ||
      !Number.isSafeInteger(f.balance_cents) || f.balance_cents < 0 || !Array.isArray(f.accounts) || !Array.isArray(f.payments)) {
    throw new Error('Caja devolvió un saldo sin confirmar. Vuelve a consultar.')
  }
  return f
}
export async function leerFinanzasCaja(orderId: string): Promise<FinanzasDeCaja | null> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
  const state = await response.json()
  if (!response.ok || state.authoritative !== true || state.write_authority !== 'caja' || !Array.isArray(state.financial_orders)) {
    throw new ErrorDeCaja('Sin conexión confirmada con Caja. Los cobros están bloqueados.', 'CAJA_UNAVAILABLE')
  }
  const current = state.financial_orders.find((o: FinanzasDeCaja) => o.order_id === orderId)
  return current ? finanzas(current, orderId) : null
}
async function change(key: string, type: string, fields: Record<string, unknown> & { order_id: string }): Promise<FinanzasDeCaja> {
  const receipt = await ejecutarComandoCaja(key, type, fields)
  return finanzas(receipt.result.financial_order, fields.order_id)
}
/** UX preflight only; Caja checks the same prerequisite with its saved order
 * inside the durable transaction. Sending and preparing remain separate. */
export function avisoAntesDeCobrarCaja(order: { items?: unknown }): string | null {
  let items = order.items
  if (typeof items === 'string') { try { items = JSON.parse(items) } catch { items = null } }
  const confirmed = Array.isArray(items) && items.length > 0 && items.every(item => item &&
    Number.isSafeInteger(item.cantidad) && item.cantidad > 0 && Number.isSafeInteger(item.sent_quantity) && item.sent_quantity === item.cantidad)
  return confirmed ? null : 'Envía todos los productos guardados a cocina antes de preparar el cobro. No es necesario esperar su preparación.'
}
export async function abrirFinanzasCaja(order: { id: string; turno_id: string; order_revision: number; total_cents: number; items?: unknown }): Promise<FinanzasDeCaja> {
  const current = await leerFinanzasCaja(order.id)
  if (current) return current
  const warning = avisoAntesDeCobrarCaja(order)
  if (warning) throw new ErrorDeCaja(warning, 'ORDER_SEND_REQUIRED')
  return change(`open:${order.id}`, 'FINANCIAL_OPEN', { order_id: order.id, turno_id: order.turno_id,
    expected_revision: 0, expected_order_revision: order.order_revision, total_cents: order.total_cents, currency: 'MXN' })
}
export function dividirParejoCaja(order: FinanzasDeCaja, count: number): Promise<FinanzasDeCaja> {
  if (!Number.isInteger(count) || count < 2 || count > 50 || count > order.total_cents) throw new Error('Elige entre 2 y 50 cuentas con saldo positivo.')
  const each = Math.floor(order.total_cents / count)
  const accounts = Array.from({ length: count }, (_, i) => ({ account_id: `${order.order_id}:part:${i + 1}`,
    label: `Cuenta ${i + 1}`, total_cents: each + (i === count - 1 ? order.total_cents - each * count : 0) }))
  return change(`split:${order.order_id}`, 'FINANCIAL_SPLIT', { order_id: order.order_id, expected_revision: order.revision, accounts })
}
export function reservarPagoCaja(order: FinanzasDeCaja, accountId: string, amount: number,
  options: { method: 'cash' | 'manual'; tender?: 'card' | 'transfer'; tip_cents?: number }): Promise<FinanzasDeCaja> {
  const account = order.accounts.find(a => a.account_id === accountId)
  if (!account || !Number.isSafeInteger(amount) || amount <= 0 || amount > account.balance_cents - account.reserved_cents) throw new Error('El importe supera el saldo disponible de esta cuenta.')
  const tip = options.tip_cents ?? 0
  if (!Number.isSafeInteger(tip) || tip < 0 || !Number.isSafeInteger(amount + tip) ||
    !['cash', 'manual'].includes(options.method) || options.method === 'manual' && !['card', 'transfer'].includes(options.tender ?? '')) throw new Error('Forma de pago o propina inválida.')
  return change(`reserve:${order.order_id}:${accountId}`, 'FINANCIAL_PAYMENT_START', { order_id: order.order_id,
    expected_revision: order.revision, account_id: accountId, payment_id: crypto.randomUUID(), amount_cents: amount,
    method: options.method, tip_cents: tip, ...(options.method === 'manual' ? { tender: options.tender } : {}) })
}
export function reservarEfectivoCaja(order: FinanzasDeCaja, accountId: string, amount: number): Promise<FinanzasDeCaja> {
  return reservarPagoCaja(order, accountId, amount, { method: 'cash' })
}
export function confirmarEfectivoCaja(order: FinanzasDeCaja, payment: PagoDeCaja, received: number): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'cash' || !Number.isSafeInteger(received) || received < payment.amount_cents + (payment.tip_cents ?? 0)) throw new Error('Confirma el efectivo recibido, incluyendo propina, con tu sesión de Caja.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status: 'accepted',
    evidence: { kind: 'cash_received', received_by: actor.staff.id, received_cents: received } })
}
/** Records an operator-verified payment made outside Fullsite. This never calls
 * a bank or presents the operator's statement as a provider authorization. */
export function confirmarPagoManualCaja(order: FinanzasDeCaja, payment: PagoDeCaja, source: string, reference: string): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'manual' || !source.trim() || !reference.trim() || source.trim().length > 200 || reference.trim().length > 200) throw new Error('Indica terminal o banco y la referencia del pago que verificaste.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status: 'accepted',
    evidence: { kind: 'manual_received', received_by: actor.staff.id, source: source.trim(), reference: reference.trim(),
      tender: payment.tender, currency: order.currency, amount_cents: payment.amount_cents + (payment.tip_cents ?? 0) } })
}
export function resolverPagoManualCaja(order: FinanzasDeCaja, payment: PagoDeCaja, status: 'unknown' | 'rejected', reason: string): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'manual' || !reason.trim()) throw new Error('Indica qué verificaste con la terminal o el banco.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status,
    evidence: { kind: 'operator_record', recorded_by: actor.staff.id, reason: reason.trim() } })
}
export function liberarEfectivoNoRecibido(order: FinanzasDeCaja, payment: PagoDeCaja): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'cash') throw new Error('Se requiere la sesión del operador de Caja.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status: 'rejected',
    evidence: { kind: 'operator_record', recorded_by: actor.staff.id, reason: 'El operador confirma que no recibió el efectivo.' } })
}
