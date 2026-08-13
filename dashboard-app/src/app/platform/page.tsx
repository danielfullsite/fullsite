'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Store,
  UtensilsCrossed,
  Users,
  Zap,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { createClient } from '@/lib/supabase-browser'

type ProviderKey = 'ubereats' | 'rappi' | 'didi'

interface PlatformIntegration {
  provider: ProviderKey
  label: string
  status: string
  certification_state: string
  provider_account_id: string | null
  store_ids: string[]
  store_open: boolean | null
  menu_sync_enabled: boolean | null
  recent_webhook_count: number
  recent_order_count: number
  last_webhook_at: string | null
  last_order_at: string | null
  last_error: string | null
  blockers: string[]
}

interface PlatformClient {
  id: string
  display_name: string
  city: string | null
  active: boolean | null
  data_source: string | null
  mesas: number | null
  type: string | null
  created_at: string | null
  integrations: PlatformIntegration[]
}

interface PlatformOverview {
  ok: boolean
  error?: string
  environment?: {
    supabase_ref: string
    service_role_used: boolean
    service_role_scope: string
  }
  summary?: {
    clients: number
    active_clients: number
    integration_slots: number
    configured_integrations: number
    recent_delivery_orders: number
    unmapped_events_hidden: number
  }
  clients?: PlatformClient[]
}

function providerStyle(provider: ProviderKey) {
  if (provider === 'ubereats') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
  if (provider === 'rappi') return 'border-orange-500/25 bg-orange-500/10 text-orange-300'
  return 'border-sky-500/25 bg-sky-500/10 text-sky-300'
}

function statusCopy(status: string) {
  const map: Record<string, string> = {
    active: 'Activo',
    ready_for_cert: 'Listo para certificar',
    configured: 'Configurado',
    mapped: 'Mapeado',
    not_connected: 'No conectado',
    waiting_external: 'Esperando externo',
  }
  return map[status] || status.replaceAll('_', ' ')
}

function statusTone(status: string) {
  if (status === 'active') return 'text-emerald-400'
  if (status === 'ready_for_cert' || status === 'configured' || status === 'mapped') return 'text-amber-300'
  return 'text-white/45'
}

function shortDate(value: string | null) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

