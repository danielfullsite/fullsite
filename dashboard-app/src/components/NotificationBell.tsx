'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, AlertTriangle, AlertCircle, XCircle, X } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const LAST_SEEN_KEY = 'fullsite_notifications_last_seen'
const REFRESH_INTERVAL = 60_000

interface AgentAlert {
  id: string
  agent_id: string
  summary: string
  priority: string
  updated_at: string
  source: 'result' | 'error'
}

async function sbFetch(table: string, params: string): Promise<unknown[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

function agentLabel(id: string): string {
  const map: Record<string, string> = {
    anomaly: 'Anomalias',
    predictor: 'Prediccion',
    upselling: 'Upselling',
    'menu-engineering': 'Menu Engineering',
    staffing: 'Staffing',
    antifraud: 'Anti-Fraude',
    kitchen: 'Calidad Cocina',
    'table-time': 'Tiempo de Mesa',
    tips: 'Propinas',
    suppliers: 'Proveedores',
    waste: 'Desperdicio',
    weather: 'Clima',
    'daily-briefing': 'Briefing Diario',
    'weekly-summary': 'Reporte Semanal',
    'wansoft-query': 'KB 24/7',
    'reservas-pendientes': 'Reservas',
    'wansoft-staleness': 'Wansoft Sync',
    hermes: 'Hermes',
  }
  return map[id] || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const fetchAlerts = useCallback(async () => {
    const [results, errors] = await Promise.all([
      sbFetch(
        'agent_results',
        'select=agent_id,summary,priority,updated_at&or=(priority.eq.critical,priority.eq.warning)&order=updated_at.desc&limit=20'
      ),
      sbFetch(
        'agent_runs',
        'select=agent_id,output_summary,status,created_at&status=eq.error&order=created_at.desc&limit=10'
      ),
    ])

    const items: AgentAlert[] = []

    for (const r of results as { agent_id: string; summary: string; priority: string; updated_at: string }[]) {
      items.push({
        id: `result-${r.agent_id}-${r.updated_at}`,
        agent_id: r.agent_id,
        summary: r.summary || 'Sin detalle',
        priority: r.priority,
        updated_at: r.updated_at,
        source: 'result',
      })
    }

    for (const e of errors as { agent_id: string; output_summary: string; status: string; created_at: string }[]) {
      items.push({
        id: `error-${e.agent_id}-${e.created_at}`,
        agent_id: e.agent_id,
        summary: e.output_summary || 'Error en ejecucion',
        priority: 'critical',
        updated_at: e.created_at,
        source: 'error',
      })
    }

    items.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    setAlerts(items.slice(0, 25))
  }, [])

  // Load lastSeen from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_SEEN_KEY)
      if (stored) setLastSeen(stored)
    } catch { /* private browsing */ }
  }, [])

  // Fetch on mount + interval
  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAlerts])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const unreadCount = lastSeen
    ? alerts.filter(a => new Date(a.updated_at).getTime() > new Date(lastSeen).getTime()).length
    : alerts.length

  function markAllRead() {
    const now = new Date().toISOString()
    setLastSeen(now)
    try {
      localStorage.setItem(LAST_SEEN_KEY, now)
    } catch { /* ignore */ }
  }

  function handleToggle() {
    if (!open) {
      markAllRead()
    }
    setOpen(prev => !prev)
  }

  function priorityBadge(priority: string) {
    switch (priority) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-red-500/15 text-red-500">
            <XCircle size={10} />
            critico
          </span>
        )
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-amber-500/15 text-amber-500">
            <AlertTriangle size={10} />
            aviso
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-blue-500/15 text-blue-500">
            <AlertCircle size={10} />
            {priority}
          </span>
        )
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--line)]"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <Bell size={20} className="text-[var(--text-2)]" strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center px-1 text-[11px] font-bold text-white bg-red-500 rounded-full shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-11 w-[360px] max-h-[480px] rounded-xl shadow-xl border border-[var(--line)] overflow-hidden z-50"
          style={{ background: 'var(--surface)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Alertas de Agentes</h3>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Alert list */}
          <div className="overflow-y-auto max-h-[420px]">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-3)]">
                <Bell size={28} className="mb-2 opacity-40" />
                <p className="text-sm">Sin alertas recientes</p>
              </div>
            ) : (
              alerts.map(alert => {
                const isUnread = lastSeen
                  ? new Date(alert.updated_at).getTime() > new Date(lastSeen).getTime()
                  : false
                return (
                  <div
                    key={alert.id}
                    className={`px-4 py-3 border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors ${
                      isUnread ? 'bg-[var(--accent)]/[0.03]' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-[var(--text-1)]">
                          {agentLabel(alert.agent_id)}
                        </span>
                        {alert.source === 'error' && (
                          <span className="text-[10px] text-red-400 font-medium">ERROR</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--text-4)] whitespace-nowrap shrink-0">
                        {timeAgo(alert.updated_at)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] line-clamp-2 mb-1.5 leading-relaxed">
                      {alert.summary}
                    </p>
                    {priorityBadge(alert.priority)}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
