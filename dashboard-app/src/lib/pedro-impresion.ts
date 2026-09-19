import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { ejecutarComandoCaja } from './pedro-comandos'
import { autorizarOperacionConPinEnCaja } from './pedro-actor'
import type { FinanzasDeCaja } from './pedro-finanzas'

export interface CuentaImprimible {
  id: string; orderRevision: number; financialRevision: number; total: number; paid: number; tip: number; label: string
}
export interface DocumentoDeCaja {
  kind: 'precheck' | 'receipt' | 'drawer'; source_command_id: string; original_command_id?: string
  job_ids: string[]; copy?: boolean; lines?: string[]
}
/** Read only Caja's confirmed state. A printed receipt is a server-rendered
 * document from accepted payments; the browser never supplies ESC/POS or money. */
export async function leerCuentasImprimibles(): Promise<{ turnoId: string | null; precuentas: CuentaImprimible[]; recibos: CuentaImprimible[] }> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
  const state = await response.json()
  if (!response.ok || state.authoritative !== true || state.write_authority !== 'caja' || state.order_snapshot_complete !== true ||
      !Array.isArray(state.financial_orders) || !Array.isArray(state.salon_orders)) throw new Error('Caja no confirmó los documentos. Vuelve a conectar antes de imprimir.')
  const finances = state.financial_orders as FinanzasDeCaja[]
  const precuentas = state.salon_orders.map((order: Record<string, unknown>): CuentaImprimible => {
    const id = String(order.order_id ?? order.id), financial = finances.find(f => f.order_id === id)
    return { id, orderRevision: Number(order.order_revision), financialRevision: financial?.revision ?? 0,
      total: Number(order.total_cents), paid: financial?.paid_cents ?? 0, tip: financial?.tip_cents ?? 0,
      label: order.mesa != null ? `Mesa ${order.mesa} · ${id.slice(-8)}` : `Cuenta ${order.customer_name || id.slice(-8)}` }
  })
  const recibos = finances.filter(f => f.payments.some(payment => payment.status === 'accepted')).map(f => ({
    id: f.order_id, orderRevision: f.order_revision, financialRevision: f.revision, total: f.total_cents, paid: f.paid_cents, tip: f.tip_cents ?? 0,
    label: precuentas.find((order: CuentaImprimible) => order.id === f.order_id)?.label ?? `Cuenta ${f.order_id.slice(-8)} · turno ${f.turno_id.slice(-8)}`,
  }))
  if ([...precuentas, ...recibos].some(order => !order.id || ![order.orderRevision, order.financialRevision, order.total, order.paid, order.tip].every(value => Number.isSafeInteger(value) && value >= 0))) throw new Error('Caja no confirmó los importes y revisiones del documento.')
  return { turnoId: typeof state.turno?.id === 'string' ? state.turno.id : null, precuentas, recibos }
}
function document(value: unknown): DocumentoDeCaja {
  const result = value as DocumentoDeCaja | undefined
  if (!result || !['precheck', 'receipt', 'drawer'].includes(result.kind) || typeof result.source_command_id !== 'string' || !Array.isArray(result.job_ids) || !result.job_ids.length || result.job_ids.some(id => typeof id !== 'string')) throw new Error('Caja no confirmó la identidad del trabajo. Recupera el mismo intento antes de solicitar otra impresión.')
  return result
}
export async function solicitarDocumentoCaja(kind: 'precheck' | 'receipt', order: CuentaImprimible): Promise<DocumentoDeCaja> {
  const receipt = await ejecutarComandoCaja(`print:${kind}:${order.id}`, kind === 'precheck' ? 'PRINT_PRECHECK' : 'PRINT_RECEIPT', {
    order_id: order.id, expected_order_revision: order.orderRevision, expected_financial_revision: order.financialRevision,
  })
  return document(receipt.result.print_document)
}
export async function solicitarCopiaCaja(original: DocumentoDeCaja, reason: string, pin: string): Promise<DocumentoDeCaja> {
  if (!reason.trim() || reason.trim().length > 200) throw new Error('Escribe el motivo de la copia, hasta 200 caracteres.')
  if (original.kind === 'drawer' || original.copy) throw new Error('Selecciona el documento original para solicitar una copia.')
  const actor = await autorizarOperacionConPinEnCaja(pin)
  const receipt = await ejecutarComandoCaja(`print:copy:${original.source_command_id}`, 'PRINT_COPY', {
    source_command_id: original.source_command_id, reason: reason.trim(),
  }, { actor })
  return document(receipt.result.print_document)
}
export async function solicitarCajonCaja(turnoId: string, reason: string): Promise<DocumentoDeCaja> {
  if (!reason.trim() || reason.trim().length > 200) throw new Error('Escribe el motivo de apertura, hasta 200 caracteres.')
  const receipt = await ejecutarComandoCaja(`drawer:${turnoId}`, 'DRAWER_OPEN', { turno_id: turnoId, reason: reason.trim() })
  return document(receipt.result.print_document)
}
