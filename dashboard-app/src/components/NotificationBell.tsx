'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, AlertTriangle, AlertCircle, Info, Sparkles, X } from 'lucide-react'

import { getAuthToken, getActiveClientSlug } from '@/lib/data'
import { traducir } from '@/lib/agentes/traducir'

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

// Aislamiento por tenant: usa el JWT de sesión (RLS por membresía, BUG-019) —
// NO la anon key, que devolvía 0 filas (o filtraría mal). El caller además filtra
// por client_id para defensa en profundidad.
async function sbFetch(table: string, params: string): Promise<unknown[]> {
  try {
    const token = await getAuthToken()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
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
    // IDs largos = los que realmente escriben los scripts (antes usaba cortos → salían feos)
    'anomaly-detector': 'Anomalías',
    'close-predictor': 'Predicción de Cierre',
    'upselling': 'Upselling',
    'menu-engineering': 'Menu Engineering',
    'staffing-optimizer': 'Staffing',
    'antifraud-agent': 'Anti-Fraude',
    'kitchen-quality': 'Calidad de Cocina',
    'table-time': 'Tiempo de Mesa',
    'speed_of_service': 'Velocidad de Servicio',
    'tips-analyzer': 'Propinas',
    'supplier-monitor': 'Proveedores',
    'waste-detector': 'Desperdicio',
    'cost-variance': 'Varianza de Costos',
    'climate-events': 'Clima',
    'stock-alert': 'Alerta de Stock',
    'auto86': 'Auto-86',
    'crm-recompra': 'CRM Recompra',
    'purchase-predictor': 'Compras',
    'config-validator': 'Config',
    'daily-briefing': 'Briefing Diario',
    'weekly-amalay': 'Reporte Semanal',
    'intraday-sales': 'Ventas Intraday',
    'wansoft-query': 'KB 24/7',
    'wansoft-staleness': 'Wansoft Sync',
    'reservas-pendientes': 'Reservas',
    'hermes': 'Hermes',
  }
  return map[id] || id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Detección estilo skeleton: color + etiqueta por tipo (no es el acento de marca)
type NKind = 'crit' | 'warn' | 'info'
function kindOf(priority: string, source: string): NKind {
  if (source === 'error' || priority === 'critical') return 'crit'
  if (priority === 'warning') return 'warn'
  return 'info'
}
const NKIND: Record<NKind, { label: string; box: string; tag: string; Icon: typeof Bell }> = {
  crit: { label: 'Alerta', box: 'bg-red-500/10 text-red-400', tag: 'bg-red-500/15 text-red-300', Icon: AlertTriangle },
  warn: { label: 'Ojo', box: 'bg-amber-500/10 text-amber-400', tag: 'bg-amber-500/15 text-amber-300', Icon: AlertCircle },
  info: { label: 'Info', box: 'bg-sky-500/10 text-sky-400', tag: 'bg-sky-500/15 text-sky-300', Icon: Info },
}

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const fetchAlerts = useCallback(async () => {
    // Solo detecciones del TENANT ACTIVO (agent_results tiene client_id + RLS por
    // membresía). Se quita agent_runs: es GLOBAL (sin client_id) → mezclaría errores
    // de otros clientes en la campana; además son ruido de ops, no del tenant.
    const clientId = getActiveClientSlug()
    const results = clientId
      ? await sbFetch(
          'agent_results',
          `select=agent_id,summary,priority,updated_at&client_id=eq.${encodeURIComponent(clientId)}&or=(priority.eq.critical,priority.eq.warning)&order=updated_at.desc&limit=20`
        )
      : []

    const items: AgentAlert[] = []

    // La campana volcaba `summary` tal cual, así que el dueño leía
    // "18 issues: 0 critical, 12 high" y "ALERTAS: 225 sin stock, 0 critico".
    // Eso es telemetría de la plataforma: su lugar es Herramientas → Agentes IA.
    //
    // `traducir()` pasa a español de restaurante lo que sí habla del negocio y
    // DESCARTA lo que sólo cuenta su propia salida. Una auditoría de los 1,025
    // registros publicados encontró que el 81.9% cae en ese segundo grupo.
    for (const r of results as { agent_id: string; summary: string; priority: string; updated_at: string }[]) {
      const t = traducir({ agent_id: r.agent_id, summary: r.summary, priority: r.priority })
      if (!t) continue
      items.push({
        id: `result-${r.agent_id}-${r.updated_at}`,
        agent_id: t.agente,
        summary: t.texto,
        priority: t.severidad === 'alta' ? 'critical' : t.severidad === 'media' ? 'warning' : 'info',
        updated_at: r.updated_at,
        source: 'result',
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

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--panel)] transition-colors"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <Bell size={18} className="text-[var(--text-2)]" strokeWidth={1.9} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel — estilo skeleton */}
      {open && (
        <div
          className="absolute right-0 top-12 w-[380px] max-w-[calc(100vw-2rem)] max-h-[500px] rounded-2xl border border-[var(--line)] overflow-hidden z-50 shadow-2xl"
          style={{ background: 'var(--panel)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[var(--line)]">
            <Sparkles size={15} className="text-emerald-400" />
            <b className="text-[13px] font-bold text-[var(--text-1)]">Notificaciones</b>
            <span className="ml-auto text-[11px] font-mono text-[var(--text-4)]">{alerts.length > 0 ? String(alerts.length) : 'al día'}</span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] transition-colors"
              aria-label="Cerrar"
            >
              <X size={15} />
            </button>
          </div>

          {/* Alert list */}
          <div className="overflow-y-auto max-h-[440px]">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
                <div className="w-11 h-11 rounded-xl grid place-items-center bg-emerald-500/10 text-emerald-400"><Bell size={20} /></div>
                <p className="text-sm font-semibold text-[var(--text-2)]">Todo en orden</p>
                <p className="text-xs text-[var(--text-4)]">Sin alertas recientes de los agentes.</p>
              </div>
            ) : (
              alerts.map(alert => {
                const isUnread = lastSeen
                  ? new Date(alert.updated_at).getTime() > new Date(lastSeen).getTime()
                  : false
                const k = NKIND[kindOf(alert.priority, alert.source)]
                const Icon = k.Icon
                return (
                  <div
                    key={alert.id}
                    className={`flex gap-3 px-4 py-3 border-t border-[var(--line-soft)] first:border-t-0 hover:bg-[var(--surface-2)] transition-colors ${
                      isUnread ? 'bg-emerald-500/[0.03]' : ''
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${k.box}`}><Icon size={15} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                        <span className="text-[12.5px] font-semibold text-[var(--text-1)]">{agentLabel(alert.agent_id)}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                        <span className="ml-auto text-[10px] font-mono text-[var(--text-4)] whitespace-nowrap">{timeAgo(alert.updated_at)}</span>
                      </div>
                      <p className="text-xs text-[var(--text-2)] mt-1 leading-snug line-clamp-2">{alert.summary}</p>
                    </div>
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
