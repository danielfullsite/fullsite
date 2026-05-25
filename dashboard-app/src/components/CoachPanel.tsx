'use client'

import { useEffect, useState } from 'react'
import { Sparkles, TrendingUp, TrendingDown, AlertTriangle, Calendar, Target, RefreshCw } from 'lucide-react'

interface CoachInsight {
  type: 'daily' | 'weekly' | 'alert'
  title: string
  body: string
  priority: 'high' | 'medium' | 'low'
  metric: string
}

interface CoachData {
  insights: CoachInsight[]
  today?: {
    fecha: string
    ventas: number
    tickets: number
    tp: number
    avgVentas: number
    avgTP: number
    weekVentas: number
    prevWeekVentas: number
  }
}

function InsightIcon({ type, priority }: { type: string; priority: string }) {
  if (type === 'alert') {
    return (
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        priority === 'high' ? 'bg-red-50' : 'bg-amber-50'
      }`}>
        <AlertTriangle size={16} className={priority === 'high' ? 'text-red-500' : 'text-amber-500'} />
      </div>
    )
  }
  if (type === 'weekly') {
    return (
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-50">
        <TrendingUp size={16} className="text-blue-500" />
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50">
      <Target size={16} className="text-emerald-500" />
    </div>
  )
}

function MetricBadge({ metric, priority }: { metric: string; priority: string }) {
  const isNegative = metric.startsWith('-')
  const colorClass = priority === 'high'
    ? (isNegative ? 'bg-red-100 text-red-700' : 'bg-red-100 text-red-700')
    : priority === 'medium'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-emerald-100 text-emerald-700'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${colorClass}`}>
      {metric}
    </span>
  )
}

function TypeLabel({ type }: { type: string }) {
  const labels: Record<string, { text: string; color: string }> = {
    daily: { text: 'HOY', color: 'text-emerald-600' },
    weekly: { text: 'SEMANA', color: 'text-blue-600' },
    alert: { text: 'ALERTA', color: 'text-red-600' },
  }
  const { text, color } = labels[type] || labels.daily
  return <span className={`text-[10px] font-bold tracking-wider ${color}`}>{text}</span>
}

export default function CoachPanel() {
  const [data, setData] = useState<CoachData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  async function loadInsights() {
    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      setData(json)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadInsights()
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    loadInsights()
  }

  if (loading) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Coach</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="h-3 bg-[var(--surface-2)] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[var(--surface-2)] rounded w-full mb-1" />
              <div className="h-3 bg-[var(--surface-2)] rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data || data.insights.length === 0) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-1)]">Coach</h3>
        </div>
        <p className="text-sm text-[var(--text-3)]">Sin datos suficientes para generar insights.</p>
      </div>
    )
  }

  const weekChange = data.today && data.today.prevWeekVentas > 0
    ? ((data.today.weekVentas / data.today.prevWeekVentas - 1) * 100).toFixed(0)
    : null
  const ventasVsAvg = data.today && data.today.avgVentas > 0
    ? ((data.today.ventas / data.today.avgVentas - 1) * 100).toFixed(0)
    : null

  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-[var(--line-soft)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
              <Sparkles size={15} className="text-white" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-1)]">Coach</h3>
              <p className="text-[11px] text-[var(--text-3)]">Insights basados en tus datos</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1.5 rounded-md hover:bg-[var(--surface-2)] transition-colors text-[var(--text-3)] hover:text-[var(--text-2)] disabled:opacity-50"
            title="Actualizar insights"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Quick stats bar */}
        {data.today && (
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-50">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-3)]">Hoy</span>
              <span className="text-xs font-bold text-[var(--text-1)]">
                ${data.today.ventas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
              </span>
              {ventasVsAvg && (
                <span className={`text-[10px] font-bold ${Number(ventasVsAvg) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {Number(ventasVsAvg) >= 0 ? '+' : ''}{ventasVsAvg}%
                </span>
              )}
            </div>
            <div className="w-px h-3 bg-[var(--line)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-3)]">Semana</span>
              <span className="text-xs font-bold text-[var(--text-1)]">
                ${data.today.weekVentas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
              </span>
              {weekChange && (
                <span className={`text-[10px] font-bold ${Number(weekChange) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {Number(weekChange) >= 0 ? '+' : ''}{weekChange}%
                </span>
              )}
            </div>
            <div className="w-px h-3 bg-[var(--line)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-3)]">TP</span>
              <span className="text-xs font-bold text-[var(--text-1)]">${data.today.tp}</span>
            </div>
          </div>
        )}
      </div>

      {/* Insights */}
      <div className="divide-y divide-slate-50">
        {data.insights.map((insight, i) => (
          <div key={i} className="px-6 py-4 hover:bg-[var(--surface-2)]/50 transition-colors">
            <div className="flex items-start gap-3">
              <InsightIcon type={insight.type} priority={insight.priority} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <TypeLabel type={insight.type} />
                  <MetricBadge metric={insight.metric} priority={insight.priority} />
                </div>
                <p className="text-sm font-semibold text-[var(--text-1)] mb-1">{insight.title}</p>
                <p className="text-xs text-[var(--text-2)] leading-relaxed">{insight.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 bg-[var(--surface-2)]/50 border-t border-[var(--line-soft)]">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
          <Calendar size={10} />
          <span>Actualizado con datos hasta {data.today?.fecha || 'hoy'}</span>
        </div>
      </div>
    </div>
  )
}
