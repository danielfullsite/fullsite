import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

type DeliveryOrderRow = {
  id: string
  client_id?: string
  platform: string
  platform_order_id: string | null
  status: string
  customer_name: string | null
  address?: string | null
  phone?: string | null
  total: number | null
  created_at: string | null
  estimated_pickup: string | null
  en_route_at?: string | null
  delivered_at?: string | null
  closed_at?: string | null
  payment_method?: string | null
  items: unknown
}

type PlatformPaymentRow = {
  id: string
  platform: string
  lot_id: string | null
  period_start: string | null
  period_end: string | null
  paid_date: string | null
  total: number | null
  status: string | null
}

type ProviderRow = {
  provider: string
  status: string
  certification_state: string
  provider_account_id: string | null
  updated_at: string | null
}

type StoreMappingRow = {
  provider: string
  provider_store_id: string
  store_open: boolean | null
  menu_sync_enabled: boolean | null
  oos_sync_enabled: boolean | null
  last_menu_sync: string | null
}

type WebhookEventRow = {
  provider: string
  event_type: string
  status: string
  created_at: string | null
  last_error: string | null
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

function serviceHeaders() {
  return {
    apikey: SB_SERVICE_KEY,
    Authorization: `Bearer ${SB_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function sbGet<T>(path: string): Promise<T[]> {
  if (!SB_URL || !SB_SERVICE_KEY) return []
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: serviceHeaders(),
    cache: 'no-store',
  }).catch(() => null)
  if (!res?.ok) return []
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows as T[] : []
}

async function sbPatch<T>(path: string, body: Record<string, unknown>): Promise<T[]> {
  if (!SB_URL || !SB_SERVICE_KEY) return []
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => null)
  if (!res?.ok) return []
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) ? rows as T[] : []
}

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()

  // This endpoint intentionally uses service-role after withPOSAuth because
  // integration tables are server-mediated. Tenant scope is explicit below.
  if (!SB_URL || !SB_SERVICE_KEY) {
    return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 503 })
  }

  const clientId = auth.clientId
  const encodedClient = encodeURIComponent(clientId)

  const [orders, payments, providers, mappings, webhookEvents] = await Promise.all([
    sbGet<DeliveryOrderRow>(
      `delivery_orders?client_id=eq.${encodedClient}&select=id,client_id,platform,platform_order_id,status,customer_name,address,phone,total,payment_method,created_at,estimated_pickup,en_route_at,delivered_at,closed_at,items&order=created_at.desc&limit=50`
    ),
    sbGet<PlatformPaymentRow>(
      `delivery_platform_payments?client_id=eq.${encodedClient}&select=id,platform,lot_id,period_start,period_end,paid_date,total,status&order=period_start.desc&limit=20`
    ),
    sbGet<ProviderRow>(
      `integration_providers?client_id=eq.${encodedClient}&select=provider,status,certification_state,provider_account_id,updated_at&provider=in.(ubereats,rappi)&order=provider.asc`
    ),
    sbGet<StoreMappingRow>(
      `integration_store_mappings?client_id=eq.${encodedClient}&select=provider,provider_store_id,store_open,menu_sync_enabled,oos_sync_enabled,last_menu_sync&provider=in.(ubereats,rappi)&order=provider.asc`
    ),
    sbGet<WebhookEventRow>(
      `integration_webhook_events?client_id=eq.${encodedClient}&select=provider,event_type,status,created_at,last_error&provider=in.(ubereats,rappi)&order=created_at.desc&limit=20`
    ),
  ])

  const providersByName = new Map(providers.map(p => [p.provider, p]))
  const mappingsByProvider = mappings.reduce<Record<string, StoreMappingRow[]>>((acc, row) => {
    if (!acc[row.provider]) acc[row.provider] = []
    acc[row.provider].push(row)
    return acc
  }, {})
  const eventsByProvider = webhookEvents.reduce<Record<string, WebhookEventRow[]>>((acc, row) => {
    if (!acc[row.provider]) acc[row.provider] = []
    acc[row.provider].push(row)
    return acc
  }, {})

  const readiness = (['ubereats', 'rappi'] as const).map(provider => {
    const providerRow = providersByName.get(provider)
    const providerMappings = mappingsByProvider[provider] ?? []
    const recentEvents = eventsByProvider[provider] ?? []
    const hasMapping = providerMappings.length > 0
    const hasProvider = Boolean(providerRow)
    const isActive = providerRow?.status === 'active'
    const hasWebhookTraffic = recentEvents.length > 0

    return {
      provider,
      label: provider === 'ubereats' ? 'Uber Eats' : 'Rappi',
      status: isActive ? 'active' : hasProvider || hasMapping ? 'configured' : 'waiting_external',
      certification_state: providerRow?.certification_state ?? 'uncertified',
      provider_account_id: providerRow?.provider_account_id ?? null,
      mappings: providerMappings,
      recent_webhook_count: recentEvents.length,
      last_webhook_at: recentEvents[0]?.created_at ?? null,
      last_error: recentEvents.find(e => e.status === 'failed' || e.status === 'dlq')?.last_error ?? null,
      blockers: [
        ...(!hasProvider ? ['Credenciales OAuth / provider account pendiente'] : []),
        ...(!hasMapping ? ['Mapping store → tenant pendiente'] : []),
        ...(!hasWebhookTraffic ? ['Orden/webhook de prueba pendiente'] : []),
        ...(provider === 'rappi' ? ['Confirmación oficial de Rappi-Signature pendiente'] : []),
      ],
    }
  })

  return Response.json({
    ok: true,
    client_id: clientId,
    readiness,
    orders,
    payments,
    webhook_events: webhookEvents,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()

  if (!SB_URL || !SB_SERVICE_KEY) {
    return Response.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({})) as {
    id?: string
    status?: 'preparando' | 'lista' | 'cancelada'
    reason?: string
  }

  if (!body.id || !body.status || !['preparando', 'lista', 'cancelada'].includes(body.status)) {
    return Response.json({ ok: false, error: 'INVALID_DELIVERY_UPDATE' }, { status: 400 })
  }

  const encodedClient = encodeURIComponent(auth.clientId)
  const encodedId = encodeURIComponent(body.id)
  const now = new Date().toISOString()

  const rows = await sbPatch<DeliveryOrderRow>(
    `delivery_orders?id=eq.${encodedId}&client_id=eq.${encodedClient}`,
    { status: body.status, updated_at: now }
  )

  const order = rows[0]
  if (!order) {
    return Response.json({ ok: false, error: 'DELIVERY_ORDER_NOT_FOUND' }, { status: 404 })
  }

  // Platform-side notification happens only after the order row is proven to
  // belong to the authenticated tenant. Failures are returned as non-fatal so
  // kitchen state remains usable even if Uber/Rappi is temporarily unavailable.
  let platform_sync: { attempted: boolean; ok?: boolean; error?: unknown } = { attempted: false }
  if (order.platform === 'ubereats' && order.platform_order_id && (body.status === 'lista' || body.status === 'cancelada')) {
    const action = body.status === 'lista' ? 'ready' : 'cancel'
    const res = await fetch(new URL('/api/integrations/uber-eats/order', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.platform_order_id,
        action,
        ...(action === 'cancel' ? { reason: body.reason || 'OUT_OF_ITEM' } : {}),
      }),
    }).catch((error: unknown) => ({ ok: false, json: async () => ({ error: String(error) }) }))
    const payload = await res.json().catch(() => ({}))
    platform_sync = { attempted: true, ok: res.ok, error: res.ok ? undefined : payload }
  }

  return Response.json({ ok: true, order, platform_sync })
}
