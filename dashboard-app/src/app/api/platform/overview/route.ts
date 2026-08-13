import { type NextRequest, NextResponse } from 'next/server'

type AuthUser = {
  id?: string
  email?: string
}

type ClientRow = {
  id: string
  display_name?: string | null
  name?: string | null
  city?: string | null
  active?: boolean | null
  data_source?: string | null
  mesas?: number | null
  type?: string | null
  created_at?: string | null
}

type IntegrationProviderRow = {
  client_id: string
  provider: string
  status?: string | null
  certification_state?: string | null
  provider_account_id?: string | null
  updated_at?: string | null
}

type IntegrationMappingRow = {
  client_id: string
  provider: string
  provider_store_id: string
  store_open?: boolean | null
  menu_sync_enabled?: boolean | null
  oos_sync_enabled?: boolean | null
  last_menu_sync?: string | null
}

type IntegrationEventRow = {
  client_id: string | null
  provider: string
  status: string
  created_at?: string | null
  last_error?: string | null
}

type DeliveryOrderRow = {
  client_id: string
  platform: string
  status: string
  created_at?: string | null
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''

const PROVIDERS = ['ubereats', 'rappi', 'didi'] as const

function bearerToken(request: NextRequest) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.cookies.get('fs-at')?.value || ''
}

function platformAdminEmails() {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

async function getUser(request: NextRequest): Promise<AuthUser | null> {
  const token = bearerToken(request)
  if (!token || !SB_URL || !SB_ANON) return null
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null)
  if (!res?.ok) return null
  return await res.json().catch(() => null) as AuthUser | null
}

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
  const data = await res.json().catch(() => [])
  return Array.isArray(data) ? data as T[] : []
}

export async function GET(request: NextRequest) {
  const admins = platformAdminEmails()
  if (admins.size === 0) {
    return NextResponse.json({ ok: false, error: 'PLATFORM_ADMIN_NOT_CONFIGURED' }, { status: 503 })
  }

  const user = await getUser(request)
  if (!user?.email) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  if (!admins.has(user.email.toLowerCase())) {
    return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 })
  }

  // Service role is used only after exact platform-admin authorization.
  if (!SB_URL || !SB_SERVICE_KEY) {
    return NextResponse.json({ ok: false, error: 'SERVER_CONFIG_ERROR' }, { status: 503 })
  }

  const [clients, providers, mappings, events, orders] = await Promise.all([
    sbGet<ClientRow>('clients?select=id,display_name,city,active,data_source,mesas,type,created_at&order=created_at.desc&limit=200'),
    sbGet<IntegrationProviderRow>('integration_providers?select=client_id,provider,status,certification_state,provider_account_id,updated_at&provider=in.(ubereats,rappi,didi)&limit=500'),
    sbGet<IntegrationMappingRow>('integration_store_mappings?select=client_id,provider,provider_store_id,store_open,menu_sync_enabled,oos_sync_enabled,last_menu_sync&provider=in.(ubereats,rappi,didi)&limit=500'),
    sbGet<IntegrationEventRow>('integration_webhook_events?select=client_id,provider,status,created_at,last_error&provider=in.(ubereats,rappi,didi)&order=created_at.desc&limit=500'),
    sbGet<DeliveryOrderRow>('delivery_orders?select=client_id,platform,status,created_at&platform=in.(ubereats,rappi,didi)&order=created_at.desc&limit=500'),
  ])

  const clientIds = new Set(clients.map(c => c.id))
  const byClient = new Map(clients.map(client => [client.id, {
    ...client,
    display_name: client.display_name || client.name || client.id,
    integrations: PROVIDERS.map(provider => ({
      provider,
      label: provider === 'ubereats' ? 'Uber Eats' : provider === 'rappi' ? 'Rappi' : 'DiDi',
      status: 'not_connected',
      certification_state: 'uncertified',
      provider_account_id: null as string | null,
      store_ids: [] as string[],
      store_open: null as boolean | null,
      menu_sync_enabled: null as boolean | null,
      recent_webhook_count: 0,
      recent_order_count: 0,
      last_webhook_at: null as string | null,
      last_order_at: null as string | null,
      last_error: null as string | null,
      blockers: [] as string[],
    })),
  }]))

  for (const provider of providers) {
    const client = byClient.get(provider.client_id)
    if (!client) continue
    const integration = client.integrations.find(i => i.provider === provider.provider)
    if (!integration) continue
    integration.status = provider.status || 'configured'
    integration.certification_state = provider.certification_state || 'uncertified'
    integration.provider_account_id = provider.provider_account_id || null
  }

  for (const mapping of mappings) {
    const client = byClient.get(mapping.client_id)
    if (!client) continue
    const integration = client.integrations.find(i => i.provider === mapping.provider)
    if (!integration) continue
    integration.store_ids.push(mapping.provider_store_id)
    integration.store_open = mapping.store_open ?? integration.store_open
    integration.menu_sync_enabled = mapping.menu_sync_enabled ?? integration.menu_sync_enabled
    if (integration.status === 'not_connected') integration.status = 'mapped'
  }

  for (const event of events) {
    if (!event.client_id) continue
    const client = byClient.get(event.client_id)
    if (!client) continue
    const integration = client.integrations.find(i => i.provider === event.provider)
    if (!integration) continue
    integration.recent_webhook_count += 1
    integration.last_webhook_at ||= event.created_at || null
    if ((event.status === 'failed' || event.status === 'dlq') && !integration.last_error) {
      integration.last_error = event.last_error || event.status
    }
  }

  for (const order of orders) {
    const client = byClient.get(order.client_id)
    if (!client) continue
    const integration = client.integrations.find(i => i.provider === order.platform)
    if (!integration) continue
    integration.recent_order_count += 1
    integration.last_order_at ||= order.created_at || null
  }

  for (const client of byClient.values()) {
    for (const integration of client.integrations) {
      integration.blockers = [
        ...(integration.provider_account_id ? [] : ['Credenciales / provider account pendiente']),
        ...(integration.store_ids.length ? [] : ['Store ID → tenant mapping pendiente']),
        ...(integration.recent_webhook_count ? [] : ['Webhook / orden de prueba pendiente']),
        ...(integration.provider === 'rappi' ? ['Firma Rappi-Signature pendiente de confirmación oficial'] : []),
        ...(integration.provider === 'didi' ? ['Conector DiDi pendiente'] : []),
      ]
      if (integration.blockers.length === 0 && integration.status !== 'active') {
        integration.status = 'ready_for_cert'
      }
    }
  }

  const summary = {
    clients: clients.length,
    active_clients: clients.filter(c => c.active !== false).length,
    integration_slots: clients.length * PROVIDERS.length,
    configured_integrations: Array.from(byClient.values()).flatMap(c => c.integrations).filter(i => i.status !== 'not_connected').length,
    recent_delivery_orders: orders.length,
    unmapped_events_hidden: events.filter(e => !e.client_id).length,
  }

  return NextResponse.json({
    ok: true,
    environment: {
      supabase_ref: new URL(SB_URL).hostname.split('.')[0],
      service_role_used: true,
      service_role_scope: 'server-only after PLATFORM_ADMIN_EMAILS authorization',
    },
    user: { email: user.email },
    summary,
    clients: Array.from(byClient.values()).filter(client => clientIds.has(client.id)),
  })
}
