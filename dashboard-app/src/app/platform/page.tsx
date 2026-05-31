'use client'

import { useEffect, useState } from 'react'
import { Users, Bot, CheckCircle, AlertTriangle, DollarSign, Activity, Clock, RefreshCw } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sbFetch(table: string, params: string = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function sbCount(table: string, filter: string = ''): Promise<number> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${filter ? '&' + filter : ''}`
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'count=exact',
        'Range': '0-0',
      },
    })
    const range = res.headers.get('content-range')
    if (range) {
      const total = range.split('/')[1]
      return total === '*' ? 0 : parseInt(total, 10)
    }
    return 0
  } catch {
    return 0
  }
}

interface DayBucket {
  label: string
  date: string
  total: number
  success: number
  error: number
}

interface PlatformData {
  activeClients: number
  totalRuns: number
  successRate: number
  alertsCritical: number
  alertsWarning: number
  valueCreated: number
  uptimePercent: number
  freshness: { client: string; hoursAgo: number }[]
  dailyRuns: DayBucket[]
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
}

function hoursAgoFromDate(dateStr: string): number {
  const now = new Date()
  const then = new Date(dateStr + 'T23:59:00')
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / (1000 * 60 * 60)))
}

export default function PlatformPage() {
  const [data, setData] = useState<PlatformData | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      // Parallel fetches
      const [
        clientCount,
        totalRunCount,
        successCount,
        errorCount,
        criticalAlerts,
        warningAlerts,
        recentRuns,
        latestDaily,
        uptimeRuns,
        uptimeSuccess,
      ] = await Promise.all([
        sbCount('clients'),
        sbCount('agent_runs'),
        sbCount('agent_runs', 'status=eq.success'),
        sbCount('agent_runs', 'status=eq.error'),
        sbCount('agent_results', 'priority=eq.critical'),
        sbCount('agent_results', 'priority=eq.warning'),
        sbFetch('agent_runs', `select=created_at,status&order=created_at.desc&limit=2000&created_at=gte.${daysAgo(7)}`),
        sbFetch('wansoft_daily', 'select=client_slug,fecha&order=fecha.desc&limit=50'),
        sbCount('agent_runs', 'agent_id=eq.uptime-monitor'),
        sbCount('agent_runs', 'agent_id=eq.uptime-monitor&status=eq.success'),
      ])

      // Build 7-day buckets
      const buckets: DayBucket[] = []
      for (let i = 6; i >= 0; i--) {
        const date = daysAgo(i)
        buckets.push({ label: shortDay(date), date, total: 0, success: 0, error: 0 })
      }
      for (const run of recentRuns as { created_at: string; status: string }[]) {
        const runDate = run.created_at?.slice(0, 10)
        const bucket = buckets.find(b => b.date === runDate)
        if (bucket) {
          bucket.total++
          if (run.status === 'success') bucket.success++
          if (run.status === 'error') bucket.error++
        }
      }

      // Data freshness per client
      const freshnessMap = new Map<string, string>()
      for (const row of latestDaily as { client_slug: string; fecha: string }[]) {
        if (!freshnessMap.has(row.client_slug)) {
          freshnessMap.set(row.client_slug, row.fecha)
        }
      }
      const freshness = Array.from(freshnessMap.entries()).map(([client, fecha]) => ({
        client,
        hoursAgo: hoursAgoFromDate(fecha),
      }))

      // Uptime %
      const uptimePercent = uptimeRuns > 0 ? (uptimeSuccess / uptimeRuns) * 100 : 99.9

      // Value created placeholder
      const clients = Math.max(clientCount, 1)
      const valueCreated = clients * 80000

      const successRate = totalRunCount > 0 ? (successCount / totalRunCount) * 100 : 0

      setData({
        activeClients: clientCount,
        totalRuns: totalRunCount,
        successRate,
        alertsCritical: criticalAlerts,
        alertsWarning: warningAlerts,
        valueCreated,
        uptimePercent,
        freshness,
        dailyRuns: buckets,
      })
    } catch (err) {
      console.error('Error loading platform data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) return null

  const maxRuns = Math.max(...data.dailyRuns.map(d => d.total), 1)

  const kpis = [
    {
      label: 'Active Clients',
      value: formatNumber(data.activeClients),
      sub: 'Multi-tenant SaaS',
      icon: Users,
      color: 'text-blue-400',
      bg: 'from-blue-500/10 to-blue-500/5',
      border: 'border-blue-500/20',
    },
    {
      label: 'Total Agent Runs',
      value: formatNumber(data.totalRuns),
      sub: 'Lifetime executions',
      icon: Bot,
      color: 'text-violet-400',
      bg: 'from-violet-500/10 to-violet-500/5',
      border: 'border-violet-500/20',
    },
    {
      label: 'Success Rate',
      value: `${data.successRate.toFixed(1)}%`,
      sub: `${formatNumber(data.totalRuns - Math.round(data.totalRuns * data.successRate / 100))} errors`,
      icon: CheckCircle,
      color: data.successRate >= 95 ? 'text-emerald-400' : data.successRate >= 80 ? 'text-amber-400' : 'text-red-400',
      bg: data.successRate >= 95 ? 'from-emerald-500/10 to-emerald-500/5' : 'from-amber-500/10 to-amber-500/5',
      border: data.successRate >= 95 ? 'border-emerald-500/20' : 'border-amber-500/20',
    },
    {
      label: 'Alerts Generated',
      value: formatNumber(data.alertsCritical + data.alertsWarning),
      sub: `${data.alertsCritical} critical, ${data.alertsWarning} warning`,
      icon: AlertTriangle,
      color: data.alertsCritical > 0 ? 'text-red-400' : 'text-amber-400',
      bg: data.alertsCritical > 0 ? 'from-red-500/10 to-red-500/5' : 'from-amber-500/10 to-amber-500/5',
      border: data.alertsCritical > 0 ? 'border-red-500/20' : 'border-amber-500/20',
    },
    {
      label: 'Value Created',
      value: formatCurrency(data.valueCreated),
      sub: `~${formatCurrency(80000)}/client/yr`,
      icon: DollarSign,
      color: 'text-emerald-400',
      bg: 'from-emerald-500/10 to-emerald-500/5',
      border: 'border-emerald-500/20',
    },
    {
      label: 'System Uptime',
      value: `${data.uptimePercent.toFixed(1)}%`,
      sub: 'Based on uptime-monitor runs',
      icon: Activity,
      color: data.uptimePercent >= 99 ? 'text-emerald-400' : 'text-amber-400',
      bg: data.uptimePercent >= 99 ? 'from-emerald-500/10 to-emerald-500/5' : 'from-amber-500/10 to-amber-500/5',
      border: data.uptimePercent >= 99 ? 'border-emerald-500/20' : 'border-amber-500/20',
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Platform Metrics"
          subtitle="Fullsite operational overview"
          eyebrow="INTERNAL"
        />
        <button
          onClick={load}
          className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {kpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <div
              key={kpi.label}
              className={`bg-gradient-to-br ${kpi.bg} rounded-xl border ${kpi.border} p-5`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg bg-[var(--surface)] flex items-center justify-center`}>
                  <Icon size={16} className={kpi.color} />
                </div>
              </div>
              <p className="text-2xl font-black text-[var(--text-1)] tracking-tight">{kpi.value}</p>
              <p className="text-xs font-medium text-[var(--text-2)] mt-1">{kpi.label}</p>
              <p className="text-[11px] text-[var(--text-3)] mt-0.5">{kpi.sub}</p>
            </div>
          )
        })}
      </div>

      {/* 7-Day Agent Runs Chart */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-[var(--line-soft)]">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Agent Runs - Last 7 Days</h3>
          <p className="text-[11px] text-[var(--text-3)] mt-0.5">
            Daily execution volume with success/error breakdown
          </p>
        </div>
        <div className="px-5 py-5">
          <div className="flex items-end gap-2" style={{ height: 180 }}>
            {data.dailyRuns.map(day => {
              const barH = maxRuns > 0 ? (day.total / maxRuns) * 150 : 0
              const successH = day.total > 0 ? (day.success / day.total) * barH : 0
              const errorH = day.total > 0 ? (day.error / day.total) * barH : 0
              const otherH = barH - successH - errorH
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-[var(--text-3)] tabular-nums">{day.total}</span>
                  <div
                    className="w-full rounded-md overflow-hidden flex flex-col-reverse"
                    style={{ height: Math.max(barH, 2) }}
                  >
                    <div
                      className="w-full bg-emerald-500/80 transition-all"
                      style={{ height: successH }}
                    />
                    <div
                      className="w-full bg-amber-500/60 transition-all"
                      style={{ height: otherH }}
                    />
                    <div
                      className="w-full bg-red-500/70 transition-all"
                      style={{ height: errorH }}
                    />
                  </div>
                  <span className="text-[10px] text-[var(--text-3)] text-center leading-tight">{day.label}</span>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[var(--line-soft)]">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" />
              <span className="text-[11px] text-[var(--text-3)]">Success</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-amber-500/60" />
              <span className="text-[11px] text-[var(--text-3)]">Other</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-500/70" />
              <span className="text-[11px] text-[var(--text-3)]">Error</span>
            </div>
          </div>
        </div>
      </div>

      {/* Data Freshness */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="px-5 py-4 border-b border-[var(--line-soft)]">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-[var(--text-3)]" />
            <h3 className="text-sm font-bold text-[var(--text-1)]">Data Freshness</h3>
          </div>
          <p className="text-[11px] text-[var(--text-3)] mt-0.5">
            Hours since last wansoft_daily entry per client
          </p>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {data.freshness.length === 0 ? (
            <div className="px-5 py-4 text-sm text-[var(--text-3)]">No client data found</div>
          ) : (
            data.freshness.map(f => {
              const isStale = f.hoursAgo > 48
              const isWarning = f.hoursAgo > 24
              return (
                <div key={f.client} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isStale ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    />
                    <span className="text-sm font-medium text-[var(--text-1)] capitalize">{f.client}</span>
                  </div>
                  <span
                    className={`text-sm tabular-nums font-medium ${
                      isStale ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-[var(--text-3)]'
                    }`}
                  >
                    {f.hoursAgo}h ago
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-4 px-4 py-3 bg-[var(--surface-2)] rounded-lg">
        <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
          <strong className="text-[var(--text-2)]">Internal page.</strong> Value Created uses a placeholder estimate of $80K MXN/client/year.
          Uptime is derived from uptime-monitor agent runs. Data freshness shows hours since the most recent wansoft_daily row per client_slug.
        </p>
      </div>
    </>
  )
}
