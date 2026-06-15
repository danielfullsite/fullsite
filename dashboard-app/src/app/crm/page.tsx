'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Users, UserX, Target, CheckCircle2, Search, Plus, Upload, Download,
  Send, Eye, Clock, MessageCircle, Phone, Mail, Calendar, ChevronRight,
  X, ArrowRight, AlertCircle, ExternalLink, Filter, MoreHorizontal,
  Sparkles, TrendingUp, RefreshCw,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'
import { generateRecoveryMessage, generateWhatsAppLink, generateBulkMessages } from '@/lib/whatsapp-crm'

// ─── Types ───────────────────────────────────────────────────────────
interface CRMClient {
  id: string
  name: string
  phone: string
  email: string
  source: string
  first_visit: string | null
  last_visit: string | null
  total_visits: number
  avg_ticket: number
  tags: string[]
  notes: string
}

interface Campaign {
  id: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  target_days_inactive: number
  incentive: string
  message_template: string
  total_sent: number
  total_responded: number
  total_confirmed: number
  total_recovered_revenue: number
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface RecoveryMsg {
  id: string
  campaign_id: string
  crm_client_id: string
  client_name?: string
  phone: string
  message_sent: string
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'responded' | 'reserved' | 'confirmed' | 'no_show'
  sent_at: string | null
  responded_at: string | null
  response_text: string
  reservation_date: string | null
  reservation_time: string | null
  reservation_guests: number | null
  confirmed_arrival: boolean
  ticket_amount: number | null
  created_at: string
}

type Tab = 'clientes' | 'campanas' | 'mensajes'
type ClientFilter = 'todos' | 'activos' | 'inactivos' | 'perdidos'
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

// ─── Storage helpers ─────────────────────────────────────────────────
const STORAGE_KEYS = {
  clients: 'crm_clients',
  campaigns: 'crm_campaigns',
  messages: 'crm_messages',
}

function loadFromStorage<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function saveToStorage<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data))
}

