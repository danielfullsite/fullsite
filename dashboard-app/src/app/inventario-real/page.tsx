'use client'

import { useEffect, useState, useMemo } from 'react'
import { Warehouse, Package, AlertTriangle, Search, ChevronUp, ChevronDown, DollarSign } from 'lucide-react'
import { getWansoftDataLatest } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

interface InventoryItem {
  almacen: string
  departamento: string
  codigo: string
  producto: string
  critico: boolean
  inv_inicial_qty: number
  inv_inicial_val: number
  entradas_qty: number
  entradas_val: number
  salidas_qty: number
  salidas_val: number
  inv_final_qty: number
  inv_final_val: number
  costo_promedio: number
  saldo_actual: number
}

type SortKey = 'codigo' | 'producto' | 'departamento' | 'critico' | 'inv_inicial_qty' | 'entradas_qty' | 'salidas_qty' | 'inv_final_qty' | 'costo_promedio' | 'saldo_actual'

const WAREHOUSE_TABS = [
  { key: 'todos', label: 'Todos' },
  { key: 'cocina', label: 'Cocina' },
  { key: 'barra', label: 'Barra' },
  { key: 'panaderia', label: 'Panaderia' },
  { key: 'market', label: 'Market' },
  { key: 'venta_terceros', label: 'Venta Terceros' },
]

function matchWarehouse(almacen: string, tab: string): boolean {
  if (tab === 'todos') return true
  const normalized = almacen.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (tab === 'cocina') return normalized.includes('cocina')
  if (tab === 'barra') return normalized.includes('barra')
  if (tab === 'panaderia') return normalized.includes('panaderia') || normalized.includes('panadería')
  if (tab === 'market') return normalized.includes('market')
  if (tab === 'venta_terceros') return normalized.includes('venta') && normalized.includes('tercero')
  return false
}

