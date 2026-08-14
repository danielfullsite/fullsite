import { auditLog } from '@/lib/integrations/audit-logger'
import { normalizeRappiOrder, rappiProviderOrderId, rappiProviderStoreId } from '@/lib/integrations/rappi/normalizer'
import { rappiStoreId } from '@/lib/integrations/rappi/auth'

type ProcessSource = 'webhook' | 'poller' | 'manual'
type ProcessResult = { action: 'new' | 'dedup' | 'dlq'; orderId?: string; platformOrderId?: string; reason?: string }

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_SERVICE_KEY = () => process.env.SUPABASE_SERVICE_KEY || ''

function assertServiceDb() {
  const url = SB_URL()
  const key = SB_SERVICE_KEY()
  if (!url || !key) throw new Error('SUPABASE_SERVICE_KEY_REQUIRED')
  return { url, key }
}

function serviceHeaders(extra?: Record<string, string>) {
  const { key } = assertServiceDb()
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function sbJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; rows: T[] }> {
  const { url } = assertServiceDb()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => [])
  return { ok: res.ok, status: res.status, rows: Array.isArray(data) ? data as T[] : [] }
}

async function findExisting(platformOrderId: string) {
  const encoded = encodeURIComponent(platformOrderId)
  const res = await sbJson<{ id: string }>(`delivery_orders?platform=eq.rappi&platform_order_id=eq.${encoded}&select=id&limit=1`)
  return res.rows[0]?.id ?? null
}

async function resolveClientId(providerStoreId: string): Promise<string | null> {
  const encoded = encodeURIComponent(providerStoreId)
  const res = await sbJson<{ client_id: string }>(
    `integration_store_mappings?provider=eq.rappi&provider_store_id=eq.${encoded}&select=client_id&limit=1`
  )
  return res.rows[0]?.client_id ?? null
}

async function quarantineUnmappedStore(rawOrder: unknown, providerStoreId: string, source: ProcessSource, correlationId: string) {
  await sbJson('integration_webhook_dlq', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      provider: 'rappi',
      event_type: `order.${source}`,
      client_id: null,
      payload: rawOrder,
      failure_reason: `unmapped_store: provider_store_id="${providerStoreId}" has no integration_store_mappings row`,
    }),
  }).catch(() => ({ ok: false, status: 0, rows: [] }))
  await auditLog({
    provider: 'rappi',
    correlation_id: correlationId,
    action: 'order.dlq',
    request: { provider_store_id: providerStoreId, source },
    response: { reason: 'unmapped_store' },
    status_code: 422,
  })
}

function deliveryOrderId(platformOrderId: string): string {
  return `rappi-${platformOrderId}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120)
}

export async function processRappiOrder(rawOrder: unknown, source: ProcessSource, correlationId = crypto.randomUUID()): Promise<ProcessResult> {
  const platformOrderId = rappiProviderOrderId(rawOrder)
  if (!platformOrderId) return { action: 'dlq', reason: 'RAPPI_ORDER_ID_MISSING' }

  const existingId = await findExisting(platformOrderId)
  if (existingId) {
    await auditLog({
      provider: 'rappi',
      correlation_id: correlationId,
      action: 'order.dedup',
      request: { platform_order_id: platformOrderId, source },
      response: { id: existingId },
      status_code: 200,
    })
    return { action: 'dedup', orderId: existingId, platformOrderId }
  }

  const providerStoreId = rappiProviderStoreId(rawOrder, rappiStoreId())
  if (!providerStoreId) return { action: 'dlq', platformOrderId, reason: 'RAPPI_STORE_ID_MISSING' }

  const clientId = await resolveClientId(providerStoreId)
  if (!clientId) {
    await quarantineUnmappedStore(rawOrder, providerStoreId, source, correlationId)
    return { action: 'dlq', platformOrderId, reason: 'UNMAPPED_STORE' }
  }

  const order = normalizeRappiOrder(rawOrder, { clientId, correlationId, storeIdFallback: providerStoreId })
  const row = {
    id: deliveryOrderId(order.provider_order_id),
    client_id: clientId,
    platform: 'rappi',
    platform_order_id: order.provider_order_id,
    status: 'nueva',
    customer_name: order.customer_name,
    customer_phone: order.customer_phone ?? null,
    phone: order.customer_phone ?? null,
    address: order.delivery_address ?? null,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    total: order.total,
    payment_method: 'rappi',
    estimated_pickup: order.estimated_pickup_at ?? null,
    notes: order.notes ?? null,
    items: order.items.map(item => ({
      name: item.name,
      qty: item.quantity,
      price: item.unit_price,
      modifiers: item.modifiers,
      notes: item.notes,
      sku: item.sku,
    })),
    raw_payload: {
      ...((rawOrder && typeof rawOrder === 'object') ? rawOrder as Record<string, unknown> : { value: rawOrder }),
      fullsite: {
        source,
        provider_store_id: order.provider_store_id,
        correlation_id: correlationId,
      },
    },
  }

  const inserted = await sbJson<{ id: string }>('delivery_orders?on_conflict=platform,platform_order_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  })

  const insertedId = inserted.rows[0]?.id || await findExisting(order.provider_order_id)
  if (!insertedId) throw new Error(`RAPPI_ORDER_INSERT_FAILED_${inserted.status}`)

  await auditLog({
    provider: 'rappi',
    client_id: clientId,
    correlation_id: correlationId,
    action: inserted.rows[0] ? 'order.new' : 'order.dedup',
    request: { platform_order_id: order.provider_order_id, provider_store_id: order.provider_store_id, source },
    response: { id: insertedId },
    status_code: inserted.rows[0] ? 201 : 200,
  })

  return { action: inserted.rows[0] ? 'new' : 'dedup', orderId: insertedId, platformOrderId: order.provider_order_id }
}
