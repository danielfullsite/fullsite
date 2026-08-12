'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Loader2, Save, Check, AlertTriangle, Eye, EyeOff } from 'lucide-react'

// Control Plane · Personal & PINs. El super-admin ve/edita los PINs del staff de
// cualquier tenant (via service_role, gateado). Los PINs no se muestran por default.
interface Tenant { id: string; name: string }
interface Staff { id: string; name: string; pin: string; role: string; role_display?: string; active: boolean }

export default function StaffPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [clientId, setClientId] = useState('')
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(false)
  const [showPins, setShowPins] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
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

  const loadStaff = useCallback(async (cid: string) => {
    if (!cid) return
    setLoading(true); setStaff([])
    try {
      const res = await fetch(`/api/platform/staff?client_id=${encodeURIComponent(cid)}`, { credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      setStaff(Array.isArray(j.staff) ? j.staff : [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (clientId) loadStaff(clientId) }, [clientId, loadStaff])

  function setField(id: string, field: 'pin' | 'name', value: string) {
    setStaff(s => s.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function save(row: Staff) {
    setSaving(row.id)
    try {
      const res = await fetch('/api/platform/staff', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, id: row.id, pin: row.pin, name: row.name, active: row.active }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) { setSaved(row.id); setTimeout(() => setSaved(null), 1500) }
      else alert(j.error || 'No se pudo guardar')
    } finally { setSaving(null) }
  }

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
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Users size={20} /></span>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--text-1)]">Personal &amp; PINs</h1>
          <p className="text-xs text-[var(--text-4)]">Ver y cambiar los PINs del staff de cualquier cliente</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={clientId} onChange={e => setClientId(e.target.value)}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
        <button onClick={() => setShowPins(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-2)] hover:text-[var(--text-1)]">
          {showPins ? <><EyeOff size={14} /> Ocultar PINs</> : <><Eye size={14} /> Mostrar PINs</>}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-[var(--text-4)]"><Loader2 size={20} className="animate-spin" /></div>
      ) : staff.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
          Este cliente no tiene personal registrado.
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
          {staff.map((row, i) => (
            <div key={row.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[var(--line)]' : ''} ${row.active ? '' : 'opacity-50'}`}>
              <input value={row.name} onChange={e => setField(row.id, 'name', e.target.value)}
                className="flex-1 min-w-[140px] bg-transparent text-sm font-medium text-[var(--text-1)] outline-none border-b border-transparent focus:border-[var(--line)]" />
              <span className="text-[11px] text-[var(--text-4)] w-24 truncate">{row.role_display || row.role}</span>
              <input value={row.pin} onChange={e => setField(row.id, 'pin', e.target.value.replace(/\D/g, ''))}
                type={showPins ? 'text' : 'password'} inputMode="numeric" maxLength={8} placeholder="PIN"
                className="w-20 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-center text-sm font-mono tracking-widest text-[var(--text-1)] outline-none focus:border-[var(--accent)]" />
              <button onClick={() => save(row)} disabled={saving === row.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[#04130d] disabled:opacity-50">
                {saving === row.id ? <Loader2 size={13} className="animate-spin" /> : saved === row.id ? <Check size={13} /> : <Save size={13} />}
                {saved === row.id ? 'Guardado' : 'Guardar'}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Los cambios quedan en la Bitácora (sin registrar el PIN en claro).</p>
    </div>
  )
}
