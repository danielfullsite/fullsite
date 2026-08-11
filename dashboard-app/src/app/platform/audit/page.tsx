'use client'

import { useEffect, useState } from 'react'
import { ScrollText, RefreshCw, AlertTriangle } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

// Control Plane · /platform/audit — bitácora append-only de platform_audit_log.
// Lectura vía /api/platform/audit (admin-gated + service_role). Solo lectura.

interface AuditEntry {
  actor_email: string
  actor_user_id: string
  action: string
  scope: string
  target_tenant: string | null
  detail: unknown
  affected_count: number | null
  created_at: string
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

const ACTION_COLOR: Record<string, string> = {
  'flag.update': 'text-blue-500 bg-blue-500/10',
  'setting.update': 'text-violet-500 bg-violet-500/10',
  'announcement.push': 'text-amber-500 bg-amber-500/10',
  'tenant.create': 'text-emerald-500 bg-emerald-500/10',
  'tenant.toggle': 'text-cyan-500 bg-cyan-500/10',
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState(false)

  async function load() {
    setLoading(true); setDenied(false); setError(false)
    try {
      const res = await fetch('/api/platform/audit', { credentials: 'include' })
      if (res.status === 401 || res.status === 403) { setDenied(true); return }
      if (!res.ok) { setError(true); return }
      const json = await res.json()
      setEntries(Array.isArray(json.entries) ? json.entries : [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <PageHeader title="Bitácora de auditoría" subtitle="Toda acción cross-tenant queda registrada (append-only)" eyebrow="CONTROL GLOBAL" />
        <button onClick={load} className="p-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors" aria-label="Refrescar">
          <RefreshCw size={16} />
        </button>
      </div>

      {denied ? (
        <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
          <AlertTriangle size={32} className="text-red-400" />
          <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
          <p className="text-sm text-[var(--text-3)]">Solo administradores de plataforma.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
            <ScrollText size={15} className="text-[var(--accent-bright)]" />
            <b className="text-sm text-[var(--text-1)]">Últimos 200 eventos</b>
            <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">{entries.length} registros</span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--text-2)]">
              Error cargando la bitácora. <button onClick={load} className="underline text-[var(--accent-bright)]">Reintentar</button>
            </div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">Sin eventos registrados aún.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    {['Fecha', 'Actor', 'Acción', 'Scope', 'Tenant', 'Detalle', 'N afectados'].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)] font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i} className="border-t border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors align-top">
                      <td className="px-4 py-2.5 text-[var(--text-3)] tabular-nums whitespace-nowrap text-xs">{fmtDate(e.created_at)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-2)] whitespace-nowrap">{e.actor_email || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${ACTION_COLOR[e.action] || 'text-[var(--text-3)] bg-[var(--surface-2)]'}`}>{e.action}</span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">{e.scope}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-3)]">{e.target_tenant || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--text-4)] max-w-xs truncate" title={e.detail ? JSON.stringify(e.detail) : ''}>
                        {e.detail ? JSON.stringify(e.detail) : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-[var(--text-2)] text-right">{e.affected_count ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
