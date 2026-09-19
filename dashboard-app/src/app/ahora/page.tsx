'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowUpRight, Bot, ChefHat, CircleDollarSign, Clock3, HeartPulse, ReceiptText, RefreshCw, Server, Sparkles, WifiOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getRecentDays } from '@/lib/data'
import { classifyFreshness, deriveSalesActions, stateLabel, type CanonicalMetric, type OperationalAction, type OperationalState } from '@/lib/operational-model'
import type { WansoftDaily } from '@/lib/types'

interface HealthPayload {
  status: 'healthy' | 'degraded' | 'down'
  timestamp: string
  checks: Array<{ name: string; status: 'ok' | 'error'; detail: string; ms: number }>
}

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 })

function metricValue(metric: CanonicalMetric) {
  if (metric.unit === 'mxn') return money.format(metric.value)
  if (metric.unit === 'percent') return `${metric.value.toFixed(1)}%`
  if (metric.unit === 'minutes') return `${metric.value.toFixed(0)} min`
  return number.format(metric.value)
}

function freshnessLabel(metric: CanonicalMetric) {
  if (!metric.observedAt) return 'Sin hora verificable'
  return `${metric.source} · ${metric.freshness === 'live' ? 'en vivo' : metric.freshness === 'recent' ? 'reciente' : metric.freshness === 'stale' ? 'desactualizado' : 'sin frescura'}`
}

function buildMetrics(rows: WansoftDaily[]): CanonicalMetric[] {
  const today = rows.at(-1)
  const previous = rows.at(-2)
  const observedAt = today?.updated_at || today?.fecha || null
  const source = 'POS canónico + histórico compatible'
  const freshness = classifyFreshness(observedAt)
  const sales = today?.ventas_dia || 0
  const previousSales = previous?.ventas_dia || 0
  const comparison = previousSales > 0 ? ((sales - previousSales) / previousSales) * 100 : 0
  const tickets = today?.tickets_count || 0

  return [
    { id: 'net_sales_today', label: 'Venta del día', value: sales, unit: 'mxn', source, observedAt, freshness, comparison: { value: comparison, label: 'vs. último día con datos' } },
    { id: 'orders_today', label: 'Órdenes cerradas', value: tickets, unit: 'count', source, observedAt, freshness },
    { id: 'average_ticket_today', label: 'Ticket promedio', value: today?.ticket_promedio_restaurant || (tickets ? sales / tickets : 0), unit: 'mxn', source, observedAt, freshness },
    { id: 'discounts_today', label: 'Descuentos', value: today?.descuentos || 0, unit: 'mxn', source, observedAt, freshness },
  ]
}

