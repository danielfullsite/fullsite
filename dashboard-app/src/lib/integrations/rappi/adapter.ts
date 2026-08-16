import { auditLog } from '@/lib/integrations/audit-logger'
import { rappiFetch, rappiOrdersBasePath } from '@/lib/integrations/rappi/auth'
import { type RappiCancelType, toRappiCancelType } from '@/lib/integrations/rappi/reasons'

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try { return JSON.parse(text) } catch { return { text: text.slice(0, 500) } }
}

async function requestRappi(options: {
  clientId?: string | null
  action: string
  storeId: string
  orderId: string
  path: string
  init: RequestInit
  correlationId: string
}) {
  const started = Date.now()
  const res = await rappiFetch(options.path, options.init)
  const payload = await parseResponse(res)
  await auditLog({
    provider: 'rappi',
    client_id: options.clientId ?? null,
    correlation_id: options.correlationId,
    action: options.action,
    request: { store_id: options.storeId, order_id: options.orderId },
    response: res.ok ? { ok: true } : payload,
    status_code: res.status,
    duration_ms: Date.now() - started,
  })
  return {
    ok: res.ok,
    status_code: res.status,
    data: payload,
    correlation_id: options.correlationId,
  }
}

export async function acceptRappiOrder(params: {
  clientId?: string | null
  storeId: string
  orderId: string
  cookingMinutes?: number
  correlationId: string
}) {
  const minutes = Math.max(1, Math.min(120, Math.round(params.cookingMinutes || 20)))
  const path = `${rappiOrdersBasePath()}/stores/${encodeURIComponent(params.storeId)}/orders/${encodeURIComponent(params.orderId)}/cooking_time/${minutes}/take`
  return requestRappi({
    clientId: params.clientId,
    action: 'order.accept',
    storeId: params.storeId,
    orderId: params.orderId,
    path,
    init: { method: 'PUT' },
    correlationId: params.correlationId,
  })
}

export async function rejectRappiOrder(params: {
  clientId?: string | null
  storeId: string
  orderId: string
  reason?: string | null
  description?: string | null
  correlationId: string
}) {
  const cancelType: RappiCancelType = toRappiCancelType(params.reason)
  const path = `${rappiOrdersBasePath()}/stores/${encodeURIComponent(params.storeId)}/orders/${encodeURIComponent(params.orderId)}/cancel_type/${cancelType}/reject`
  return requestRappi({
    clientId: params.clientId,
    action: 'order.reject',
    storeId: params.storeId,
    orderId: params.orderId,
    path,
    init: {
      method: 'PUT',
      body: JSON.stringify({
        description: params.description || 'Orden cancelada desde Fullsite POS',
        additional_info: {},
      }),
    },
    correlationId: params.correlationId,
  })
}

export async function markRappiOrderReady(params: {
  clientId?: string | null
  storeId: string
  orderId: string
  correlationId: string
}) {
  const path = `${rappiOrdersBasePath()}/stores/${encodeURIComponent(params.storeId)}/orders/${encodeURIComponent(params.orderId)}/ready-for-pickup`
  return requestRappi({
    clientId: params.clientId,
    action: 'order.ready',
    storeId: params.storeId,
    orderId: params.orderId,
    path,
    init: { method: 'POST' },
    correlationId: params.correlationId,
  })
}
