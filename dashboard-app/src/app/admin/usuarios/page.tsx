'use client'

import { useState, useEffect, useCallback } from 'react'
import { useClientId } from '@/hooks/useClientId'
import {
  Users, UserPlus, Pencil, Trash2, Save, X, Shield, ShieldCheck,
  ShieldAlert, Eye, Clock, CheckCircle, XCircle, Search, ChevronDown,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Types ──────────────────────────────────────────────────────────

type Role = 'admin' | 'gerente' | 'cajero' | 'mesero' | 'cocina' | 'viewer'

interface PortalUser {
  id: string
  nombre: string
  email: string
  rol: Role
  sucursales: string[]
  activo: boolean
  ultimo_acceso: string | null
  created_at: string
}

// ── Role config ────────────────────────────────────────────────────

const ROLES: { value: Role; label: string; color: string; icon: typeof Shield; pages: string[] }[] = [
  { value: 'admin', label: 'Admin', color: 'text-red-400 bg-red-500/15', icon: ShieldAlert, pages: ['Todas las paginas'] },
  { value: 'gerente', label: 'Gerente', color: 'text-purple-400 bg-purple-500/15', icon: ShieldCheck, pages: ['Dashboard', 'Reportes', 'Inventario', 'Meseros', 'CRM'] },
  { value: 'cajero', label: 'Cajero', color: 'text-blue-400 bg-blue-500/15', icon: Shield, pages: ['POS', 'Caja', 'Cortes'] },
  { value: 'mesero', label: 'Mesero', color: 'text-emerald-400 bg-emerald-500/15', icon: Users, pages: ['POS'] },
  { value: 'cocina', label: 'Cocina', color: 'text-amber-400 bg-amber-500/15', icon: Eye, pages: ['KDS'] },
  { value: 'viewer', label: 'Viewer', color: 'text-gray-400 bg-gray-500/15', icon: Eye, pages: ['Dashboard'] },
]

const SUCURSALES_DISPONIBLES = ['Principal', 'Sucursal 2', 'Sucursal 3']

const roleMap = Object.fromEntries(ROLES.map(r => [r.value, r]))

// ── Supabase fetch helper ──────────────────────────────────────────

async function sbFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts?.method === 'POST' || opts?.method === 'PATCH'
        ? 'return=representation'
        : '',
      ...opts?.headers,
    },
  })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ── Empty form ─────────────────────────────────────────────────────

const emptyUser: Omit<PortalUser, 'id' | 'created_at'> = {
  nombre: '',
  email: '',
  rol: 'viewer',
  sucursales: ['Principal'],
  activo: true,
  ultimo_acceso: null,
}

// ── Component ──────────────────────────────────────────────────────

