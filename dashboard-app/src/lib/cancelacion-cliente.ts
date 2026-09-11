export interface IntentoCancelacion {
  client_id: string; order_id: string; item_id: string; reason: string; manager: string; mesero: string
  prepared: boolean; voided: boolean; operation_id?: string
  authorization_mode?: 'online' | 'offline'
}
const approvals = new Map<string, string>()
export interface ReciboCancelacion {
  ok: true; revision: number; order: Record<string, any>; inventory_pending?: boolean; inventory_error?: string
}

/** Immutable cancellation intent survives a lost response. No local order or
 * inventory effect is permitted until its canonical receipt is validated. */
export async function confirmarCancelacionItem(input: IntentoCancelacion, headers: Record<string, string>, approvalToken?: string | null) {
  const key = `pos_cancel_item:${JSON.stringify([input.client_id, input.order_id, input.item_id])}`
  let intent: IntentoCancelacion
  let recovered: boolean
  try {
    const saved = localStorage.getItem(key)
    recovered = saved !== null
    intent = saved ? JSON.parse(saved) : { ...input, operation_id: crypto.randomUUID(), authorization_mode: approvalToken ? 'online' : 'offline' }
    if (!intent.operation_id || intent.order_id !== input.order_id || intent.item_id !== input.item_id || intent.client_id !== input.client_id) throw new Error('INVALID_INTENT')
    localStorage.setItem(key, JSON.stringify(intent))
  } catch { throw new Error('No se pudo conservar el intento. La cuenta no se modificó.') }
  if (approvalToken) approvals.set(intent.operation_id!, approvalToken)
  const authorization = approvalToken || approvals.get(intent.operation_id!)
  if (intent.authorization_mode === 'online' && !authorization) throw new Error('Autoriza nuevamente con PIN para recuperar esta cancelación.')
  let response: Response
  let result: Record<string, any>
  try {
    response = await fetch('/api/pos/cancel-item', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ...intent, approval_token: authorization || undefined, offline_approved: authorization ? undefined : true }),
      signal: AbortSignal.timeout(5000) })
    result = await response.json()
  } catch { throw new Error('Cancelación sin confirmar. Reintenta para recuperar el mismo intento; la cuenta y el inventario no se modificaron aquí.') }
  if (!response.ok || result.ok !== true) {
    // Rejections cannot turn into an automatic later mutation. Unknown outcomes
    // retain their identity; a new manual attempt supplies fresh authorization.
    if (response.status >= 400 && response.status < 500) localStorage.removeItem(key)
    throw new Error(result.message || (result.conflict ? 'Otra terminal cambió la cuenta. Recarga antes de cancelar.' : `Cancelación no confirmada: ${result.error || response.status}`))
  }
  const order = result.order
  let items = order?.items
  if (typeof items === 'string') { try { items = JSON.parse(items) } catch { items = null } }
  if (!order || order.id !== intent.order_id || !Number.isSafeInteger(result.revision) || result.revision < 1 ||
    order.order_revision !== result.revision || !Array.isArray(items)) throw new Error('No llegó un recibo válido. Reintenta la misma cancelación.')
  const confirmedItem = items.find((item: Record<string, unknown>) => item?.id === intent.item_id && item.cancelled === true)
  if (!confirmedItem) {
    localStorage.removeItem(key)
    throw new Error('El artículo ya no pertenece a esta cuenta. Actualiza la cuenta; no se aplicó otra cancelación.')
  }
  return { result: result as ReciboCancelacion, item: confirmedItem, intent, recovered,
    confirmada: () => { localStorage.removeItem(key); approvals.delete(intent.operation_id!) } }
}