export default function InventarioRealPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('todos')
  const [sortKey, setSortKey] = useState<SortKey>('saldo_actual')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const result = await getWansoftDataLatest('inventory_parsed')
        if (result?.data) {
          const raw = Array.isArray(result.data) ? result.data : (result.data as any)?.items || []
          setItems(raw.map((r: any) => ({
            almacen: r.almacen || '',
            departamento: r.departamento || '',
            codigo: r.codigo || '',
            producto: r.producto || '',
            critico: Boolean(r.critico),
            inv_inicial_qty: Number(r.inv_inicial_qty) || 0,
            inv_inicial_val: Number(r.inv_inicial_val) || 0,
            entradas_qty: Number(r.entradas_qty) || 0,
            entradas_val: Number(r.entradas_val) || 0,
            salidas_qty: Number(r.salidas_qty) || 0,
            salidas_val: Number(r.salidas_val) || 0,
            inv_final_qty: Number(r.inv_final_qty) || 0,
            inv_final_val: Number(r.inv_final_val) || 0,
            costo_promedio: Number(r.costo_promedio) || 0,
            saldo_actual: Number(r.saldo_actual) || 0,
          })))
          setFecha(result.fecha)
        }
      } catch (e) {
        console.error('[inventario-real] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    let list = items.filter(i => matchWarehouse(i.almacen, activeTab))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.departamento.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, activeTab, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: any = a[sortKey]
      let vb: any = b[sortKey]
      if (typeof va === 'boolean') { va = va ? 1 : 0; vb = vb ? 1 : 0 }
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb as string, 'es')
        return sortAsc ? cmp : -cmp
      }
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
  }, [filtered, sortKey, sortAsc])

  // KPIs
  const totalSaldo = items.reduce((s, i) => s + i.saldo_actual, 0)
  const itemsConStock = items.filter(i => i.inv_final_qty > 0).length
  const itemsCriticosSinStock = items.filter(i => i.critico && i.inv_final_qty <= 0).length
  const almacenes = new Set(items.map(i => i.almacen)).size

  // Totals for current filtered view
  const totals = useMemo(() => ({
    inv_inicial_qty: filtered.reduce((s, i) => s + i.inv_inicial_qty, 0),
    entradas_qty: filtered.reduce((s, i) => s + i.entradas_qty, 0),
    salidas_qty: filtered.reduce((s, i) => s + i.salidas_qty, 0),
    inv_final_qty: filtered.reduce((s, i) => s + i.inv_final_qty, 0),
    saldo_actual: filtered.reduce((s, i) => s + i.saldo_actual, 0),
  }), [filtered])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={12} className="opacity-30 ml-0.5 inline" />
    return sortAsc
      ? <ChevronUp size={12} className="text-blue-400 ml-0.5 inline" />
      : <ChevronDown size={12} className="text-blue-400 ml-0.5 inline" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle={`Estado de cuenta por almacen${fecha ? ` — ${fecha}` : ''}`}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Total saldo"
          value={formatCurrency(totalSaldo)}
          icon={DollarSign}
          accentClass="kpi-accent-green"
          index={0}
        />
        <KPICard
          label="Items con stock"
          value={formatNumber(itemsConStock)}
          subtitle={`de ${formatNumber(items.length)} items`}
          icon={Package}
          accentClass="kpi-accent-blue"
          index={1}
        />
        <KPICard
          label="Criticos sin stock"
          value={formatNumber(itemsCriticosSinStock)}
          icon={AlertTriangle}
          accentClass={itemsCriticosSinStock > 0 ? 'kpi-accent-amber' : 'kpi-accent-green'}
          index={2}
        />
        <KPICard
          label="Almacenes"
          value={String(almacenes)}
          icon={Warehouse}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* Warehouse tabs + search */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1 flex-wrap">
          {WAREHOUSE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.key
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            placeholder="Buscar producto, codigo o departamento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-3)]">
          {formatNumber(filtered.length)} items{activeTab !== 'todos' ? ` en ${WAREHOUSE_TABS.find(t => t.key === activeTab)?.label}` : ''}
          {search ? ` (filtro: "${search}")` : ''}
        </p>
        <p className="text-xs text-[var(--text-3)]">
          Saldo vista: <span className="font-semibold text-[var(--text-1)]">{formatCurrency(totals.saldo_actual)}</span>
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--accent-line)]" style={{ background: 'var(--bento-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--accent-line)]">
              {([
                { key: 'codigo' as SortKey, label: 'Codigo', align: 'left' },
                { key: 'producto' as SortKey, label: 'Producto', align: 'left' },
                { key: 'departamento' as SortKey, label: 'Depto', align: 'left' },
                { key: 'critico' as SortKey, label: 'Critico', align: 'center' },
                { key: 'inv_inicial_qty' as SortKey, label: 'Inv Inicial', align: 'right' },
                { key: 'entradas_qty' as SortKey, label: 'Entradas', align: 'right' },
                { key: 'salidas_qty' as SortKey, label: 'Salidas', align: 'right' },
                { key: 'inv_final_qty' as SortKey, label: 'Inv Final', align: 'right' },
                { key: 'costo_promedio' as SortKey, label: 'Costo Prom', align: 'right' },
                { key: 'saldo_actual' as SortKey, label: 'Saldo', align: 'right' },
              ]).map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] cursor-pointer select-none hover:text-[var(--text-1)] transition-colors whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
                  {col.label}
                  <SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-[var(--text-4)] text-sm">
                  No se encontraron items
                </td>
              </tr>
            ) : (
              sorted.map((item, idx) => {
                const isZeroStock = item.critico && item.inv_final_qty <= 0
                return (
                  <tr
                    key={`${item.codigo}-${item.almacen}-${idx}`}
                    className={`border-b border-[var(--accent-line)]/50 transition-colors ${
                      isZeroStock
                        ? 'bg-red-500/8 hover:bg-red-500/15'
                        : 'hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-[var(--text-3)] whitespace-nowrap">{item.codigo}</td>
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap max-w-[260px] truncate ${
                      isZeroStock ? 'text-red-400' : 'text-[var(--text-1)]'
                    }`}>
                      {item.producto}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-3)] whitespace-nowrap text-xs">{item.departamento}</td>
                    <td className="px-3 py-2.5 text-center">
                      {item.critico ? (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isZeroStock ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {isZeroStock && <AlertTriangle size={10} />}
                          SI
                        </span>
                      ) : (
                        <span className="text-[var(--text-4)] text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">
                      {item.inv_inicial_qty.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-emerald-400">
                      {item.entradas_qty > 0 ? `+${item.entradas_qty.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-red-400">
                      {item.salidas_qty > 0 ? `-${item.salidas_qty.toFixed(2)}` : '-'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold tnum ${
                      item.inv_final_qty <= 0 ? 'text-red-400' : 'text-[var(--text-1)]'
                    }`}>
                      {item.inv_final_qty.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">
                      {formatCurrency(item.costo_promedio)}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold tnum ${
                      item.saldo_actual <= 0 ? 'text-red-400' : 'text-[var(--text-1)]'
                    }`}>
                      {formatCurrency(item.saldo_actual)}
                    </td>
                  </tr>
                )
              })
            )}

            {/* Totals row */}
            {sorted.length > 0 && (
              <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                <td className="px-3 py-3" />
                <td className="px-3 py-3 font-bold text-[var(--text-1)] text-xs uppercase tracking-wider">
                  Total ({formatNumber(filtered.length)} items)
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                  {totals.inv_inicial_qty.toFixed(2)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-emerald-400">
                  +{totals.entradas_qty.toFixed(2)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-red-400">
                  -{totals.salidas_qty.toFixed(2)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                  {totals.inv_final_qty.toFixed(2)}
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                  {formatCurrency(totals.saldo_actual)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
