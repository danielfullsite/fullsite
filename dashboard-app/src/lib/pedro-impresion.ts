import { getBridgeUrl } from './bridge-url'
import { localNetworkFetch } from './local-network-fetch'
import { actorDeCaja, type SesionDeCaja } from './pedro-actor'
import { comandoPendienteCaja, ejecutarComandoCaja } from './pedro-comandos'
import type { FinanzasDeCaja } from './pedro-finanzas'

/** The browser requests a canonical document, never ESC/POS bytes or amounts.
 * A receipt confirms durable queueing; it does not prove paper was produced. */
export interface DocumentoDeCaja {
  document_id: string
  kind: string
  order_id: string
  payment_id?: string
  order_revision: number
  financial_revision?: number
  [key: string]: unknown
}
export interface ImpresionInciertaCaja {
  job_id: string
  uncertain_episode_id: string
  printer_name: string
  document_type: string
  created_at: string
  copies: number
  copies_printed: number
}
type CopyOptions = { originalDocumentId: string; reason: string }
export async function leerDocumentosCaja(orderId: string): Promise<DocumentoDeCaja[]> {
  const response = await localNetworkFetch(`${getBridgeUrl()}/state`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
  const body = await response.json()
  if (!response.ok || body.authoritative !== true || body.write_authority !== 'caja' || !Array.isArray(body.print_documents)) {
    throw new Error('Caja no confirmó los documentos de esta cuenta.')
  }
  return body.print_documents.filter((document: DocumentoDeCaja) => document.order_id === orderId)
}
const copyFields = (copy?: CopyOptions) => copy ? { original_document_id: copy.originalDocumentId, reason: copy.reason.trim() } : {}
function validateDocument(result: Record<string, unknown>, command: Readonly<Record<string, unknown>>) {
  const document = result.print_document as DocumentoDeCaja | undefined
  if (!document || document.document_id !== command.command_id || document.order_id !== command.order_id ||
      !Number.isSafeInteger(document.order_revision) ||
      (command.original_document_id !== undefined && (document.original_document_id !== command.original_document_id || document.reason !== command.reason)) ||
      (!command.original_document_id && document.order_revision !== command.expected_revision) ||
      (!command.original_document_id && command.expected_financial_revision !== undefined && document.financial_revision !== command.expected_financial_revision) ||
      (command.payment_id !== undefined && document.payment_id !== command.payment_id)) throw new Error('Documento sin confirmar')
}
async function documentCommand(operation: string, type: string, fields: Record<string, unknown>) {
  const receipt = await ejecutarComandoCaja(operation, type, fields, { validateResult: validateDocument })
  return { document: receipt.result.print_document as DocumentoDeCaja, recovered: receipt.recovered }
}
export function imprimirPrecuentaCaja(order: { id: string; order_revision: number; financial_order?: FinanzasDeCaja | null }, copy?: CopyOptions) {
  return documentCommand(`print-precheck:${order.id}`, 'ORDER_PRECHECK_PRINT', {
    order_id: order.id, expected_revision: order.order_revision,
    ...(order.financial_order ? { expected_financial_revision: order.financial_order.revision } : {}), ...copyFields(copy),
  })
}
export function imprimirReciboPagoCaja(finance: FinanzasDeCaja, paymentId: string, copy?: CopyOptions) {
  return documentCommand(`print-receipt:${finance.order_id}:${paymentId}`, 'PAYMENT_RECEIPT_PRINT', {
    order_id: finance.order_id, payment_id: paymentId, expected_revision: finance.order_revision,
    expected_financial_revision: finance.revision, ...copyFields(copy),
  })
}
function validateResolution(result: Record<string, unknown>, command: Readonly<Record<string, unknown>>) {
  const resolution = result.print_resolution as Record<string, unknown> | undefined
  if (!resolution || resolution.job_id !== command.job_id || resolution.uncertain_episode_id !== command.uncertain_episode_id ||
      resolution.resolution !== command.resolution || resolution.reason !== command.reason) throw new Error('Verificación de impresión sin confirmar')
}
export async function resolverImpresionCaja(job: ImpresionInciertaCaja, resolution: 'printed' | 'reprint', reason: string, actor: SesionDeCaja) {
  if (!reason.trim()) throw new Error('Indica qué verificaste en la impresora.')
  const receipt = await ejecutarComandoCaja(`print-resolve:${job.job_id}:${job.uncertain_episode_id}`, 'PRINT_UNCERTAIN_RESOLVE', {
    job_id: job.job_id, uncertain_episode_id: job.uncertain_episode_id, resolution, reason: reason.trim(),
  }, { actor, validateResult: validateResolution })
  return { resolution: receipt.result.print_resolution as Record<string, unknown>, recovered: receipt.recovered }
}
export async function leerImpresionesInciertasCaja(actor = actorDeCaja()): Promise<ImpresionInciertaCaja[]> {
  if (!actor) throw new Error('Ingresa con PIN para consultar las impresiones.')
  const response = await localNetworkFetch(`${getBridgeUrl()}/print/uncertain`, {
    cache: 'no-store', headers: { 'x-fullsite-actor': actor.actor_token }, signal: AbortSignal.timeout(3000),
  })
  const body = await response.json()
  if (!response.ok || body.authoritative !== true || !Array.isArray(body.jobs) || body.jobs.some((job: ImpresionInciertaCaja) =>
    !job || typeof job.job_id !== 'string' || typeof job.uncertain_episode_id !== 'string')) {
    throw new Error(body.error || 'Caja no confirmó la cola de impresión.')
  }
  return body.jobs
}
export async function recuperarImpresionCaja(operation: string, actor?: SesionDeCaja) {
  const command = comandoPendienteCaja(operation)
  const expectedOperation = command?.command_type === 'ORDER_PRECHECK_PRINT' ? `print-precheck:${command.order_id}`
    : command?.command_type === 'PAYMENT_RECEIPT_PRINT' ? `print-receipt:${command.order_id}:${command.payment_id}`
      : command?.command_type === 'PRINT_UNCERTAIN_RESOLVE' ? `print-resolve:${command.job_id}:${command.uncertain_episode_id}` : null
  if (!command || operation !== expectedOperation) throw new Error('No hay una impresión pendiente para recuperar.')
  return ejecutarComandoCaja(operation, command.command_type, command, {
    ...(actor ? { actor } : {}), validateResult: command.command_type === 'PRINT_UNCERTAIN_RESOLVE' ? validateResolution : validateDocument,
  })
}
