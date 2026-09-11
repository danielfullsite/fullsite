import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { actorDeCaja } from './pedro-actor'
import { ejecutarComandoCaja, ErrorDeCaja } from './pedro-comandos'

export interface CuentaFinanciera { account_id: string; label?: string; total_cents: number; paid_cents: number; reserved_cents: number; balance_cents: number }
export interface PagoDeCaja { payment_id: string; account_id: string; amount_cents: number; method: 'cash' | 'external'; status: 'pending' | 'unknown' | 'accepted' | 'rejected'; change_cents?: number; provider?: string }
export interface FinanzasDeCaja {
  order_id: string; turno_id: string; currency: 'MXN'; revision: number; order_revision: number
  total_cents: number; paid_cents: number; reserved_cents: number; balance_cents: number
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
export function validarFinanzasCaja(value: unknown, orderId: string): FinanzasDeCaja {
  const f = value as FinanzasDeCaja | undefined
  if (!f || f.order_id !== orderId || f.currency !== 'MXN' || !Number.isSafeInteger(f.revision) ||
      !Number.isSafeInteger(f.balance_cents) || f.balance_cents < 0 || !Array.isArray(f.accounts) || !Array.isArray(f.payments)) {
    throw new Error('Caja devolvió un saldo sin confirmar. Vuelve a consultar.')
  }
  return f
}
export interface OrdenParaCobroCaja { id: string; turno_id: string; order_revision: number; total_cents: number; items?: unknown }
export async function leerEstadoCobroCaja(orderId: string): Promise<{ financial: FinanzasDeCaja | null; order: OrdenParaCobroCaja | null }> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
  const state = await response.json()
  if (!response.ok || state.authoritative !== true || state.write_authority !== 'caja' || !Array.isArray(state.financial_orders)) {
    throw new ErrorDeCaja('Sin conexión confirmada con Caja. Los cobros están bloqueados.', 'CAJA_UNAVAILABLE')
  }
  const current = state.financial_orders.find((o: FinanzasDeCaja) => o.order_id === orderId)
  const order = Array.isArray(state.salon_orders) ? state.salon_orders.find((row: { id?: string; order_id?: string }) => (row.order_id ?? row.id) === orderId) : null
  const confirmed = order && typeof order.turno_id === 'string' && Number.isSafeInteger(order.order_revision) && Number.isSafeInteger(order.total_cents)
  return { financial: current ? validarFinanzasCaja(current, orderId) : null, order: confirmed ? { ...order, id: orderId } : null }
}
export async function leerFinanzasCaja(orderId: string): Promise<FinanzasDeCaja | null> {
  return (await leerEstadoCobroCaja(orderId)).financial
}
async function change(key: string, type: string, fields: Record<string, unknown> & { order_id: string }): Promise<FinanzasDeCaja> {
  const receipt = await ejecutarComandoCaja(key, type, fields)
  return validarFinanzasCaja(receipt.result.financial_order, fields.order_id)
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
export function reservarEfectivoCaja(order: FinanzasDeCaja, accountId: string, amount: number): Promise<FinanzasDeCaja> {
  const account = order.accounts.find(a => a.account_id === accountId)
  if (!account || !Number.isSafeInteger(amount) || amount <= 0 || amount > account.balance_cents - account.reserved_cents) throw new Error('El importe supera el saldo disponible de esta cuenta.')
  return change(`reserve:${order.order_id}:${accountId}`, 'FINANCIAL_PAYMENT_START', { order_id: order.order_id,
    expected_revision: order.revision, account_id: accountId, payment_id: crypto.randomUUID(), amount_cents: amount, method: 'cash' })
}
export function confirmarEfectivoCaja(order: FinanzasDeCaja, payment: PagoDeCaja, received: number): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'cash' || !Number.isSafeInteger(received) || received < payment.amount_cents) throw new Error('Confirma el efectivo recibido con tu sesión de Caja.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status: 'accepted',
    evidence: { kind: 'cash_received', received_by: actor.staff.id, received_cents: received } })
}
/**
 * COBRO CON TERMINAL BANCARIA.
 *
 * En AMALAY la tarjeta NO se cobra desde el punto de venta: se pasa en la terminal del
 * banco, que es un aparato aparte, y el POS sólo tiene que dejar constancia de que ese
 * dinero entró y con qué referencia. El dominio de Caja ya sabía hacer esto —
 * `financial-domain.js:219` acepta `cash` y `external` desde antes— con su evidencia, su
 * resultado incierto y su recuperación. Lo único que faltaba era la pantalla.
 *
 * Son DOS actos separados a propósito, igual que el efectivo:
 *
 *   1. reservar   el importe queda apartado de la cuenta ANTES de pasar la tarjeta, para
 *                 que otra terminal no lo cobre otra vez mientras el cajero está en eso.
 *   2. resolver   se registra lo que dijo la terminal: aprobado, rechazado o INCIERTO.
 *
 * El tercer resultado es el que importa y es el que casi nadie implementa. Si la terminal
 * aprueba y se va la luz antes de que alguien vea el voucher, el cobro NO se puede dar por
 * bueno ni por malo: queda `unknown`, sigue reteniendo el saldo (`RESERVING` en
 * financial-domain.js:6 incluye 'unknown') y se puede resolver después con el número de
 * autorización cuando aparezca el voucher. Nunca deja la mesa cobrada por accidente ni
 * libre por accidente.
 */
