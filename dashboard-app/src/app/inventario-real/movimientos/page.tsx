'use client'

import { useEffect, useState, useMemo, Fragment } from 'react'
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
// Type badge treatment mapped to DS v2.1 tokens (theme-aware in both themes):
//   entrada → accent-ink · transferencia → info-ink · merma → crit-ink
//   conteo → warn-ink · venta → violet (--st-barra)
// A leading `.g` dot inherits currentColor of the badge text.
const TYPE_CONFIG: Record<
  MovementType,
  { label: string; color: string; bg: string; border: string; icon: typeof Package }
> = {
  entrada: {
    label: 'Entrada',
    color: 'text-[var(--accent-ink)]',
    bg: 'bg-[var(--accent-soft)]',
    border: 'border-[var(--accent-line)]',
    icon: Package,
  },
  transferencia: {
    label: 'Transferencia',
    color: 'text-[var(--info-ink)]',
    bg: 'bg-[var(--info-soft)]',
    border: 'border-[color-mix(in_srgb,var(--info)_40%,transparent)]',
    icon: ArrowRightLeft,
  },
  merma: {
    label: 'Merma',
    color: 'text-[var(--crit-ink)]',
    bg: 'bg-[var(--crit-soft)]',
    border: 'border-[color-mix(in_srgb,var(--crit)_40%,transparent)]',
    icon: Trash2,
  },
  conteo: {
    label: 'Conteo Fisico',
    color: 'text-[var(--warn-ink)]',
    bg: 'bg-[var(--warn-soft)]',
    border: 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)]',
    icon: ClipboardCheck,
  },
  venta: {
    label: 'Venta',
    color: 'text-[var(--st-barra)]',
    bg: 'bg-[color-mix(in_srgb,var(--st-barra)_13%,transparent)]',
    border: 'border-[color-mix(in_srgb,var(--st-barra)_42%,transparent)]',
    icon: ShoppingCart,
  },
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

// ── Shared cell styles (dense table · DS v2.1) ──────────────────────
const TH = 'px-3.5 py-2.5 border-b border-[var(--line)] font-mono text-[10px] uppercase tracking-[0.11em] font-semibold text-[var(--text-4)] whitespace-nowrap text-left'
const TH_NUM = TH + ' text-right'
const TD = 'px-3.5 py-2.5 border-b border-[var(--line-soft)] text-[var(--text-2)] align-middle'
const TD_NUM = TD + ' text-right tnum font-mono text-[var(--text-1)]'