export default function AdminUsuariosPage() {
  const CLIENT_ID = useClientId()
  const [users, setUsers] = useState<PortalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<Role | ''>('')

  // Form state
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PortalUser | null>(null)
  const [form, setForm] = useState(emptyUser)
  const [formPassword, setFormPassword] = useState('')

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  // ── Load users from wansoft_data ───────────────────────────────

  const load = useCallback(async () => {
    try {
      const rows = await sbFetch(
        `wansoft_data?client_id=eq.${CLIENT_ID}&data_key=eq.portal_users&select=data`
      )
      if (rows?.length > 0) {
        let d = rows[0].data
        if (typeof d === 'string') d = JSON.parse(d)
        if (Array.isArray(d)) setUsers(d)
      }
    } catch (e) {
      console.error('[usuarios] Error loading:', e)
      showToast('Error cargando usuarios', 'err')
    } finally {
      setLoading(false)
    }
  }, [CLIENT_ID])

  useEffect(() => { load() }, [load])

  // ── Save all users back to wansoft_data ────────────────────────

  const persist = async (updated: PortalUser[]) => {
    try {
      // Try PATCH first; if row doesn't exist, POST
      const existing = await sbFetch(
        `wansoft_data?client_id=eq.${CLIENT_ID}&data_key=eq.portal_users&select=id`
      )
      if (existing?.length > 0) {
        await sbFetch(
          `wansoft_data?client_id=eq.${CLIENT_ID}&data_key=eq.portal_users`,
          { method: 'PATCH', body: JSON.stringify({ data: updated }) }
        )
      } else {
        await sbFetch('wansoft_data', {
          method: 'POST',
          body: JSON.stringify({
            client_id: CLIENT_ID,
            data_key: 'portal_users',
            data: updated,
            fecha: new Date().toISOString().slice(0, 10),
          }),
        })
      }
      setUsers(updated)
    } catch (e) {
      console.error('[usuarios] persist error:', e)
      throw e
    }
  }

  // ── CRUD handlers ──────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.nombre || !form.email) {
      showToast('Nombre y email son requeridos', 'err')
      return
    }
    if (users.some(u => u.email === form.email)) {
      showToast('Ya existe un usuario con ese email', 'err')
      return
    }
    const newUser: PortalUser = {
      ...form,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }
    try {
      await persist([...users, newUser])
      showToast(`${newUser.nombre} creado`)
      setForm({ ...emptyUser })
      setFormPassword('')
      setAdding(false)
    } catch {
      showToast('Error al crear usuario', 'err')
    }
  }

  const handleSave = async () => {
    if (!editing) return
    const updated = users.map(u => u.id === editing.id ? editing : u)
    try {
      await persist(updated)
      showToast(`${editing.nombre} actualizado`)
      setEditing(null)
    } catch {
      showToast('Error al guardar', 'err')
    }
  }

  const handleToggleActive = async (user: PortalUser) => {
    const updated = users.map(u =>
      u.id === user.id ? { ...u, activo: !u.activo } : u
    )
    try {
      await persist(updated)
      showToast(`${user.nombre} ${user.activo ? 'desactivado' : 'activado'}`)
    } catch {
      showToast('Error al cambiar estado', 'err')
    }
  }

  const handleDelete = async (user: PortalUser) => {
    if (!confirm(`Eliminar "${user.nombre}"? Esta accion no se puede deshacer.`)) return
    const updated = users.filter(u => u.id !== user.id)
    try {
      await persist(updated)
      showToast(`${user.nombre} eliminado`)
    } catch {
      showToast('Error al eliminar', 'err')
    }
  }

  // ── Filters ────────────────────────────────────────────────────

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      u.nombre.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = !filterRole || u.rol === filterRole
    return matchSearch && matchRole
  })

  // ── KPI calculations ──────────────────────────────────────────

  const totalUsers = users.length
  const activeUsers = users.filter(u => u.activo).length
  const uniqueRoles = new Set(users.map(u => u.rol)).size
  const lastLogin = users
    .filter(u => u.ultimo_acceso)
    .sort((a, b) => (b.ultimo_acceso || '').localeCompare(a.ultimo_acceso || ''))
    [0]?.ultimo_acceso

  // ── Role badge ─────────────────────────────────────────────────

  const RoleBadge = ({ rol }: { rol: Role }) => {
    const r = roleMap[rol]
    if (!r) return <span className="text-xs text-[var(--text-3)]">{rol}</span>
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-semibold ${r.color}`}>
        <r.icon size={12} />
        {r.label}
      </span>
    )
  }

  // ── Sucursales multi-select ────────────────────────────────────

  const SucursalSelect = ({
    selected,
    onChange,
  }: {
    selected: string[]
    onChange: (v: string[]) => void
  }) => (
    <div className="flex flex-wrap gap-1">
      {SUCURSALES_DISPONIBLES.map(s => (
        <button
          key={s}
          type="button"
          onClick={() =>
            onChange(
              selected.includes(s)
                ? selected.filter(x => x !== s)
                : [...selected, s]
            )
          }
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
            selected.includes(s)
              ? 'bg-blue-500 text-white'
              : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--line)]'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Usuarios"
        subtitle="Gestion de accesos al portal"
        eyebrow="Admin"
        action={
          <button
            onClick={() => { setAdding(true); setForm({ ...emptyUser }); setFormPassword('') }}
            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors"
          >
            <UserPlus size={16} /> Nuevo usuario
          </button>
        }
      />

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KPICard
          label="Total usuarios"
          value={String(totalUsers)}
          icon={Users}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Activos"
          value={String(activeUsers)}
          delta={totalUsers > 0 ? `${Math.round((activeUsers / totalUsers) * 100)}%` : '--'}
          deltaType={activeUsers === totalUsers ? 'up' : 'neutral'}
          icon={CheckCircle}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Roles en uso"
          value={String(uniqueRoles)}
          subtitle={`de ${ROLES.length} disponibles`}
          icon={Shield}
          accentClass="kpi-accent-purple"
          index={2}
        />
        <KPICard
          label="Ultimo login"
          value={lastLogin ? new Date(lastLogin).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) : '--'}
          subtitle={lastLogin ? new Date(lastLogin).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
          icon={Clock}
          accentClass="kpi-accent-amber"
          index={3}
        />
      </div>

      {/* ── Add user form ────────────────────────────────────── */}
      {adding && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 mb-6">
          <h3 className="font-semibold text-blue-400 mb-4 flex items-center gap-2">
            <UserPlus size={16} /> Nuevo usuario
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1 block">Nombre</label>
              <input
                value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Juan Perez"
                className="w-full border border-[var(--line)] bg-[var(--surface)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-1)]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1 block">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="juan@amalay.mx"
                className="w-full border border-[var(--line)] bg-[var(--surface)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-1)]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1 block">Password</label>
              <input
                type="password"
                value={formPassword}
                onChange={e => setFormPassword(e.target.value)}
                placeholder="********"
                className="w-full border border-[var(--line)] bg-[var(--surface)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-1)]"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1 block">Rol</label>
              <div className="relative">
                <select
                  value={form.rol}
                  onChange={e => setForm({ ...form, rol: e.target.value as Role })}
                  className="w-full border border-[var(--line)] bg-[var(--surface)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-1)] appearance-none pr-8"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.pages.join(', ')}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1 block">Sucursales</label>
              <SucursalSelect selected={form.sucursales} onChange={s => setForm({ ...form, sucursales: s })} />
            </div>
          </div>

          {/* Role access preview */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-lg p-3 mb-4">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-2">Acceso de {roleMap[form.rol]?.label}</p>
            <div className="flex flex-wrap gap-1">
              {roleMap[form.rol]?.pages.map(p => (
                <span key={p} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs font-medium">{p}</span>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-1 transition-colors"
            >
              <Save size={14} /> Crear usuario
            </button>
            <button
              onClick={() => { setAdding(false); setForm({ ...emptyUser }); setFormPassword('') }}
              className="px-4 py-2 bg-[var(--line)] text-[var(--text-2)] rounded-lg text-sm hover:bg-[var(--surface-2)] transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="w-full border border-[var(--line)] bg-[var(--surface)] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[var(--text-1)]"
          />
        </div>
        <div className="relative">
          <select
            value={filterRole}
            onChange={e => setFilterRole(e.target.value as Role | '')}
            className="border border-[var(--line)] bg-[var(--surface)] rounded-xl px-3 py-2.5 text-sm text-[var(--text-1)] appearance-none pr-8 min-w-[140px]"
          >
            <option value="">Todos los roles</option>
            {ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
        </div>
      </div>

      {/* ── User table ───────────────────────────────────────── */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users size={32} className="mx-auto mb-3 text-[var(--text-4)]" />
            <p className="text-[var(--text-3)] text-sm">
              {users.length === 0
                ? 'No hay usuarios configurados. Crea el primero.'
                : 'No se encontraron usuarios con esos filtros.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[var(--surface-2)] border-b border-[var(--line)]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Usuario</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase hidden sm:table-cell">Email</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Rol</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase hidden lg:table-cell">Sucursal(es)</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase hidden md:table-cell">Ultimo acceso</th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--text-2)] uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                    {/* Nombre */}
                    <td className="px-5 py-3">
                      {editing?.id === u.id ? (
                        <input
                          value={editing.nombre}
                          onChange={e => setEditing({ ...editing, nombre: e.target.value })}
                          className="border border-blue-400/50 bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)] w-full"
                        />
                      ) : (
                        <div>
                          <span className="text-sm font-medium text-[var(--text-1)]">{u.nombre}</span>
                          <p className="text-xs text-[var(--text-3)] sm:hidden">{u.email}</p>
                        </div>
                      )}
                    </td>

                    {/* Email */}
                    <td className="px-5 py-3 hidden sm:table-cell">
                      {editing?.id === u.id ? (
                        <input
                          type="email"
                          value={editing.email}
                          onChange={e => setEditing({ ...editing, email: e.target.value })}
                          className="border border-blue-400/50 bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)] w-full"
                        />
                      ) : (
                        <span className="text-sm text-[var(--text-2)]">{u.email}</span>
                      )}
                    </td>

                    {/* Rol */}
                    <td className="px-5 py-3">
                      {editing?.id === u.id ? (
                        <select
                          value={editing.rol}
                          onChange={e => setEditing({ ...editing, rol: e.target.value as Role })}
                          className="border border-blue-400/50 bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)]"
                        >
                          {ROLES.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge rol={u.rol} />
                      )}
                    </td>

                    {/* Sucursales */}
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {editing?.id === u.id ? (
                        <SucursalSelect
                          selected={editing.sucursales}
                          onChange={s => setEditing({ ...editing, sucursales: s })}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {u.sucursales.map(s => (
                            <span key={s} className="px-2 py-0.5 bg-[var(--surface-2)] text-[var(--text-2)] rounded text-xs">
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Ultimo acceso */}
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm text-[var(--text-3)]">
                        {u.ultimo_acceso
                          ? new Date(u.ultimo_acceso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : 'Nunca'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() => handleToggleActive(u)}
                        title={u.activo ? 'Desactivar' : 'Activar'}
                        className="inline-flex items-center gap-1 transition-colors"
                      >
                        {u.activo ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
                            <CheckCircle size={12} /> Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-semibold">
                            <XCircle size={12} /> Inactivo
                          </span>
                        )}
                      </button>
                    </td>

                    {/* Acciones */}
                    <td className="px-5 py-3 text-right">
                      {editing?.id === u.id ? (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={handleSave}
                            className="w-8 h-8 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-500 flex items-center justify-center transition-colors"
                          >
                            <Save size={14} />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => setEditing({ ...u })}
                            className="w-8 h-8 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--line)] text-[var(--text-2)] flex items-center justify-center transition-colors"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Role access reference ────────────────────────────── */}
      <div className="mt-6 bg-[var(--surface)] rounded-2xl border border-[var(--line)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-1)] mb-3 flex items-center gap-2">
          <Shield size={14} className="text-[var(--text-3)]" />
          Referencia de permisos por rol
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLES.map(r => (
            <div key={r.value} className="bg-[var(--surface-2)] rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2">
                <r.icon size={14} className={r.color.split(' ')[0]} />
                <span className="text-sm font-semibold text-[var(--text-1)]">{r.label}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.pages.map(p => (
                  <span key={p} className="px-2 py-0.5 bg-[var(--surface)] text-[var(--text-3)] rounded text-[10px] font-medium">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-2xl text-sm font-medium ${
          toast.type === 'ok' ? 'bg-[var(--surface-2)] text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
