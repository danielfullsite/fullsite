'use client'

// Control Plane · Arquitectura de hardware por cliente (Esqueleton · Feature 2).
// Muestra la topología de cada restaurante: el Local Server (Pedro/caja) + terminales
// conectadas + salud, para entender el flujo de cada cliente de un vistazo.

import { useState, useEffect, useCallback } from 'react'
import { Server, Monitor, Loader2, AlertTriangle, RefreshCw, Cpu } from 'lucide-react'

interface Tenant { id: string; name: string }
interface Heartbeat {
  server_id: string; restaurant_id: string; reported_at: string; version?: string; platform?: string
  uptime_seconds?: number; clients_connected?: number; sync_queue_size?: number; health_status?: string; disk_free_mb?: number
}
interface Session { terminal_id: string; staff_name?: string; last_heartbeat?: string; started_at?: string }
interface Terminal { device_id: string; label?: string; active?: boolean; last_seen?: string }

function isRecent(ts?: string, mins = 5): boolean {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < mins * 60_000
}
function ago(ts?: string): string {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return `hace ${s}s`
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`
  return `hace ${Math.floor(s / 86400)}d`
}
function uptimeStr(sec?: number): string {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600); const d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`
}

export default function DevicesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [clientId, setClientId] = useState('')
  const [data, setData] = useState<{ heartbeats: Heartbeat[]; sessions: Session[]; terminals: Terminal[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/platform/tenants', { credentials: 'include' })
        if (res.status === 401 || res.status === 403) { setDenied(true); return }
        const j = await res.json().catch(() => ({}))
        const list: Tenant[] = Array.isArray(j.tenants) ? j.tenants : []
        setTenants(list); if (list[0]) setClientId(list[0].id)
      } catch { /* noop */ }
    })()
  }, [])

  const load = useCallback(async (cid: string) => {
    if (!cid) return
    setLoading(true); setData(null)
    try {
      const res = await fetch(`/api/platform/devices?clientId=${encodeURIComponent(cid)}`, { credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      setData({ heartbeats: j.heartbeats || [], sessions: j.sessions || [], terminals: j.terminals || [] })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (clientId) load(clientId) }, [clientId, load])

  if (denied) return (
    <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
      <AlertTriangle size={32} className="text-red-400" />
      <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
    </div>
  )

  const server = data?.heartbeats?.[0]
  const serverOnline = isRecent(server?.reported_at)
  const dot = (on: boolean) => <span className={`inline-block w-2 h-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-red-400'}`} />

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Cpu size={20} /></span>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--text-1)]">Arquitectura de hardware</h1>
          <p className="text-xs text-[var(--text-4)]">Topología de dispositivos por cliente — caja (Pedro), POS, KDS</p>
        </div>
        <button onClick={() => load(clientId)} className="w-9 h-9 rounded-lg border border-[var(--line)] grid place-items-center text-[var(--text-3)] hover:text-[var(--text-1)]"><RefreshCw size={14} /></button>
      </div>

      <select value={clientId} onChange={e => setClientId(e.target.value)}
        className="mb-5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
      </select>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-3)] text-sm py-12 justify-center"><Loader2 size={16} className="animate-spin" /> Cargando…</div>
      ) : (
        <div className="space-y-4">
          {/* Pedro / Local Server */}
          <div className={`rounded-2xl border p-5 ${serverOnline ? 'border-emerald-500/40' : 'border-[var(--line)]'} bg-[var(--surface)]`}>
            <div className="flex items-center gap-2 mb-3">
              <Server size={18} className="text-[var(--accent-bright)]" />
              <span className="font-bold text-[var(--text-1)]">Caja · Pedro (Local Server)</span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--text-3)]">{dot(serverOnline)} {serverOnline ? 'En línea' : 'Sin reporte'}</span>
            </div>
            {server ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Versión" value={server.version || '—'} />
                <Stat label="Terminales conectadas" value={String(server.clients_connected ?? '—')} />
                <Stat label="Cola de sync" value={String(server.sync_queue_size ?? '—')} warn={(server.sync_queue_size ?? 0) > 20} />
                <Stat label="Salud" value={server.health_status || '—'} warn={server.health_status !== 'ok'} />
                <Stat label="Uptime" value={uptimeStr(server.uptime_seconds)} />
                <Stat label="Plataforma" value={server.platform || '—'} />
                <Stat label="Disco libre" value={server.disk_free_mb != null ? `${Math.round(server.disk_free_mb / 1024)} GB` : '—'} />
                <Stat label="Último reporte" value={ago(server.reported_at)} />
              </div>
            ) : (
              <p className="text-sm text-[var(--text-4)]">Sin heartbeat. Pedro aún no reporta a la nube para este cliente (¿instalado? ¿reportando como cuenta local_server?).</p>
            )}
          </div>

          {/* Terminales activas (sesiones) */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2 mb-3"><Monitor size={16} className="text-[var(--text-2)]" /><span className="font-bold text-[var(--text-1)] text-sm">Terminales con sesión</span><span className="ml-auto text-xs text-[var(--text-4)]">{data?.sessions?.length ?? 0}</span></div>
            {data && data.sessions.length > 0 ? (
              <div className="space-y-1.5">
                {data.sessions.map(s => (
                  <div key={s.terminal_id} className="flex items-center gap-2 text-sm py-1.5 border-b border-[var(--line-soft)] last:border-0">
                    {dot(isRecent(s.last_heartbeat))}
                    <span className="font-mono text-[var(--text-2)] text-xs">{s.terminal_id.slice(0, 18)}</span>
                    <span className="text-[var(--text-1)]">{s.staff_name || '—'}</span>
                    <span className="ml-auto text-xs text-[var(--text-4)]">{ago(s.last_heartbeat)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[var(--text-4)]">Sin sesiones activas registradas.</p>}
          </div>

          {/* Terminales enroladas (pos_terminals) */}
          {data && data.terminals.length > 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-2 mb-3"><Monitor size={16} className="text-[var(--text-2)]" /><span className="font-bold text-[var(--text-1)] text-sm">Terminales enroladas</span></div>
              <div className="space-y-1.5">
                {data.terminals.map(t => (
                  <div key={t.device_id} className="flex items-center gap-2 text-sm py-1.5 border-b border-[var(--line-soft)] last:border-0">
                    {dot(!!t.active && isRecent(t.last_seen))}
                    <span className="text-[var(--text-1)]">{t.label || t.device_id}</span>
                    <span className="ml-auto text-xs text-[var(--text-4)]">{ago(t.last_seen)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-xs text-[var(--text-4)]">{label}</div>
      <div className={`font-medium ${warn ? 'text-amber-400' : 'text-[var(--text-1)]'}`}>{value}</div>
    </div>
  )
}
