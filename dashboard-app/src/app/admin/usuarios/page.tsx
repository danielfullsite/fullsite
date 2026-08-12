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

// DS v2.1 role badge tint — admin=crit, gerente=violet(st-barra), cajero=info, mesero=ok(accent), cocina=warn, viewer=neutral
type BadgeTint = { color: string; bg: string; border: string }
const ROLE_TINT: Record<Role, BadgeTint> = {
  admin:   { color: 'var(--crit-ink)',  bg: 'var(--crit-soft)',  border: 'color-mix(in srgb, var(--crit) 35%, transparent)' },
  gerente: { color: 'var(--st-barra)',  bg: 'color-mix(in srgb, var(--st-barra) 12%, transparent)', border: 'color-mix(in srgb, var(--st-barra) 38%, transparent)' },
  cajero:  { color: 'var(--info-ink)',  bg: 'var(--info-soft)',  border: 'color-mix(in srgb, var(--info) 38%, transparent)' },
  mesero:  { color: 'var(--accent-ink)', bg: 'var(--accent-soft)', border: 'var(--accent-line)' },
  cocina:  { color: 'var(--warn-ink)',  bg: 'var(--warn-soft)',  border: 'color-mix(in srgb, var(--warn) 38%, transparent)' },
  viewer:  { color: 'var(--text-2)',    bg: 'var(--surface-2)',  border: 'var(--line)' },
}

const ROLES: { value: Role; label: string; icon: typeof Shield; pages: string[] }[] = [
  { value: 'admin', label: 'Admin', icon: ShieldAlert, pages: ['Todas las paginas'] },
  { value: 'gerente', label: 'Gerente', icon: ShieldCheck, pages: ['Dashboard', 'Reportes', 'Inventario', 'Meseros', 'CRM'] },
  { value: 'cajero', label: 'Cajero', icon: Shield, pages: ['POS', 'Caja', 'Cortes'] },
  { value: 'mesero', label: 'Mesero', icon: Users, pages: ['POS'] },
  { value: 'cocina', label: 'Cocina', icon: Eye, pages: ['KDS'] },
  { value: 'viewer', label: 'Viewer', icon: Eye, pages: ['Dashboard'] },
]

const SUCURSALES_DISPONIBLES = ['Principal', 'Sucursal 2', 'Sucursal 3']

const roleMap = Object.fromEntries(ROLES.map(r => [r.value, r]))

// Tokens de estación DS v2.1 (violet st-barra — no viven en globals, scoped a esta página)
const USUARIOS_TOKENS = `
  .usr-scope{ --st-barra:#a78bfa; }
  [data-theme="light"] .usr-scope{ --st-barra:#7c3aed; }
`

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
    const t = ROLE_TINT[rol]
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
        style={{ color: t.color, background: t.bg, borderColor: t.border }}
      >
        <r.icon size={11} />
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
          className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors border"
          style={
            selected.includes(s)
              ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'var(--accent-line)' }
              : { background: 'var(--surface-2)', color: 'var(--text-3)', borderColor: 'var(--line)' }
          }
        >
          {s}
        </button>
      ))}
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="usr-scope max-w-6xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: USUARIOS_TOKENS }} />
      <PageHeader
        title="Usuarios"
        subtitle="Gestion de accesos al portal"
        eyebrow="Admin"
        action={
          <button
            onClick={() => { setAdding(true); setForm({ ...emptyUser }); setFormPassword('') }}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-[filter] min-h-[44px] hover:brightness-105"
            style={{
              background: 'linear-gradient(150deg, var(--accent-bright), var(--accent-deep))',
              color: '#04140d',
              boxShadow: '0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)',
            }}
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
        <div className="rounded-2xl p-5 mb-6 border" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
            <UserPlus size={16} style={{ color: 'var(--accent-ink)' }} /> Nuevo usuario
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
          <div className="rounded-lg p-3 mb-4 border" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}>
            <p className="text-[9.5px] uppercase tracking-wider font-mono font-semibold mb-2" style={{ color: 'var(--text-4)' }}>Acceso de {roleMap[form.rol]?.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {roleMap[form.rol]?.pages.map(p => {
                const t = ROLE_TINT[form.rol]
                return <span key={p} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border" style={{ color: t.color, background: t.bg, borderColor: t.border }}>{p}</span>
              })}
            </div>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={handleAdd}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-[filter] min-h-[44px] hover:brightness-105"
              style={{
                background: 'linear-gradient(150deg, var(--accent-bright), var(--accent-deep))',
                color: '#04140d',
                boxShadow: '0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)',
              }}
            >
              <Save size={15} /> Crear usuario
            </button>
            <button
              onClick={() => { setAdding(false); setForm({ ...emptyUser }); setFormPassword('') }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-[44px] border"
              style={{ background: 'var(--surface-2)', color: 'var(--text-1)', borderColor: 'var(--line)' }}
            >
              Cancelar
            </button>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>Guardar → Guardando… → Guardado ✓</span>
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
            <div className="w-8 h-8 border-[2.5px] rounded-full animate-spin" style={{ borderColor: 'var(--line)', borderTopColor: 'var(--accent)' }} />
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
                          className="border border-[var(--accent-line)] bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)] w-full"
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
                          className="border border-[var(--accent-line)] bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)] w-full"
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
                          className="border border-[var(--accent-line)] bg-[var(--surface)] rounded px-2 py-1 text-sm text-[var(--text-1)]"
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
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border" style={{ color: 'var(--accent-ink)', background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
                            <CheckCircle size={11} /> Activo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border" style={{ color: 'var(--crit-ink)', background: 'var(--crit-soft)', borderColor: 'color-mix(in srgb, var(--crit) 40%, transparent)' }}>
                            <XCircle size={11} /> Inactivo
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
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'var(--accent-line)' }}
                          >
                            <Save size={14} />
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border"
                            style={{ background: 'var(--surface-2)', color: 'var(--text-2)', borderColor: 'var(--line)' }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => setEditing({ ...u })}
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-transparent hover:border-[var(--line)] hover:bg-[var(--surface-2)]"
                            style={{ color: 'var(--text-3)' }}
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-transparent"
                            style={{ color: 'var(--text-3)' }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--crit-ink)'; e.currentTarget.style.background = 'var(--crit-soft)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--crit) 30%, transparent)' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
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
      <div className="mt-6 rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
        <h3 className="text-[15px] font-bold mb-3.5 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <Shield size={16} style={{ color: 'var(--accent-ink)' }} />
          Referencia de permisos por rol
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLES.map(r => {
            const t = ROLE_TINT[r.value]
            return (
              <div key={r.value} className="rounded-xl p-3 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border" style={{ color: t.color, background: t.bg, borderColor: t.border }}>
                    <r.icon size={11} />{r.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.pages.map(p => (
                    <span key={p} className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] border" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-sm font-semibold border inline-flex items-center gap-2"
          style={
            toast.type === 'ok'
              ? { background: 'var(--surface-2)', color: 'var(--text-1)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }
              : { background: 'var(--surface-2)', color: 'var(--text-1)', borderColor: 'color-mix(in srgb, var(--crit) 40%, transparent)', boxShadow: 'var(--shadow-mid)' }
          }
        >
          <span
            className="w-5 h-5 rounded-md grid place-items-center flex-none"
            style={toast.type === 'ok'
              ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }
              : { background: 'var(--crit-soft)', color: 'var(--crit-ink)' }}
          >
            {toast.type === 'ok' ? <CheckCircle size={13} /> : <XCircle size={13} />}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
