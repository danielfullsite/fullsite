import { acceptRappiOrder, markRappiOrderReady, rejectRappiOrder } from '@/lib/integrations/rappi/adapter'
import { rappiStoreId } from '@/lib/integrations/rappi/auth'
import { rappiProviderStoreId } from '@/lib/integrations/rappi/normalizer'

type RappiOrderAction = 'accept' | 'ready' | 'reject' | 'cancel'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_SERVICE_KEY = () => process.env.SUPABASE_SERVICE_KEY || ''

function assertServiceDb() {
  const url = SB_URL()
  const key = SB_SERVICE_KEY()
  if (!url || !key) throw new Error('SUPABASE_SERVICE_KEY_REQUIRED')
  return { url, key }
}

function headers(extra?: Record<string, string>) {
  const { key } = assertServiceDb()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function fetchOrder(clientId: string, platformOrderId: string) {
  const { url } = assertServiceDb()
  const res = await fetch(
    `${url}/rest/v1/delivery_orders?client_id=eq.${encodeURIComponent(clientId)}&platform=eq.rappi&platform_order_id=eq.${encodeURIComponent(platformOrderId)}&select=id,status,raw_payload&limit=1`,
    { headers: headers(), cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json().catch(() => []) as Array<{ id: string; status: string; raw_payload: unknown }>
  return rows[0] ?? null
}

async function patchOrder(id: string, status: string) {
  const { url } = assertServiceDb()
  await fetch(`${url}/rest/v1/delivery_orders?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    cache: 'no-store',
  }).catch(() => null)
}

export async function syncRappiOrderAction(params: {
  clientId: string
  platformOrderId: string
  action: RappiOrderAction
  reason?: string | null
  minutesToReady?: number
  correlationId?: string
  updateLocalStatus?: boolean
}) {
  const correlationId = params.correlationId || crypto.randomUUID()
  const order = await fetchOrder(params.clientId, params.platformOrderId)
  if (!order) return { ok: false, status_code: 404, error: 'RAPPI_ORDER_NOT_FOUND', correlation_id: correlationId }

  const storeId = rappiProviderStoreId(order.raw_payload, rappiStoreId())
  if (!storeId) return { ok: false, status_code: 422, error: 'RAPPI_STORE_ID_MISSING', correlation_id: correlationId }

  const result = params.action === 'accept'
    ? await acceptRappiOrder({
      clientId: params.clientId,
      storeId,
      orderId: params.platformOrderId,
      cookingMinutes: params.minutesToReady,
      correlationId,
    })
    : params.action === 'ready'
      ? await markRappiOrderReady({
        clientId: params.clientId,
        storeId,
        orderId: params.platformOrderId,
        correlationId,
      })
      : await rejectRappiOrder({
        clientId: params.clientId,
        storeId,
        orderId: params.platformOrderId,
        reason: params.reason,
        correlationId,
      })

  if (result.ok && params.updateLocalStatus) {
    const nextStatus = params.action === 'accept' ? 'preparando' : params.action === 'ready' ? 'lista' : 'cancelada'
    await patchOrder(order.id, nextStatus)
  }
  return result
}
