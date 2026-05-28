'use client'

import { useEffect, useState } from 'react'
import { Package, TrendingUp, RefreshCw, Search, Truck } from 'lucide-react'
import { getWansoftDataLatest } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

interface PurchaseItem {
  Quantity: number
  ProductName: string
  UnitOfMeasure: string
  Cost: number
  BuyerName: string
  Department: string
}

export default function ComprasPage() {
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [fecha, setFecha] = useState('')
  const [sortBy, setSortBy] = useState<'cost' | 'qty' | 'name'>('cost')

  useEffect(() => {
    async function load() {
      const result = await getWansoftDataLatest('purchases_by_product')
      if (result?.data) {
        const raw = (result.data as any)?.Result || result.data
        if (Array.isArray(raw)) {
          setItems(raw.filter((i: any) => i.ProductName && i.Cost > 0))
        }
        setFecha(result.fecha)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>

  const filtered = search
    ? items.filter(i => i.ProductName.toLowerCase().includes(search.toLowerCase()) || i.Department?.toLowerCase().includes(search.toLowerCase()))
    : items

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'cost') return b.Cost - a.Cost
    if (sortBy === 'qty') return b.Quantity - a.Quantity
    return a.ProductName.localeCompare(b.ProductName)
  })

  const totalCost = items.reduce((s, i) => s + i.Cost, 0)
  const totalItems = items.length
  const departments = [...new Set(items.map(i => i.Department).filter(Boolean))]
  const topDept = departments.map(d => ({
    name: d,
    cost: items.filter(i => i.Department === d).reduce((s, i) => s + i.Cost, 0),
  })).sort((a, b) => b.cost - a.cost)

  return (
    <>
      <PageHeader title="Compras por Producto" subtitle={`Datos de Wansoft${fecha ? ` · ${fecha}` : ''}`} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Gasto total</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalCost)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Productos comprados</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalItems}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Departamentos</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{departments.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Top departamento</p>
          <p className="text-sm font-bold text-[var(--text-1)]">{topDept[0]?.name || '—'}</p>
          <p className="text-xs text-[var(--text-3)]">{formatCurrency(topDept[0]?.cost || 0)}</p>
        </div>
      </div>

      {/* Department breakdown */}
      {topDept.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 flex items-center gap-2"><Truck size={14} className="text-blue-400" /> Gasto por departamento</h3>
          <div className="space-y-2">
            {topDept.slice(0, 8).map(d => (
              <div key={d.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-1)]">{d.name}</span>
                  <span className="text-[var(--text-2)]">{formatCurrency(d.cost)} ({totalCost > 0 ? ((d.cost / totalCost) * 100).toFixed(1) : 0}%)</span>
                </div>
                <div className="w-full bg-[var(--surface-2)] rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${totalCost > 0 ? (d.cost / totalCost) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + Sort */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto o departamento..."
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500" />
        </div>
        <div className="flex gap-1">
          {(['cost', 'qty', 'name'] as const).map(s => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium ${sortBy === s ? 'bg-blue-500 text-white' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
              {s === 'cost' ? '$' : s === 'qty' ? 'Qty' : 'A-Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Producto</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Depto</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Cantidad</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-3)]">Costo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {sorted.slice(0, 50).map((item, i) => (
              <tr key={i} className="hover:bg-[var(--surface-2)]">
                <td className="px-4 py-2.5 text-sm text-[var(--text-1)]">{item.ProductName}</td>
                <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">{item.Department}</td>
                <td className="px-4 py-2.5 text-sm text-[var(--text-2)] text-right tabular-nums">{item.Quantity.toLocaleString()} {item.UnitOfMeasure}</td>
                <td className="px-4 py-2.5 text-sm font-semibold text-[var(--text-1)] text-right tabular-nums">{formatCurrency(item.Cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 50 && <p className="text-center text-xs text-[var(--text-3)] py-3">Mostrando 50 de {sorted.length} productos</p>}
      </div>

      {items.length === 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center">
          <Package size={32} className="text-blue-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-[var(--text-1)] mb-2">Sin datos de compras</h3>
          <p className="text-sm text-[var(--text-3)]">Los datos se actualizan diariamente desde Wansoft.</p>
        </div>
      )}
    </>
  )
}