export default function PlatformPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  async function load() {
    setRefreshing(true)
    try {
      const { data: { session } } = await createClient().auth.getSession()
      const res = await fetch('/api/platform/overview', {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        cache: 'no-store',
      })
      const payload = await res.json().catch(() => ({ ok: false, error: `HTTP_${res.status}` })) as PlatformOverview
      setOverview({ ...payload, ok: res.ok && payload.ok })
    } catch {
      setOverview({ ok: false, error: 'NETWORK_ERROR' })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const clients = useMemo(() => {
    const source = overview?.clients ?? []
    const q = query.trim().toLowerCase()
    if (!q) return source
    return source.filter(client =>
      client.id.toLowerCase().includes(q) ||
      client.display_name.toLowerCase().includes(q) ||
      (client.city || '').toLowerCase().includes(q)
    )
  }, [overview?.clients, query])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!overview?.ok) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Control Center" subtitle="God Mode global de Fullsite · clientes e integraciones" eyebrow="GOD MODE" />
        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="text-amber-300 shrink-0" size={24} />
            <div>
              <h2 className="text-lg font-black text-[var(--text-1)]">Control Center no disponible</h2>
              <p className="text-sm text-[var(--text-2)] mt-2">
                {overview?.error || 'UNKNOWN_ERROR'}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-3">
                Esta pantalla falla cerrada. Requiere sesión válida, email incluido en PLATFORM_ADMIN_EMAILS y service role configurado solo server-side.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const summary = overview.summary!

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <PageHeader
          title="Control Center"
          subtitle="God Mode global: clientes, módulos e integraciones marketplace — lectura segura server-side"
          eyebrow="GOD MODE · FULLSITE PLATFORM"
        />
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
        <MetricCard icon={Users} label="Clientes" value={String(summary.clients)} sub={`${summary.active_clients} activos`} />
        <MetricCard icon={PlugZap} label="Slots integración" value={String(summary.integration_slots)} sub="Uber · Rappi · DiDi por tenant" />
        <MetricCard icon={CheckCircle2} label="Configuradas" value={String(summary.configured_integrations)} sub="con mapping o provider" />
        <MetricCard icon={UtensilsCrossed} label="Órdenes recientes" value={String(summary.recent_delivery_orders)} sub="marketplaces" />
        <MetricCard icon={ShieldCheck} label="Entorno" value={overview.environment?.supabase_ref || '—'} sub="server-mediated" mono />
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[var(--line-soft)] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-[var(--text-1)]">Restaurantes</h2>
            <p className="text-xs text-[var(--text-3)] mt-1">
              Crear un cliente no lo conecta automáticamente: lo deja listo para asignarle Store ID, credenciales y prueba oficial por plataforma.
            </p>
          </div>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar tenant..."
            className="w-full md:w-72 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none focus:border-emerald-500"
          />
        </div>

        <div className="divide-y divide-[var(--line-soft)]">
          {clients.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-3)]">No hay clientes que coincidan.</div>
          ) : (
            clients.map(client => (
              <section key={client.id} className="p-5">
                <div className="flex flex-col xl:flex-row xl:items-start gap-4">
                  <div className="xl:w-72 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <Store size={18} className="text-emerald-300" />
                      </div>
                      <div>
                        <h3 className="font-black text-[var(--text-1)]">{client.display_name}</h3>
                        <p className="text-xs font-mono text-[var(--text-3)]">{client.id}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className={`text-[11px] px-2 py-1 rounded-full border ${client.active === false ? 'border-red-500/20 text-red-300 bg-red-500/10' : 'border-emerald-500/20 text-emerald-300 bg-emerald-500/10'}`}>
                        {client.active === false ? 'Inactivo' : 'Activo'}
                      </span>
                      <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 text-white/45 bg-white/5">
                        {client.city || 'Sin ciudad'}
                      </span>
                      <span className="text-[11px] px-2 py-1 rounded-full border border-white/10 text-white/45 bg-white/5">
                        {client.mesas ?? '—'} mesas
                      </span>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-3 gap-3 flex-1">
                    {client.integrations.map(integration => (
                      <IntegrationCard key={`${client.id}-${integration.provider}`} integration={integration} />
                    ))}
                  </div>
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  mono = false,
}: {
  icon: typeof Users
  label: string
  value: string
  sub: string
  mono?: boolean
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[var(--text-3)] mb-3">
        <Icon size={15} />
        <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className={`text-2xl font-black text-[var(--text-1)] ${mono ? 'font-mono text-lg' : ''}`}>{value}</p>
      <p className="text-xs text-[var(--text-3)] mt-1">{sub}</p>
    </div>
  )
}

function IntegrationCard({ integration }: { integration: PlatformIntegration }) {
  const hasBlockers = integration.blockers.length > 0
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/50 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-black ${providerStyle(integration.provider)}`}>
          <Zap size={12} />
          {integration.label}
        </span>
        {hasBlockers ? (
          <AlertTriangle size={18} className="text-amber-300" />
        ) : (
          <CheckCircle2 size={18} className="text-emerald-300" />
        )}
      </div>

      <p className={`text-sm font-black ${statusTone(integration.status)}`}>{statusCopy(integration.status)}</p>
      <p className="text-[11px] text-[var(--text-3)] mt-1">
        Cert: {integration.certification_state} · Store: {integration.store_ids.length ? integration.store_ids.join(', ') : '—'}
      </p>

      <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
        <div className="rounded-lg bg-black/10 border border-white/5 px-2 py-2">
          <p className="text-[var(--text-3)]">Webhooks</p>
          <p className="font-bold text-[var(--text-1)]">{integration.recent_webhook_count}</p>
        </div>
        <div className="rounded-lg bg-black/10 border border-white/5 px-2 py-2">
          <p className="text-[var(--text-3)]">Órdenes</p>
          <p className="font-bold text-[var(--text-1)]">{integration.recent_order_count}</p>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-[var(--text-3)] space-y-1">
        <p>Último webhook: {shortDate(integration.last_webhook_at)}</p>
        <p>Última orden: {shortDate(integration.last_order_at)}</p>
      </div>

      {integration.last_error && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-2 text-[11px] text-red-300">
          {integration.last_error}
        </p>
      )}

      {hasBlockers && (
        <ul className="mt-3 space-y-1">
          {integration.blockers.slice(0, 3).map(blocker => (
            <li key={blocker} className="text-[11px] text-amber-200/80 flex gap-1.5">
              <span>•</span>
              <span>{blocker}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
