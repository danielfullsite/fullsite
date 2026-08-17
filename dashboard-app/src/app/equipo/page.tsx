'use client'

// A2a — Equipo / Personal. El dueño (y gerente) gestiona su staff POS + PINs desde
// el dashboard. Escribe vía el endpoint server-side /api/owner/staff (service_role,
// gateado por rol, scopeado al client_id del caller). Same-origin envía la cookie
// fs-at → withPOSAuth resuelve el tenant. Ver /api/owner/staff/route.ts.

import { useState, useEffect } from 'react'
import { RefreshCw, Plus, Pencil, Eye, EyeOff, UserPlus, X, Check, Ban } from 'lucide-react'

interface Staff {
  id: string; name: string; pin: string; role: string; role_display: string | null
  active: boolean; hourly_rate: number | null; weekly_salary: number | null
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', gerente: 'Gerente', capitan: 'Capitán',
  cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra',
}
const BASE_ROLES = ['mesero', 'cajero', 'cocina', 'barra', 'capitan']
const ELEVATED_ROLES = ['gerente', 'admin']

function roleTint(role: string): string {
  switch (role) {
    case 'admin': return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'gerente': return 'bg-violet-500/15 text-violet-300 border-violet-500/30'
    case 'capitan': return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'cajero': return 'bg-sky-500/15 text-sky-300 border-sky-500/30'
    default: return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  }
}

type FormState = { id?: string; name: string; pin: string; role: string; hourly_rate: string; weekly_salary: string }
const EMPTY_FORM: FormState = { name: '', pin: '', role: 'mesero', hourly_rate: '', weekly_salary: '' }

export default function EquipoPage() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [callerRole, setCallerRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canElevate = callerRole === 'dueño' || callerRole === 'admin'
  const roleOptions = canElevate ? [...BASE_ROLES, ...ELEVATED_ROLES] : BASE_ROLES

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/owner/staff', { credentials: 'same-origin', cache: 'no-store' })
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      const data = await res.json()
      setStaff(Array.isArray(data.staff) ? data.staff : [])
      setCallerRole(data.callerRole || '')
    } catch { setError('No se pudo cargar el equipo') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function submit() {
    if (!form) return
    setSaving(true); setError('')
    const isEdit = !!form.id
    const body: Record<string, unknown> = {
      name: form.name, role: form.role,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : 0,
      weekly_salary: form.weekly_salary ? Number(form.weekly_salary) : 0,
    }
    if (form.pin) body.pin = form.pin
    if (isEdit) body.id = form.id
    try {
      const res = await fetch('/api/owner/staff', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Error ${res.status}`); setSaving(false); return }
      setForm(null); setSaving(false); await load()
    } catch { setError('Error de red'); setSaving(false) }
  }

  async function toggleActive(s: Staff) {
    await fetch('/api/owner/staff', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ id: s.id, active: !s.active }),
    })
    await load()
  }

  if (forbidden) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <Ban size={32} className="mx-auto mb-4 text-[var(--text-3)]" />
        <h2 className="text-lg font-bold text-[var(--text-1)]">Acceso restringido</h2>
        <p className="text-sm text-[var(--text-3)] mt-1">La gestión del equipo es para el dueño o gerente del restaurante.</p>
      </div>
    )
  }

  const active = staff.filter(s => s.active)
  const inactive = staff.filter(s => !s.active)

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Equipo</h2>
          <p className="text-sm text-[var(--text-3)]">{active.length} activos{inactive.length ? ` · ${inactive.length} inactivos` : ''} · PINs de acceso al POS</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="w-10 h-10 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => { setForm({ ...EMPTY_FORM }); setError('') }}
            className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-medium flex items-center gap-1.5">
            <UserPlus size={14} /> Agregar
          </button>
        </div>
      </div>

      {error && !form && <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="text-[var(--text-3)] text-sm py-12 text-center">Cargando…</div>
      ) : (
        <div className="border border-[var(--line)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface-2)] text-[var(--text-3)] text-xs uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-3">Nombre</th>
                <th className="text-left font-medium px-4 py-3">Rol</th>
                <th className="text-left font-medium px-4 py-3">PIN</th>
                <th className="text-left font-medium px-4 py-3">Estado</th>
                <th className="text-right font-medium px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id} className={`border-t border-[var(--line)] ${s.active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3 text-[var(--text-1)] font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-medium ${roleTint(s.role)}`}>
                      {ROLE_LABELS[s.role] || s.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--text-2)]">
                    <button onClick={() => setRevealed(p => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })}
                      className="inline-flex items-center gap-1.5 hover:text-[var(--text-1)]">
                      {revealed.has(s.id) ? s.pin : '••••'}
                      {revealed.has(s.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${s.active ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>{s.active ? 'Activo' : 'Inactivo'}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setForm({ id: s.id, name: s.name, pin: '', role: s.role, hourly_rate: s.hourly_rate ? String(s.hourly_rate) : '', weekly_salary: s.weekly_salary ? String(s.weekly_salary) : '' }); setError('') }}
                      className="px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 text-xs">
                      <Pencil size={12} /> Editar
                    </button>
                    <button onClick={() => toggleActive(s)}
                      className={`px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] inline-flex items-center gap-1 text-xs ${s.active ? 'text-red-400' : 'text-emerald-400'}`}>
                      {s.active ? <><Ban size={12} /> Desactivar</> : <><Check size={12} /> Activar</>}
                    </button>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-[var(--text-3)]">Aún no hay personal. Agrega el primero.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal alta/edición */}
      {form && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setForm(null)}>
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-[var(--text-1)]">{form.id ? 'Editar miembro' : 'Nuevo miembro'}</h3>
              <button onClick={() => setForm(null)} className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]"><X size={16} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1.5">Nombre</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1.5">PIN {form.id && <span className="text-[var(--text-4)]">(dejar vacío = sin cambio)</span>}</label>
                  <input value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                    inputMode="numeric" placeholder={form.id ? '••••' : '3–8 dígitos'}
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] font-mono text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1.5">Rol</label>
                  <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500">
                    {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1.5">Pago/hora (opcional)</label>
                  <input value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: e.target.value })} inputMode="decimal"
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-3)] mb-1.5">Sueldo/semana (opcional)</label>
                  <input value={form.weekly_salary} onChange={e => setForm({ ...form, weekly_salary: e.target.value })} inputMode="decimal"
                    className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setForm(null)} className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)]">Cancelar</button>
              <button onClick={submit} disabled={saving || !form.name.trim() || (!form.id && !form.pin)}
                className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 flex items-center justify-center gap-1.5">
                {saving ? 'Guardando…' : <><Check size={14} /> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
