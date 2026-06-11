'use client'

import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ChevronDown, ChevronUp, Package, ArrowRightLeft,
  Trash2, ClipboardCheck, ShoppingCart, Activity, Calendar,
  Filter, TrendingDown, DollarSign, ArrowDownUp,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'
import { formatCurrency, formatNumber } from '@/lib/format'
import { getActiveClientSlug } from '@/lib/data'

// ── Types ───────────────────────────────────────────────────────────

type MovementType = 'entrada' | 'transferencia' | 'merma' | 'conteo' | 'venta'

interface MovementItem {
  producto: string
  cantidad: number
  costo_unitario?: number
  costo_total?: number
  motivo?: string
  stock_sistema?: number
  conteo_real?: number
  diferencia?: number
}

interface Movement {
  id: string
  type: MovementType
  date: string
  description: string
  items: MovementItem[]
  total: number
  user: string
  source: 'wansoft_data' | 'pos'
  raw_key?: string
}

// ── Constants ───────────────────────────────────────────────────────

const TYPE_CONFIG: Record<MovementType, { label: string; color: string; bg: string; border: string; icon: typeof Package }> = {
  entrada:       { label: 'Entrada',       color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', icon: Package },
  transferencia: { label: 'Transferencia', color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/40',    icon: ArrowRightLeft },
  merma:         { label: 'Merma',         color: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/40',     icon: Trash2 },
  conteo:        { label: 'Conteo Fisico', color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   icon: ClipboardCheck },
  venta:         { label: 'Venta',         color: 'text-purple-400',  bg: 'bg-purple-500/15',  border: 'border-purple-500/40',  icon: ShoppingCart },
}

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'entrada', label: 'Entradas' },
  { value: 'transferencia', label: 'Transferencias' },
  { value: 'merma', label: 'Merma' },
  { value: 'conteo', label: 'Conteo' },
  { value: 'venta', label: 'Ventas' },
]

// ── Helpers ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function deepParse(raw: unknown): unknown {
  let parsed = raw
  for (let i = 0; i < 5; i++) {
    if (typeof parsed !== 'string') break
    try { parsed = JSON.parse(parsed) } catch { break }
  }
  return parsed
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function monthAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function startOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

async function sbFetchRows(table: string, params: string): Promise<Record<string, unknown>[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function classifyDataKey(key: string): MovementType | null {
  if (key.startsWith('inventory_entry_')) return 'entrada'
  if (key.startsWith('inventory_transfer_')) return 'transferencia'
  if (key.startsWith('inventory_waste_')) return 'merma'
  if (key.startsWith('physical_count_')) return 'conteo'
  return null
}

function parseWansoftMovement(row: Record<string, unknown>): Movement | null {
  const dataKey = row.data_key as string
  const type = classifyDataKey(dataKey)
  if (!type) return null

  const data = deepParse(row.data) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return null

  const fecha = (row.fecha as string) || (data.created_at as string)?.slice(0, 10) || ''
  const rawItems = Array.isArray(data.items) ? data.items : []

  let description = ''
  let items: MovementItem[] = []
  let total = 0
  let user = (data.user as string) || (data.created_by as string) || ''

  switch (type) {
    case 'entrada':
      description = data.supplier ? `Entrada de ${data.supplier}` : 'Entrada de mercancia'
      items = rawItems.map((it: Record<string, unknown>) => ({
        producto: (it.producto as string) || (it.name as string) || '',
        cantidad: Number(it.cantidad) || 0,
        costo_unitario: Number(it.costo_unitario) || 0,
        costo_total: Number(it.costo_total) || 0,
      }))
      total = Number(data.total) || items.reduce((s, i) => s + (i.costo_total || 0), 0)
      break

    case 'transferencia':
      description = `${data.source || '?'} -> ${data.destination || '?'}`
      items = rawItems.map((it: Record<string, unknown>) => ({
        producto: (it.producto as string) || '',
        cantidad: Number(it.cantidad) || 0,
      }))
      total = 0
      break

    case 'merma':
      description = data.warehouse ? `Merma en ${data.warehouse}` : 'Registro de merma'
      items = rawItems.map((it: Record<string, unknown>) => ({
        producto: (it.producto as string) || '',
        cantidad: Number(it.cantidad) || 0,
        motivo: (it.motivo as string) || '',
        costo_total: Number(it.costo_total) || 0,
      }))
      total = Number(data.total) || items.reduce((s, i) => s + (i.costo_total || 0), 0)
      break

    case 'conteo':
      description = data.warehouse ? `Conteo en ${data.warehouse}` : 'Conteo fisico'
      items = rawItems.map((it: Record<string, unknown>) => ({
        producto: (it.producto as string) || '',
        cantidad: Number(it.conteo_real) || 0,
        stock_sistema: Number(it.stock_sistema) || 0,
        conteo_real: Number(it.conteo_real) || 0,
        diferencia: Number(it.diferencia) || 0,
      }))
      total = 0
      break
  }

  return {
    id: dataKey + '_' + fecha,
    type,
    date: fecha,
    description,
    items,
    total,
    user,
    source: 'wansoft_data',
    raw_key: dataKey,
  }
}

interface PurchaseSnapshot {
  fecha: string
  map: Map<string, { qty: number; cost: number }>
}

// purchases_by_product is a rolling cumulative report — diff consecutive
// snapshots to reconstruct the purchases (entradas) of each day.
function parsePurchaseSnapshots(rows: Record<string, unknown>[]): Movement[] {
  const snaps: PurchaseSnapshot[] = []
  for (const row of rows) {
    const data = deepParse(row.data) as Record<string, unknown> | null
    const result = Array.isArray(data?.Result) ? data.Result : Array.isArray(data) ? data : null
    if (!result || !row.fecha) continue
    const map = new Map<string, { qty: number; cost: number }>()
    for (const p of result as Record<string, unknown>[]) {
      const name = (p.ProductName as string) || ''
      if (!name) continue
      map.set(name, { qty: Number(p.Quantity) || 0, cost: Number(p.Cost) || 0 })
    }
    snaps.push({ fecha: row.fecha as string, map })
  }
  snaps.sort((a, b) => a.fecha.localeCompare(b.fecha))

  const movements: Movement[] = []
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]
    const curr = snaps[i]
    const items: MovementItem[] = []
    curr.map.forEach((v, name) => {
      const p = prev.map.get(name)
      const dQty = v.qty - (p?.qty || 0)
      const dCost = v.cost - (p?.cost || 0)
      if (dQty > 0.001 && dCost > 0.01) {
        items.push({
          producto: name,
          cantidad: Math.round(dQty * 100) / 100,
          costo_unitario: Math.round((dCost / dQty) * 100) / 100,
          costo_total: Math.round(dCost * 100) / 100,
        })
      }
    })
    if (items.length === 0) continue
    const total = items.reduce((s, it) => s + (it.costo_total || 0), 0)
    movements.push({
      id: `wpurch_${curr.fecha}`,
      type: 'entrada',
      date: curr.fecha,
      description: `Compras Wansoft (${items.length} producto${items.length === 1 ? '' : 's'})`,
      items: items.sort((a, b) => (b.costo_total || 0) - (a.costo_total || 0)),
      total: Math.round(total * 100) / 100,
      user: 'Wansoft',
      source: 'wansoft_data',
      raw_key: 'purchases_by_product',
    })
  }
  return movements
}

