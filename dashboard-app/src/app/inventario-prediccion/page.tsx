'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, TrendingDown, ShieldCheck, Search, Filter, ArrowUpDown, ShoppingCart, Package, Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/format'

interface Prediction {
  product: string
  category: string
  current_stock: number
  unit: string
  avg_daily_consumption: number
  days_remaining: number | null
  status: 'critical' | 'warning' | 'ok'
  cost_per_unit: number
  suggested_purchase: number
  suggested_purchase_cost: number
}

interface Summary {
  total_products: number
  with_consumption_estimate: number
  critical: number
  warning: number
  healthy: number
  no_recipe: number
  total_suggested_purchase_cost: number
  days_analyzed: number
}

type SortKey = 'product' | 'days_remaining' | 'avg_daily_consumption' | 'current_stock' | 'suggested_purchase'
type ViewMode = 'all' | 'purchase'

export default function InventarioPrediccionPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('days_remaining')
  const [sortAsc, setSortAsc] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('all')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/inventory/predict')
        if (!res.ok) throw new Error('API error')
        const data = await res.json()
        setPredictions(data.predictions || [])
        setSummary(data.summary || null)
        setCategories(data.categories || [])
      } catch (err) {
        console.error('Error loading predictions:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(key === 'product') }
  }

  const filtered = predictions
    .filter(p => viewMode === 'purchase' ? p.suggested_purchase > 0 : true)
    .filter(p => !categoryFilter || p.category === categoryFilter)
    .filter(p => !statusFilter || p.status === statusFilter)
    .filter(p => !search || p.product.toLowerCase().includes(search.toLowerCase()))
    .filter(p => viewMode === 'all' ? p.avg_daily_consumption > 0 : true) // hide no-recipe in main view
    .sort((a, b) => {
      if (sortKey === 'product') {
        return sortAsc ? a.product.localeCompare(b.product) : b.product.localeCompare(a.product)
      }
      const va = sortKey === 'days_remaining' ? (a.days_remaining ?? 9999) : (a[sortKey] ?? 0)
      const vb = sortKey === 'days_remaining' ? (b.days_remaining ?? 9999) : (b[sortKey] ?? 0)
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  const purchaseItems = predictions.filter(p => p.suggested_purchase > 0)
  const totalPurchaseCost = purchaseItems.reduce((s, p) => s + p.suggested_purchase_cost, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function statusBadge(status: string, daysRemaining: number | null) {
    if (status === 'critical') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">CRITICO</span>
    if (status === 'warning') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">RIESGO</span>
    if (daysRemaining === null) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/20 text-zinc-400 font-medium">SIN RECETA</span>
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">OK</span>
  }

  function daysLabel(days: number | null) {
    if (days === null) return <span className="text-zinc-500">--</span>
    if (days < 1) return <span className="text-red-400 font-bold">{days.toFixed(1)}d</span>
    if (days < 3) return <span className="text-red-400 font-bold">{days.toFixed(1)}d</span>
    if (days < 7) return <span className="text-amber-400 font-bold">{days.toFixed(1)}d</span>
    return <span className="text-emerald-400">{days.toFixed(1)}d</span>
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Prediccion de Inventario</h2>
        <p className="text-sm text-[var(--text-3)]">
          Estimacion basada en {summary?.days_analyzed || 30} dias de ventas
          {summary ? ` · ${summary.with_consumption_estimate} productos con consumo estimado` : ''}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div
          className={`bg-[var(--surface)] rounded-xl border shadow-sm p-5 cursor-pointer transition-all ${statusFilter === 'critical' ? 'border-red-500 ring-1 ring-red-500/30' : 'border-[var(--line)]'}`}
          onClick={() => setStatusFilter(statusFilter === 'critical' ? '' : 'critical')}
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={16} className="text-red-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Criticos (&lt; 3 dias)</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{summary?.critical || 0}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">Se agotan pronto</p>
        </div>
        <div
          className={`bg-[var(--surface)] rounded-xl border shadow-sm p-5 cursor-pointer transition-all ${statusFilter === 'warning' ? 'border-amber-500 ring-1 ring-amber-500/30' : 'border-[var(--line)]'}`}
          onClick={() => setStatusFilter(statusFilter === 'warning' ? '' : 'warning')}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">En riesgo (&lt; 7 dias)</span>
          </div>
          <p className="text-2xl font-bold text-amber-400">{summary?.warning || 0}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">Monitorear de cerca</p>
        </div>
        <div
          className={`bg-[var(--surface)] rounded-xl border shadow-sm p-5 cursor-pointer transition-all ${statusFilter === 'ok' ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-[var(--line)]'}`}
          onClick={() => setStatusFilter(statusFilter === 'ok' ? '' : 'ok')}
        >
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} className="text-emerald-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Stock saludable</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{summary?.healthy || 0}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">7+ dias de stock</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart size={16} className="text-blue-500" />
            <span className="text-xs text-[var(--text-2)] font-medium">Compra sugerida</span>
          </div>
          <p className="text-2xl font-bold text-blue-400">{formatCurrency(totalPurchaseCost)}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">{purchaseItems.length} productos para 14 dias</p>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('all')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${viewMode === 'all' ? 'bg-emerald-600 text-white' : 'bg-[var(--surface)] text-[var(--text-2)] border border-[var(--line)]'}`}
        >
          <Clock size={14} className="inline mr-1.5 -mt-0.5" />
          Dias de stock
        </button>
        <button
          onClick={() => setViewMode('purchase')}
          className={`px-4 py-2 text-sm rounded-lg transition-all ${viewMode === 'purchase' ? 'bg-blue-600 text-white' : 'bg-[var(--surface)] text-[var(--text-2)] border border-[var(--line)]'}`}
        >
          <ShoppingCart size={14} className="inline mr-1.5 -mt-0.5" />
          Orden de compra sugerida
        </button>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)] flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          <div className="relative">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 appearance-none"
            >
              <option value="">Todas las categorias</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <span className="text-xs text-[var(--text-3)]">{filtered.length} productos</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Package size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">Sin resultados</p>
            <p className="text-xs text-[var(--text-3)]">Intenta con otro termino de busqueda o filtro.</p>
          </div>
        ) : viewMode === 'all' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('product')}>
                    Producto <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Categoria</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('current_stock')}>
                    Stock <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Unidad</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('avg_daily_consumption')}>
                    Consumo/dia <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('days_remaining')}>
                    Dias restantes <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-center px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((item, i) => (
                  <tr
                    key={i}
                    className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${
                      item.status === 'critical' ? 'bg-red-500/5' : item.status === 'warning' ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{item.product}</td>
                    <td className="px-4 py-3 text-xs text-[var(--text-2)]">{item.category}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{item.current_stock.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{item.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{item.avg_daily_consumption.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{daysLabel(item.days_remaining)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(item.status, item.days_remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 300 && (
              <p className="p-3 text-center text-xs text-[var(--text-3)]">Mostrando 300 de {filtered.length} productos</p>
            )}
          </div>
        ) : (
          /* Purchase Order View */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('product')}>
                    Producto <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Categoria</th>
                  <th className="text-right px-4 py-3 font-medium">Stock actual</th>
                  <th className="text-left px-4 py-3 font-medium">Unidad</th>
                  <th className="text-right px-4 py-3 font-medium">Consumo/dia</th>
                  <th className="text-right px-4 py-3 font-medium">Dias restantes</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('suggested_purchase')}>
                    Comprar <ArrowUpDown size={12} className="inline" />
                  </th>
                  <th className="text-right px-4 py-3 font-medium">Costo est.</th>
                  <th className="text-center px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((item, i) => (
                  <tr
                    key={i}
                    className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${
                      item.status === 'critical' ? 'bg-red-500/5' : item.status === 'warning' ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{item.product}</td>
                    <td className="px-4 py-3 text-xs text-[var(--text-2)]">{item.category}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{item.current_stock.toFixed(2)}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{item.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{item.avg_daily_consumption.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{daysLabel(item.days_remaining)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-blue-400">{item.suggested_purchase} {item.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(item.suggested_purchase_cost)}</td>
                    <td className="px-4 py-3 text-center">{statusBadge(item.status, item.days_remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Purchase Summary Footer */}
            <div className="p-4 border-t border-[var(--line-soft)] flex items-center justify-between">
              <span className="text-sm text-[var(--text-2)]">{filtered.length} productos en la orden sugerida</span>
              <span className="text-sm font-bold text-[var(--text-1)]">
                Total estimado: <span className="text-blue-400">{formatCurrency(totalPurchaseCost)}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Methodology note */}
      <div className="mt-4 p-4 bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <p className="text-xs text-[var(--text-3)]">
          Metodologia: promedio de ventas por categoria (ultimos {summary?.days_analyzed || 30} dias) cruzado con recetas e ingredientes.
          La compra sugerida calcula la cantidad necesaria para alcanzar 14 dias de stock.
          Productos sin receta asociada no muestran consumo estimado.
        </p>
      </div>
    </>
  )
}