function uuid(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999
  // Handle both YYYY-MM-DD and DD/MM/YYYY formats
  let d: Date
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/')
    if (parts.length === 3) {
      d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}T12:00:00`)
    } else {
      d = new Date(dateStr + 'T12:00:00')
    }
  } else {
    d = new Date(dateStr + 'T12:00:00')
  }
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function daysColor(days: number): string {
  if (days < 30) return 'text-emerald-400'
  if (days < 60) return 'text-yellow-400'
  if (days < 120) return 'text-orange-400'
  return 'text-red-400'
}

function daysBadgeColor(days: number): string {
  if (days < 30) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  if (days < 60) return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20'
  if (days < 120) return 'bg-orange-500/15 text-orange-400 border-orange-500/20'
  return 'bg-red-500/15 text-red-400 border-red-500/20'
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-zinc-500/15 text-zinc-400'
    case 'sent': return 'bg-blue-500/15 text-blue-400'
    case 'delivered': return 'bg-cyan-500/15 text-cyan-400'
    case 'read': return 'bg-purple-500/15 text-purple-400'
    case 'responded': return 'bg-amber-500/15 text-amber-400'
    case 'reserved': return 'bg-indigo-500/15 text-indigo-400'
    case 'confirmed': return 'bg-emerald-500/15 text-emerald-400'
    case 'no_show': return 'bg-red-500/15 text-red-400'
    default: return 'bg-zinc-500/15 text-zinc-400'
  }
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendiente',
    sent: 'Enviado',
    delivered: 'Entregado',
    read: 'Leido',
    responded: 'Respondio',
    reserved: 'Reservo',
    confirmed: 'Confirmado',
    no_show: 'No Show',
    draft: 'Borrador',
    active: 'Activa',
    paused: 'Pausada',
    completed: 'Completada',
  }
  return labels[status] || status
}

// ─── Demo data ───────────────────────────────────────────────────────
const DEMO_CLIENTS: CRMClient[] = [
  { id: uuid(), name: 'Maria Garcia Lopez', phone: '8112345678', email: 'maria@gmail.com', source: 'opentable', first_visit: '2025-06-15', last_visit: '2026-05-20', total_visits: 12, avg_ticket: 485, tags: ['vip'], notes: 'Prefiere mesa en jardin' },
  { id: uuid(), name: 'Carlos Ramirez', phone: '8119876543', email: 'carlos.r@outlook.com', source: 'reserve', first_visit: '2025-09-01', last_visit: '2026-03-10', total_visits: 5, avg_ticket: 320, tags: ['inactive'], notes: '' },
  { id: uuid(), name: 'Ana Rodriguez', phone: '8113456789', email: '', source: 'walk-in', first_visit: '2026-01-20', last_visit: '2026-01-20', total_visits: 1, avg_ticket: 290, tags: [], notes: 'Primera visita' },
  { id: uuid(), name: 'Roberto Gonzalez Trevino', phone: '8117654321', email: 'roberto.gt@gmail.com', source: 'opentable', first_visit: '2025-03-08', last_visit: '2025-11-15', total_visits: 8, avg_ticket: 520, tags: ['vip', 'inactive'], notes: 'Cumple 15 nov' },
  { id: uuid(), name: 'Sofia Martinez', phone: '8112223344', email: 'sofi.mtz@hotmail.com', source: 'manual', first_visit: '2026-04-01', last_visit: '2026-05-18', total_visits: 3, avg_ticket: 410, tags: ['regular'], notes: '' },
]

// ─── Main Component ──────────────────────────────────────────────────
export default function CRMPage() {
  const [tab, setTab] = useState<Tab>('clientes')
  const [clients, setClients] = useState<CRMClient[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [messages, setMessages] = useState<RecoveryMsg[]>([])
  const [loading, setLoading] = useState(true)

  // Load clients from Supabase pos_clients (real data from Reservy)
  useEffect(() => {
    const cid = typeof window !== 'undefined' ? (localStorage.getItem('fullsite_client_id') || 'amalay') : 'amalay'
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    async function loadClients() {
      try {
        const res = await fetch(
          `${sbUrl}/rest/v1/pos_clients?client_id=eq.${cid}&select=id,nombre,apellido,telefono,email,cumpleanos,visitas,ultima_visita,gasto_total,gasto_por_visita,tags,notas,source&order=visitas.desc&limit=5000`,
          { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
        )
        if (res.ok) {
          const data = await res.json()
          const mapped: CRMClient[] = data.map((r: Record<string, unknown>) => ({
            id: String(r.id),
            name: [r.nombre, r.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre',
            phone: String(r.telefono || ''),
            email: String(r.email || ''),
            source: String(r.source || 'manual'),
            first_visit: null,
            last_visit: r.ultima_visita ? String(r.ultima_visita) : null,
            total_visits: Number(r.visitas) || 0,
            avg_ticket: Number(r.gasto_por_visita) || 0,
            tags: r.tags ? String(r.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [],
            notes: String(r.notas || ''),
          }))
          if (mapped.length > 0) {
            setClients(mapped)
          } else {
            setClients(DEMO_CLIENTS)
          }
        } else {
          setClients(DEMO_CLIENTS)
        }
      } catch {
        setClients(DEMO_CLIENTS)
      }

      const camp = loadFromStorage<Campaign>(STORAGE_KEYS.campaigns, [])
      const msgs = loadFromStorage<RecoveryMsg>(STORAGE_KEYS.messages, [])
      setCampaigns(camp)
      setMessages(msgs)
      setLoading(false)
    }
    loadClients()
  }, [])

  // Persist on change
  useEffect(() => { if (!loading) saveToStorage(STORAGE_KEYS.clients, clients) }, [clients, loading])
  useEffect(() => { if (!loading) saveToStorage(STORAGE_KEYS.campaigns, campaigns) }, [campaigns, loading])
  useEffect(() => { if (!loading) saveToStorage(STORAGE_KEYS.messages, messages) }, [messages, loading])

  // KPIs
  const totalClients = clients.length
  const inactive60 = clients.filter(c => daysSince(c.last_visit) >= 60).length
  const activeCampaigns = campaigns.filter(c => c.status === 'active').length
  const recoveredThisMonth = messages.filter(m => {
    if (m.status !== 'confirmed') return false
    const now = new Date()
    const sent = m.sent_at ? new Date(m.sent_at) : null
    return sent && sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear()
  }).length

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[var(--text-3)]">Cargando CRM...</div>
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="CRM — Recuperacion de Clientes"
        subtitle="Reemplaza Bernardo ($18/cliente). Campanas de WhatsApp para recuperar clientes inactivos."
        eyebrow="CRM"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Total Clientes" value={String(totalClients)} icon={Users} accentClass="kpi-accent-blue" index={0} />
        <KPICard label="Inactivos 60+ dias" value={String(inactive60)} icon={UserX} accentClass="kpi-accent-amber" index={1} />
        <KPICard label="Campanas Activas" value={String(activeCampaigns)} icon={Target} accentClass="kpi-accent-purple" index={2} />
        <KPICard label="Recuperados (mes)" value={String(recoveredThisMonth)} icon={CheckCircle2} accentClass="kpi-accent-green" index={3} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl bg-[var(--surface)] border border-[var(--line)]">
        {([
          { key: 'clientes' as Tab, label: 'Clientes', icon: Users },
          { key: 'campanas' as Tab, label: 'Campañas', icon: Target },
          { key: 'mensajes' as Tab, label: 'Mensajes', icon: MessageCircle },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'clientes' && (
        <ClientesTab clients={clients} setClients={setClients} />
      )}
      {tab === 'campanas' && (
        <CampanasTab
          clients={clients}
          campaigns={campaigns}
          setCampaigns={setCampaigns}
          messages={messages}
          setMessages={setMessages}
        />
      )}
      {tab === 'mensajes' && (
        <MensajesTab messages={messages} setMessages={setMessages} clients={clients} campaigns={campaigns} />
      )}
    </div>
  )
}

// ─── Tab 1: Clientes ─────────────────────────────────────────────────
function ClientesTab({ clients, setClients }: {
  clients: CRMClient[]
  setClients: React.Dispatch<React.SetStateAction<CRMClient[]>>
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ClientFilter>('todos')
  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editClient, setEditClient] = useState<CRMClient | null>(null)

  const filtered = useMemo(() => {
    let list = clients
    // Filter by status
    if (filter === 'activos') list = list.filter(c => daysSince(c.last_visit) < 60)
    else if (filter === 'inactivos') list = list.filter(c => { const d = daysSince(c.last_visit); return d >= 60 && d < 180 })
    else if (filter === 'perdidos') list = list.filter(c => daysSince(c.last_visit) >= 180)
    // Search
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(s) ||
        (c.phone || '').includes(s) ||
        (c.email || '').toLowerCase().includes(s)
      )
    }
    return list.sort((a, b) => daysSince(b.last_visit) - daysSince(a.last_visit))
  }, [clients, filter, search])

  const filterCounts = useMemo(() => ({
    todos: clients.length,
    activos: clients.filter(c => daysSince(c.last_visit) < 60).length,
    inactivos: clients.filter(c => { const d = daysSince(c.last_visit); return d >= 60 && d < 180 }).length,
    perdidos: clients.filter(c => daysSince(c.last_visit) >= 180).length,
  }), [clients])

  const handleAddClient = (client: Omit<CRMClient, 'id'>) => {
    setClients(prev => [...prev, { ...client, id: uuid() }])
    setShowAdd(false)
  }

  const handleUpdateClient = (updated: CRMClient) => {
    setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    setEditClient(null)
  }

  const handleDeleteClient = (id: string) => {
    setClients(prev => prev.filter(c => c.id !== id))
  }

  const handleImport = (imported: Omit<CRMClient, 'id'>[]) => {
    const newClients = imported.map(c => ({ ...c, id: uuid() }))
    setClients(prev => [...prev, ...newClients])
    setShowImport(false)
  }

  return (
    <>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, telefono o email..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-2)] hover:border-emerald-500/50 hover:text-emerald-400 transition-all"
        >
          <Upload size={16} />
          Importar CSV
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
        >
          <Plus size={16} />
          Agregar Cliente
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {([
          { key: 'todos' as ClientFilter, label: 'Todos' },
          { key: 'activos' as ClientFilter, label: 'Activos (<60d)' },
          { key: 'inactivos' as ClientFilter, label: 'Inactivos (60-180d)' },
          { key: 'perdidos' as ClientFilter, label: 'Perdidos (180d+)' },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              filter === f.key
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)] bg-[var(--surface)] border border-[var(--line)]'
            }`}
          >
            {f.label}
            <span className="text-[10px] opacity-60">({filterCounts[f.key]})</span>
          </button>
        ))}
      </div>

      {/* Client list */}
      <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: 'var(--surface)' }}>
        {/* Header */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_0.7fr_0.8fr_0.7fr_0.5fr] gap-4 px-5 py-3 border-b border-[var(--line)] text-[10px] uppercase tracking-[0.15em] font-mono text-[var(--text-4)]">
          <span>Cliente</span>
          <span>Telefono</span>
          <span>Ultima visita</span>
          <span>Dias</span>
          <span>Visitas</span>
          <span>Ticket prom.</span>
          <span></span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-4)] text-sm">
            No se encontraron clientes
          </div>
        ) : (
          filtered.map(client => {
            const days = daysSince(client.last_visit)
            return (
              <div
                key={client.id}
                className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_0.7fr_0.8fr_0.7fr_0.5fr] gap-2 md:gap-4 px-5 py-3.5 border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer group"
                onClick={() => setEditClient(client)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-xs font-bold text-[var(--text-3)]">
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-1)]">{client.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {client.tags.map(tag => (
                        <span key={tag} className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-4)]">
                          {tag}
                        </span>
                      ))}
                      <span className="text-[10px] text-[var(--text-4)]">{client.source}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center text-sm text-[var(--text-2)]">
                  {client.phone || <span className="text-[var(--text-4)]">--</span>}
                </div>
                <div className="flex items-center text-sm text-[var(--text-3)]">
                  {client.last_visit || '--'}
                </div>
                <div className="flex items-center">
                  <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-md border ${daysBadgeColor(days)}`}>
                    {days === 999 ? '--' : `${days}d`}
                  </span>
                </div>
                <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                  {client.total_visits}
                </div>
                <div className="flex items-center text-sm text-[var(--text-2)] font-mono">
                  {formatCurrency(client.avg_ticket)}
                </div>
                <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight size={16} className="text-[var(--text-4)]" />
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Modals */}
      {showImport && <CSVImportModal onClose={() => setShowImport(false)} onImport={handleImport} />}
      {showAdd && <ClientFormModal onClose={() => setShowAdd(false)} onSave={handleAddClient} />}
      {editClient && (
        <ClientFormModal
          client={editClient}
          onClose={() => setEditClient(null)}
          onSave={(c) => handleUpdateClient({ ...c, id: editClient.id } as CRMClient)}
          onDelete={() => { handleDeleteClient(editClient.id); setEditClient(null) }}
        />
      )}
    </>
  )
}

// ─── Tab 2: Campanas ─────────────────────────────────────────────────
function CampanasTab({ clients, campaigns, setCampaigns, messages, setMessages }: {
  clients: CRMClient[]
  campaigns: Campaign[]
  setCampaigns: React.Dispatch<React.SetStateAction<Campaign[]>>
  messages: RecoveryMsg[]
  setMessages: React.Dispatch<React.SetStateAction<RecoveryMsg[]>>
}) {
  const [showWizard, setShowWizard] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)

  const handleLaunch = (campaign: Campaign) => {
    // Find target clients
    const targetClients = clients.filter(c =>
      daysSince(c.last_visit) >= campaign.target_days_inactive && c.phone
    )
    // Generate messages
    const newMessages: RecoveryMsg[] = targetClients.map(c => ({
      id: uuid(),
      campaign_id: campaign.id,
      crm_client_id: c.id,
      client_name: c.name,
      phone: c.phone,
      message_sent: (campaign.message_template || generateRecoveryMessage({
        clientName: c.name,
        phone: c.phone,
        incentive: campaign.incentive || 'un detalle especial',
        restaurantName: 'Tu Restaurante',
        validDays: 'lunes a viernes',
      })).replace('{name}', c.name),
      status: 'pending' as const,
      sent_at: null,
      responded_at: null,
      response_text: '',
      reservation_date: null,
      reservation_time: null,
      reservation_guests: null,
      confirmed_arrival: false,
      ticket_amount: null,
      created_at: new Date().toISOString(),
    }))

    const updatedCampaign: Campaign = {
      ...campaign,
      status: 'active',
      total_sent: targetClients.length,
      started_at: new Date().toISOString(),
    }

    setCampaigns(prev => prev.map(c => c.id === campaign.id ? updatedCampaign : c))
    setMessages(prev => [...prev, ...newMessages])
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-[var(--text-3)]">{campaigns.length} campañas</p>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
        >
          <Plus size={16} />
          Nueva Campana
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] p-12 text-center">
          <Target size={40} className="mx-auto mb-3 text-[var(--text-4)]" />
          <p className="text-[var(--text-2)] font-medium mb-1">Sin campañas</p>
          <p className="text-sm text-[var(--text-4)] mb-4">Crea tu primera campana de recuperacion para contactar clientes inactivos</p>
          <button
            onClick={() => setShowWizard(true)}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
          >
            Crear Campana
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(campaign => {
            const campMessages = messages.filter(m => m.campaign_id === campaign.id)
            const responseRate = campaign.total_sent > 0
              ? ((campaign.total_responded / campaign.total_sent) * 100).toFixed(1)
              : '0'
            return (
              <div
                key={campaign.id}
                className="rounded-2xl border border-[var(--line)] p-5 hover:border-[var(--accent-line)] transition-all cursor-pointer"
                style={{ background: 'var(--surface)' }}
                onClick={() => setSelectedCampaign(campaign)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-[var(--text-1)]">{campaign.name}</h3>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${statusColor(campaign.status)}`}>
                        {statusLabel(campaign.status)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-4)]">
                      Target: {campaign.target_days_inactive}+ dias inactivos
                      {campaign.incentive && ` | Incentivo: ${campaign.incentive}`}
                    </p>
                  </div>
                  {campaign.status === 'draft' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLaunch(campaign) }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-colors"
                    >
                      <Send size={12} />
                      Lanzar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] mb-0.5">Enviados</p>
                    <p className="text-lg font-bold text-[var(--text-1)] font-mono">{campaign.total_sent}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] mb-0.5">Respondieron</p>
                    <p className="text-lg font-bold text-[var(--text-1)] font-mono">{campaign.total_responded}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] mb-0.5">Confirmados</p>
                    <p className="text-lg font-bold text-emerald-400 font-mono">{campaign.total_confirmed}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-4)] mb-0.5">Tasa resp.</p>
                    <p className="text-lg font-bold text-[var(--text-1)] font-mono">{responseRate}%</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Wizard modal */}
      {showWizard && (
        <CampaignWizard
          clients={clients}
          onClose={() => setShowWizard(false)}
          onCreate={(campaign) => {
            setCampaigns(prev => [...prev, campaign])
            setShowWizard(false)
          }}
        />
      )}

      {/* Campaign detail modal */}
      {selectedCampaign && (
        <CampaignDetailModal
          campaign={selectedCampaign}
          messages={messages.filter(m => m.campaign_id === selectedCampaign.id)}
          clients={clients}
          onClose={() => setSelectedCampaign(null)}
          onUpdateMessage={(msgId, updates) => {
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...updates } : m))
            // Update campaign counters
            const campMsgs = messages.filter(m => m.campaign_id === selectedCampaign.id)
            const updated = campMsgs.map(m => m.id === msgId ? { ...m, ...updates } : m)
            setCampaigns(prev => prev.map(c => c.id === selectedCampaign.id ? {
              ...c,
              total_responded: updated.filter(m => ['responded', 'reserved', 'confirmed'].includes(m.status)).length,
              total_confirmed: updated.filter(m => m.status === 'confirmed').length,
            } : c))
          }}
        />
      )}
    </>
  )
}

