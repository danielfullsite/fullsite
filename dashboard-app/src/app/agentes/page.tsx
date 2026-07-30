'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Activity, Package, Shield, Users, TrendingUp, RefreshCw,
  ChevronRight, CheckCircle, AlertTriangle, AlertCircle, Info,
  Play, ThumbsUp, ThumbsDown, DollarSign,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import type { AgentId, AgentEvent, AgentMetrics, Severity, Outcome } from '@/lib/agents/types'
import { AGENT_META } from '@/lib/agents/types'

/* ── Helpers ──────────────────────────────────────────────────────── */

function getClientId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (
      localStorage.getItem('fullsite_client_id') ||
      process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID ||
      ''
    )
  } catch { return '' }
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `hace ${h}h` : `hace ${Math.floor(h / 24)}d`
}

function fmtMXN(n: number): string {
  return `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`
}

const SEV: Record<Severity, { border: string; bg: string; text: string; icon: React.ElementType; label: string }> = {
  critical: { border: 'border-l-red-500',   bg: 'bg-red-500/8',   text: 'text-red-500',   icon: AlertCircle,  label: 'Crítico' },
  warning:  { border: 'border-l-amber-500', bg: 'bg-amber-500/8', text: 'text-amber-500', icon: AlertTriangle, label: 'Alerta' },
  info:     { border: 'border-l-blue-500',  bg: 'bg-blue-500/8',  text: 'text-blue-500',  icon: Info,          label: 'Info' },
}

const AGENT_ICONS: Record<AgentId, React.ElementType> = {
  operations: Activity, inventory: Package, fraud: Shield, staff: Users, finance: TrendingUp,
}

const AGENT_COLORS: Record<AgentId, string> = {
  operations: 'bg-blue-500/15 text-blue-400',
  inventory:  'bg-amber-500/15 text-amber-400',
  fraud:      'bg-red-500/15 text-red-400',
  staff:      'bg-violet-500/15 text-violet-400',
  finance:    'bg-emerald-500/15 text-emerald-400',
}

/* ── Event Card ───────────────────────────────────────────────────── */

