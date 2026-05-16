'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Package, Search, RefreshCw, AlertTriangle, TrendingDown, BookOpen, ArrowUpDown } from 'lucide-react'
import { getInventory, getInventoryMovements, formatMXN, type InventoryItem, type InventoryMovement } from '@/lib/pos-data'

type SortKey = 'name' | 'stock' | 'category' | 'status'

export default function InventarioPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [tab, setTab] = useState<'stock' | 'movements'>('stock')

  const fetchData = async () => {
    setLoading(true)
    const [inv, mov] = await Promise.all([getInventory(), getInventoryMovements(100)])
    setInventory(inv)
    setMovements(mov)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const categories = useMemo(() => {
    const cats = new Set(inventory.map(i => i.ingredient_category).filter(Boolean))
    return Array.from(cats).sort()
  }, [inventory])

  const getStatus = (item: InventoryItem): 'critical' | 'low' | 'ok' => {
    if (item.stock <= 0) return 'critical'
    if (item.stock <= item.reorder_point) return 'low'
    return 'ok'
  }

  const filtered = useMemo(() => {
    let items = inventory.filter(i => {
      if (searchTerm && !i.ingredient_name?.toLowerCase().includes(searchTerm.toLowerCase())) return false
      if (filterCategory !== 'all' && i.ingredient_category !== filterCategory) return false
      if (filterStatus !== 'all' && getStatus(i) !== filterStatus) return false
      return true
    })

    items.sort((a, b) => {
      switch (sortKey) {
        case 'name': return (a.ingredient_name ?? '').localeCompare(b.ingredient_name ?? '')
        case 'stock': return a.stock - b.stock
        case 'category': return (a.ingredient_category ?? '').localeCompare(b.ingredient_category ?? '')
        case 'status': {
          const p: Record<string, number> = { critical: 0, low: 1, ok: 2 }
          return (p[getStatus(a)] ?? 3) - (p[getStatus(b)] ?? 3)
        }
        default: return 0
      }
    })

    return items
  }, [inventory, searchTerm, filterCategory, filterStatus, sortKey])

  const stats = useMemo(() => {
    const critical = inventory.filter(i => getStatus(i) === 'critical').length
    const low = inventory.filter(i => getStatus(i) === 'low').length
    const ok = inventory.filter(i => getStatus(i) === 'ok').length
    const totalValue = inventory.reduce((sum, i) => sum + (i.stock * (i.ingredient_cost ?? 0)), 0)
    return { critical, low, ok, totalValue }
  }, [inventory])

  const statusConfig = {
    critical: { bg: 'bg-red-900/30', border: 'border-red-700/50', text: 'text-red-400', label: 'AGOTADO' },
    low: { bg: 'bg-amber-900/30', border: 'border-amber-700/50', text: 'text-amber-400', label: 'BAJO' },
    ok: { bg: 'bg-slate-800/60', border: 'border-slate-700/50', text: 'text-emerald-400', label: 'OK' },
  }

  const catLabels: Record<string, string> = {
    vegetal: 'Frutas y Verduras',
    proteina: 'Lacteos, Carnes y Pescados',
    abarrote: 'Abarrotes y Congelados',
    subreceta: 'Sub-recetas',
    otro: 'Otro',
  }

  return (
    <div className="h-screen flex flex-col text-white bg-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/pos" className="w-10 h-10 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <Package size={24} className="text-blue-400" />
            <h1 className="text-xl font-bold">Inventario</h1>
          </div>
          <button onClick={fetchData} className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center">
            <RefreshCw size={14} />
          </button>
        </div>
        <Link
          href="/pos/recetas"
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors flex items-center gap-1.5"
        >
          <BookOpen size={14} />
          Recetas
        </Link>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 bg-slate-800/30 border-b border-slate-700">
        <div className="bg-red-900/20 border border-red-700/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-2xl font-bold">{stats.critical}</p>
          <p className="text-red-400/70 text-xs">Agotados</p>
        </div>
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3">
          <p className="text-amber-400 text-2xl font-bold">{stats.low}</p>
          <p className="text-amber-400/70 text-xs">Bajo stock</p>
        </div>
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3">
          <p className="text-emerald-400 text-2xl font-bold">{stats.ok}</p>
          <p className="text-emerald-400/70 text-xs">OK</p>
        </div>
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3">
          <p className="text-blue-400 text-2xl font-bold">{formatMXN(stats.totalValue)}</p>
          <p className="text-blue-400/70 text-xs">Valor total</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2 border-b border-slate-700">
        <button
          onClick={() => setTab('stock')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'stock' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Stock actual
        </button>
        <button
          onClick={() => setTab('movements')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'movements' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          Movimientos
        </button>
      </div>

      {tab === 'stock' ? (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 px-6 py-3 bg-slate-800/30 border-b border-slate-700">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar ingrediente..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm min-h-[42px]"
            >
              <option value="all">Todas las categorias</option>
              {categories.map(c => (
                <option key={c} value={c}>{catLabels[c ?? ''] ?? c}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm min-h-[42px]"
            >
              <option value="all">Todos los estados</option>
              <option value="critical">Agotados</option>
              <option value="low">Bajo stock</option>
              <option value="ok">OK</option>
            </select>
            <button
              onClick={() => setSortKey(prev => {
                const order: SortKey[] = ['status', 'name', 'stock', 'category']
                const idx = order.indexOf(prev)
                return order[(idx + 1) % order.length]
              })}
              className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors flex items-center gap-1.5"
            >
              <ArrowUpDown size={14} />
              {sortKey === 'status' ? 'Estado' : sortKey === 'name' ? 'Nombre' : sortKey === 'stock' ? 'Stock' : 'Categoria'}
            </button>
          </div>

          {/* Inventory table */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-500">
                <div className="text-center">
                  <Package size={48} className="mx-auto mb-3 opacity-50" />
                  <p className="text-xl">Sin inventario</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {filtered.map(item => {
                  const status = getStatus(item)
                  const config = statusConfig[status]
                  const pct = item.reorder_point > 0
                    ? Math.min(100, (item.stock / (item.reorder_point * 3)) * 100)
                    : 100

                  return (
                    <div key={item.id} className={`flex items-center gap-4 px-6 py-3 ${status === 'critical' ? 'bg-red-950/20' : ''}`}>
                      {/* Status indicator */}
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg} border ${config.border}`}>
                        {status === 'critical' ? <AlertTriangle size={16} className={config.text} /> :
                         status === 'low' ? <TrendingDown size={16} className={config.text} /> :
                         <Package size={16} className={config.text} />}
                      </div>

                      {/* Name + category */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm">{item.ingredient_name}</p>
                        <p className="text-slate-500 text-xs">{catLabels[item.ingredient_category ?? ''] ?? item.ingredient_category}</p>
                      </div>

                      {/* Stock bar */}
                      <div className="w-32 flex-shrink-0">
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              status === 'critical' ? 'bg-red-500' :
                              status === 'low' ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Stock number */}
                      <div className="w-28 text-right flex-shrink-0">
                        <p className={`font-semibold text-sm ${config.text}`}>
                          {item.stock.toFixed(item.ingredient_unit === 'pz' || item.ingredient_unit === 'pza.' ? 0 : 2)} {item.ingredient_unit}
                        </p>
                        <p className="text-slate-600 text-xs">
                          reorden: {item.reorder_point} {item.ingredient_unit}
                        </p>
                      </div>

                      {/* Value */}
                      <div className="w-24 text-right flex-shrink-0">
                        <p className="text-slate-400 text-sm">{formatMXN(item.stock * (item.ingredient_cost ?? 0))}</p>
                      </div>

                      {/* Status badge */}
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${config.bg} ${config.text} border ${config.border}`}>
                        {config.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Movements tab */
        <div className="flex-1 overflow-y-auto">
          {movements.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <p>Sin movimientos registrados</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {movements.map(mov => {
                const isDeduction = mov.movement_type === 'deduction'
                return (
                  <div key={mov.id} className="flex items-center gap-4 px-6 py-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      isDeduction ? 'bg-red-900/30' : 'bg-emerald-900/30'
                    }`}>
                      {isDeduction ? <TrendingDown size={16} className="text-red-400" /> : <Package size={16} className="text-emerald-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{mov.ingredient_id}</p>
                      <p className="text-slate-400 text-xs">{mov.notes || mov.movement_type}</p>
                    </div>
                    <p className={`font-semibold text-sm ${isDeduction ? 'text-red-400' : 'text-emerald-400'}`}>
                      {mov.quantity > 0 ? '+' : ''}{mov.quantity}
                    </p>
                    <div className="text-right flex-shrink-0">
                      <p className="text-slate-400 text-xs">{mov.actor}</p>
                      <p className="text-slate-600 text-xs">
                        {new Date(mov.created_at).toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
