'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Wallet,
  CalendarDays,
  Tag,
  TrendingUp,
  Plus,
  Search,
  RefreshCw,
  Receipt,
  Filter,
  BarChart3,
  Loader2,
  Check,
  X,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'
import { getActiveClientSlug } from '@/lib/data'
import { sbPost } from '@/lib/supabase-helpers'
import { formatCurrency } from '@/lib/format'

// ── Types ───────────────────────────────────────────────────────────

const CATEGORIAS = [
  'Renta',
  'Servicios',
  'Nomina',
  'Insumos',
  'Mantenimiento',
  'Marketing',
  'Impuestos',
  'Seguros',
  'Equipo',
  'Otros',
] as const

type Categoria = (typeof CATEGORIAS)[number]

const FRECUENCIAS = ['semanal', 'quincenal', 'mensual'] as const
type Frecuencia = (typeof FRECUENCIAS)[number]

interface Expense {
  id: string
  fecha: string
  categoria: Categoria
  subcategoria: string
  monto: number
  proveedor: string
  descripcion: string
  recurrente: boolean
  frecuencia: Frecuencia | ''
  comprobante: string
  created_at: string
}

interface Supplier {
  id: string
  name: string
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const CATEGORY_COLORS: Record<string, string> = {
  Renta: '#3b82f6',
  Servicios: '#10b981',
  Nomina: '#f59e0b',
  Insumos: '#8b5cf6',
  Mantenimiento: '#06b6d4',
  Marketing: '#ec4899',
  Impuestos: '#ef4444',
  Seguros: '#14b8a6',
  Equipo: '#a855f7',
  Otros: '#6b7280',
}

// ── Helpers ─────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function generateDataKey() {
  const now = new Date()
  return `expense_${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

// ── Component ───────────────────────────────────────────────────────

export default function EgresosPage() {
  const clientId = getActiveClientSlug()

  // State
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form fields
  const [fecha, setFecha] = useState(todayStr())
  const [categoria, setCategoria] = useState<Categoria>('Insumos')
  const [subcategoria, setSubcategoria] = useState('')
  const [monto, setMonto] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [proveedorSearch, setProveedorSearch] = useState('')
  const [showProveedorDropdown, setShowProveedorDropdown] = useState(false)
  const [descripcion, setDescripcion] = useState('')
  const [recurrente, setRecurrente] = useState(false)
  const [frecuencia, setFrecuencia] = useState<Frecuencia | ''>('')
  const [comprobante, setComprobante] = useState('')

  // Filters
  const [filterCategoria, setFilterCategoria] = useState<string>('')
  const [filterProveedor, setFilterProveedor] = useState('')
  const [filterDesde, setFilterDesde] = useState('')
  const [filterHasta, setFilterHasta] = useState('')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // ── Load data ─────────────────────────────────────────────────────

  const loadExpenses = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wansoft_data?select=data_key,fecha,data&client_id=eq.${clientId}&data_key=like.expense_%&order=fecha.desc&limit=500`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return
      const rows: { data_key: string; fecha: string; data: unknown }[] = await res.json()
      const parsed: Expense[] = rows
        .map((row) => {
          const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>
          return {
            id: row.data_key,
            fecha: (d.fecha as string) || row.fecha,
            categoria: (d.categoria as Categoria) || 'Otros',
            subcategoria: (d.subcategoria as string) || '',
            monto: Number(d.monto) || 0,
            proveedor: (d.proveedor as string) || '',
            descripcion: (d.descripcion as string) || '',
            recurrente: Boolean(d.recurrente),
            frecuencia: ((d.frecuencia as string) || '') as Frecuencia | '',
            comprobante: (d.comprobante as string) || '',
            created_at: row.fecha,
          }
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
      setExpenses(parsed)
    } catch (err) {
      console.error('Error loading expenses:', err)
    }
  }, [clientId])

  const loadSuppliers = useCallback(async () => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_suppliers?client_id=eq.${clientId}&select=id,name&order=name.asc&limit=500`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (res.ok) {
        const data: Supplier[] = await res.json()
        setSuppliers(data)
      }
    } catch (err) {
      console.error('Error loading suppliers:', err)
    }
  }, [clientId])

  useEffect(() => {
    Promise.all([loadExpenses(), loadSuppliers()]).then(() => setLoading(false))
  }, [loadExpenses, loadSuppliers])

  // ── Save expense ──────────────────────────────────────────────────

  async function handleSave() {
    const amount = parseFloat(monto)
    if (!amount || amount <= 0) return
    setSaving(true)

    const dataKey = generateDataKey()
    const payload = {
      fecha,
      categoria,
      subcategoria,
      monto: amount,
      proveedor,
      descripcion,
      recurrente,
      frecuencia: recurrente ? frecuencia : '',
      comprobante,
    }

    const ok = await sbPost('wansoft_data', clientId, {
      data_key: dataKey,
      fecha,
      data: payload,
    })

    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Reset form
      setFecha(todayStr())
      setCategoria('Insumos')
      setSubcategoria('')
      setMonto('')
      setProveedor('')
      setProveedorSearch('')
      setDescripcion('')
      setRecurrente(false)
      setFrecuencia('')
      setComprobante('')
      setShowForm(false)
      await loadExpenses()
    }
    setSaving(false)
  }

  // ── Computed ──────────────────────────────────────────────────────

  const today = new Date()
  const monthStart = startOfMonth(today).toISOString().slice(0, 10)
  const weekStart = startOfWeek(today).toISOString().slice(0, 10)

  const totalMes = useMemo(
    () => expenses.filter((e) => e.fecha >= monthStart).reduce((s, e) => s + e.monto, 0),
    [expenses, monthStart]
  )

  const totalSemana = useMemo(
    () => expenses.filter((e) => e.fecha >= weekStart).reduce((s, e) => s + e.monto, 0),
    [expenses, weekStart]
  )

  const daysInMonth = today.getDate()
  const promedioDiario = daysInMonth > 0 ? totalMes / daysInMonth : 0

  const categorySums = useMemo(() => {
    const sums: Record<string, number> = {}
    for (const e of expenses.filter((e) => e.fecha >= monthStart)) {
      sums[e.categoria] = (sums[e.categoria] || 0) + e.monto
    }
    return Object.entries(sums)
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total)
  }, [expenses, monthStart])

  const topCategoria = categorySums[0]?.cat || '--'

  // Filtered expenses
  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (filterCategoria && e.categoria !== filterCategoria) return false
      if (filterProveedor && !e.proveedor.toLowerCase().includes(filterProveedor.toLowerCase())) return false
      if (filterDesde && e.fecha < filterDesde) return false
      if (filterHasta && e.fecha > filterHasta) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          e.descripcion.toLowerCase().includes(q) ||
          e.categoria.toLowerCase().includes(q) ||
          e.proveedor.toLowerCase().includes(q) ||
          e.subcategoria.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [expenses, filterCategoria, filterProveedor, filterDesde, filterHasta, search])

  // Supplier autocomplete
  const filteredSuppliers = useMemo(() => {
    if (!proveedorSearch) return suppliers.slice(0, 10)
    const q = proveedorSearch.toLowerCase()
    return suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 10)
  }, [suppliers, proveedorSearch])

  // Chart max
  const chartMax = categorySums[0]?.total || 1

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Egresos"
        subtitle="Control de gastos del negocio"
        action={
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Cerrar' : 'Nuevo gasto'}
          </button>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Total mes"
          value={formatCurrency(totalMes)}
          icon={Wallet}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Total semana"
          value={formatCurrency(totalSemana)}
          icon={CalendarDays}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Promedio diario"
          value={formatCurrency(promedioDiario)}
          icon={TrendingUp}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Top categoria"
          value={topCategoria}
          subtitle={categorySums[0] ? formatCurrency(categorySums[0].total) : ''}
          icon={Tag}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* ── Add Expense Form ───────────────────────────────────────── */}
      {showForm && (
        <div className="bg-[var(--bento-card)] border border-[var(--accent-line)] rounded-2xl p-5 mb-6" style={{ boxShadow: 'var(--shadow-mid)' }}>
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <Receipt size={16} className="text-blue-400" /> Registrar gasto
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Fecha */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Categoria */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Categoria</label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as Categoria)}
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Subcategoria */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Subcategoria</label>
              <input
                type="text"
                value={subcategoria}
                onChange={(e) => setSubcategoria(e.target.value)}
                placeholder="Ej: Luz, Gas, Internet..."
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Monto */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Monto (MXN)</label>
              <input
                type="number"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Proveedor (searchable) */}
            <div className="relative">
              <label className="block text-xs text-[var(--text-3)] mb-1">Proveedor (opcional)</label>
              <input
                type="text"
                value={proveedorSearch || proveedor}
                onChange={(e) => {
                  setProveedorSearch(e.target.value)
                  setProveedor(e.target.value)
                  setShowProveedorDropdown(true)
                }}
                onFocus={() => setShowProveedorDropdown(true)}
                onBlur={() => setTimeout(() => setShowProveedorDropdown(false), 200)}
                placeholder="Buscar proveedor..."
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              {showProveedorDropdown && filteredSuppliers.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-lg max-h-48 overflow-y-auto">
                  {filteredSuppliers.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setProveedor(s.name)
                        setProveedorSearch(s.name)
                        setShowProveedorDropdown(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Descripcion */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Descripcion</label>
              <input
                type="text"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Detalle del gasto..."
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Comprobante */}
            <div>
              <label className="block text-xs text-[var(--text-3)] mb-1">Comprobante (folio/referencia)</label>
              <input
                type="text"
                value={comprobante}
                onChange={(e) => setComprobante(e.target.value)}
                placeholder="Folio o referencia..."
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Recurrente */}
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recurrente}
                  onChange={(e) => {
                    setRecurrente(e.target.checked)
                    if (!e.target.checked) setFrecuencia('')
                  }}
                  className="w-4 h-4 rounded border-[var(--line)] bg-[var(--surface)] text-blue-600 focus:ring-blue-500/40"
                />
                <span className="text-sm text-[var(--text-1)]">Recurrente</span>
              </label>
              {recurrente && (
                <select
                  value={frecuencia}
                  onChange={(e) => setFrecuencia(e.target.value as Frecuencia)}
                  className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                >
                  <option value="">Seleccionar frecuencia</option>
                  {FRECUENCIAS.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Save button */}
            <div className="flex items-end">
              <button
                onClick={handleSave}
                disabled={saving || !monto || parseFloat(monto) <= 0}
                className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : saved ? (
                  <Check size={16} />
                ) : (
                  <Plus size={16} />
                )}
                {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar gasto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly Summary Chart ──────────────────────────────────── */}
      {categorySums.length > 0 && (
        <div className="bg-[var(--bento-card)] border border-[var(--accent-line)] rounded-2xl p-5 mb-6" style={{ boxShadow: 'var(--shadow-mid)' }}>
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-400" /> Gastos del mes por categoria
          </h3>
          <div className="space-y-3">
            {categorySums.map((cs) => (
              <div key={cs.cat}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-1)] font-medium">{cs.cat}</span>
                  <span className="text-[var(--text-2)] tnum">
                    {formatCurrency(cs.total)}{' '}
                    <span className="text-[var(--text-4)]">
                      ({totalMes > 0 ? ((cs.total / totalMes) * 100).toFixed(1) : 0}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${(cs.total / chartMax) * 100}%`,
                      backgroundColor: CATEGORY_COLORS[cs.cat] || '#6b7280',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar gastos..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
            showFilters
              ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
              : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text-1)]'
          }`}
        >
          <Filter size={14} /> Filtros
        </button>
        <button
          onClick={() => {
            setLoading(true)
            loadExpenses().then(() => setLoading(false))
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text-1)] text-sm transition-colors"
        >
          <RefreshCw size={14} /> Actualizar
        </button>
        <span className="text-xs text-[var(--text-4)]">{filtered.length} gasto{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Categoria</label>
            <select
              value={filterCategoria}
              onChange={(e) => setFilterCategoria(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm"
            >
              <option value="">Todas</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Proveedor</label>
            <input
              type="text"
              value={filterProveedor}
              onChange={(e) => setFilterProveedor(e.target.value)}
              placeholder="Filtrar proveedor..."
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Desde</label>
            <input
              type="date"
              value={filterDesde}
              onChange={(e) => setFilterDesde(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-3)] mb-1">Hasta</label>
            <input
              type="date"
              value={filterHasta}
              onChange={(e) => setFilterHasta(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--text-1)] px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* ── Expense Table ──────────────────────────────────────────── */}
      <div className="bg-[var(--bento-card)] border border-[var(--accent-line)] rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-mid)' }}>
        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Fecha</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Categoria</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Descripcion</th>
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Proveedor</th>
                <th className="text-right px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Monto</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Recurrente</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-[var(--text-4)] text-sm">
                    No hay gastos registrados
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--line)] hover:bg-[var(--surface-2)]/50 transition-colors">
                    <td className="px-4 py-3 text-[var(--text-2)] tnum whitespace-nowrap">{e.fecha}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${CATEGORY_COLORS[e.categoria] || '#6b7280'}20`,
                          color: CATEGORY_COLORS[e.categoria] || '#6b7280',
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[e.categoria] || '#6b7280' }}
                        />
                        {e.categoria}
                      </span>
                      {e.subcategoria && (
                        <span className="ml-2 text-xs text-[var(--text-4)]">{e.subcategoria}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-1)] max-w-[200px] truncate">
                      {e.descripcion || '--'}
                      {e.comprobante && (
                        <span className="ml-2 text-[10px] text-[var(--text-4)] font-mono">{e.comprobante}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{e.proveedor || '--'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--text-1)] tnum">
                      {formatCurrency(e.monto)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.recurrente ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-400">
                          <RefreshCw size={10} />
                          {e.frecuencia || 'si'}
                        </span>
                      ) : (
                        <span className="text-[var(--text-4)] text-xs">--</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-[var(--line)]">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-4)] text-sm">
              No hay gastos registrados
            </div>
          ) : (
            filtered.map((e) => (
              <div key={e.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${CATEGORY_COLORS[e.categoria] || '#6b7280'}20`,
                      color: CATEGORY_COLORS[e.categoria] || '#6b7280',
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[e.categoria] || '#6b7280' }}
                    />
                    {e.categoria}
                  </span>
                  <span className="text-base font-bold text-[var(--text-1)] tnum">{formatCurrency(e.monto)}</span>
                </div>
                <p className="text-sm text-[var(--text-1)]">{e.descripcion || e.subcategoria || '--'}</p>
                <div className="flex items-center gap-3 text-xs text-[var(--text-3)]">
                  <span className="tnum">{e.fecha}</span>
                  {e.proveedor && <span>{e.proveedor}</span>}
                  {e.recurrente && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 text-[10px] font-semibold">
                      <RefreshCw size={9} />
                      {e.frecuencia || 'rec'}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