function parsePosMovement(row: Record<string, unknown>): Movement {
  return {
    id: `pos_${row.id}`,
    type: row.movement_type === 'waste' ? 'merma' : row.movement_type === 'deduction' ? 'venta' : 'entrada',
    date: ((row.created_at as string) || '').slice(0, 10),
    description: (row.notes as string) || `${row.movement_type} - ${row.ingredient_id || ''}`,
    items: [{
      producto: (row.ingredient_id as string) || '',
      cantidad: Math.abs(Number(row.quantity) || 0),
    }],
    total: 0,
    user: (row.actor as string) || '',
    source: 'pos',
  }
}

function formatDateShort(d: string): string {
  if (!d) return '-'
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Component ───────────────────────────────────────────────────────

export default function MovimientosPage() {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState(monthAgoStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [typeFilter, setTypeFilter] = useState('todos')
  const [search, setSearch] = useState('')

  // ── Fetch ──────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true)
      const clientId = getActiveClientSlug()

      // Fetch wansoft_data rows matching inventory patterns
      const patterns = [
        'inventory_entry_',
        'inventory_transfer_',
        'inventory_waste_',
        'physical_count_',
      ]

      const wansoftPromises = patterns.map(prefix =>
        sbFetchRows(
          'wansoft_data',
          `select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.${prefix}*&order=fecha.desc&limit=200`
        )
      )

      // Fetch pos_inventory_movements
      const posPromise = sbFetchRows(
        'pos_inventory_movements',
        `client_id=eq.${clientId}&order=created_at.desc&limit=200`
      )

      // Fetch Wansoft purchases snapshots (rolling report → daily deltas)
      const purchasesPromise = sbFetchRows(
        'wansoft_data',
        `select=fecha,data&client_id=eq.${clientId}&data_key=eq.purchases_by_product&order=fecha.desc&limit=15`
      )

      const [entryRows, transferRows, wasteRows, countRows, posRows, purchaseRows] = await Promise.all([
        ...wansoftPromises,
        posPromise,
        purchasesPromise,
      ])

      const allWansoft = [...entryRows, ...transferRows, ...wasteRows, ...countRows]
      const wansoftMovements = allWansoft
        .map(parseWansoftMovement)
        .filter((m): m is Movement => m !== null)

      const posMovements = posRows.map(parsePosMovement)
      const purchaseMovements = parsePurchaseSnapshots(purchaseRows)

      const combined = [...wansoftMovements, ...posMovements, ...purchaseMovements]
        .sort((a, b) => b.date.localeCompare(a.date))

      setMovements(combined)
      setLoading(false)
    }

    load()
  }, [])

  // ── Filtered + searched ────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = movements

    // Date filter
    if (dateFrom) result = result.filter(m => m.date >= dateFrom)
    if (dateTo) result = result.filter(m => m.date <= dateTo)

    // Type filter
    if (typeFilter !== 'todos') result = result.filter(m => m.type === typeFilter)

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(m =>
        m.description.toLowerCase().includes(q) ||
        m.user.toLowerCase().includes(q) ||
        m.items.some(it => it.producto.toLowerCase().includes(q))
      )
    }

    return result
  }, [movements, dateFrom, dateTo, typeFilter, search])

  // ── KPIs (current month) ──────────────────────────────────────

  const kpis = useMemo(() => {
    const som = startOfMonth()
    const thisMonth = movements.filter(m => m.date >= som)

    const totalMovements = thisMonth.length
    const entradasTotal = thisMonth
      .filter(m => m.type === 'entrada')
      .reduce((s, m) => s + m.total, 0)
    const mermaTotal = thisMonth
      .filter(m => m.type === 'merma')
      .reduce((s, m) => s + m.total, 0)
    const transferCount = thisMonth.filter(m => m.type === 'transferencia').length

    return { totalMovements, entradasTotal, mermaTotal, transferCount }
  }, [movements])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen px-4 py-6 sm:px-8" style={{ background: 'var(--surface)' }}>
      <PageHeader
        title="Movimientos de Inventario"
        subtitle="Historial completo"
        eyebrow="Inventario"
      />

      {/* ── KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KPICard
          label="Movimientos del mes"
          value={formatNumber(kpis.totalMovements)}
          icon={Activity}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Entradas del mes"
          value={formatCurrency(kpis.entradasTotal)}
          icon={Package}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Merma del mes"
          value={formatCurrency(kpis.mermaTotal)}
          icon={TrendingDown}
          accentClass="kpi-accent-pink"
          index={2}
        />
        <KPICard
          label="Transferencias del mes"
          value={formatNumber(kpis.transferCount)}
          icon={ArrowRightLeft}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* ── Filters ───────────────────────────────────────────── */}
      <div
        className="rounded-2xl border border-[var(--accent-line)] p-4 mb-6 flex flex-wrap items-center gap-3"
        style={{ background: 'var(--bento-card)' }}
      >
        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--text-3)]" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded-lg border border-[var(--accent-line)] px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--text-1)] outline-none focus:border-blue-500"
          />
          <span className="text-[var(--text-4)] text-xs">a</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded-lg border border-[var(--accent-line)] px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--text-1)] outline-none focus:border-blue-500"
          />
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-[var(--text-3)]" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="rounded-lg border border-[var(--accent-line)] px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--text-1)] outline-none focus:border-blue-500"
          >
            {FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={16} className="text-[var(--text-3)]" />
          <input
            type="text"
            placeholder="Buscar producto, proveedor, usuario..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--accent-line)] px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--text-1)] outline-none focus:border-blue-500 placeholder:text-[var(--text-4)]"
          />
        </div>

        {/* Count */}
        <span className="text-xs text-[var(--text-3)] ml-auto whitespace-nowrap">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl border border-[var(--accent-line)] p-12 text-center"
          style={{ background: 'var(--bento-card)' }}
        >
          <ArrowDownUp size={40} className="mx-auto text-[var(--text-4)] mb-3" />
          <p className="text-[var(--text-3)] text-sm">No se encontraron movimientos</p>
          <p className="text-[var(--text-4)] text-xs mt-1">Ajusta los filtros o el rango de fechas</p>
        </div>
      ) : (
        <div
          className="rounded-2xl border border-[var(--accent-line)] overflow-hidden"
          style={{ background: 'var(--bento-card)' }}
        >
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[120px_130px_1fr_80px_110px_120px] gap-2 px-4 py-3 border-b border-[var(--accent-line)] text-[10px] uppercase tracking-[0.12em] font-mono text-[var(--text-4)]">
            <span>Fecha</span>
            <span>Tipo</span>
            <span>Descripcion</span>
            <span className="text-right">Items</span>
            <span className="text-right">Total</span>
            <span>Usuario</span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[var(--accent-line)]">
            {filtered.map((m, idx) => {
              const config = TYPE_CONFIG[m.type]
              const isExpanded = expandedId === m.id
              const Icon = config.icon

              return (
                <div key={m.id}>
                  {/* Main row */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(idx * 0.02, 0.5) }}
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    className="grid grid-cols-1 sm:grid-cols-[120px_130px_1fr_80px_110px_120px] gap-1 sm:gap-2 px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors"
                  >
                    {/* Date */}
                    <span className="text-sm text-[var(--text-2)] font-mono sm:flex items-center hidden">
                      {formatDateShort(m.date)}
                    </span>

                    {/* Type badge */}
                    <div className="flex items-center gap-2">
                      {/* Mobile date */}
                      <span className="sm:hidden text-xs text-[var(--text-3)] font-mono mr-2">
                        {formatDateShort(m.date)}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.color} ${config.bg} border ${config.border}`}>
                        <Icon size={12} />
                        {config.label}
                      </span>
                    </div>

                    {/* Description */}
                    <div className="flex items-center text-sm text-[var(--text-1)] truncate">
                      {m.description}
                    </div>

                    {/* Items count */}
                    <div className="hidden sm:flex items-center justify-end text-sm text-[var(--text-2)]">
                      {m.items.length}
                    </div>

                    {/* Total */}
                    <div className="hidden sm:flex items-center justify-end text-sm font-semibold text-[var(--text-1)]">
                      {m.total > 0 ? formatCurrency(m.total) : '-'}
                    </div>

                    {/* User + chevron */}
                    <div className="hidden sm:flex items-center justify-between">
                      <span className="text-xs text-[var(--text-3)] truncate max-w-[90px]">{m.user || '-'}</span>
                      {isExpanded
                        ? <ChevronUp size={14} className="text-[var(--text-4)]" />
                        : <ChevronDown size={14} className="text-[var(--text-4)]" />
                      }
                    </div>

                    {/* Mobile summary row */}
                    <div className="sm:hidden flex items-center justify-between text-xs text-[var(--text-3)]">
                      <span>{m.items.length} items</span>
                      <span className="font-semibold text-[var(--text-1)]">{m.total > 0 ? formatCurrency(m.total) : '-'}</span>
                      <span className="truncate max-w-[80px]">{m.user || '-'}</span>
                      {isExpanded
                        ? <ChevronUp size={14} className="text-[var(--text-4)]" />
                        : <ChevronDown size={14} className="text-[var(--text-4)]" />
                      }
                    </div>
                  </motion.div>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-1">
                          <div className="rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--surface)' }}>
                            {/* Detail header */}
                            <div className="grid gap-2 px-3 py-2 border-b border-[var(--accent-line)] text-[9px] uppercase tracking-[0.12em] font-mono text-[var(--text-4)]"
                              style={{
                                gridTemplateColumns: m.type === 'conteo'
                                  ? '1fr 80px 80px 80px'
                                  : m.type === 'merma'
                                    ? '1fr 70px 1fr 90px'
                                    : '1fr 80px 90px 90px',
                              }}
                            >
                              <span>Producto</span>
                              {m.type === 'conteo' ? (
                                <>
                                  <span className="text-right">Sistema</span>
                                  <span className="text-right">Conteo</span>
                                  <span className="text-right">Diferencia</span>
                                </>
                              ) : m.type === 'merma' ? (
                                <>
                                  <span className="text-right">Cant.</span>
                                  <span>Motivo</span>
                                  <span className="text-right">Costo</span>
                                </>
                              ) : m.type === 'transferencia' ? (
                                <>
                                  <span className="text-right">Cantidad</span>
                                  <span></span>
                                  <span></span>
                                </>
                              ) : (
                                <>
                                  <span className="text-right">Cant.</span>
                                  <span className="text-right">C. Unit.</span>
                                  <span className="text-right">C. Total</span>
                                </>
                              )}
                            </div>

                            {/* Detail rows */}
                            {m.items.map((it, i) => (
                              <div
                                key={i}
                                className="grid gap-2 px-3 py-2 border-b border-[var(--accent-line)] last:border-b-0 text-sm"
                                style={{
                                  gridTemplateColumns: m.type === 'conteo'
                                    ? '1fr 80px 80px 80px'
                                    : m.type === 'merma'
                                      ? '1fr 70px 1fr 90px'
                                      : '1fr 80px 90px 90px',
                                }}
                              >
                                <span className="text-[var(--text-1)] truncate">{it.producto}</span>
                                {m.type === 'conteo' ? (
                                  <>
                                    <span className="text-right text-[var(--text-2)]">{it.stock_sistema ?? '-'}</span>
                                    <span className="text-right text-[var(--text-2)]">{it.conteo_real ?? '-'}</span>
                                    <span className={`text-right font-semibold ${
                                      (it.diferencia || 0) < 0 ? 'text-red-400' : (it.diferencia || 0) > 0 ? 'text-emerald-400' : 'text-[var(--text-3)]'
                                    }`}>
                                      {(it.diferencia || 0) > 0 ? '+' : ''}{it.diferencia ?? 0}
                                    </span>
                                  </>
                                ) : m.type === 'merma' ? (
                                  <>
                                    <span className="text-right text-[var(--text-2)]">{it.cantidad}</span>
                                    <span className="text-[var(--text-3)] text-xs truncate">{it.motivo || '-'}</span>
                                    <span className="text-right text-red-400 font-semibold">
                                      {it.costo_total ? formatCurrency(it.costo_total) : '-'}
                                    </span>
                                  </>
                                ) : m.type === 'transferencia' ? (
                                  <>
                                    <span className="text-right text-[var(--text-2)]">{it.cantidad}</span>
                                    <span></span>
                                    <span></span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-right text-[var(--text-2)]">{it.cantidad}</span>
                                    <span className="text-right text-[var(--text-3)]">
                                      {it.costo_unitario ? formatCurrency(it.costo_unitario) : '-'}
                                    </span>
                                    <span className="text-right text-emerald-400 font-semibold">
                                      {it.costo_total ? formatCurrency(it.costo_total) : '-'}
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}

                            {/* Total footer for types that have it */}
                            {m.total > 0 && (
                              <div className="flex justify-between items-center px-3 py-2 bg-white/[0.03]">
                                <span className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">Total</span>
                                <span className={`text-sm font-bold ${m.type === 'merma' ? 'text-red-400' : 'text-emerald-400'}`}>
                                  {formatCurrency(m.total)}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Metadata */}
                          <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-4)]">
                            {m.raw_key && <span>Key: {m.raw_key}</span>}
                            <span>Fuente: {m.source === 'pos' ? 'POS' : 'Wansoft'}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