export default function AhoraPage() {
  const { clientConfig, locationId } = useAuth()
  const [rows, setRows] = useState<WansoftDaily[]>([])
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  async function refresh() {
    setLoading(true)
    const [daily, healthResponse] = await Promise.all([
      getRecentDays(8, undefined, locationId),
      fetch('/api/health', { cache: 'no-store' }).then(async response => ({ response, body: await response.json() })).catch(() => null),
    ])
    setRows(daily)
    if (healthResponse?.body) setHealth(healthResponse.body as HealthPayload)
    setRefreshedAt(new Date())
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    void Promise.all([
      getRecentDays(8, undefined, locationId),
      fetch('/api/health', { cache: 'no-store' }).then(async response => ({ response, body: await response.json() })).catch(() => null),
    ]).then(([daily, healthResponse]) => {
      if (!active) return
      setRows(daily)
      if (healthResponse?.body) setHealth(healthResponse.body as HealthPayload)
      setRefreshedAt(new Date())
      setLoading(false)
    })
    return () => { active = false }
  }, [locationId])

  const metrics = useMemo(() => buildMetrics(rows), [rows])
  const systemState: OperationalState = health?.status === 'healthy' ? 'operational' : health?.status === 'degraded' ? 'degraded' : health?.status === 'down' ? 'blocked' : 'unknown'
  const healthActions: OperationalAction[] = (health?.checks || []).filter(check => check.status === 'error').map(check => ({
    id: `health-${check.name}`,
    title: check.name === 'data_freshness' ? 'Datos desactualizados' : `Revisar ${check.name}`,
    detail: check.detail,
    priority: check.name === 'supabase' ? 'critical' : 'high',
    area: 'sistema',
    href: '/mission-control',
    owner: 'Administrador',
    source: '/api/health',
    observedAt: health?.timestamp || null,
  }))
  const actions = [...healthActions, ...deriveSalesActions(metrics)]

  function askCopilot(prompt: string) {
    window.dispatchEvent(new CustomEvent('fullsite:open-copilot', { detail: { prompt, context: 'Home Ahora' } }))
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-ink)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Turno en curso
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.035em] text-[var(--text-1)] sm:text-4xl">Ahora en {clientConfig?.display_name || 'tu restaurante'}</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-3)]">Una sola lectura de ventas, salud y excepciones. Cada dato declara de dónde viene.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text-2)] transition hover:border-[var(--accent-line)] hover:text-[var(--text-1)] disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </header>

      <section aria-label="Línea de turno" className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-mid)]">
        <div className="grid lg:grid-cols-[1.25fr_1fr_1fr]">
          <div className="relative overflow-hidden p-6 sm:p-8">
            <div className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]" />
            <div className="flex items-center gap-3">
              <span className={`grid h-12 w-12 place-items-center rounded-2xl ${systemState === 'operational' ? 'bg-[var(--ok-soft)] text-[var(--ok-ink)]' : systemState === 'degraded' ? 'bg-[var(--warn-soft)] text-[var(--warn-ink)]' : 'bg-[var(--crit-soft)] text-[var(--crit-ink)]'}`}><HeartPulse size={22} /></span>
              <div><p className="text-xs uppercase tracking-[0.16em] text-[var(--text-4)]">Estado del sistema</p><p className="mt-1 text-xl font-bold text-[var(--text-1)]">{stateLabel(systemState)}</p></div>
            </div>
            <p className="mt-5 text-sm leading-6 text-[var(--text-3)]">{health?.checks.find(check => check.name === 'supabase')?.detail || 'Esperando una lectura verificable de salud.'}</p>
          </div>
          <div className="border-t border-[var(--line-soft)] p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-[var(--text-3)]"><Clock3 size={16} /><span className="text-xs uppercase tracking-[0.15em]">Última lectura</span></div>
            <p className="mt-3 text-lg font-bold text-[var(--text-1)]">{refreshedAt ? refreshedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
            <p className="mt-1 text-xs text-[var(--text-4)]">Actualización manual y al abrir la vista</p>
          </div>
          <div className="border-t border-[var(--line-soft)] p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-[var(--text-3)]"><AlertTriangle size={16} /><span className="text-xs uppercase tracking-[0.15em]">Requiere atención</span></div>
            <p className="mt-3 text-lg font-bold text-[var(--text-1)]">{actions.length} {actions.length === 1 ? 'asunto' : 'asuntos'}</p>
            <p className="mt-1 text-xs text-[var(--text-4)]">Ordenados por impacto y urgencia</p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--text-3)]">Pulso del turno</h2><Link href="/ventas" className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">Ver análisis</Link></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric, index) => {
            const Icon = [CircleDollarSign, ReceiptText, Sparkles, WifiOff][index]
            return <article key={metric.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <div className="flex items-start justify-between"><p className="text-sm font-medium text-[var(--text-3)]">{metric.label}</p><Icon size={17} className="text-[var(--text-4)]" /></div>
              <p className="mt-4 text-2xl font-extrabold tracking-tight text-[var(--text-1)]">{loading ? '—' : metricValue(metric)}</p>
              {metric.comparison && <p className={`mt-2 text-xs font-semibold ${metric.comparison.value >= 0 ? 'text-[var(--ok-ink)]' : 'text-[var(--crit-ink)]'}`}>{metric.comparison.value >= 0 ? '+' : ''}{metric.comparison.value.toFixed(1)}% {metric.comparison.label}</p>}
              <p className="mt-3 truncate text-[10px] text-[var(--text-4)]" title={freshnessLabel(metric)}>{freshnessLabel(metric)}</p>
            </article>
          })}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <div className="rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-4)]">Cola de acción</p><h2 className="mt-1 text-xl font-bold text-[var(--text-1)]">Lo que merece atención</h2></div><ChefHat className="text-[var(--text-4)]" size={20} /></div>
          <div className="mt-5 space-y-2">
            {actions.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--line)] p-7 text-center"><p className="font-semibold text-[var(--text-2)]">No hay excepciones detectadas</p><p className="mt-1 text-sm text-[var(--text-4)]">Esto significa “sin alertas con la evidencia disponible”, no una garantía absoluta.</p></div> : actions.map(action => <Link key={action.id} href={action.href} className="group flex items-start gap-4 rounded-2xl border border-[var(--line-soft)] bg-[var(--surface-2)] p-4 transition hover:border-[var(--accent-line)]">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${action.priority === 'critical' ? 'bg-[var(--crit)]' : action.priority === 'high' ? 'bg-[var(--warn)]' : 'bg-[var(--info)]'}`} />
              <span className="min-w-0 flex-1"><span className="block font-semibold text-[var(--text-1)]">{action.title}</span><span className="mt-1 block text-sm leading-5 text-[var(--text-3)]">{action.detail}</span><span className="mt-2 block text-[10px] uppercase tracking-[0.12em] text-[var(--text-4)]">{action.owner} · {action.source}</span></span>
              <ArrowUpRight size={17} className="mt-1 shrink-0 text-[var(--text-4)] transition group-hover:text-[var(--accent-ink)]" />
            </Link>)}
          </div>
        </div>

        <aside className="relative overflow-hidden rounded-[22px] border border-[var(--accent-line)] bg-[linear-gradient(155deg,var(--surface),var(--accent-soft))] p-6">
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[var(--accent-soft)] blur-2xl" />
          <div className="relative"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent)] text-white"><Bot size={21} /></span><p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-ink)]">Copiloto Fullsite</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-1)]">Pregunta y actúa desde aquí.</h2><p className="mt-3 text-sm leading-6 text-[var(--text-3)]">El copiloto recibe el contexto de esta pantalla. Debe citar la fuente antes de recomendar cambios.</p>
            <div className="mt-6 space-y-2"><button onClick={() => askCopilot('Explícame qué requiere atención ahora, usando sólo datos verificables y diciendo la fuente y frescura.')} className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left text-sm font-semibold text-[var(--text-2)] transition hover:border-[var(--accent-line)] hover:text-[var(--text-1)]">¿Qué merece atención ahora?</button><button onClick={() => askCopilot('Compara la venta de hoy con el último periodo disponible y explícame los principales cambios.')} className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left text-sm font-semibold text-[var(--text-2)] transition hover:border-[var(--accent-line)] hover:text-[var(--text-1)]">Explícame la venta del día</button></div>
          </div>
        </aside>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[{ href: '/pos', label: 'Abrir POS', icon: ReceiptText }, { href: '/kds', label: 'Ver cocina', icon: ChefHat }, { href: '/mission-control', label: 'Salud y agentes', icon: Server }].map(item => <Link key={item.href} href={item.href} className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 font-semibold text-[var(--text-2)] transition hover:border-[var(--accent-line)] hover:text-[var(--text-1)]"><item.icon size={18} className="text-[var(--accent-ink)]" />{item.label}<ArrowUpRight size={15} className="ml-auto text-[var(--text-4)]" /></Link>)}
      </section>
    </div>
  )
}
