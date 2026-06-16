'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Users, Search, Plus, X, Phone, Mail, Calendar, ChevronRight,
  Repeat, Tag, Eye, Star, Gift,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

// ─── Types ───────────────────────────────────────────────────────────
interface PosCustomer {
  id: number
  client_id: string
  name: string
  phone: string
  email: string
  notes: string
  total_visits: number
  total_spent: number
  avg_ticket: number
  last_visit: string | null
  first_visit: string | null
  tags: string[]
  birthday: string | null
  created_at: string
}

interface PosCustomerVisit {
  id: number
  customer_id: number
  order_id: string | null
  amount: number
  items_count: number
  visited_at: string
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const COMMON_TAGS = ['VIP', 'frecuente', 'cumpleanero', 'nuevo', 'corporativo', 'evento', 'influencer']

function hdrs() {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
}

function clientId(): string {
  if (typeof window !== 'undefined') return localStorage.getItem('fullsite_client_id') || 'amalay'
  return 'amalay'
}

function parseDate(dateStr: string): Date {
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/')
    if (parts.length === 3) return new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T12:00:00`)
  }
  return new Date(dateStr)
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  const d = parseDate(dateStr)
  if (isNaN(d.getTime())) return 999
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  const days = daysSince(dateStr)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} dias`
  if (days < 30) return `Hace ${Math.floor(days / 7)} sem`
  if (days < 365) return `Hace ${Math.floor(days / 30)} meses`
  return `Hace ${Math.floor(days / 365)} anos`
}

// ─── Main Component ──────────────────────────────────────────────────
export default function CRMPage() {
  const [customers, setCustomers] = useState<PosCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null)

  const cid = clientId()

