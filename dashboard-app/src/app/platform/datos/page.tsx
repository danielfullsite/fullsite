'use client'

import { useState, useEffect } from 'react'
import { Database, Download, FileJson, FileSpreadsheet, AlertTriangle } from 'lucide-react'

// Control Plane · Exportar datos. El super-admin baja los datos de cualquier
// cliente a CSV/JSON (via service_role, gateado). Sin depender de un dev.
interface Tenant { id: string; name: string }

const DATASETS = [
  { key: 'menu', label: 'Menú (platillos)' },
  { key: 'categorias', label: 'Categorías' },
  { key: 'personal', label: 'Personal & PINs' },
  { key: 'pagos', label: 'Métodos de pago' },
  { key: 'mesas', label: 'Mesas' },
  { key: 'ordenes', label: 'Órdenes (últimas 5,000)' },
]

export default function DatosPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [clientId, setClientId] = useState('')
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/platform/tenants', { credentials: 'include' })
        if (res.status === 401 || res.status === 403) { setDenied(true); return }
        const j = await res.json().catch(() => ({}))
        const list: Tenant[] = Array.isArray(j.tenants) ? j.tenants : []
        setTenants(list)
        if (list[0]) setClientId(list[0].id)
      } catch { /* noop */ }
    })()
  }, [])

  const url = (dataset: string, format: string) =>
    `/api/platform/export?client_id=${encodeURIComponent(clientId)}&dataset=${dataset}&format=${format}`

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Database size={20} /></span>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--text-1)]">Exportar datos</h1>
          <p className="text-xs text-[var(--text-4)]">Baja los datos de cualquier cliente a CSV o JSON</p>
        </div>
      </div>

      <select value={clientId} onChange={e => setClientId(e.target.value)}
        className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
      </select>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {DATASETS.map(d => (
          <div key={d.key} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <span className="flex-1 text-sm font-medium text-[var(--text-1)]">{d.label}</span>
            <a href={url(d.key, 'xls')} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"><FileSpreadsheet size={13} /> Excel</a>
            <a href={url(d.key, 'csv')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"><Download size={13} /> CSV</a>
            <a href={url(d.key, 'json')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"><FileJson size={13} /> JSON</a>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Cada descarga queda en la Bitácora. Import con validación viene después.</p>
    </div>
  )
}
