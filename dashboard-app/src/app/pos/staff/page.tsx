'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  UserPlus,
  Edit,
  Shield,
  Search,
  ChevronDown,
  ChevronUp,
  X,
  ToggleLeft,
  ToggleRight,
  Clock,
  Users,
  AlertTriangle,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _cid(): string {
  try {
    return localStorage.getItem('fullsite_client_id') || 'amalay'
  } catch {
    return 'amalay'
  }
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function sbHeaders() {
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

interface StaffMember {
  id: string
  client_id: string
  name: string
  pin: string
  role: string
  active: boolean
  created_at: string
}

interface AuditEntry {
  id: string
  client_id: string
  staff_id: string
  action: string
  changed_fields: Record<string, unknown> | null
  changed_by: string
  created_at: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  gerente: 'Gerente',
  capitan: 'Capitan',
  cajero: 'Cajero',
  mesero: 'Mesero',
  cocina: 'Cocina',
  barra: 'Barra',
}

const CREATABLE_ROLES = ['mesero', 'cajero', 'cocina', 'barra', 'capitan']

const ROLE_COLORS: Record<string, string> = {
  admin: 'text-amber-400',
  gerente: 'text-purple-400',
  capitan: 'text-blue-400',
  cajero: 'text-cyan-400',
  mesero: 'text-emerald-400',
  cocina: 'text-orange-400',
  barra: 'text-pink-400',
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StaffPage() {
  // Auth
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [currentStaff, setCurrentStaff] = useState<StaffMember | null>(null)

  // Data
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<'name' | 'role'>('name')
  const [sortAsc, setSortAsc] = useState(true)

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<StaffMember | null>(null)

  // Audit panel
  const [showAudit, setShowAudit] = useState(false)

  // Form state
  const [formName, setFormName] = useState('')
  const [formPin, setFormPin] = useState('')
  const [formNewPin, setFormNewPin] = useState('')
  const [formRole, setFormRole] = useState('mesero')
  const [formActive, setFormActive] = useState(true)
  const [formError, setFormError] = useState('')
  const [formSaving, setFormSaving] = useState(false)

  // ------ Auth check ------
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pos_staff')
      if (raw) {
        const parsed = JSON.parse(raw) as StaffMember
        if (parsed.role === 'admin' || parsed.role === 'gerente') {
          setCurrentStaff(parsed)
          setAuthorized(true)
          return
        }
      }
    } catch { /* ignore */ }
    setAuthorized(false)
  }, [])

  // ------ Fetch data ------
  const fetchStaff = useCallback(async () => {
    const cid = _cid()
    const res = await fetch(
      `${SB_URL}/rest/v1/pos_staff?client_id=eq.${cid}&select=id,name,role,active,created_at&order=name.asc`,
      { headers: sbHeaders() },
    )
    if (res.ok) {
      const data = await res.json()
      setStaff(data)
    }
  }, [])

  const fetchAudit = useCallback(async () => {
    const cid = _cid()
    const res = await fetch(
      `${SB_URL}/rest/v1/pos_staff_audit?client_id=eq.${cid}&select=*&order=created_at.desc&limit=50`,
      { headers: sbHeaders() },
    )
    if (res.ok) {
      setAudit(await res.json())
    }
  }, [])

  useEffect(() => {
    if (!authorized) return
    setLoading(true)
    Promise.all([fetchStaff(), fetchAudit()]).finally(() => setLoading(false))
  }, [authorized, fetchStaff, fetchAudit])

  // ------ PIN uniqueness check ------
  async function isPinTaken(pin: string, excludeId?: string): Promise<boolean> {
    const cid = _cid()
    let url = `${SB_URL}/rest/v1/pos_staff?pin=eq.${pin}&client_id=eq.${cid}&select=id&limit=1`
    if (excludeId) url += `&id=neq.${excludeId}`
    const res = await fetch(url, { headers: sbHeaders() })
    if (!res.ok) return false
    const data = await res.json()
    return data.length > 0
  }

  // ------ Audit helper ------
  async function postAudit(staffId: string, action: string, changedFields?: Record<string, unknown>) {
    const cid = _cid()
    await fetch(`${SB_URL}/rest/v1/pos_staff_audit`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({
        client_id: cid,
        staff_id: staffId,
        action,
        changed_fields: changedFields || null,
        changed_by: currentStaff?.name || 'unknown',
      }),
    })
  }

  // ------ Create ------
  async function handleCreate() {
    setFormError('')
    if (!formName.trim()) { setFormError('Nombre es requerido'); return }
    if (!formPin || formPin.length < 4 || formPin.length > 8 || !/^\d+$/.test(formPin)) {
      setFormError('PIN debe ser de 4 a 8 digitos')
      return
    }
    setFormSaving(true)
    if (await isPinTaken(formPin)) {
      setFormError('Este PIN ya esta en uso')
      setFormSaving(false)
      return
    }
    const cid = _cid()
    const newId = crypto.randomUUID()
    const body = {
      id: newId,
      client_id: cid,
      name: formName.trim(),
      pin: formPin,
      role: formRole,
      active: formActive,
    }
    const res = await fetch(`${SB_URL}/rest/v1/pos_staff`, {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text()
      setFormError(txt.includes('unique') ? 'PIN ya esta en uso' : 'Error al guardar')
      setFormSaving(false)
      return
    }
    await postAudit(newId, 'created', { name: formName.trim(), role: formRole, active: formActive })
    setShowCreateModal(false)
    resetForm()
    setFormSaving(false)
    fetchStaff()
    fetchAudit()
  }

  // ------ Edit ------
  async function handleEdit() {
    if (!editingStaff) return
    setFormError('')
    if (!formName.trim()) { setFormError('Nombre es requerido'); return }

    // If new PIN provided, validate
    if (formNewPin) {
      if (formNewPin.length < 4 || formNewPin.length > 8 || !/^\d+$/.test(formNewPin)) {
        setFormError('PIN debe ser de 4 a 8 digitos')
        return
      }
    }

    setFormSaving(true)

    if (formNewPin && await isPinTaken(formNewPin, editingStaff.id)) {
      setFormError('Este PIN ya esta en uso')
      setFormSaving(false)
      return
    }

    const changes: Record<string, unknown> = {}
    const patch: Record<string, unknown> = {}

    if (formName.trim() !== editingStaff.name) {
      patch.name = formName.trim()
      changes.name = { from: editingStaff.name, to: formName.trim() }
    }
    if (formRole !== editingStaff.role) {
      patch.role = formRole
      changes.role = { from: editingStaff.role, to: formRole }
    }
    // Prevent self-deactivation
    const isSelf = currentStaff?.id === editingStaff.id
    if (!isSelf && formActive !== editingStaff.active) {
      patch.active = formActive
      changes.active = { from: editingStaff.active, to: formActive }
    }
    if (formNewPin) {
      patch.pin = formNewPin
      changes.pin = { changed: true }
    }

    if (Object.keys(patch).length === 0) {
      setEditingStaff(null)
      resetForm()
      setFormSaving(false)
      return
    }

    const res = await fetch(`${SB_URL}/rest/v1/pos_staff?id=eq.${editingStaff.id}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify(patch),
    })

    if (!res.ok) {
      const txt = await res.text()
      setFormError(txt.includes('unique') ? 'PIN ya esta en uso' : 'Error al guardar')
      setFormSaving(false)
      return
    }

    await postAudit(editingStaff.id, 'updated', changes)
    setEditingStaff(null)
    resetForm()
    setFormSaving(false)
    fetchStaff()
    fetchAudit()
  }

  // ------ Toggle active ------
  async function handleToggle(s: StaffMember) {
    const newActive = !s.active
    const action = newActive ? 'reactivated' : 'deactivated'
    await fetch(`${SB_URL}/rest/v1/pos_staff?id=eq.${s.id}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify({ active: newActive }),
    })
    await postAudit(s.id, action, { active: { from: s.active, to: newActive } })
    setConfirmToggle(null)
    fetchStaff()
    fetchAudit()
  }

  // ------ Form reset ------
  function resetForm() {
    setFormName('')
    setFormPin('')
    setFormNewPin('')
    setFormRole('mesero')
    setFormActive(true)
    setFormError('')
  }

  function openEdit(s: StaffMember) {
    setFormName(s.name)
    setFormPin('')
    setFormNewPin('')
    setFormRole(s.role)
    setFormActive(s.active)
    setFormError('')
    setEditingStaff(s)
  }

  // ------ Filtering & sorting ------
  const filtered = staff
    .filter(s => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false
      if (activeFilter === 'active' && !s.active) return false
      if (activeFilter === 'inactive' && s.active) return false
      if (searchTerm && !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const aVal = sortField === 'name' ? a.name : a.role
      const bVal = sortField === 'name' ? b.name : b.role
      const cmp = aVal.localeCompare(bVal)
      return sortAsc ? cmp : -cmp
    })

  // ------ Unauthorized ------
  if (authorized === false) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <Shield size={48} className="text-red-500 mx-auto mb-4" />
          <p className="text-white text-xl font-semibold mb-2">Sin permiso</p>
          <p className="text-gray-400 mb-6">Solo admin y gerente pueden acceder a esta página.</p>
          <Link href="/pos" className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-semibold min-h-[48px] inline-flex items-center">
            Regresar al POS
          </Link>
        </div>
      </div>
    )
  }

  if (authorized === null || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-white text-lg">Cargando...</div>
      </div>
    )
  }

  // ------ Render ------
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="bg-[#12121a] border-b border-[#1e1e2e] px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <Link href="/pos" className="p-2 rounded-xl hover:bg-[#1e1e2e] min-h-[48px] min-w-[48px] flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <Users size={22} className="text-emerald-400" />
        <h1 className="text-lg font-bold flex-1">Empleados</h1>
        <button
          onClick={() => { resetForm(); setShowCreateModal(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 min-h-[48px] transition-colors"
        >
          <UserPlus size={18} />
          <span className="hidden sm:inline">Nuevo</span>
        </button>
      </header>

      {/* Filters */}
      <div className="px-4 py-3 bg-[#12121a] border-b border-[#1e1e2e] flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Buscar por nombre..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 min-h-[48px]"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          className="bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-2 text-sm text-white min-h-[48px] focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todos los roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={activeFilter}
          onChange={e => setActiveFilter(e.target.value)}
          className="bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-2 text-sm text-white min-h-[48px] focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>

      {/* Staff table */}
      <div className="px-4 py-4">
        <div className="bg-[#12121a] rounded-2xl border border-[#1e1e2e] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_80px_80px_auto] sm:grid-cols-[1fr_120px_80px_100px_120px] gap-2 px-4 py-3 bg-[#1a1a28] text-xs text-gray-400 uppercase font-semibold border-b border-[#1e1e2e]">
            <button
              onClick={() => { if (sortField === 'name') setSortAsc(!sortAsc); else { setSortField('name'); setSortAsc(true) } }}
              className="flex items-center gap-1 text-left min-h-[32px]"
            >
              Nombre {sortField === 'name' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
            <button
              onClick={() => { if (sortField === 'role') setSortAsc(!sortAsc); else { setSortField('role'); setSortAsc(true) } }}
              className="flex items-center gap-1 text-left min-h-[32px]"
            >
              Rol {sortField === 'role' && (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
            <span>PIN</span>
            <span>Estado</span>
            <span className="text-right">Acciones</span>
          </div>

          {/* Rows */}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500">No se encontraron empleados.</div>
          )}
          {filtered.map(s => {
            const isSelf = currentStaff?.id === s.id
            return (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_auto_80px_80px_auto] sm:grid-cols-[1fr_120px_80px_100px_120px] gap-2 px-4 py-3 border-b border-[#1e1e2e] items-center hover:bg-[#1a1a28] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="font-medium truncate">{s.name}</span>
                  {isSelf && <span className="text-[10px] bg-emerald-600/20 text-emerald-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Tu</span>}
                </div>
                <span className={`text-sm font-medium ${ROLE_COLORS[s.role] || 'text-gray-400'}`}>
                  {ROLE_LABELS[s.role] || s.role}
                </span>
                <span className="text-sm text-gray-500 font-mono">****</span>
                <span className={`text-xs font-medium ${s.active ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.active ? 'Activo' : 'Inactivo'}
                </span>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => openEdit(s)}
                    className="p-2 rounded-xl hover:bg-[#2a2a3e] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Editar"
                  >
                    <Edit size={16} className="text-gray-400" />
                  </button>
                  {!isSelf && (
                    <button
                      onClick={() => setConfirmToggle(s)}
                      className="p-2 rounded-xl hover:bg-[#2a2a3e] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title={s.active ? 'Desactivar' : 'Reactivar'}
                    >
                      {s.active
                        ? <ToggleRight size={18} className="text-emerald-400" />
                        : <ToggleLeft size={18} className="text-red-400" />
                      }
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-gray-500 mt-2 px-1">{filtered.length} empleado{filtered.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Audit Log */}
      <div className="px-4 pb-8">
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-3 min-h-[48px]"
        >
          <Clock size={16} />
          <span>Historial de cambios</span>
          {showAudit ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showAudit && (
          <div className="bg-[#12121a] rounded-2xl border border-[#1e1e2e] overflow-hidden">
            {audit.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-500 text-sm">Sin cambios registrados.</div>
            )}
            {audit.map(a => {
              const staffName = staff.find(s => s.id === a.staff_id)?.name || a.staff_id.slice(0, 8)
              return (
                <div key={a.id} className="px-4 py-3 border-b border-[#1e1e2e] text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-500 text-xs">{new Date(a.created_at).toLocaleString('es-MX')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      a.action === 'created' ? 'bg-emerald-600/20 text-emerald-400'
                        : a.action === 'deactivated' ? 'bg-red-600/20 text-red-400'
                        : a.action === 'reactivated' ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-amber-600/20 text-amber-400'
                    }`}>
                      {a.action}
                    </span>
                    <span className="text-white font-medium">{staffName}</span>
                    <span className="text-gray-500">por {a.changed_by}</span>
                  </div>
                  {a.changed_fields && Object.keys(a.changed_fields).length > 0 && (
                    <div className="mt-1 text-xs text-gray-500">
                      Campos: {Object.entries(a.changed_fields).map(([k, v]) => {
                        const val = v as { from?: unknown; to?: unknown; changed?: boolean } | undefined
                        if (val && typeof val === 'object' && 'from' in val) {
                          return `${k}: ${String(val.from)} → ${String(val.to)}`
                        }
                        if (val && typeof val === 'object' && 'changed' in val) {
                          return `${k}: cambiado`
                        }
                        return `${k}: ${String(v)}`
                      }).join(', ')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ---- Create Modal ---- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2"><UserPlus size={20} className="text-emerald-400" /> Nuevo Empleado</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 rounded-xl hover:bg-[#2a2a3e] min-h-[44px] min-w-[44px] flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Nombre completo *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px]"
                  placeholder="Nombre del empleado"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">PIN (4-8 digitos) *</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={formPin}
                  onChange={e => setFormPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px] font-mono tracking-widest"
                  placeholder="****"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Rol *</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px]"
                >
                  {CREATABLE_ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">Activo</label>
                <button
                  onClick={() => setFormActive(!formActive)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  {formActive
                    ? <ToggleRight size={28} className="text-emerald-400" />
                    : <ToggleLeft size={28} className="text-gray-500" />
                  }
                </button>
              </div>
              {formError && (
                <div className="bg-red-600/20 text-red-400 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                  <AlertTriangle size={14} /> {formError}
                </div>
              )}
              <button
                onClick={handleCreate}
                disabled={formSaving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-3 rounded-xl font-semibold min-h-[52px] transition-colors"
              >
                {formSaving ? 'Guardando...' : 'Crear Empleado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Edit Modal ---- */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => { setEditingStaff(null); resetForm() }}>
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2"><Edit size={20} className="text-amber-400" /> Editar Empleado</h2>
              <button onClick={() => { setEditingStaff(null); resetForm() }} className="p-2 rounded-xl hover:bg-[#2a2a3e] min-h-[44px] min-w-[44px] flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Nombre completo *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px]"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Nuevo PIN (opcional, 4-8 digitos)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={formNewPin}
                  onChange={e => setFormNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px] font-mono tracking-widest"
                  placeholder="Dejar vacio para no cambiar"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 block mb-1">Rol</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 min-h-[48px]"
                >
                  {CREATABLE_ROLES.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              {currentStaff?.id !== editingStaff.id && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400">Activo</label>
                  <button
                    onClick={() => setFormActive(!formActive)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    {formActive
                      ? <ToggleRight size={28} className="text-emerald-400" />
                      : <ToggleLeft size={28} className="text-gray-500" />
                    }
                  </button>
                </div>
              )}
              {formError && (
                <div className="bg-red-600/20 text-red-400 px-4 py-2 rounded-xl text-sm flex items-center gap-2">
                  <AlertTriangle size={14} /> {formError}
                </div>
              )}
              <button
                onClick={handleEdit}
                disabled={formSaving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-3 rounded-xl font-semibold min-h-[52px] transition-colors"
              >
                {formSaving ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Confirm Toggle Modal ---- */}
      {confirmToggle && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmToggle(null)}>
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-5">
              <AlertTriangle size={40} className={`mx-auto mb-3 ${confirmToggle.active ? 'text-red-400' : 'text-emerald-400'}`} />
              <h2 className="text-lg font-bold mb-2">
                {confirmToggle.active ? 'Desactivar' : 'Reactivar'} empleado
              </h2>
              <p className="text-gray-400 text-sm">
                {confirmToggle.active
                  ? `¿Desactivar a ${confirmToggle.name}? Ya no podra iniciar sesión.`
                  : `¿Reactivar a ${confirmToggle.name}? Podra iniciar sesión de nuevo.`
                }
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmToggle(null)}
                className="flex-1 bg-[#1e1e2e] hover:bg-[#2a2a3e] text-white px-4 py-3 rounded-xl font-semibold min-h-[52px] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleToggle(confirmToggle)}
                className={`flex-1 px-4 py-3 rounded-xl font-semibold min-h-[52px] transition-colors text-white ${
                  confirmToggle.active ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmToggle.active ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
