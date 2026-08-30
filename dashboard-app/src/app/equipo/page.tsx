'use client'

// A2 — Equipo. Dos pestañas:
//  · Personal (POS): staff + PINs → /api/owner/staff (A2a)
//  · Accesos al dashboard: usuarios auth.users + rol → /api/owner/users (A2b Fase 1)
// Ambos endpoints son server-side (service_role), gateados por rol, scopeados al
// client_id del caller, y blindados (sameOriginOnly). Same-origin envía la cookie
// fs-at → withPOSAuth resuelve el tenant.

import { useState, useEffect } from 'react'
import { RefreshCw, Pencil, Eye, EyeOff, UserPlus, X, Check, Ban, KeyRound, Copy, Trash2, Shield } from 'lucide-react'

interface Staff {
  id: string; name: string; pin: string; role: string; role_display: string | null
  active: boolean; hourly_rate: number | null; weekly_salary: number | null
}
interface DashUser { user_id: string; email: string; role: string; display_name: string }

const ROLE_LABELS: Record<string, string> = {
  dueño: 'Dueño', admin: 'Admin', gerente: 'Gerente', capitan: 'Capitán',
  cajero: 'Cajero', mesero: 'Mesero', cocina: 'Cocina', barra: 'Barra',
}
const STAFF_BASE = ['mesero', 'cajero', 'cocina', 'barra', 'capitan']
const STAFF_ELEVATED = ['gerente', 'admin']
const DASH_ROLES = ['gerente', 'capitan', 'cajero', 'mesero', 'dueño']

function roleTint(role: string): string {
  switch (role) {
    case 'dueño': case 'admin': return 'bg-red-500/15 text-red-400 border-red-500/30'
    case 'gerente': return 'bg-violet-500/15 text-violet-300 border-violet-500/30'
    case 'capitan': return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'cajero': return 'bg-sky-500/15 text-sky-300 border-sky-500/30'
    default: return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  }
}
const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-2.5 text-[var(--text-1)] text-sm focus:outline-none focus:border-emerald-500'

type StaffForm = { id?: string; name: string; pin: string; role: string; hourly_rate: string; weekly_salary: string }
const EMPTY_STAFF: StaffForm = { name: '', pin: '', role: 'mesero', hourly_rate: '', weekly_salary: '' }