// detail sub-table cells
const DTH = 'px-3 py-2 border-b border-[var(--line)] font-mono text-[9px] uppercase tracking-[0.11em] font-semibold text-[var(--text-4)] whitespace-nowrap text-left bg-[var(--panel)]'
const DTH_NUM = DTH + ' text-right'
const DTD = 'px-3 py-2 border-b border-[var(--line-soft)] text-[var(--text-2)]'
const DTD_NUM = DTD + ' text-right tnum font-mono text-[var(--text-1)]'

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
          accentClass="kpi-accent-red"
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
        className="rounded-[14px] border border-[var(--line)] p-3 sm:px-3.5 sm:py-3 mb-4 flex flex-wrap items-center gap-3"
        style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-soft)' }}
      >
        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--text-3)]" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded-[9px] border border-[var(--line)] px-3 py-2 text-[12.5px] font-mono tnum bg-[var(--surface-2)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <span className="text-[var(--text-4)] text-[11px]">a</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded-[9px] border border-[var(--line)] px-3 py-2 text-[12.5px] font-mono tnum bg-[var(--surface-2)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-[var(--text-3)]" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="rounded-[9px] border border-[var(--line)] px-3 py-2 text-[12.5px] bg-[var(--surface-2)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
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
            className="w-full rounded-[9px] border border-[var(--line)] px-3 py-2 text-[12.5px] bg-[var(--surface-2)] text-[var(--text-1)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] placeholder:text-[var(--text-4)]"
          />
        </div>

        {/* Count */}
        <span className="ml-auto font-mono text-[11px] tnum text-[var(--text-3)] whitespace-nowrap">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="rounded-[14px] border border-dashed border-[var(--line)] px-5 py-9 flex flex-col items-center justify-center gap-2.5 text-center" style={{ background: 'var(--surface)' }}>
          <div className="w-[26px] h-[26px] border-[2.5px] border-[var(--line)] border-t-[var(--accent)] rounded-full animate-spin" />
          <p className="text-sm font-semibold text-[var(--text-2)]">Cargando movimientos...</p>
          <p className="text-xs text-[var(--text-4)]">Consultando wansoft_data · pos_inventory_movements</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--line)] px-5 py-9 flex flex-col items-center justify-center gap-2.5 text-center" style={{ background: 'var(--surface)' }}>
          <div className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--surface-2)] text-[var(--text-3)]">
            <ArrowDownUp size={22} />
          </div>
          <p className="text-sm font-semibold text-[var(--text-2)]">No se encontraron movimientos</p>
          <p className="text-xs text-[var(--text-4)]">Ajusta los filtros o el rango de fechas</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-[var(--line)]" style={{ background: 'var(--surface)' }}>
          <table className="w-full border-collapse text-[13px] min-w-[820px]">
            <thead>
              <tr>
                <th className={`${TH} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Fecha</th>
                <th className={`${TH} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Tipo</th>
                <th className={`${TH} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Descripcion</th>
                <th className={`${TH_NUM} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Items</th>
                <th className={`${TH_NUM} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Total</th>
                <th className={`${TH} sticky top-0 z-[1] bg-[var(--surface-2)]`}>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, idx) => {
                const config = TYPE_CONFIG[m.type]
                const isExpanded = expandedId === m.id
                const Icon = config.icon
                const totalCls =
                  m.total > 0
                    ? m.type === 'merma'
                      ? 'text-[var(--crit-ink)]'
                      : 'text-[var(--accent-ink)]'
                    : 'text-[var(--text-4)]'

                return (
                  <Fragment key={m.id}>
                  <motion.tr
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: Math.min(idx * 0.02, 0.5) }}
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    className={`cursor-pointer transition-colors ${isExpanded ? '[&>td]:!bg-[var(--accent-soft)]' : 'hover:[&>td]:bg-[var(--surface-2)]'}`}
                  >
                    <td className={`${TD} font-mono whitespace-nowrap`}>{formatDateShort(m.date)}</td>
                    <td className={TD}>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold leading-none whitespace-nowrap border ${config.color} ${config.bg} ${config.border}`}
                      >
                        <Icon size={12} />
                        {config.label}
                      </span>
                    </td>
                    <td className={`${TD} text-[var(--text-1)]`}>
                      <div className="max-w-[340px] truncate">{m.description}</div>
                    </td>
                    <td className={TD_NUM}>{m.items.length}</td>
                    <td className={`${TD_NUM} ${totalCls}`}>
                      {m.total > 0 ? (m.type === 'merma' ? `−${formatCurrency(m.total).replace(/^[-−]/, '')}` : formatCurrency(m.total)) : '—'}
                    </td>
                    <td className={`${TD} text-[var(--text-3)] text-[12px]`}>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[110px]">{m.user || '-'}</span>
                        {isExpanded
                          ? <ChevronUp size={14} className="text-[var(--accent-ink)] shrink-0" />
                          : <ChevronDown size={14} className="text-[var(--text-4)] shrink-0" />}
                      </div>
                    </td>

                  </motion.tr>

                  {/* Expanded detail — full-width row inside <tbody> */}
                  <AnimatePresence>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="p-0" style={{ background: 'var(--surface)' }}>
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="px-3.5 pb-4 pt-1.5">
                              <div className="rounded-[10px] border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
                                <table className="w-full border-collapse text-[12.5px]">
                                  <thead>
                                    <tr>
                                      <th className={DTH}>Producto</th>
                                      {m.type === 'conteo' ? (
                                        <>
                                          <th className={DTH_NUM}>Sistema</th>
                                          <th className={DTH_NUM}>Conteo</th>
                                          <th className={DTH_NUM}>Diferencia</th>
                                        </>
                                      ) : m.type === 'merma' ? (
                                        <>
                                          <th className={DTH_NUM}>Cant.</th>
                                          <th className={DTH}>Motivo</th>
                                          <th className={DTH_NUM}>Costo</th>
                                        </>
                                      ) : m.type === 'transferencia' ? (
                                        <>
                                          <th className={DTH_NUM}>Cantidad</th>
                                          <th className={DTH}></th>
                                          <th className={DTH}></th>
                                        </>
                                      ) : (
                                        <>
                                          <th className={DTH_NUM}>Cant.</th>
                                          <th className={DTH_NUM}>C. Unit.</th>
                                          <th className={DTH_NUM}>C. Total</th>
                                        </>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {m.items.map((it, k) => (
                                      <tr key={k}>
                                        <td className={`${DTD} text-[var(--text-1)]`}>
                                          <div className="truncate max-w-[280px]">{it.producto}</div>
                                        </td>
                                        {m.type === 'conteo' ? (
                                          <>
                                            <td className={DTD_NUM}>{it.stock_sistema ?? '-'}</td>
                                            <td className={DTD_NUM}>{it.conteo_real ?? '-'}</td>
                                            <td className={`${DTD_NUM} font-semibold ${
                                              (it.diferencia || 0) < 0
                                                ? 'text-[var(--crit-ink)]'
                                                : (it.diferencia || 0) > 0
                                                  ? 'text-[var(--accent-ink)]'
                                                  : 'text-[var(--text-3)]'
                                            }`}>
                                              {(it.diferencia || 0) > 0 ? '+' : ''}{it.diferencia ?? 0}
                                            </td>
                                          </>
                                        ) : m.type === 'merma' ? (
                                          <>
                                            <td className={DTD_NUM}>{it.cantidad}</td>
                                            <td className={`${DTD} text-[var(--text-3)] text-xs`}>
                                              <div className="truncate max-w-[160px]">{it.motivo || '-'}</div>
                                            </td>
                                            <td className={`${DTD_NUM} text-[var(--crit-ink)] font-semibold`}>
                                              {it.costo_total ? `−${formatCurrency(it.costo_total).replace(/^[-−]/, '')}` : '-'}
                                            </td>
                                          </>
                                        ) : m.type === 'transferencia' ? (
                                          <>
                                            <td className={DTD_NUM}>{it.cantidad}</td>
                                            <td className={DTD}></td>
                                            <td className={DTD}></td>
                                          </>
                                        ) : (
                                          <>
                                            <td className={DTD_NUM}>{it.cantidad}</td>
                                            <td className={`${DTD_NUM} text-[var(--text-3)]`}>
                                              {it.costo_unitario ? formatCurrency(it.costo_unitario) : '-'}
                                            </td>
                                            <td className={`${DTD_NUM} text-[var(--accent-ink)] font-semibold`}>
                                              {it.costo_total ? formatCurrency(it.costo_total) : '-'}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                  {m.total > 0 && (
                                    <tfoot>
                                      <tr>
                                        <td className="px-3 py-2.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--text-1)_2%,transparent)] font-mono text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--text-3)]">
                                          Total
                                        </td>
                                        <td className="px-3 py-2.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--text-1)_2%,transparent)]" />
                                        <td className="px-3 py-2.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--text-1)_2%,transparent)]" />
                                        <td className={`px-3 py-2.5 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--text-1)_2%,transparent)] text-right tnum font-mono font-bold ${m.type === 'merma' ? 'text-[var(--crit-ink)]' : 'text-[var(--accent-ink)]'}`}>
                                          {m.type === 'merma' ? `−${formatCurrency(m.total).replace(/^[-−]/, '')}` : formatCurrency(m.total)}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>

                              {/* Metadata */}
                              <div className="flex flex-wrap items-center gap-4 mt-2.5 font-mono text-[10px] text-[var(--text-4)]">
                                {m.raw_key && <span><span className="text-[var(--text-3)]">Key:</span> {m.raw_key}</span>}
                                <span><span className="text-[var(--text-3)]">Fuente:</span> {m.source === 'pos' ? 'POS' : 'Wansoft'}</span>
                              </div>
                            </div>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
