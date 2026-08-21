'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Users, Search, Plus, X, Phone, Mail, Calendar, ChevronRight,
  Repeat, Tag, Eye, Star, Gift, MessageCircle, Clock, Check,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { generateRecoveryMessage, generateWhatsAppLink, isWhatsAppablePhone } from '@/lib/whatsapp-crm'

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

import { getActiveClientSlug as clientId, getAuthToken } from '@/lib/data'

// Headers AUTENTICADOS. El CRM antes usaba la ANON key como Bearer → RLS de
// pos_customers bloquea a `anon` (sin grants SELECT/UPDATE) → lecturas y escrituras
// fallaban en silencio (0 clientes). getAuthToken() devuelve el access_token de la
// sesión (con timeout + fallback a anon), igual que el resto del dashboard (data.ts).
async function authHdrs(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
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
  const [showRecovery, setShowRecovery] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null)

  const cid = clientId()

  // ─── Fetch customers ────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    try {
      const url = `${SUPABASE_URL}/rest/v1/pos_customers?client_id=eq.${cid}&select=*&order=total_visits.desc&limit=1000`
      const res = await fetch(url, { headers: await authHdrs() })
      if (res.ok) {
        const data = await res.json()
        setCustomers(data.map((r: Record<string, unknown>) => ({
          ...r,
          tags: Array.isArray(r.tags) ? r.tags : [],
          phone: r.phone || '',
          email: r.email || '',
          notes: r.notes || '',
        })))
      } else {
        console.error('[CRM] Error:', res.status, await res.text().then(t => t.slice(0, 200)))
      }
    } catch (e) { console.error('[CRM] Fetch failed:', e) }
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
          headers: { ...(await authHdrs()), Prefer: 'return=representation' },
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
          headers: { ...(await authHdrs()), Prefer: 'return=representation' },
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

  // ─── OP-44: marcar como contactado (recuperación) ───────────────
  // Tracking sin tabla nueva: tag 'contactado' (filtrable, ya se muestra) + línea
  // fechada en notes. PATCH propio (NO reusa handleUpdateCustomer para no arrastrar
  // su side-effect setSelectedCustomer(null)): optimista + filtro de tenant + revert.
  const markContacted = async (c: PosCustomer) => {
    if (c.tags?.includes('contactado')) return  // idempotente — ya contactado, no re-escribe
    const tags = [...(c.tags || []), 'contactado']
    const stamp = new Date().toISOString().slice(0, 10)
    const note = `${c.notes ? c.notes + '\n' : ''}Contactado (recuperación) ${stamp}`.slice(0, 2000)
    setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, tags, notes: note } : x))  // optimista
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_customers?id=eq.${c.id}&client_id=eq.${cid}`,  // filtro tenant (defensa)
        { method: 'PATCH', headers: { ...(await authHdrs()), Prefer: 'return=minimal' }, body: JSON.stringify({ tags, notes: note }) }
      )
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setCustomers(prev => prev.map(x => x.id === c.id ? c : x))  // revertir si falló
    }
  }

  // Import customers from reservations
  const importFromReservations = async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/reservaciones?client_id=eq.${clientId()}&select=nombre,telefono,fecha,total&order=fecha.desc&limit=500`,
        { headers: await authHdrs() }
      )
      if (!res.ok) return
      const reservations = await res.json()

      // Dedupe by phone or name
      const seen = new Map<string, { nombre: string; telefono: string; total: number; visits: number; firstVisit: string; lastVisit: string }>()
      for (const r of reservations) {
        const key = r.telefono || r.nombre
        if (!key) continue
        const existing = seen.get(key)
        if (existing) {
          existing.visits++
          existing.total += Number(r.total) || 0
          if (r.fecha < existing.firstVisit) existing.firstVisit = r.fecha
          if (r.fecha > existing.lastVisit) existing.lastVisit = r.fecha
        } else {
          seen.set(key, {
            nombre: r.nombre,
            telefono: r.telefono || '',
            total: Number(r.total) || 0,
            visits: 1,
            firstVisit: r.fecha,
            lastVisit: r.fecha,
          })
        }
      }

      // Insert batch
      const batch = Array.from(seen.values()).map(c => ({
        client_id: cid,
        name: c.nombre,
        phone: c.telefono || null,
        total_visits: c.visits,
        total_spent: c.total,
        avg_ticket: c.visits > 0 ? Math.round(c.total / c.visits) : 0,
        first_visit: c.firstVisit,
        last_visit: c.lastVisit,
        tags: c.visits >= 3 ? ['frecuente'] : [],
      }))

      if (batch.length === 0) return

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_customers`, {
        method: 'POST',
        headers: { ...(await authHdrs()), Prefer: 'return=representation' },
        body: JSON.stringify(batch),
      })

      if (insertRes.ok) {
        loadCustomers()
      }
    } catch (e) {
      console.error('[CRM] Import error:', e)
    }
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
      <div className="mb-6 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-center justify-between">
        <span>
          <strong>Integracion POS:</strong> Los clientes se vinculan a ordenes al momento del pago ingresando su telefono. Esto actualiza automaticamente visitas, gasto total y ticket promedio.
        </span>
        {customers.length === 0 && (
          <button
            onClick={importFromReservations}
            className="ml-4 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors whitespace-nowrap"
          >
            Importar desde reservaciones
          </button>
        )}
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
          onClick={() => setShowRecovery(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-[var(--text-2)] text-sm font-medium hover:text-[var(--text-1)] hover:border-emerald-500/40 transition-colors"
          title="Reactivar clientes que no han vuelto"
        >
          <MessageCircle size={16} />
          Recuperación
        </button>
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

      {/* OP-44: recuperación de clientes inactivos vía WhatsApp */}
      {showRecovery && (
        <RecoveryModal
          customers={customers}
          restaurantSlug={cid}
          onMarkContacted={markContacted}
          onClose={() => setShowRecovery(false)}
        />
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
          { headers: await authHdrs() }
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

// ─── OP-44: Recuperación de clientes inactivos vía WhatsApp ─────────
// Corte A (manual, sin Meta): filtra inactivos con teléfono, arma el mensaje con la
// lib de dominio whatsapp-crm.ts y abre wa.me pre-llenado. El botón "enviar" se
// cambiará por la WhatsApp Business API cuando Meta esté aprobado — la UI y el
// tracking (tag 'contactado') no se tiran. Ver OP-44 en docs/state/OPEN-ITEMS.md.
function RecoveryModal({ customers, restaurantSlug, onMarkContacted, onClose }: {
  customers: PosCustomer[]
  restaurantSlug: string
  onMarkContacted: (c: PosCustomer) => void
  onClose: () => void
}) {
  const [days, setDays] = useState(30)
  const [incentive, setIncentive] = useState('un postre de cortesía')
  const [validDays, setValidDays] = useState('lunes a viernes')
  const [restaurantName, setRestaurantName] = useState(
    restaurantSlug ? restaurantSlug.charAt(0).toUpperCase() + restaurantSlug.slice(1) : 'el restaurante'
  )

  const inactivos = useMemo(() => {
    return customers
      .filter(c => isWhatsAppablePhone(c.phone) && daysSince(c.last_visit) >= days)
      .sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0))
  }, [customers, days])

  const potencial = useMemo(
    () => inactivos.reduce((sum, c) => sum + (c.avg_ticket || 0), 0),
    [inactivos]
  )

  const openWhatsApp = (c: PosCustomer) => {
    const message = generateRecoveryMessage({
      clientName: (c.name || '').split(' ')[0] || c.name,
      phone: c.phone,
      incentive,
      restaurantName,
      validDays,
    })
    const w = window.open(generateWhatsAppLink(c.phone, message), '_blank')
    if (w) w.opener = null  // anti reverse-tabnabbing sin pasar features string (evita abrir ventana en vez de pestaña)
    onMarkContacted(c)
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-1)] flex items-center gap-2"><MessageCircle size={18} className="text-emerald-400" /> Recuperación de clientes</h3>
            <p className="text-xs text-[var(--text-3)] mt-0.5">{inactivos.length} sin volver hace {days}+ días · potencial ~{formatCurrency(potencial)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text-3)]"><X size={16} /></button>
        </div>

        {/* Config */}
        <div className="px-6 py-4 border-b border-[var(--line)] space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-3)] w-28">Sin volver hace</span>
            {[30, 60, 90].map(d => (
              <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${days === d ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-3)]'}`}>{d} días</button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div><label className="block text-[10px] uppercase tracking-wide text-[var(--text-4)] mb-1">Incentivo</label><input value={incentive} onChange={e => setIncentive(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-[10px] uppercase tracking-wide text-[var(--text-4)] mb-1">Restaurante</label><input value={restaurantName} onChange={e => setRestaurantName(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-[10px] uppercase tracking-wide text-[var(--text-4)] mb-1">Válido</label><input value={validDays} onChange={e => setValidDays(e.target.value)} className={inputCls} /></div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {inactivos.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--text-4)]">Ningún cliente inactivo con teléfono en este rango. 🎉</div>
          ) : inactivos.map(c => {
            const contactado = c.tags?.includes('contactado')
            return (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-1)] truncate">{c.name}</span>
                    {contactado && <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400"><Check size={9} /> contactado</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[var(--text-4)] mt-0.5">
                    <span className="flex items-center gap-1"><Clock size={10} /> {relativeDate(c.last_visit)}</span>
                    <span>{c.total_visits} visitas</span>
                    <span>{formatCurrency(c.total_spent || 0)}</span>
                  </div>
                </div>
                <button
                  onClick={() => openWhatsApp(c)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium whitespace-nowrap"
                  title="Abrir WhatsApp con el mensaje listo"
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[var(--line)] text-[11px] text-[var(--text-4)]">
          El botón abre WhatsApp con el mensaje pre-llenado (envío manual). Al abrirlo se marca al cliente como <b>contactado</b>. El envío automático en lote llega cuando se apruebe la WhatsApp Business API (Meta).
        </div>
      </div>
    </div>
  )
}