  // ─── Fetch customers ────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_customers?client_id=eq.${cid}&select=*&order=last_visit.desc.nullslast&limit=5000`,
        { headers: hdrs() }
      )
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.map((r: Record<string, unknown>) => ({
          ...r,
          tags: Array.isArray(r.tags) ? r.tags : [],
          phone: r.phone || '',
          email: r.email || '',
          notes: r.notes || '',
        })))
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [cid])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  // ─── KPIs ───────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = customers.length
    const now = new Date()
    const thisMonth = customers.filter(c => {
      if (!c.last_visit) return false
      const d = new Date(c.last_visit)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length

    const vips = customers.filter(c => c.tags?.includes('VIP'))
    const avgTicketVip = vips.length > 0
      ? vips.reduce((sum, c) => sum + (c.avg_ticket || 0), 0) / vips.length
      : 0
    const avgTicketAll = total > 0
      ? customers.reduce((sum, c) => sum + (c.avg_ticket || 0), 0) / total
      : 0

    const repeatCustomers = customers.filter(c => c.total_visits > 1).length
    const repeatRate = total > 0 ? (repeatCustomers / total) * 100 : 0

    return { total, thisMonth, avgTicketVip, avgTicketAll, repeatRate }
  }, [customers])

  // ─── Filtered list ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = customers
    if (tagFilter) {
      list = list.filter(c => c.tags?.includes(tagFilter))
    }
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(s) ||
        (c.phone || '').includes(s) ||
        (c.email || '').toLowerCase().includes(s)
      )
    }
    return list
  }, [customers, search, tagFilter])

  // ─── All unique tags ────────────────────────────────────────────
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    customers.forEach(c => c.tags?.forEach(t => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [customers])

  // ─── Add customer ───────────────────────────────────────────────
  const handleAddCustomer = async (data: { name: string; phone: string; email: string; birthday: string; tags: string[]; notes: string }) => {
    try {
      const body = {
        client_id: cid,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        birthday: data.birthday || null,
        tags: data.tags,
        notes: data.notes || null,
        first_visit: new Date().toISOString(),
      }
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_customers`,
        {
          method: 'POST',
          headers: { ...hdrs(), Prefer: 'return=representation' },
          body: JSON.stringify(body),
        }
      )
      if (res.ok) {
        const [created] = await res.json()
        setCustomers(prev => [{ ...created, tags: created.tags || [], phone: created.phone || '', email: created.email || '', notes: created.notes || '' }, ...prev])
        setShowAddModal(false)
      }
    } catch { /* silent */ }
  }

  // ─── Update customer ────────────────────────────────────────────
  const handleUpdateCustomer = async (id: number, data: Partial<PosCustomer>) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: { ...hdrs(), Prefer: 'return=representation' },
          body: JSON.stringify(data),
        }
      )
      if (res.ok) {
        const [updated] = await res.json()
        setCustomers(prev => prev.map(c => c.id === id ? { ...updated, tags: updated.tags || [], phone: updated.phone || '', email: updated.email || '', notes: updated.notes || '' } : c))
        setSelectedCustomer(null)
      }
    } catch { /* silent */ }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--text-3)]">Cargando CRM...</div>
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="CRM — Clientes & Lealtad"
        subtitle="Seguimiento de clientes, visitas, gasto y marketing personalizado."
        eyebrow="CRM"
      />

      {/* Integration note */}
      <div className="mb-6 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
        <strong>Integracion POS:</strong> Los clientes se vinculan a ordenes al momento del pago ingresando su telefono. Esto actualiza automaticamente visitas, gasto total y ticket promedio.
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Total Clientes" value={String(kpis.total)} icon={Users} accentClass="kpi-accent-blue" index={0} />
        <KPICard label="Visitas este mes" value={String(kpis.thisMonth)} icon={Eye} accentClass="kpi-accent-green" index={1} />
        <KPICard
          label="Ticket VIP vs Todos"
          value={`${formatCurrency(kpis.avgTicketVip)} / ${formatCurrency(kpis.avgTicketAll)}`}
          icon={Star}
          accentClass="kpi-accent-purple"
          index={2}
        />
        <KPICard label="Tasa de retorno" value={`${kpis.repeatRate.toFixed(1)}%`} icon={Repeat} accentClass="kpi-accent-amber" index={3} />
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o telefono..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
        >
          <Plus size={16} />
          Agregar Cliente
        </button>
      </div>

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setTagFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              !tagFilter
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)] bg-[var(--surface)] border border-[var(--line)]'
            }`}
          >
            Todos ({customers.length})
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                tagFilter === tag
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)] bg-[var(--surface)] border border-[var(--line)]'
              }`}
            >
              <Tag size={10} />
              {tag}
              <span className="text-[10px] opacity-60">({customers.filter(c => c.tags?.includes(tag)).length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Customer table */}
      <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: 'var(--surface)' }}>
        {/* Header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_0.8fr_0.8fr_0.8fr_1fr_0.5fr] gap-4 px-5 py-3 border-b border-[var(--line)] text-[10px] uppercase tracking-[0.15em] font-mono text-[var(--text-4)]">
          <span>Cliente</span>
          <span>Telefono</span>
          <span>Visitas</span>
          <span>Gasto total</span>
          <span>Ticket prom.</span>
          <span>Ultima visita</span>
          <span></span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={40} className="mx-auto mb-3 text-[var(--text-4)]" />
            <p className="text-[var(--text-2)] font-medium mb-1">
              {customers.length === 0 ? 'Sin clientes registrados' : 'Sin resultados'}
            </p>
            <p className="text-sm text-[var(--text-4)] mb-4">
              {customers.length === 0
                ? 'Agrega tu primer cliente o vincula ordenes del POS.'
                : 'Intenta otra busqueda o quita el filtro.'}
            </p>
            {customers.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
              >
                Agregar Cliente
              </button>
            )}
          </div>
        ) : (
          filtered.map(customer => (
            <div
              key={customer.id}
              className="grid grid-cols-1 md:grid-cols-[2fr_1fr_0.8fr_0.8fr_0.8fr_1fr_0.5fr] gap-2 md:gap-4 px-5 py-3.5 border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer group"
              onClick={() => setSelectedCustomer(customer)}
            >
              {/* Name + tags */}
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-xs font-bold text-[var(--text-3)]">
                  {customer.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-1)]">{customer.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {customer.tags?.slice(0, 3).map(tag => (
                      <span key={tag} className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        tag === 'VIP' ? 'bg-amber-500/15 text-amber-400' : 'bg-[var(--surface-2)] text-[var(--text-4)]'
                      }`}>
                        {tag}
                      </span>
                    ))}
                    {(customer.tags?.length || 0) > 3 && (
                      <span className="text-[9px] text-[var(--text-4)]">+{customer.tags.length - 3}</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Phone */}
              <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                {customer.phone || <span className="text-[var(--text-4)]">--</span>}
              </div>
              {/* Visits */}
              <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                {customer.total_visits}
              </div>
              {/* Total spent */}
              <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                {formatCurrency(customer.total_spent)}
              </div>
              {/* Avg ticket */}
              <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                {formatCurrency(customer.avg_ticket)}
              </div>
              {/* Last visit */}
              <div className="flex items-center text-sm text-[var(--text-3)]">
                {relativeDate(customer.last_visit)}
              </div>
              {/* Arrow */}
              <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight size={16} className="text-[var(--text-4)]" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      {filtered.length > 0 && (
        <p className="text-xs text-[var(--text-4)] mt-3 text-right">
          {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
          {tagFilter && ` con tag "${tagFilter}"`}
          {search && ` buscando "${search}"`}
        </p>
      )}

      {/* Add customer modal */}
      {showAddModal && (
        <AddCustomerModal
          onClose={() => setShowAddModal(false)}
          onSave={handleAddCustomer}
        />
      )}

      {/* Customer detail modal */}
      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onUpdate={handleUpdateCustomer}
        />
      )}
    </div>
  )
}

