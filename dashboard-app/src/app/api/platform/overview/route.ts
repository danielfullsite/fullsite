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

type PosOrderRow = {
  client_id: string
  status?: string | null
  created_at?: string | null
  updated_at?: string | null
  comanda_batches?: Record<string, { status?: string | null }> | null
}

type PosTurnoRow = {
  client_id: string
  opened_at?: string | null
  closed_at?: string | null
}

type PrintJobRow = {
  client_id?: string | null
  status?: string | null
  type?: string | null
  created_at?: string | null
  printed_at?: string | null
  updated_at?: string | null
}

type BridgeLogRow = {
  client_id: string
  logged_at?: string | null
  created_at?: string | null
  status?: number | null
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

function newestDate(...values: Array<string | null | undefined>) {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value))
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function setNewest<T extends { [key: string]: unknown }>(target: T, key: keyof T, candidate: string | null | undefined) {
  if (!candidate) return
  const current = typeof target[key] === 'string' ? target[key] as string : null
  const newest = newestDate(current, candidate)
  if (newest) target[key] = newest as T[keyof T]
}

function makeOperations() {
  return {
    pos: {
      open_turnos: 0,
      recent_orders: 0,
      last_order_at: null as string | null,
      status: 'idle' as 'idle' | 'ready' | 'live',
    },
    kds: {
      active_orders: 0,
      pending_batches: 0,
      last_sent_at: null as string | null,
      status: 'idle' as 'idle' | 'live',
    },
    printing: {
      pending_jobs: 0,
      failed_jobs: 0,
      last_print_at: null as string | null,
      status: 'idle' as 'idle' | 'ok' | 'queued' | 'attention',
    },
    bridge: {
      events: 0,
      last_seen_at: null as string | null,
      status: 'unknown' as 'unknown' | 'seen' | 'stale' | 'online',
    },
  }
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

  const [clients, providers, mappings, events, orders, posOrders, turnos, printJobs] = await Promise.all([
    sbGet<ClientRow>('clients?select=id,display_name,city,active,data_source,mesas,type,created_at&order=created_at.desc&limit=200'),
    sbGet<IntegrationProviderRow>('integration_providers?select=client_id,provider,status,certification_state,provider_account_id,updated_at&provider=in.(ubereats,rappi,didi)&limit=500'),
    sbGet<IntegrationMappingRow>('integration_store_mappings?select=client_id,provider,provider_store_id,store_open,menu_sync_enabled,oos_sync_enabled,last_menu_sync&provider=in.(ubereats,rappi,didi)&limit=500'),
    sbGet<IntegrationEventRow>('integration_webhook_events?select=client_id,provider,status,created_at,last_error&provider=in.(ubereats,rappi,didi)&order=created_at.desc&limit=500'),
    sbGet<DeliveryOrderRow>('delivery_orders?select=client_id,platform,status,created_at&platform=in.(ubereats,rappi,didi)&order=created_at.desc&limit=500'),
    sbGet<PosOrderRow>('pos_orders?select=client_id,status,created_at,updated_at,comanda_batches&order=updated_at.desc&limit=1000'),
    sbGet<PosTurnoRow>('pos_turnos?select=client_id,opened_at,closed_at&order=opened_at.desc&limit=1000'),
    sbGet<PrintJobRow>('pos_print_jobs?select=client_id,status,type,created_at,printed_at,updated_at&order=created_at.desc&limit=1000'),
  ])

  const bridgeLogsByLoggedAt = await sbGet<BridgeLogRow>('pos_bridge_logs?select=client_id,logged_at,status&order=logged_at.desc&limit=1000')
  const bridgeLogs = bridgeLogsByLoggedAt.length > 0
    ? bridgeLogsByLoggedAt
    : await sbGet<BridgeLogRow>('pos_bridge_logs?select=client_id,created_at,status&order=created_at.desc&limit=1000')

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
    operations: makeOperations(),
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

  for (const order of posOrders) {
    const client = byClient.get(order.client_id)
    if (!client) continue
    client.operations.pos.recent_orders += 1
    setNewest(client.operations.pos, 'last_order_at', order.updated_at || order.created_at)

    if (['enviada', 'preparando', 'lista', 'entregada'].includes(order.status || '')) {
      client.operations.kds.active_orders += 1
      setNewest(client.operations.kds, 'last_sent_at', order.updated_at || order.created_at)
    }

    if (order.comanda_batches && typeof order.comanda_batches === 'object') {
      client.operations.kds.pending_batches += Object.values(order.comanda_batches)
        .filter(batch => batch?.status && !['cerrada', 'cancelada', 'entregada'].includes(batch.status))
        .length
    }
  }

  for (const turno of turnos) {
    const client = byClient.get(turno.client_id)
    if (!client) continue
    if (!turno.closed_at) client.operations.pos.open_turnos += 1
  }

  for (const job of printJobs) {
    if (!job.client_id) continue
    const client = byClient.get(job.client_id)
    if (!client) continue
    setNewest(client.operations.printing, 'last_print_at', job.printed_at || job.updated_at || job.created_at)
    if (['pending', 'retrying', 'bridge_unavailable'].includes(job.status || '')) {
      client.operations.printing.pending_jobs += 1
    }
    if (['failed', 'needs_attention'].includes(job.status || '')) {
      client.operations.printing.failed_jobs += 1
    }
  }

  for (const bridgeLog of bridgeLogs) {
    const client = byClient.get(bridgeLog.client_id)
    if (!client) continue
    client.operations.bridge.events += 1
    setNewest(client.operations.bridge, 'last_seen_at', bridgeLog.logged_at || bridgeLog.created_at)
  }

  for (const client of byClient.values()) {
    client.operations.pos.status = client.operations.pos.open_turnos > 0
      ? 'live'
      : client.operations.pos.recent_orders > 0
        ? 'ready'
        : 'idle'
    client.operations.kds.status = client.operations.kds.active_orders > 0 || client.operations.kds.pending_batches > 0 ? 'live' : 'idle'
    client.operations.printing.status = client.operations.printing.failed_jobs > 0
      ? 'attention'
      : client.operations.printing.pending_jobs > 0
        ? 'queued'
        : client.operations.printing.last_print_at
          ? 'ok'
          : 'idle'
    if (client.operations.bridge.last_seen_at) {
      const ageMs = Date.now() - new Date(client.operations.bridge.last_seen_at).getTime()
      client.operations.bridge.status = ageMs <= 30 * 60 * 1000 ? 'online' : ageMs <= 24 * 60 * 60 * 1000 ? 'seen' : 'stale'
    }

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
