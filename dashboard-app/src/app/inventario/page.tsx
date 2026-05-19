'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, TrendingDown, Search, ArrowUpDown } from 'lucide-react'
import { getLatestDeep } from '@/lib/data'
import { formatCurrency } from '@/lib/format'

interface InventoryItem {
  producto: string
  existencia: number
  unidad: string
  costo_unitario: number
  costo_total: number
}

interface ShrinkageItem {
  producto: string
  sistema: number
  fisico: number
  diferencia: number
  costo_diferencia: number
}

type SortKey = 'producto' | 'existencia' | 'costo_total'

export default function InventarioPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [shrinkage, setShrinkage] = useState<ShrinkageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('costo_total')
  const [sortAsc, setSortAsc] = useState(false)
  const [tab, setTab] = useState<'stock' | 'merma'>('stock')
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [invRow, shrinkRow] = await Promise.all([
          getLatestDeep('wansoft_inventory'),
          getLatestDeep('wansoft_shrinkage'),
        ])
        if (invRow?.data && Array.isArray(invRow.data)) {
          setInventory(invRow.data)
          setFecha(invRow.fecha as string || '')
        }
        if (shrinkRow?.data && Array.isArray(shrinkRow.data)) setShrinkage(shrinkRow.data)
      } catch (err) {
        console.error('Error loading inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = inventory
    .filter(i => !search || i.producto.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (typeof va === 'string') return sortAsc ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string)
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  const totalValue = inventory.reduce((s, i) => s + (i.costo_total || 0), 0)
  const lowStock = inventory.filter(i => i.existencia > 0 && i.existencia < 5)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Inventario</h2>
        <p className="text-sm text-slate-400">Stock actual y deteccion de merma {fecha && `· ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-blue-500" /><span className="text-xs text-slate-500 font-medium">Productos</span></div>
          <p className="text-2xl font-bold text-slate-900">{inventory.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-emerald-500" /><span className="text-xs text-slate-500 font-medium">Valor total</span></div>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalValue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-amber-500" /><span className="text-xs text-slate-500 font-medium">Stock bajo</span></div>
          <p className="text-2xl font-bold text-amber-600">{lowStock.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingDown size={16} className="text-red-500" /><span className="text-xs text-slate-500 font-medium">Items con merma</span></div>
          <p className="text-2xl font-bold text-red-600">{shrinkage.length}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('stock')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'stock' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>Stock ({inventory.length})</button>
        <button onClick={() => setTab('merma')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'merma' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}>Merma ({shrinkage.length})</button>
      </div>

      {tab === 'stock' ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">{inventory.length === 0 ? 'Sin datos. El scraper corre diario a las 11pm.' : 'Sin resultados'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('producto')}>Producto <ArrowUpDown size={12} className="inline" /></th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('existencia')}>Existencia <ArrowUpDown size={12} className="inline" /></th>
                  <th className="text-left px-4 py-3 font-medium">Unidad</th>
                  <th className="text-right px-4 py-3 font-medium">Costo unit.</th>
                  <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('costo_total')}>Costo total <ArrowUpDown size={12} className="inline" /></th>
                </tr></thead>
                <tbody>{filtered.slice(0, 200).map((item, i) => (
                  <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${item.existencia < 5 && item.existencia > 0 ? 'bg-amber-50/50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.producto}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${item.existencia < 5 ? 'text-amber-600 font-bold' : 'text-slate-700'}`}>{item.existencia}</td>
                    <td className="px-4 py-3 text-slate-500">{item.unidad}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(item.costo_unitario)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">{formatCurrency(item.costo_total)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {shrinkage.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Sin diferencias detectadas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">Producto</th>
                  <th className="text-right px-4 py-3 font-medium">Sistema</th>
                  <th className="text-right px-4 py-3 font-medium">Fisico</th>
                  <th className="text-right px-4 py-3 font-medium">Diferencia</th>
                  <th className="text-right px-4 py-3 font-medium">Costo dif.</th>
                </tr></thead>
                <tbody>{shrinkage.map((item, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-red-50/50">
                    <td className="px-4 py-3 font-medium text-slate-900">{item.producto}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.sistema}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{item.fisico}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-bold ${item.diferencia < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{item.diferencia > 0 ? '+' : ''}{item.diferencia}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-600">{formatCurrency(Math.abs(item.costo_diferencia))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}
