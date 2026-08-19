'use client'

// Control Plane · Provisionar terminales (Esqueleton clonable · Feature 1).
// Genera el config de una terminal (caja/POS/KDS) por cliente para instalar sin
// teclear: descargas el config.json (el wizard del Electron lo importa) o copias el
// deep-link/QR. Un solo instalador genérico + este config = terminal provisionada.

import { useState, useEffect } from 'react'
import { MonitorSmartphone, Loader2, Download, Copy, Check, AlertTriangle, ChefHat, Server, Monitor } from 'lucide-react'

interface Tenant { id: string; name: string }
type Role = 'server_pos' | 'pos' | 'kds' | 'admin'

const ROLE_OPTS: { value: Role; label: string; icon: typeof Server; needsBridge: boolean }[] = [
  { value: 'server_pos', label: 'Caja (servidor Pedro)', icon: Server, needsBridge: false },
  { value: 'pos', label: 'POS (mesero)', icon: Monitor, needsBridge: true },
  { value: 'kds', label: 'KDS (cocina)', icon: ChefHat, needsBridge: true },
  { value: 'admin', label: 'Admin', icon: MonitorSmartphone, needsBridge: false },
]

export default function TerminalesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [clientId, setClientId] = useState('')
  const [role, setRole] = useState<Role>('server_pos')
  const [name, setName] = useState('')
  const [bridgeHost, setBridgeHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ config: Record<string, unknown>; deepLink: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const needsBridge = ROLE_OPTS.find(r => r.value === role)?.needsBridge ?? false

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

  async function generate() {
    setBusy(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/platform/terminal-config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, role, name: name || undefined, bridgeHost: bridgeHost || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Error ${res.status}`); return }
      setResult({ config: j.config, deepLink: j.deepLink })
    } catch { setError('Error de red') } finally { setBusy(false) }
  }

  function downloadConfig() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'config.json'; a.click()
    URL.revokeObjectURL(url)
  }
  function copyLink() {
    if (!result) return
    navigator.clipboard?.writeText(result.deepLink)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  if (denied) return (
    <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
      <AlertTriangle size={32} className="text-red-400" />
      <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
    </div>
  )

  const input = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]'

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><MonitorSmartphone size={20} /></span>
        <div>
          <h1 className="text-xl font-bold text-[var(--text-1)]">Provisionar terminal</h1>
          <p className="text-xs text-[var(--text-4)]">Genera el config de una terminal por cliente — instala sin teclear</p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4">
        <div>
          <label className="block text-xs text-[var(--text-3)] mb-1.5">Cliente</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)} className={input}>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--text-3)] mb-1.5">Tipo de terminal</label>
          <div className="grid grid-cols-2 gap-2">
            {ROLE_OPTS.map(o => {
              const Icon = o.icon
              return (
                <button key={o.value} onClick={() => setRole(o.value)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${role === o.value ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-1)]' : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)]'}`}>
                  <Icon size={15} /> {o.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs text-[var(--text-3)] mb-1.5">Nombre (opcional)</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="ej. Caja Principal" className={input} />
        </div>

        {needsBridge && (
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1.5">IP de la caja (Pedro) en la LAN</label>
            <input value={bridgeHost} onChange={e => setBridgeHost(e.target.value)} placeholder="ej. 192.168.1.71" className={`${input} font-mono`} />
            <p className="text-xs text-[var(--text-4)] mt-1">Requerida para POS y KDS — es la IP de la máquina que corre Pedro (la caja).</p>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2">{error}</div>}

        <button onClick={generate} disabled={busy || !clientId} className="w-full rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-medium py-2.5 text-sm disabled:opacity-40 inline-flex items-center justify-center gap-2">
          {busy ? <><Loader2 size={15} className="animate-spin" /> Generando…</> : 'Generar config'}
        </button>
      </div>

      {result && (
        <div className="mt-4 rounded-2xl border border-[var(--accent)]/40 bg-[var(--surface)] p-5 space-y-4">
          <div className="flex items-center gap-2 text-[var(--accent-bright)] font-bold"><Check size={18} /> Config lista</div>
          <div className="flex gap-2">
            <button onClick={downloadConfig} className="flex-1 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-medium py-2.5 text-sm inline-flex items-center justify-center gap-2"><Download size={15} /> Descargar config.json</button>
            <button onClick={copyLink} className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-1)] font-medium py-2.5 text-sm inline-flex items-center justify-center gap-2">{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar deep-link</>}</button>
          </div>
          <p className="text-xs text-[var(--text-4)]">
            En la terminal: instala el app genérico → en el wizard usa <b>Importar config</b> con este archivo (o pega el deep-link). Queda provisionada, sin teclear.
          </p>
          <pre className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-3 text-xs text-[var(--text-2)] overflow-x-auto font-mono">{JSON.stringify(result.config, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
