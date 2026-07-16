'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  Bot, Activity, Clock, Zap, CheckCircle, XCircle, AlertTriangle, Search,
  ChevronUp, ChevronDown, RefreshCw, Filter,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { getDeepTable } from '@/lib/data'

/* ── Types ─────────────────────────────────────────────────────────── */

interface AgentRun {
  agent_id: string
  status: string
  created_at: string
  duration_ms: number | null
  tentacle: string | null
  tokens_used: number | null
}

type SortKey = 'agent_id' | 'tentacle' | 'status' | 'duration_ms' | 'created_at'
type SortDir = 'asc' | 'desc'

/* ── Helpers ───────────────────────────────────────────────────────── */

async function fetchAgentRuns(): Promise<AgentRun[]> {
  try {
    const rows = await getDeepTable('agent_runs', 200)
    const data = (rows as unknown as AgentRun[])
    return data.sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return []
  }
}

function timeSince(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

function fmtDate(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '--'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/* ── Status badge ──────────────────────────────────────────────────── */

const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'OK' },
  warning: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Warn' },
  error: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Error' },
  no_data: { bg: 'bg-[var(--surface-2)]', text: 'text-[var(--text-4)]', label: 'Sin datos' },
}

function StatusBadge({ status }: { status: string }) {
  const s = statusStyles[status] || statusStyles.no_data
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.bg} ${s.text}`}>
      {status === 'success' && <CheckCircle size={11} />}
      {status === 'error' && <XCircle size={11} />}
      {status === 'warning' && <AlertTriangle size={11} />}
      {s.label}
    </span>
  )
}

/* ── Agent summary type ────────────────────────────────────────────── */

interface AgentSummary {
  agent_id: string
  lastRun: string
  totalRuns: number
  successCount: number
  avgDuration: number
  tentacle: string | null
}

/* ── Main page ─────────────────────────────────────────────────────── */

export default function AgentesPage() {
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loading, setLoading] = useState(true)

  // Table state
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchAgentRuns()
    setRuns(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  /* ── KPI computations ────────────────────────────────────────────── */
  const now = Date.now()
  const last24h = useMemo(() => runs.filter(r => now - new Date(r.created_at).getTime() < 86400000), [runs, now])

  const totalRuns24h = last24h.length
  const successRate = last24h.length > 0
    ? Math.round((last24h.filter(r => r.status === 'success').length / last24h.length) * 100)
    : 0
  const avgDuration = useMemo(() => {
    const durations = last24h.filter(r => r.duration_ms != null).map(r => r.duration_ms!)
    return durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
  }, [last24h])
  const uniqueAgents = useMemo(() => new Set(last24h.map(r => r.agent_id)).size, [last24h])

  /* ── Agent summaries ─────────────────────────────────────────────── */
  const agentSummaries = useMemo(() => {
    const map = new Map<string, AgentSummary>()
    for (const r of runs) {
      if (!map.has(r.agent_id)) {
        map.set(r.agent_id, {
          agent_id: r.agent_id,
          lastRun: r.created_at,
          totalRuns: 0,
          successCount: 0,
          avgDuration: 0,
          tentacle: r.tentacle,
        })
      }
      const s = map.get(r.agent_id)!
      s.totalRuns++
      if (r.status === 'success') s.successCount++
      if (r.duration_ms != null) s.avgDuration += r.duration_ms
      if (r.created_at > s.lastRun) s.lastRun = r.created_at
    }
    for (const s of map.values()) {
      const withDur = runs.filter(r => r.agent_id === s.agent_id && r.duration_ms != null)
      s.avgDuration = withDur.length > 0 ? Math.round(s.avgDuration / withDur.length) : 0
    }
    return Array.from(map.values()).sort((a, b) => b.lastRun.localeCompare(a.lastRun))
  }, [runs])

  /* ── Filtered / sorted table data ────────────────────────────────── */
  const filteredRuns = useMemo(() => {
    let list = [...runs]
    if (filterStatus !== 'all') list = list.filter(r => r.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => r.agent_id.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal))
    })
    return list
  }, [runs, filterStatus, search, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown size={12} className="opacity-30" />
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  /* ── Unique statuses for filter dropdown ─────────────────────────── */
  const statuses = useMemo(() => Array.from(new Set(runs.map(r => r.status))), [runs])

  /* ── Render ──────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Agentes de IA"
        subtitle={`${runs.length} ejecuciones recientes`}
        eyebrow="War Room"
        action={
          <button
            onClick={load}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard
          label="Runs (24h)"
          value={String(totalRuns24h)}
          icon={Zap}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Tasa de exito"
          value={`${successRate}%`}
          icon={CheckCircle}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Duracion promedio"
          value={fmtDuration(avgDuration)}
          icon={Clock}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Agentes activos"
          value={String(uniqueAgents)}
          icon={Bot}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* ── Agent Summary Cards ────────────────────────────────────── */}
      <h3 className="text-sm font-bold text-[var(--text-2)] uppercase tracking-widest mb-3">
        Resumen por agente
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-8">
        {agentSummaries.map(agent => {
          const rate = agent.totalRuns > 0
            ? Math.round((agent.successCount / agent.totalRuns) * 100)
            : 0
          return (
            <div
              key={agent.agent_id}
              className="rounded-xl border border-[var(--line)] p-4 transition-all hover:border-violet-500/40"
              style={{ background: 'var(--bento-card)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Bot size={16} className="text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--text-1)] truncate">{agent.agent_id}</p>
                  {agent.tentacle && (
                    <p className="text-[10px] text-[var(--text-4)] uppercase tracking-wider">{agent.tentacle}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-[var(--text-1)]">{agent.totalRuns}</p>
                  <p className="text-[9px] text-[var(--text-4)] uppercase">Runs</p>
                </div>
                <div>
                  <p className={`text-lg font-bold ${rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {rate}%
                  </p>
                  <p className="text-[9px] text-[var(--text-4)] uppercase">Exito</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[var(--text-1)]">{fmtDuration(agent.avgDuration)}</p>
                  <p className="text-[9px] text-[var(--text-4)] uppercase">Avg</p>
                </div>
              </div>
              <p className="text-[10px] text-[var(--text-4)] mt-2 text-right">{timeSince(agent.lastRun)}</p>
            </div>
          )
        })}
      </div>

      {/* ── Runs Table ─────────────────────────────────────────────── */}
      <h3 className="text-sm font-bold text-[var(--text-2)] uppercase tracking-widest mb-3">
        Ejecuciones recientes
      </h3>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            placeholder="Buscar agente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-[var(--text-4)]" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text-2)] px-3 py-2 focus:outline-none focus:border-violet-500/50"
          >
            <option value="all">Todos</option>
            {statuses.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--line)]" style={{ background: 'var(--bento-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)]">
              {([
                ['agent_id', 'Agente'],
                ['tentacle', 'Tentaculo'],
                ['status', 'Status'],
                ['duration_ms', 'Duracion'],
                ['created_at', 'Fecha'],
              ] as [SortKey, string][]).map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-3)] cursor-pointer hover:text-[var(--text-2)] select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <SortIcon col={key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRuns.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-[var(--text-4)]">
                  Sin resultados
                </td>
              </tr>
            ) : (
              filteredRuns.map((run, i) => (
                <tr
                  key={`${run.agent_id}-${run.created_at}-${i}`}
                  className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-[var(--text-1)]">{run.agent_id}</td>
                  <td className="px-4 py-3 text-[var(--text-3)]">{run.tentacle || '--'}</td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-[var(--text-2)] font-mono text-xs">{fmtDuration(run.duration_ms)}</td>
                  <td className="px-4 py-3 text-[var(--text-3)] text-xs">{fmtDate(run.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