// ─── Add Customer Modal ─────────────────────────────────────────────
function AddCustomerModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (data: { name: string; phone: string; email: string; birthday: string; tags: string[]; notes: string }) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [birthday, setBirthday] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name: name.trim(), phone: phone.trim(), email: email.trim(), birthday, tags, notes: notes.trim() })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h3 className="text-base font-semibold text-[var(--text-1)]">Nuevo Cliente</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Nombre *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Maria Garcia"
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 text-xs text-[var(--text-3)] mb-1">
                <Phone size={10} /> Telefono
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="8112345678"
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-[var(--text-3)] mb-1">
                <Mail size={10} /> Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="opcional"
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Birthday */}
          <div>
            <label className="flex items-center gap-1 text-xs text-[var(--text-3)] mb-1">
              <Calendar size={10} /> Cumpleanos
            </label>
            <input
              type="date"
              value={birthday}
              onChange={e => setBirthday(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-2">Tags</label>
            <div className="flex flex-wrap gap-2">
              {COMMON_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    tags.includes(tag)
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'bg-[var(--surface)] border border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Preferencias, alergias, mesa favorita..."
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--line)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-3)]">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Customer Detail Modal ──────────────────────────────────────────
function CustomerDetailModal({ customer, onClose, onUpdate }: {
  customer: PosCustomer
  onClose: () => void
  onUpdate: (id: number, data: Partial<PosCustomer>) => void
}) {
  const [visits, setVisits] = useState<PosCustomerVisit[]>([])
  const [loadingVisits, setLoadingVisits] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editTags, setEditTags] = useState<string[]>(customer.tags || [])
  const [editNotes, setEditNotes] = useState(customer.notes || '')
  const [editName, setEditName] = useState(customer.name)
  const [editPhone, setEditPhone] = useState(customer.phone)
  const [editEmail, setEditEmail] = useState(customer.email)
  const [editBirthday, setEditBirthday] = useState(customer.birthday || '')

  // Load visit history
  useEffect(() => {
    async function loadVisits() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_customer_visits?customer_id=eq.${customer.id}&order=visited_at.desc&limit=50`,
          { headers: hdrs() }
        )
        if (res.ok) setVisits(await res.json())
      } catch { /* silent */ }
      setLoadingVisits(false)
    }
    loadVisits()
  }, [customer.id])

  const handleSaveEdit = () => {
    onUpdate(customer.id, {
      name: editName,
      phone: editPhone || undefined,
      email: editEmail || undefined,
      birthday: editBirthday || undefined,
      tags: editTags,
      notes: editNotes,
    } as Partial<PosCustomer>)
  }

  const toggleTag = (tag: string) => {
    setEditTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] flex items-center justify-center text-sm font-bold text-[var(--text-2)]">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-1)]">{customer.name}</h3>
              <p className="text-xs text-[var(--text-4)]">
                Cliente desde {customer.first_visit ? new Date(customer.first_visit).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }) : '--'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4">
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-3 text-center">
            <p className="text-lg font-bold text-[var(--text-1)] font-mono">{customer.total_visits}</p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)]">Visitas</p>
          </div>
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-3 text-center">
            <p className="text-lg font-bold text-emerald-400 font-mono">{formatCurrency(customer.total_spent)}</p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)]">Gasto total</p>
          </div>
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-3 text-center">
            <p className="text-lg font-bold text-[var(--text-1)] font-mono">{formatCurrency(customer.avg_ticket)}</p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)]">Ticket prom.</p>
          </div>
        </div>

        {/* Info / Edit */}
        <div className="px-6 pb-4">
          {!editing ? (
            <div className="space-y-3">
              {/* Contact info */}
              <div className="flex items-center gap-4 text-sm flex-wrap">
                {customer.phone && (
                  <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                    <Phone size={12} className="text-[var(--text-4)]" />
                    {customer.phone}
                  </span>
                )}
                {customer.email && (
                  <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                    <Mail size={12} className="text-[var(--text-4)]" />
                    {customer.email}
                  </span>
                )}
                {customer.birthday && (
                  <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                    <Gift size={12} className="text-[var(--text-4)]" />
                    {new Date(customer.birthday + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}
                  </span>
                )}
              </div>
              {/* Tags */}
              {customer.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customer.tags.map(tag => (
                    <span key={tag} className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      tag === 'VIP' ? 'bg-amber-500/15 text-amber-400' : 'bg-[var(--surface-2)] text-[var(--text-4)]'
                    }`}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {/* Notes */}
              {customer.notes && (
                <p className="text-xs text-[var(--text-3)] italic">{customer.notes}</p>
              )}
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Editar info
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">Nombre</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Telefono</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-3)] mb-1">Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">Cumpleanos</label>
                <input
                  type="date"
                  value={editBirthday}
                  onChange={e => setEditBirthday(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-2">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {COMMON_TAGS.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        editTags.includes(tag)
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                          : 'bg-[var(--surface)] border border-[var(--line)] text-[var(--text-3)]'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-3)] mb-1">Notas</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-[var(--text-3)]">Cancelar</button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-colors"
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Visit history */}
        <div className="px-6 pb-6">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-4)] mb-3">
            Historial de visitas
          </h4>
          {loadingVisits ? (
            <p className="text-xs text-[var(--text-4)]">Cargando...</p>
          ) : visits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
              <p className="text-sm text-[var(--text-4)]">Sin visitas registradas aun.</p>
              <p className="text-[10px] text-[var(--text-4)] mt-1">Las visitas se registran automaticamente al vincular ordenes del POS.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visits.map(visit => (
                <div key={visit.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)]">
                  <div>
                    <p className="text-sm text-[var(--text-1)] font-mono">{formatCurrency(visit.amount)}</p>
                    <p className="text-[10px] text-[var(--text-4)]">
                      {visit.items_count} items
                      {visit.order_id && ` | Orden ${visit.order_id.slice(0, 8)}`}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--text-3)]">
                    {new Date(visit.visited_at).toLocaleDateString('es-MX', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