export default function EquipoPage() {
  const [tab, setTab] = useState<'staff' | 'users'>('staff')
  const [callerRole, setCallerRole] = useState('')
  const [forbidden, setForbidden] = useState(false)

  // Personal POS
  const [staff, setStaff] = useState<Staff[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [sForm, setSForm] = useState<StaffForm | null>(null)
  // OP-42 — tras alta rápida, mostrar el PIN una vez para que el gerente lo anote.
  const [justCreated, setJustCreated] = useState<{ name: string; pin: string; generated: boolean } | null>(null)

  // Usuarios dashboard
  const [users, setUsers] = useState<DashUser[]>([])
  const [usersAllowed, setUsersAllowed] = useState(false)
  const [invite, setInvite] = useState<{ email: string; name: string; role: string } | null>(null)
  const [tempCred, setTempCred] = useState<{ email: string; pass: string } | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [permsFor, setPermsFor] = useState<DashUser | null>(null)

  const canElevate = callerRole === 'dueño' || callerRole === 'admin'
  const staffRoleOptions = canElevate ? [...STAFF_BASE, ...STAFF_ELEVATED] : STAFF_BASE

  async function loadStaff() {
    const res = await fetch('/api/owner/staff', { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 403) { setForbidden(true); return }
    const data = await res.json()
    setStaff(Array.isArray(data.staff) ? data.staff : [])
    setCallerRole(data.callerRole || '')
  }
  async function loadUsers() {
    const res = await fetch('/api/owner/users', { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 403) { setUsersAllowed(false); return }
    const data = await res.json()
    setUsers(Array.isArray(data.users) ? data.users : [])
    setUsersAllowed(true)
  }
  async function loadAll() {
    setLoading(true); setError('')
    try { await Promise.all([loadStaff(), loadUsers()]) } catch { setError('No se pudo cargar') }
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  // ── Personal POS ──
  async function submitStaff() {
    if (!sForm) return
    setSaving(true); setError('')
    const isEdit = !!sForm.id
    const body: Record<string, unknown> = {
      name: sForm.name, role: sForm.role,
      hourly_rate: sForm.hourly_rate ? Number(sForm.hourly_rate) : 0,
      weekly_salary: sForm.weekly_salary ? Number(sForm.weekly_salary) : 0,
    }
    if (sForm.pin) body.pin = sForm.pin
    if (isEdit) body.id = sForm.id
    const res = await fetch('/api/owner/staff', {
      method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(data.error || `Error ${res.status}`); return }
    // Alta nueva: mostrar el PIN una vez (sobre todo si fue autogenerado).
    if (!isEdit && data.pin) setJustCreated({ name: sForm.name.trim(), pin: String(data.pin), generated: !!data.pinGenerated })
    setSForm(null); await loadStaff()
  }
  async function toggleStaff(s: Staff) {
    await fetch('/api/owner/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ id: s.id, active: !s.active }) })
    await loadStaff()
  }

  // ── Usuarios dashboard ──
  async function submitInvite() {
    if (!invite) return
    setSaving(true); setError('')
    const res = await fetch('/api/owner/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(invite),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setError(data.error || `Error ${res.status}`); return }
    setInvite(null); setTempCred({ email: data.email, pass: data.tempPassword }); await loadUsers()
  }
  async function resetPass(u: DashUser) {
    const res = await fetch('/api/owner/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ user_id: u.user_id, reset_password: true }) })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.tempPassword) setTempCred({ email: u.email, pass: data.tempPassword })
    else setError(data.error || 'No se pudo resetear')
  }
  async function removeUser(u: DashUser) {
    await fetch(`/api/owner/users?user_id=${encodeURIComponent(u.user_id)}`, { method: 'DELETE', credentials: 'same-origin' })
    await loadUsers()
  }
  async function changeUserRole(u: DashUser, role: string) {
    await fetch('/api/owner/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ user_id: u.user_id, role }) })
    await loadUsers()
  }

  if (forbidden) return (
    <div className="max-w-md mx-auto mt-20 text-center">
      <Ban size={32} className="mx-auto mb-4 text-[var(--text-3)]" />
      <h2 className="text-lg font-bold text-[var(--text-1)]">Acceso restringido</h2>
      <p className="text-sm text-[var(--text-3)] mt-1">La gestión del equipo es para el dueño o gerente del restaurante.</p>
    </div>
  )

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Equipo</h2>
          <p className="text-sm text-[var(--text-3)]">Personal del POS y accesos al dashboard</p>
        </div>
        <button onClick={loadAll} className="w-10 h-10 rounded-lg border border-[var(--line)] hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]"><RefreshCw size={14} /></button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--line)]">
        {([['staff', 'Personal (POS)'], ['users', 'Accesos al dashboard']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setError('') }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-emerald-500 text-[var(--text-1)]' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && !sForm && !invite && <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
      {loading && <div className="text-[var(--text-3)] text-sm py-12 text-center">Cargando…</div>}

      {/* ── PERSONAL POS ── */}
      {!loading && tab === 'staff' && (
        <>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-[var(--text-3)]">{staff.filter(s => s.active).length} activos · entran al POS con PIN</span>
            <button onClick={() => { setSForm({ ...EMPTY_STAFF }); setError('') }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-medium flex items-center gap-1.5"><UserPlus size={14} /> Agregar</button>
          </div>
          <div className="border border-[var(--line)] rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="bg-[var(--surface-2)] text-[var(--text-3)] text-xs uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-3">Nombre</th><th className="text-left font-medium px-4 py-3">Rol</th>
                <th className="text-left font-medium px-4 py-3">PIN</th><th className="text-left font-medium px-4 py-3">Estado</th>
                <th className="text-right font-medium px-4 py-3">Acciones</th></tr></thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className={`border-t border-[var(--line)] ${s.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-3 text-[var(--text-1)] font-medium">{s.name}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-medium ${roleTint(s.role)}`}>{ROLE_LABELS[s.role] || s.role}</span></td>
                    <td className="px-4 py-3 font-mono text-[var(--text-2)]">
                      <button onClick={() => setRevealed(p => { const n = new Set(p); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })} className="inline-flex items-center gap-1.5 hover:text-[var(--text-1)]">
                        {revealed.has(s.id) ? s.pin : '••••'}{revealed.has(s.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs ${s.active ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>{s.active ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => { setSForm({ id: s.id, name: s.name, pin: '', role: s.role, hourly_rate: s.hourly_rate ? String(s.hourly_rate) : '', weekly_salary: s.weekly_salary ? String(s.weekly_salary) : '' }); setError('') }} className="px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 text-xs"><Pencil size={12} /> Editar</button>
                      <button onClick={() => toggleStaff(s)} className={`px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] inline-flex items-center gap-1 text-xs ${s.active ? 'text-red-400' : 'text-emerald-400'}`}>{s.active ? <><Ban size={12} /> Desactivar</> : <><Check size={12} /> Activar</>}</button>
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-[var(--text-3)]">Aún no hay personal.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── ACCESOS DASHBOARD ── */}
      {!loading && tab === 'users' && (
        !usersAllowed ? (
          <div className="text-center py-16 text-[var(--text-3)] text-sm"><Shield size={28} className="mx-auto mb-3" />Solo el dueño puede gestionar accesos al dashboard.</div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-[var(--text-3)]">{users.length} con acceso · entran a app.fullsite.mx con correo</span>
              <button onClick={() => { setInvite({ email: '', name: '', role: 'gerente' }); setError('') }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm text-white font-medium flex items-center gap-1.5"><UserPlus size={14} /> Dar acceso</button>
            </div>
            <div className="border border-[var(--line)] rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="bg-[var(--surface-2)] text-[var(--text-3)] text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-4 py-3">Correo</th><th className="text-left font-medium px-4 py-3">Nombre</th>
                  <th className="text-left font-medium px-4 py-3">Rol</th><th className="text-right font-medium px-4 py-3">Acciones</th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.user_id} className="border-t border-[var(--line)]">
                      <td className="px-4 py-3 text-[var(--text-1)] font-medium">{u.email}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{u.display_name || '—'}</td>
                      <td className="px-4 py-3">
                        <select value={DASH_ROLES.includes(u.role) ? u.role : ''} onChange={e => changeUserRole(u, e.target.value)}
                          className={`px-2 py-1 rounded-md border text-xs font-medium bg-transparent ${roleTint(u.role)}`}>
                          {!DASH_ROLES.includes(u.role) && <option value="">{ROLE_LABELS[u.role] || u.role}</option>}
                          {DASH_ROLES.map(r => <option key={r} value={r} className="text-black">{ROLE_LABELS[r]}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => setPermsFor(u)} className="px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 text-xs"><Shield size={12} /> Permisos</button>
                        <button onClick={() => resetPass(u)} className="px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 text-xs"><KeyRound size={12} /> Reset</button>
                        <button onClick={() => removeUser(u)} className="px-2 py-1.5 rounded-md hover:bg-[var(--surface-2)] text-red-400 inline-flex items-center gap-1 text-xs"><Trash2 size={12} /> Quitar</button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-[var(--text-3)]">Nadie más tiene acceso al dashboard.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {/* Modal staff */}
      {sForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setSForm(null)}>
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5"><h3 className="text-lg font-bold text-[var(--text-1)]">{sForm.id ? 'Editar miembro' : 'Nuevo miembro'}</h3><button onClick={() => setSForm(null)} className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]"><X size={16} /></button></div>
            <div className="space-y-4">
              <div><label className="block text-xs text-[var(--text-3)] mb-1.5">Nombre</label><input value={sForm.name} onChange={e => setSForm({ ...sForm, name: e.target.value })} className={inputCls} /></div>
              <div className="flex gap-3">
                <div className="flex-1"><label className="block text-xs text-[var(--text-3)] mb-1.5">PIN {sForm.id ? <span className="text-[var(--text-4)]">(vacío = sin cambio)</span> : <span className="text-[var(--text-4)]">(opcional — vacío = automático)</span>}</label><input value={sForm.pin} onChange={e => setSForm({ ...sForm, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" placeholder={sForm.id ? '••••' : 'vacío = automático'} className={`${inputCls} font-mono`} /></div>
                <div className="flex-1"><label className="block text-xs text-[var(--text-3)] mb-1.5">Rol</label><select value={sForm.role} onChange={e => setSForm({ ...sForm, role: e.target.value })} className={inputCls}>{staffRoleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}</select></div>
              </div>
              {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
            </div>
            <div className="flex gap-2 mt-6"><button onClick={() => setSForm(null)} className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)]">Cancelar</button><button onClick={submitStaff} disabled={saving || !sForm.name.trim()} className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 flex items-center justify-center gap-1.5">{saving ? 'Guardando…' : <><Check size={14} /> Guardar</>}</button></div>
          </div>
        </div>
      )}

      {/* OP-42 — confirmación de alta: muestra el PIN una vez para anotarlo */}
      {justCreated && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setJustCreated(null)}>
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><Check size={24} className="text-emerald-400" /></div>
            <h3 className="text-lg font-bold text-[var(--text-1)] mb-1">{justCreated.name} ya puede entrar al POS</h3>
            <p className="text-sm text-[var(--text-3)] mb-4">{justCreated.generated ? 'PIN generado automáticamente' : 'PIN asignado'} — anótalo, no se vuelve a mostrar así.</p>
            <div className="flex items-center justify-center gap-2 mb-5">
              <span className="text-4xl font-mono font-bold tracking-[0.3em] text-[var(--text-1)] bg-[var(--surface-2)] rounded-xl px-6 py-3">{justCreated.pin}</span>
              <button onClick={() => navigator.clipboard?.writeText(justCreated.pin).catch(() => {})} className="w-11 h-11 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)]" title="Copiar PIN"><Copy size={16} /></button>
            </div>
            <button onClick={() => setJustCreated(null)} className="w-full py-2.5 rounded-xl text-sm text-white font-medium bg-emerald-600 hover:bg-emerald-500">Listo</button>
          </div>
        </div>
      )}

      {/* Modal invitar usuario dashboard */}
      {invite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setInvite(null)}>
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5"><h3 className="text-lg font-bold text-[var(--text-1)]">Dar acceso al dashboard</h3><button onClick={() => setInvite(null)} className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]"><X size={16} /></button></div>
            <div className="space-y-4">
              <div><label className="block text-xs text-[var(--text-3)] mb-1.5">Correo</label><input value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} type="email" placeholder="persona@correo.com" className={inputCls} /></div>
              <div className="flex gap-3">
                <div className="flex-1"><label className="block text-xs text-[var(--text-3)] mb-1.5">Nombre</label><input value={invite.name} onChange={e => setInvite({ ...invite, name: e.target.value })} className={inputCls} /></div>
                <div className="flex-1"><label className="block text-xs text-[var(--text-3)] mb-1.5">Rol</label><select value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })} className={inputCls}>{DASH_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
              </div>
              <p className="text-xs text-[var(--text-3)]">Se generará una contraseña temporal que verás una vez, para compartírsela. La cambia al entrar.</p>
              {error && <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
            </div>
            <div className="flex gap-2 mt-6"><button onClick={() => setInvite(null)} className="flex-1 py-2.5 rounded-xl text-sm text-[var(--text-3)] hover:bg-[var(--surface-2)]">Cancelar</button><button onClick={submitInvite} disabled={saving || !invite.email.trim() || !invite.name.trim()} className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 flex items-center justify-center gap-1.5">{saving ? 'Creando…' : <><Check size={14} /> Crear acceso</>}</button></div>
          </div>
        </div>
      )}

      {/* Credencial temporal (mostrada una vez) */}
      {tempCred && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTempCred(null)}>
          <div className="bg-[var(--surface)] border border-emerald-500/40 rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4 text-emerald-400"><KeyRound size={18} /><h3 className="text-lg font-bold">Contraseña temporal</h3></div>
            <p className="text-sm text-[var(--text-3)] mb-4">Compártela con <b className="text-[var(--text-1)]">{tempCred.email}</b>. Solo se muestra una vez; la cambiará al entrar.</p>
            <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--line)] rounded-lg px-3 py-3 mb-5">
              <code className="flex-1 font-mono text-[var(--text-1)] text-base break-all">{tempCred.pass}</code>
              <button onClick={() => navigator.clipboard?.writeText(tempCred.pass)} className="p-2 rounded-md hover:bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text-1)]"><Copy size={15} /></button>
            </div>
            <button onClick={() => setTempCred(null)} className="w-full py-2.5 rounded-xl text-sm text-white font-medium bg-emerald-600 hover:bg-emerald-500">Ya la copié</button>
          </div>
        </div>
      )}

      {permsFor && <PermissionsModal user={permsFor} onClose={() => setPermsFor(null)} onSaved={() => { setPermsFor(null) }} />}
    </>
  )
}

// ─── Modal de permisos por empleado ──────────────────────────────────────────
const PERM_SECTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'operacion', label: 'Operación', hint: 'Ventas, meseros, platillos, tendencias, reportes' },
  { key: 'finanzas', label: 'Finanzas', hint: 'Estado de resultados, nómina, ingresos, ROI' },
  { key: 'inventario', label: 'Inventario', hint: 'Existencias, compras, recepción, merma' },
  { key: 'cortes', label: 'Cortes y caja', hint: 'Cortes, control de efectivo, conciliación' },
  { key: 'agentes', label: 'Agentes IA', hint: 'Agentes, coach, chat' },
  { key: 'pos', label: 'Punto de venta', hint: 'Acceso al POS' },
  { key: 'admin', label: 'Administración', hint: 'Configuración y gestión del equipo' },
]

function PermissionsModal({ user, onClose, onSaved }: { user: DashUser; onClose: () => void; onSaved: () => void }) {
  const [sections, setSections] = useState<Record<string, boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/owner/permissions', { credentials: 'same-origin', cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        const row = (data.permissions || []).find((p: { staff_id: string }) => p.staff_id === user.user_id)
        if (!alive) return
        if (row?.sections && Object.keys(row.sections).length > 0) {
          setSections(row.sections)
        } else {
          // Sin override guardado → precargar con el default del rol (para que el
          // dueño parta de lo que hoy ve esa persona y solo ajuste).
          const { defaultSectionsForRole } = await import('@/lib/roles')
          const role = (user.role === 'admin' ? 'dueño' : user.role) as Parameters<typeof defaultSectionsForRole>[0]
          setSections(defaultSectionsForRole(role))
        }
      } catch { if (alive) setSections({}) }
    })()
    return () => { alive = false }
  }, [user])

  async function save(clear = false) {
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/owner/permissions', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: user.user_id, sections: clear ? null : sections }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.error || 'No se pudo guardar'); return }
      onSaved()
    } catch { setErr('Error de red') } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center gap-3">
          <Shield size={18} className="text-[var(--accent-bright)]" />
          <div><div className="font-bold text-[var(--text-1)]">Permisos</div><div className="text-[11px] text-[var(--text-3)]">{user.display_name || user.email}</div></div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text-1)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-[11px] text-[var(--text-4)] mb-3">Lo que apagues aquí desaparece de su menú y de su acceso. No puede darle más de lo que su rol permite.</p>
          {sections === null ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-[var(--text-3)] border-t-transparent rounded-full animate-spin" /></div>
          ) : PERM_SECTIONS.map(s => (
            <label key={s.key} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-2)] cursor-pointer">
              <input type="checkbox" checked={sections[s.key] === true}
                onChange={e => setSections(prev => ({ ...(prev || {}), [s.key]: e.target.checked }))}
                className="w-4 h-4 accent-[var(--accent)]" />
              <div className="min-w-0">
                <div className="text-sm text-[var(--text-1)]">{s.label}</div>
                <div className="text-[11px] text-[var(--text-4)] truncate">{s.hint}</div>
              </div>
            </label>
          ))}
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={() => save(true)} disabled={busy} className="px-3 py-2.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text-3)] hover:text-[var(--text-1)] disabled:opacity-50">Usar rol por defecto</button>
            <button onClick={() => save(false)} disabled={busy || sections === null} className="flex-1 py-2.5 rounded-lg bg-[var(--accent)] text-[#04120c] font-bold disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar permisos'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
