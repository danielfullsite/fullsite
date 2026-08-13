'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChefHat,
  DatabaseZap,
  LockKeyhole,
  Monitor,
  Plus,
  PlugZap,
  Power,
  Printer,
  RefreshCw,
  Store,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { createClient } from '@/lib/supabase-browser'

type ProviderKey = 'ubereats' | 'rappi' | 'didi'

interface PlatformIntegration {
  provider: ProviderKey
  label: string
  status: string
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
  operations?: {
    pos: {
      open_turnos: number
      recent_orders: number
      last_order_at: string | null
      status: 'idle' | 'ready' | 'live'
    }
    kds: {
      active_orders: number
      pending_batches: number
      last_sent_at: string | null
      status: 'idle' | 'live'
    }
    printing: {
      pending_jobs: number
      failed_jobs: number
      last_print_at: string | null
      status: 'idle' | 'ok' | 'queued' | 'attention'
    }
    bridge: {
      events: number
      last_seen_at: string | null
      status: 'unknown' | 'seen' | 'stale' | 'online'
    }
  }
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

function latestSignal(client: PlatformClient): string | null {
  const dates = client.integrations
    .flatMap(integration => [integration.last_order_at, integration.last_webhook_at])
    .filter((value): value is string => Boolean(value))
    .map(value => new Date(value).getTime())
    .filter(value => Number.isFinite(value))

  if (dates.length === 0) return null
  const newest = Math.max(...dates)
  const hours = Math.max(0, Math.round((Date.now() - newest) / 36e5))
  if (hours < 1) return 'ahora'
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function tenantHasData(client: PlatformClient) {
  return Boolean(
    client.data_source ||
    client.integrations.some(integration => integration.recent_order_count > 0 || integration.recent_webhook_count > 0)
  )
}

function tenantOpenDetections(client: PlatformClient) {
  return client.integrations.filter(integration => integration.last_error).length
}

function statusDot(client: PlatformClient) {
  if (client.active === false) return 'bg-white/30'
  if (tenantOpenDetections(client) > 0) return 'bg-amber-400'
  if (tenantHasData(client)) return 'bg-rose-400'
  return 'bg-slate-500'
}

function integrationTone(integration: PlatformIntegration) {
  if (integration.status === 'active') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
  if (integration.status === 'ready_for_cert' || integration.status === 'configured' || integration.status === 'mapped') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-300'
  }
  if (integration.last_error) return 'border-red-500/25 bg-red-500/10 text-red-300'
  return 'border-white/10 bg-white/[0.03] text-[var(--text-3)]'
}

function opTone(status: string) {
  if (status === 'live' || status === 'online') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
  if (status === 'ready' || status === 'seen' || status === 'queued' || status === 'ok') return 'border-sky-500/25 bg-sky-500/10 text-sky-300'
  if (status === 'attention' || status === 'stale') return 'border-amber-500/25 bg-amber-500/10 text-amber-300'
  return 'border-white/10 bg-white/[0.03] text-[var(--text-3)]'
}

function shortStatus(status: string) {
  return status.replaceAll('_', ' ')
}

export default function PlatformTenantsPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

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