function EventCard({ event, onOutcome }: {
  event: AgentEvent
  onOutcome: (id: string, outcome: Outcome | 'ack') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const sev = SEV[event.severity]
  const SevIcon = sev.icon
  const AgentIcon = AGENT_ICONS[event.agent_id]

  async function submitOutcome(outcome: Outcome | 'ack') {
    if (!event.id) return
    setPending(outcome)
    try {
      if (outcome === 'ack') {
        await fetch(`/api/agents/ack/${event.id}`, { method: 'POST' })
      } else {
        await fetch(`/api/agents/outcome/${event.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outcome }),
        })
      }
      onOutcome(event.id, outcome)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={`rounded-xl border-l-4 ${sev.border} border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden`}>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex-shrink-0 ${sev.text}`}><SevIcon size={17} /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${AGENT_COLORS[event.agent_id]}`}>
                <AgentIcon size={10} />
                {AGENT_META[event.agent_id].label}
              </span>
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${sev.text}`}>
                {sev.label}
              </span>
              {event.estimated_value != null && event.estimated_value > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500 ml-auto">
                  <DollarSign size={11} />
                  {fmtMXN(event.estimated_value)} en juego
                </span>
              )}
              {(!event.estimated_value || event.estimated_value === 0) && (
                <span className="text-[11px] text-[var(--text-3)] ml-auto">{timeSince(event.created_at ?? '')}</span>
              )}
            </div>
            <p className="text-[14px] font-semibold text-[var(--text-1)] leading-snug">{event.title}</p>
          </div>
        </div>

        {/* Confianza */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-0.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${event.confidence >= 0.85 ? 'bg-emerald-500' : event.confidence >= 0.7 ? 'bg-amber-500' : 'bg-[var(--text-3)]'}`}
              style={{ width: `${Math.round(event.confidence * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-[var(--text-3)] tabular-nums shrink-0">
            {Math.round(event.confidence * 100)}% conf.
          </span>
          {event.estimated_value != null && (
            <span className="text-[10px] text-[var(--text-3)] shrink-0">
              · {timeSince(event.created_at ?? '')}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-3 flex items-center gap-1 text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
        >
          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {expanded ? 'Ocultar' : 'Ver explicación y acción'}
        </button>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className={`px-4 pb-4 pt-0 border-t border-[var(--border)] ${sev.bg}`}>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1">Por qué</p>
              <p className="text-[13px] text-[var(--text-2)] leading-relaxed">{event.explanation}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-1">Accion ahora</p>
              <p className="text-[13px] font-semibold text-[var(--text-1)] leading-relaxed">{event.suggested_action}</p>
            </div>

            {/* Outcome buttons */}
            <div className="pt-1 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[var(--text-3)] mr-1">¿Fue útil?</span>
              <button
                onClick={() => submitOutcome('correct')}
                disabled={!!pending}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-lg bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
              >
                <ThumbsUp size={12} />
                {pending === 'correct' ? 'Guardando…' : 'Sí, funcionó'}
              </button>
              <button
                onClick={() => submitOutcome('false_positive')}
                disabled={!!pending}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1 rounded-lg bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors disabled:opacity-50"
              >
                <ThumbsDown size={12} />
                {pending === 'false_positive' ? 'Guardando…' : 'Falso positivo'}
              </button>
              <button
                onClick={() => submitOutcome('ack')}
                disabled={!!pending}
                className="ml-auto text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors disabled:opacity-50"
              >
                {pending === 'ack' ? '…' : 'Solo reconocer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Metrics Widget ───────────────────────────────────────────────── */

function MetricsWidget({ clientId }: { clientId: string }) {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!clientId) return
    const url = `/api/agents/metrics?client_id=${encodeURIComponent(clientId)}`
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.metrics) setMetrics(d.metrics) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [clientId])

  if (!loaded || !metrics) return null
  if (metrics.total_decisions === 0) return null

  const hasOutcomes = metrics.correct + metrics.false_positives > 0
  const precisionPct = hasOutcomes ? Math.round(metrics.precision_rate * 100) : null

  return (
    <div className="mb-6 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
      <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-widest mb-3">
        Rendimiento — últimos 30 días
      </p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[11px] text-[var(--text-3)] mb-0.5">Decisiones</p>
          <p className="text-xl font-bold tabular-nums text-[var(--text-1)]">{metrics.total_decisions}</p>
        </div>
        <div>
          <p className="text-[11px] text-[var(--text-3)] mb-0.5">Precisión</p>
          {precisionPct !== null ? (
            <p className={`text-xl font-bold tabular-nums ${precisionPct >= 75 ? 'text-emerald-500' : precisionPct >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
              {precisionPct}%
            </p>
          ) : (
            <p className="text-xl font-bold text-[var(--text-3)]">—</p>
          )}
          {precisionPct === null && (
            <p className="text-[10px] text-[var(--text-3)]">sin feedback aún</p>
          )}
        </div>
        <div>
          <p className="text-[11px] text-[var(--text-3)] mb-0.5">Valor validado</p>
          {metrics.total_value_validated > 0 ? (
            <p className="text-xl font-bold tabular-nums text-emerald-500">
              {fmtMXN(metrics.total_value_validated)}
            </p>
          ) : (
            <p className="text-xl font-bold text-[var(--text-3)]">—</p>
          )}
        </div>
      </div>
      {!hasOutcomes && (
        <p className="mt-3 text-[11px] text-[var(--text-3)]">
          Usa "Si, funcionó" o "Falso positivo" en cada decisión para que el sistema aprenda y puedas ver su precision real.
        </p>
      )}
    </div>
  )
}

/* ── Main Page ────────────────────────────────────────────────────── */

const AGENTS: AgentId[] = ['operations', 'inventory', 'fraud', 'staff', 'finance']
const REFRESH_INTERVAL = 60

export default function AgentesPage() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<string | null>(null)
  const [nextRefresh, setNextRefresh] = useState(REFRESH_INTERVAL)
  const [filterAgent, setFilterAgent] = useState<AgentId | null>(null)
  const [filterSev, setFilterSev] = useState<Severity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clientId = useRef(getClientId())

  const fetchEvents = useCallback(async () => {
    if (!clientId.current) return
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/agents/events', window.location.origin)
      url.searchParams.set('client_id', clientId.current)
      url.searchParams.set('limit', '60')
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { events: evts } = await res.json()
      setEvents(evts ?? [])
      setLastRun(new Date().toISOString())
      setNextRefresh(REFRESH_INTERVAL)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  useEffect(() => {
    const tick = setInterval(() => {
      setNextRefresh(prev => {
        if (prev <= 1) { fetchEvents(); return REFRESH_INTERVAL }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [fetchEvents])

  async function runAllAgents() {
    if (!clientId.current || running) return
    setRunning(true)
    setError(null)
    try {
      await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId.current }),
      })
      await fetchEvents()
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  function handleOutcome(id: string, _outcome: Outcome | 'ack') {
    // Remove from feed after any action — user already saw it
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  const filtered = events.filter(e => {
    if (filterAgent && e.agent_id !== filterAgent) return false
    if (filterSev && e.severity !== filterSev) return false
    return true
  })

  const criticals = filtered.filter(e => e.severity === 'critical')
  const warnings  = filtered.filter(e => e.severity === 'warning')
  const infos     = filtered.filter(e => e.severity === 'info')

  const countCrit = events.filter(e => e.severity === 'critical').length
  const countWarn = events.filter(e => e.severity === 'warning').length
  const totalValue = events.reduce((s, e) => s + (e.estimated_value ?? 0), 0)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        eyebrow="AI Operations Lab"
        title="Decisiones"
        subtitle={lastRun ? `Actualizado ${timeSince(lastRun)} · refresca en ${nextRefresh}s` : undefined}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="p-2 rounded-lg border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={runAllAgents}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-60"
            >
              <Play size={13} />
              {running ? 'Analizando…' : 'Analizar ahora'}
            </button>
          </div>
        }
      />

      {/* Métricas 30 días */}
      <MetricsWidget clientId={clientId.current} />

      {/* Summary chips */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {countCrit > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400">
            <AlertCircle size={12} />
            {countCrit} crítico{countCrit > 1 ? 's' : ''}
          </span>
        )}
        {countWarn > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400">
            <AlertTriangle size={12} />
            {countWarn} alerta{countWarn > 1 ? 's' : ''}
          </span>
        )}
        {totalValue > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400">
            <DollarSign size={12} />
            {fmtMXN(totalValue)} en juego
          </span>
        )}
        {events.length === 0 && !loading && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400">
            <CheckCircle size={12} />
            Sin alertas activas
          </span>
        )}
      </div>

      {/* Filtros de agente */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setFilterAgent(null)}
          className={`px-3 py-1 text-[12px] font-semibold rounded-full border transition-colors ${filterAgent === null ? 'border-blue-500 bg-blue-500/15 text-blue-400' : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
        >
          Todos
        </button>
        {AGENTS.map(id => {
          const Icon = AGENT_ICONS[id]
          const count = events.filter(e => e.agent_id === id).length
          return (
            <button key={id}
              onClick={() => setFilterAgent(prev => prev === id ? null : id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold rounded-full border transition-colors ${filterAgent === id ? `border-current ${AGENT_COLORS[id]}` : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
            >
              <Icon size={11} />
              {AGENT_META[id].label}
              {count > 0 && <span className="opacity-70 tabular-nums">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Filtros de severidad */}
      <div className="flex gap-2 mb-6">
        {(['critical', 'warning', 'info'] as Severity[]).map(sev => {
          const cfg = SEV[sev]
          const SevIcon = cfg.icon
          const count = events.filter(e => e.severity === sev).length
          return (
            <button key={sev}
              onClick={() => setFilterSev(prev => prev === sev ? null : sev)}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${filterSev === sev ? `border-current ${cfg.bg} ${cfg.text}` : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
            >
              <SevIcon size={11} />
              {cfg.label}
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-[13px] text-red-400">{error}</div>
      )}

      {loading && events.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] animate-pulse" />
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle size={40} className="text-emerald-500 mb-3" />
          <p className="text-sm font-semibold text-[var(--text-1)]">
            {events.length === 0 ? 'Sin alertas activas' : 'Nada con ese filtro'}
          </p>
          <p className="text-[13px] text-[var(--text-3)] mt-1">
            {events.length === 0 ? 'El sistema analizará el próximo ciclo automáticamente.' : 'Cambia los filtros para ver más decisiones.'}
          </p>
          {events.length === 0 && (
            <button
              onClick={runAllAgents}
              disabled={running}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-60"
            >
              <Play size={14} />
              {running ? 'Analizando…' : 'Analizar ahora'}
            </button>
          )}
        </div>
      )}

      <div className="space-y-6">
        {criticals.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-red-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <AlertCircle size={13} /> Critico — {criticals.length}
            </h3>
            <div className="space-y-2">
              {criticals.map(e => <EventCard key={e.id} event={e} onOutcome={handleOutcome} />)}
            </div>
          </section>
        )}
        {warnings.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <AlertTriangle size={13} /> Alertas — {warnings.length}
            </h3>
            <div className="space-y-2">
              {warnings.map(e => <EventCard key={e.id} event={e} onOutcome={handleOutcome} />)}
            </div>
          </section>
        )}
        {infos.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold text-blue-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Info size={13} /> Informacion — {infos.length}
            </h3>
            <div className="space-y-2">
              {infos.map(e => <EventCard key={e.id} event={e} onOutcome={handleOutcome} />)}
            </div>
          </section>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="mt-10 text-center text-[11px] text-[var(--text-3)]">
          Usa "Si, funcionó" o "Falso positivo" para que el sistema aprenda · los eventos se archivan automáticamente en 6h
        </p>
      )}
    </div>
  )
}