// ─── Tab 3: Mensajes ─────────────────────────────────────────────────
function MensajesTab({ messages, setMessages, clients, campaigns }: {
  messages: RecoveryMsg[]
  setMessages: React.Dispatch<React.SetStateAction<RecoveryMsg[]>>
  clients: CRMClient[]
  campaigns: Campaign[]
}) {
  const sorted = useMemo(() =>
    [...messages].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [messages]
  )

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId)
    return client?.name || 'Desconocido'
  }

  const getCampaignName = (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId)
    return campaign?.name || '--'
  }

  const updateStatus = (msgId: string, status: RecoveryMsg['status']) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status } : m))
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] p-12 text-center">
        <MessageCircle size={40} className="mx-auto mb-3 text-[var(--text-4)]" />
        <p className="text-[var(--text-2)] font-medium mb-1">Sin mensajes</p>
        <p className="text-sm text-[var(--text-4)]">Los mensajes apareceran aqui cuando lances una campana</p>
      </div>
    )
  }

  // Status pipeline
  const statuses = ['pending', 'sent', 'delivered', 'read', 'responded', 'reserved', 'confirmed', 'no_show']
  const statusCounts = statuses.map(s => ({
    status: s,
    count: messages.filter(m => m.status === s).length,
  }))

  return (
    <>
      {/* Pipeline summary */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
        {statusCounts.map(sc => (
          <div key={sc.status} className={`flex-1 min-w-[80px] px-3 py-2 rounded-lg text-center ${statusColor(sc.status)}`}>
            <p className="text-lg font-bold font-mono">{sc.count}</p>
            <p className="text-[9px] uppercase tracking-wider">{statusLabel(sc.status)}</p>
          </div>
        ))}
      </div>

      {/* Messages timeline */}
      <div className="space-y-2">
        {sorted.map(msg => (
          <div
            key={msg.id}
            className="rounded-xl border border-[var(--line)] p-4 hover:border-[var(--accent-line)] transition-all"
            style={{ background: 'var(--surface)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-[var(--text-1)]">
                    {msg.client_name || getClientName(msg.crm_client_id)}
                  </p>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${statusColor(msg.status)}`}>
                    {statusLabel(msg.status)}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-4)] mb-1">
                  {msg.phone} | Campana: {getCampaignName(msg.campaign_id)}
                </p>
                <p className="text-xs text-[var(--text-3)] line-clamp-2">{msg.message_sent}</p>
                {msg.response_text && (
                  <div className="mt-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] border-l-2 border-emerald-500">
                    <p className="text-xs text-[var(--text-2)]">{msg.response_text}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {msg.status !== 'confirmed' && msg.status !== 'no_show' && (
                  <>
                    <button
                      onClick={() => updateStatus(msg.id, 'confirmed')}
                      title="Marcar como confirmado (si visito)"
                      className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-[var(--text-4)] hover:text-emerald-400 transition-colors"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      onClick={() => updateStatus(msg.id, 'no_show')}
                      title="Marcar como no show"
                      className="p-1.5 rounded-lg hover:bg-red-500/15 text-[var(--text-4)] hover:text-red-400 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
                {msg.phone && (
                  <a
                    href={generateWhatsAppLink(msg.phone, msg.message_sent || '')}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title="Abrir en WhatsApp"
                    className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-[var(--text-4)] hover:text-emerald-400 transition-colors"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-4)]">
              <span>{new Date(msg.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              {msg.reservation_date && (
                <span className="text-indigo-400">Reservacion: {msg.reservation_date} {msg.reservation_time} ({msg.reservation_guests} personas)</span>
              )}
              {msg.ticket_amount && (
                <span className="text-emerald-400">Consumo: {formatCurrency(msg.ticket_amount)}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Campaign Wizard ─────────────────────────────────────────────────
function CampaignWizard({ clients, onClose, onCreate }: {
  clients: CRMClient[]
  onClose: () => void
  onCreate: (campaign: Campaign) => void
}) {
  const [step, setStep] = useState<WizardStep>(1)
  const [name, setName] = useState('')
  const [targetDays, setTargetDays] = useState(60)
  const [customDays, setCustomDays] = useState('')
  const [template, setTemplate] = useState(
    'Hola {name}, te habla el conserje digital de {restaurant}. Hace tiempo que no te vemos y nos encantaria regalarte {incentive} en tu proxima visita. Yo te puedo ayudar con tu reservacion, si te interesa visitarnos, contestame aqui y yo me encargo del resto. Promocion valida de {valid_days}.'
  )
  const [incentive, setIncentive] = useState('')

  const targetClients = useMemo(() =>
    clients.filter(c => daysSince(c.last_visit) >= (customDays ? Number(customDays) : targetDays) && c.phone),
    [clients, targetDays, customDays]
  )

  const previewMessage = useMemo(() => {
    const sampleName = targetClients[0]?.name || 'Maria Garcia'
    return template
      .replace('{name}', sampleName)
      .replace('{incentive}', incentive || 'un detalle especial')
      .replace('{restaurant}', 'Tu Restaurante')
      .replace('{valid_days}', 'lunes a viernes')
  }, [template, incentive, targetClients])

  const handleCreate = () => {
    const campaign: Campaign = {
      id: uuid(),
      name,
      status: 'draft',
      target_days_inactive: customDays ? Number(customDays) : targetDays,
      incentive,
      message_template: template,
      total_sent: 0,
      total_responded: 0,
      total_confirmed: 0,
      total_recovered_revenue: 0,
      started_at: null,
      completed_at: null,
      created_at: new Date().toISOString(),
    }
    onCreate(campaign)
  }

  const INCENTIVES = [
    'Pan dulce gratis',
    '2x1 en cafe',
    '10% de descuento',
    'Postre gratis',
    'Bebida de cortesia',
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-1)]">Nueva Campana</h3>
            <p className="text-xs text-[var(--text-4)]">Paso {step} de 6</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="h-1 rounded-full bg-[var(--surface-2)]">
            <div className="h-1 rounded-full bg-emerald-500 transition-all" style={{ width: `${(step / 6) * 100}%` }} />
          </div>
        </div>

        <div className="px-6 py-5">
          {/* Step 1: Name */}
          {step === 1 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-2">Nombre de la campana</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Recovery Mayo 2026"
                className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          )}

          {/* Step 2: Target */}
          {step === 2 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-3">Clientes inactivos por</label>
              <div className="space-y-2">
                {[60, 90, 120].map(d => (
                  <button
                    key={d}
                    onClick={() => { setTargetDays(d); setCustomDays('') }}
                    className={`w-full px-4 py-3 rounded-xl border text-left text-sm transition-all ${
                      targetDays === d && !customDays
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--accent-line)]'
                    }`}
                  >
                    {d}+ dias sin visitar
                    <span className="ml-2 text-xs text-[var(--text-4)]">
                      ({clients.filter(c => daysSince(c.last_visit) >= d && c.phone).length} clientes)
                    </span>
                  </button>
                ))}
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={customDays}
                    onChange={e => setCustomDays(e.target.value)}
                    placeholder="Custom..."
                    className="flex-1 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
                  />
                  <span className="text-sm text-[var(--text-3)]">dias</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Message template */}
          {step === 3 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-2">
                Mensaje (usa {'{name}'} para el nombre)
              </label>
              <textarea
                value={template}
                onChange={e => setTemplate(e.target.value)}
                rows={5}
                className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50 resize-none"
              />
              <p className="text-[10px] text-[var(--text-4)] mt-1">
                Variables: {'{name}'}, {'{incentive}'}, {'{restaurant}'}, {'{valid_days}'}
              </p>
            </div>
          )}

          {/* Step 4: Preview */}
          {step === 4 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-2">Vista previa del mensaje</label>
              <div className="rounded-xl bg-[var(--surface)] border border-[var(--line)] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <MessageCircle size={12} className="text-emerald-400" />
                  </div>
                  <span className="text-xs font-medium text-emerald-400">WhatsApp</span>
                </div>
                <p className="text-sm text-[var(--text-1)] leading-relaxed">{previewMessage}</p>
              </div>
            </div>
          )}

          {/* Step 5: Incentive */}
          {step === 5 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-3">Incentivo</label>
              <div className="space-y-2 mb-3">
                {INCENTIVES.map(inc => (
                  <button
                    key={inc}
                    onClick={() => setIncentive(inc)}
                    className={`w-full px-4 py-2.5 rounded-xl border text-left text-sm transition-all ${
                      incentive === inc
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--accent-line)]'
                    }`}
                  >
                    {inc}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={incentive}
                onChange={e => setIncentive(e.target.value)}
                placeholder="O escribe otro incentivo..."
                className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          )}

          {/* Step 6: Review */}
          {step === 6 && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-2)] mb-3">Resumen</label>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-3)]">Campana</span>
                  <span className="text-[var(--text-1)] font-medium">{name || 'Sin nombre'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-3)]">Target</span>
                  <span className="text-[var(--text-1)] font-medium">{customDays || targetDays}+ dias inactivos</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-3)]">Incentivo</span>
                  <span className="text-[var(--text-1)] font-medium">{incentive || 'Sin definir'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-3)]">Clientes a contactar</span>
                  <span className="text-emerald-400 font-bold">{targetClients.length}</span>
                </div>
              </div>
              {targetClients.length === 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-400 text-xs">
                    <AlertCircle size={14} />
                    No hay clientes con telefono que cumplan el criterio. Ajusta el target o agrega mas clientes.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--line)]">
          <button
            onClick={() => step === 1 ? onClose() : setStep((step - 1) as WizardStep)}
            className="px-4 py-2 rounded-xl text-sm text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
          >
            {step === 1 ? 'Cancelar' : 'Atras'}
          </button>
          {step < 6 ? (
            <button
              onClick={() => setStep((step + 1) as WizardStep)}
              disabled={step === 1 && !name}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!name || targetClients.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles size={14} />
              Crear Campana
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Campaign Detail Modal ───────────────────────────────────────────
function CampaignDetailModal({ campaign, messages, clients, onClose, onUpdateMessage }: {
  campaign: Campaign
  messages: RecoveryMsg[]
  clients: CRMClient[]
  onClose: () => void
  onUpdateMessage: (msgId: string, updates: Partial<RecoveryMsg>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-1)]">{campaign.name}</h3>
            <p className="text-xs text-[var(--text-4)]">{messages.length} mensajes | {campaign.incentive || 'Sin incentivo'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-[var(--text-4)] py-8">No hay mensajes en esta campana. Lanza la campana para generar mensajes.</p>
          ) : (
            messages.map(msg => {
              const client = clients.find(c => c.id === msg.crm_client_id)
              return (
                <div key={msg.id} className="flex items-center gap-4 p-3 rounded-xl border border-[var(--line)] bg-[var(--surface)]">
                  <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-xs font-bold text-[var(--text-3)]">
                    {(msg.client_name || client?.name || '?').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-1)] truncate">
                      {msg.client_name || client?.name || 'Desconocido'}
                    </p>
                    <p className="text-xs text-[var(--text-4)]">{msg.phone}</p>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${statusColor(msg.status)}`}>
                    {statusLabel(msg.status)}
                  </span>
                  <div className="flex items-center gap-1">
                    {msg.phone && (
                      <a
                        href={generateWhatsAppLink(msg.phone, msg.message_sent || '')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-[var(--text-4)] hover:text-emerald-400 transition-colors"
                        title="Enviar por WhatsApp"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {msg.status !== 'confirmed' && msg.status !== 'no_show' && (
                      <>
                        <button
                          onClick={() => onUpdateMessage(msg.id, { status: 'confirmed', confirmed_arrival: true })}
                          className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-[var(--text-4)] hover:text-emerald-400 transition-colors"
                          title="Confirmo visita"
                        >
                          <CheckCircle2 size={14} />
                        </button>
                        <button
                          onClick={() => onUpdateMessage(msg.id, { status: 'no_show' })}
                          className="p-1.5 rounded-lg hover:bg-red-500/15 text-[var(--text-4)] hover:text-red-400 transition-colors"
                          title="No show"
                        >
                          <X size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CSV Import Modal ────────────────────────────────────────────────
function CSVImportModal({ onClose, onImport }: {
  onClose: () => void
  onImport: (clients: Omit<CRMClient, 'id'>[]) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({
    name: '', phone: '', email: '', last_visit: '',
  })
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload')
  const dropRef = useRef<HTMLDivElement>(null)

  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return
    // Handle quoted CSV
    const parseLine = (line: string) => {
      const result: string[] = []
      let current = ''
      let inQuotes = false
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; continue }
        if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue }
        current += char
      }
      result.push(current.trim())
      return result
    }
    const hdrs = parseLine(lines[0])
    const rws = lines.slice(1).map(parseLine).filter(r => r.length === hdrs.length)
    setHeaders(hdrs)
    setRows(rws)
    // Auto-map common column names
    const autoMap: Record<string, string> = { name: '', phone: '', email: '', last_visit: '' }
    hdrs.forEach(h => {
      const lh = h.toLowerCase()
      if (lh.includes('name') || lh.includes('nombre') || lh.includes('first') || lh.includes('guest')) autoMap.name = h
      if (lh.includes('phone') || lh.includes('telefono') || lh.includes('tel') || lh.includes('mobile')) autoMap.phone = h
      if (lh.includes('email') || lh.includes('correo') || lh.includes('mail')) autoMap.email = h
      if (lh.includes('last') || lh.includes('visit') || lh.includes('date') || lh.includes('fecha') || lh.includes('ultima')) autoMap.last_visit = h
    })
    setMapping(autoMap)
    setStep('map')
  }

  const handleFile = (f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = e => parseCSV(e.target?.result as string || '')
    reader.readAsText(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) handleFile(f)
  }

  const handleImport = () => {
    const getCol = (row: string[], field: string) => {
      const idx = headers.indexOf(mapping[field])
      return idx >= 0 ? row[idx] : ''
    }
    const imported = rows.map(row => ({
      name: getCol(row, 'name') || 'Sin nombre',
      phone: getCol(row, 'phone') || '',
      email: getCol(row, 'email') || '',
      source: 'opentable' as const,
      first_visit: null,
      last_visit: getCol(row, 'last_visit') || null,
      total_visits: 1,
      avg_ticket: 0,
      tags: [] as string[],
      notes: '',
    })).filter(c => c.name !== 'Sin nombre')
    onImport(imported)
  }

  const previewRows = rows.slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h3 className="text-base font-semibold text-[var(--text-1)]">Importar Clientes (CSV)</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          {step === 'upload' && (
            <div
              ref={dropRef}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[var(--line)] rounded-2xl p-12 text-center hover:border-emerald-500/50 transition-colors"
            >
              <Upload size={32} className="mx-auto mb-3 text-[var(--text-4)]" />
              <p className="text-sm text-[var(--text-2)] mb-1">Arrastra tu archivo CSV aqui</p>
              <p className="text-xs text-[var(--text-4)] mb-4">o selecciona un archivo</p>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium cursor-pointer hover:bg-emerald-500 transition-colors">
                <Upload size={14} />
                Seleccionar archivo
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                  }}
                />
              </label>
            </div>
          )}

          {step === 'map' && (
            <div>
              <p className="text-sm text-[var(--text-2)] mb-4">Mapea las columnas del CSV a los campos del CRM</p>
              <div className="space-y-3">
                {(['name', 'phone', 'email', 'last_visit'] as const).map(field => (
                  <div key={field} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-[var(--text-3)] capitalize">{field === 'last_visit' ? 'Ultima visita' : field === 'name' ? 'Nombre' : field === 'phone' ? 'Telefono' : 'Email'}</span>
                    <select
                      value={mapping[field]}
                      onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
                      className="flex-1 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">-- No mapear --</option>
                      {headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm text-[var(--text-3)]">Atras</button>
                <button
                  onClick={() => setStep('preview')}
                  disabled={!mapping.name}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
                >
                  Vista previa
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <p className="text-sm text-[var(--text-2)] mb-3">Primeros {previewRows.length} registros de {rows.length} total</p>
              <div className="rounded-xl border border-[var(--line)] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[var(--surface)] border-b border-[var(--line)]">
                      <th className="px-3 py-2 text-left text-[var(--text-4)] font-mono uppercase tracking-wider">Nombre</th>
                      <th className="px-3 py-2 text-left text-[var(--text-4)] font-mono uppercase tracking-wider">Telefono</th>
                      <th className="px-3 py-2 text-left text-[var(--text-4)] font-mono uppercase tracking-wider">Email</th>
                      <th className="px-3 py-2 text-left text-[var(--text-4)] font-mono uppercase tracking-wider">Ultima Visita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-[var(--line-soft)]">
                        <td className="px-3 py-2 text-[var(--text-1)]">{headers.indexOf(mapping.name) >= 0 ? row[headers.indexOf(mapping.name)] : '--'}</td>
                        <td className="px-3 py-2 text-[var(--text-2)]">{headers.indexOf(mapping.phone) >= 0 ? row[headers.indexOf(mapping.phone)] : '--'}</td>
                        <td className="px-3 py-2 text-[var(--text-2)]">{headers.indexOf(mapping.email) >= 0 ? row[headers.indexOf(mapping.email)] : '--'}</td>
                        <td className="px-3 py-2 text-[var(--text-2)]">{headers.indexOf(mapping.last_visit) >= 0 ? row[headers.indexOf(mapping.last_visit)] : '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setStep('map')} className="px-4 py-2 text-sm text-[var(--text-3)]">Atras</button>
                <button
                  onClick={handleImport}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors"
                >
                  <Download size={14} />
                  Importar {rows.length} clientes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Client Form Modal ───────────────────────────────────────────────
function ClientFormModal({ client, onClose, onSave, onDelete }: {
  client?: CRMClient
  onClose: () => void
  onSave: (client: Omit<CRMClient, 'id'> | CRMClient) => void
  onDelete?: () => void
}) {
  const [form, setForm] = useState({
    name: client?.name || '',
    phone: client?.phone || '',
    email: client?.email || '',
    source: client?.source || 'manual',
    first_visit: client?.first_visit || '',
    last_visit: client?.last_visit || '',
    total_visits: client?.total_visits || 1,
    avg_ticket: client?.avg_ticket || 0,
    tags: client?.tags || [],
    notes: client?.notes || '',
  })

  const [tagInput, setTagInput] = useState('')

  const addTag = () => {
    if (tagInput.trim() && !form.tags.includes(tagInput.trim().toLowerCase())) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, tagInput.trim().toLowerCase()] }))
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] shadow-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <h3 className="text-base font-semibold text-[var(--text-1)]">{client ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Telefono</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="8112345678"
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Ultima visita</label>
              <input
                type="date"
                value={form.last_visit}
                onChange={e => setForm(prev => ({ ...prev, last_visit: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Fuente</label>
              <select
                value={form.source}
                onChange={e => setForm(prev => ({ ...prev, source: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
              >
                <option value="manual">Manual</option>
                <option value="opentable">OpenTable</option>
                <option value="reserve">Reserve</option>
                <option value="walk-in">Walk-in</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Visitas</label>
              <input
                type="number"
                value={form.total_visits}
                onChange={e => setForm(prev => ({ ...prev, total_visits: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Ticket promedio</label>
              <input
                type="number"
                value={form.avg_ticket}
                onChange={e => setForm(prev => ({ ...prev, avg_ticket: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          {/* Tags */}
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-400">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="vip, regular, etc..."
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-emerald-500/50"
              />
              <button onClick={addTag} className="px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-3)] hover:text-emerald-400">
                <Plus size={14} />
              </button>
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-sm text-[var(--text-1)] focus:outline-none focus:border-emerald-500/50 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--line)]">
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Eliminar cliente
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-3)]">Cancelar</button>
            <button
              onClick={() => onSave(form as Omit<CRMClient, 'id'>)}
              disabled={!form.name}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