const REFERENCIA_MAXIMA = 200

function referenciaDeTerminal(texto: string): string {
  const limpia = texto.trim()
  if (!limpia) throw new Error('Escribe la referencia o el número de autorización del voucher.')
  if (limpia.length > REFERENCIA_MAXIMA) throw new Error('La referencia es demasiado larga.')
  return limpia
}

/** Aparta el importe antes de pasar la tarjeta. `provider` identifica la terminal. */
export function reservarCobroExterno(order: FinanzasDeCaja, accountId: string, amount: number, provider: string): Promise<FinanzasDeCaja> {
  const account = order.accounts.find(a => a.account_id === accountId)
  if (!account || !Number.isSafeInteger(amount) || amount <= 0 || amount > account.balance_cents - account.reserved_cents) {
    throw new Error('El importe supera el saldo disponible de esta cuenta.')
  }
  const terminal = provider.trim()
  if (!terminal) throw new Error('Indica en qué terminal se va a cobrar.')
  return change(`reserve-ext:${order.order_id}:${accountId}`, 'FINANCIAL_PAYMENT_START', {
    order_id: order.order_id, expected_revision: order.revision, account_id: accountId,
    payment_id: crypto.randomUUID(), amount_cents: amount, method: 'external', provider: terminal,
  })
}

/**
 * Registra lo que contestó la terminal.
 *
 * La evidencia repite proveedor, estado, importe y moneda porque el dominio los compara
 * contra el intento reservado (`requireEvidence`, financial-domain.js:82-88). Si algo no
 * cuadra —otra terminal, otro importe— el comando se rechaza en vez de guardar un cobro
 * que no corresponde.
 */
function resolverCobroExterno(order: FinanzasDeCaja, payment: PagoDeCaja, status: 'accepted' | 'rejected' | 'unknown', referencia: string): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor) throw new Error('Se requiere la sesión del operador de Caja.')
  if (payment.method !== 'external' || !payment.provider) throw new Error('Este cobro no se hizo con terminal.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', {
    order_id: order.order_id, expected_revision: order.revision, payment_id: payment.payment_id, status,
    evidence: {
      kind: 'provider_result', provider: payment.provider, status,
      reference: referenciaDeTerminal(referencia),
      amount_cents: payment.amount_cents, currency: order.currency,
    },
  })
}

/** La terminal aprobó. La referencia es el número de autorización del voucher. */
export const confirmarCobroExterno = (order: FinanzasDeCaja, payment: PagoDeCaja, referencia: string) =>
  resolverCobroExterno(order, payment, 'accepted', referencia)

/** La terminal rechazó. Se libera el saldo y la cuenta vuelve a quedar cobrable. */
export const rechazarCobroExterno = (order: FinanzasDeCaja, payment: PagoDeCaja, referencia: string) =>
  resolverCobroExterno(order, payment, 'rejected', referencia)

/**
 * No se sabe qué pasó — se cayó la luz, se trabó la terminal, nadie vio el voucher.
 *
 * NO es un rechazo. El importe sigue retenido para que nadie lo cobre dos veces, y el
 * cobro se puede resolver después cuando aparezca el voucher o el estado de cuenta.
 * Adivinar aquí es como se cobra dos veces o se regala una comida.
 */
export const marcarCobroExternoIncierto = (order: FinanzasDeCaja, payment: PagoDeCaja, referencia: string) =>
  resolverCobroExterno(order, payment, 'unknown', referencia)

export function liberarEfectivoNoRecibido(order: FinanzasDeCaja, payment: PagoDeCaja): Promise<FinanzasDeCaja> {
  const actor = actorDeCaja()
  if (!actor || payment.method !== 'cash') throw new Error('Se requiere la sesión del operador de Caja.')
  return change(`result:${payment.payment_id}`, 'FINANCIAL_PAYMENT_RESULT', { order_id: order.order_id,
    expected_revision: order.revision, payment_id: payment.payment_id, status: 'rejected',
    evidence: { kind: 'operator_record', recorded_by: actor.staff.id, reason: 'El operador confirma que no recibió el efectivo.' } })
}