  const clients = useMemo(() => overview?.clients ?? [], [overview?.clients])
  const metrics = useMemo(() => {
    const withData = clients.filter(tenantHasData).length
    const detections = clients.reduce((sum, client) => sum + tenantOpenDetections(client), 0)
    return {
      tenants: clients.length,
      withData,
      detections,
      activeAgents: 'activos',
    }
  }, [clients])

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
        <PageHeader title="Tenants" subtitle="Todos los clientes de Fullsite · lectura segura" eyebrow="PLATAFORMA" />
        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="text-amber-300 shrink-0" size={24} />
            <div>
              <h2 className="text-lg font-black text-[var(--text-1)]">Tenants no disponible</h2>
              <p className="text-sm text-[var(--text-2)] mt-2">{overview?.error || 'UNKNOWN_ERROR'}</p>
              <p className="text-xs text-[var(--text-3)] mt-3">
                Falla cerrada: requiere sesión válida, email en PLATFORM_ADMIN_EMAILS y service role únicamente server-side.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <PageHeader title="Tenants" subtitle="Todos los clientes de Fullsite · un solo cerebro" eyebrow="PLATAFORMA" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] disabled:opacity-60"
            aria-label="Actualizar tenants"
          >
            <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            disabled
            title="Pendiente: provisioning server-side auditado. No se habilita desde browser."
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500/80 px-4 py-2.5 text-sm font-black text-black opacity-60 cursor-not-allowed"
          >
            <Plus size={17} />
            Nuevo cliente
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <TenantMetric icon={Store} label="Tenants" value={String(metrics.tenants)} />
        <TenantMetric icon={DatabaseZap} label="Con datos" value={String(metrics.withData)} />
        <TenantMetric icon={AlertTriangle} label="Detecciones abiertas" value={String(metrics.detections)} tone={metrics.detections ? 'amber' : 'default'} />
        <TenantMetric icon={Bot} label="Agentes" value={metrics.activeAgents} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line-soft)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Store size={18} className="text-emerald-300" />
            <h2 className="font-black text-[var(--text-1)]">Clientes</h2>
          </div>
          <p className="hidden md:block text-xs font-mono text-[var(--text-3)]">
            {clients.length} tenants · misma app, mismo core
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead>
              <tr className="border-b border-[var(--line-soft)] text-[11px] uppercase tracking-[0.18em] text-[var(--text-3)]">
                <th className="px-5 py-3 font-black">Cliente</th>
                <th className="px-5 py-3 font-black">ID</th>
                <th className="px-5 py-3 font-black">Últimos datos</th>
                <th className="px-5 py-3 font-black">Detecciones</th>
                <th className="px-5 py-3 font-black">Integraciones</th>
                <th className="px-5 py-3 font-black">Operación</th>
                <th className="px-5 py-3 font-black text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {clients.map(client => {
                const detections = tenantOpenDetections(client)
                const signal = latestSignal(client) || (tenantHasData(client) ? 'configurado' : 'sin datos aún')
                return (
                  <tr key={client.id} className="group hover:bg-emerald-500/[0.035] transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(client)}`} />
                        <div>
                          <p className="font-black text-[var(--text-1)]">{client.display_name}</p>
                          <p className="text-xs text-[var(--text-3)] md:hidden">{client.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-[var(--text-2)]">{client.id}</td>
                    <td className="px-5 py-4 text-sm text-[var(--text-2)]">{signal}</td>
                    <td className="px-5 py-4 text-sm text-[var(--text-2)]">{detections ? detections : '—'}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {client.integrations.map(integration => (
                          <span
                            key={integration.provider}
                            title={`${integration.label}: ${shortStatus(integration.status)}`}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${integrationTone(integration)}`}
                          >
                            <PlugZap size={11} />
                            {integration.provider === 'ubereats' ? 'Uber' : integration.provider === 'rappi' ? 'Rappi' : 'DiDi'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <OperationChip icon={Monitor} label="POS" value={client.operations?.pos.status || 'idle'} />
                        <OperationChip icon={ChefHat} label="KDS" value={client.operations?.kds.status || 'idle'} />
                        <OperationChip icon={Printer} label="Print" value={client.operations?.printing.status || 'idle'} />
                        <OperationChip icon={DatabaseZap} label="Bridge" value={client.operations?.bridge.status || 'unknown'} />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          disabled
                          title="Pendiente: desactivación server-side auditada."
                          className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-3)] opacity-55 cursor-not-allowed"
                        >
                          <Power size={15} />
                          Desactivar
                        </button>
                        <button
                          disabled
                          title="Pendiente: impersonation auditada. No se habilita cambiando tenant en browser."
                          className="inline-flex items-center gap-1.5 text-sm font-black text-emerald-300 opacity-55 cursor-not-allowed"
                        >
                          Entrar
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-[var(--line-soft)] px-5 py-4 text-xs text-[var(--text-3)]">
          <div className="flex items-start gap-2">
            <LockKeyhole size={14} className="mt-0.5 text-emerald-300" />
            <p>
              “Nuevo cliente”, “Desactivar” y “Entrar” quedan bloqueados hasta existir acciones server-side auditadas.
              Esta pantalla no selecciona tenants desde el navegador.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function TenantMetric({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Store
  label: string
  value: string
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className={`mb-4 flex items-center gap-2 ${tone === 'amber' ? 'text-amber-300' : 'text-emerald-300'}`}>
        <Icon size={16} />
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--text-3)]">{label}</span>
      </div>
      <p className="text-3xl font-black tracking-tight text-[var(--text-1)]">{value}</p>
    </div>
  )
}

function OperationChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Store
  label: string
  value: string
}) {
  return (
    <span
      title={`${label}: ${shortStatus(value)}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${opTone(value)}`}
    >
      <Icon size={11} />
      {label}
    </span>
  )
}
