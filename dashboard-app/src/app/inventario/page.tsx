'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, TrendingDown, Search, ArrowUpDown, Filter } from 'lucide-react'
import { sbApi } from '@/lib/supabase-api'
import { formatCurrency } from '@/lib/format'

interface InventoryItem {
  producto: string
  existencia: number
  unidad: string
  costo_unitario: number
  costo_total: number
  category: string
  reorder_point: number
  below_reorder: boolean
}

type SortKey = 'producto' | 'existencia' | 'costo_total' | 'category'

export default function InventarioPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('costo_total')
  const [sortAsc, setSortAsc] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      try {
        // Read from pos_inventory_products (769 products with real stock)
        const data = await sbApi('pos_inventory_products?active=eq.true&order=name.asc&select=name,unit,cost_per_unit,stock,reorder_point,category,updated_at')
        if (Array.isArray(data) && data.length > 0) {
          const items: InventoryItem[] = data.map((row: { name: string; unit: string; cost_per_unit: number; stock: number; reorder_point: number; category: string; updated_at: string }) => ({
            producto: row.name,
            existencia: row.stock ?? 0,
            unidad: row.unit || '',
            costo_unitario: row.cost_per_unit ?? 0,
            costo_total: (row.stock ?? 0) * (row.cost_per_unit ?? 0),
            category: row.category || 'SIN CATEGORIA',
            reorder_point: row.reorder_point ?? 0,
            below_reorder: row.reorder_point > 0 && (row.stock ?? 0) <= row.reorder_point,
          }))
          setInventory(items)
          // Use the most recent updated_at as the date
          const latest = data.reduce((max: string, r: { updated_at: string }) => r.updated_at > max ? r.updated_at : max, data[0].updated_at)
          setFecha(latest ? new Date(latest).toLocaleDateString('es-MX') : '')
        }
      } catch (err) {
        console.error('Error loading inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const categories = Array.from(new Set(inventory.map(i => i.category))).sort()

  const filtered = inventory
    .filter(i => !categoryFilter || i.category === categoryFilter)
    .filter(i => !search || i.producto.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (typeof va === 'string') return sortAsc ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string)
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  const totalValue = inventory.reduce((s, i) => s + (i.costo_total || 0), 0)
  const belowReorder = inventory.filter(i => i.below_reorder)
  const outOfStock = inventory.filter(i => i.existencia <= 0)

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
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Inventario</h2>
        <p className="text-sm text-[var(--text-3)]">769 productos con stock real {fecha && `· Actualizado ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Productos</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{inventory.length}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">{categories.length} categorias</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Valor total</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalValue)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Bajo reorden</span></div>
          <p className="text-2xl font-bold text-amber-400">{belowReorder.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingDown size={16} className="text-red-500" /><span className="text-xs text-[var(--text-2)] font-medium">Sin stock</span></div>
          <p className="text-2xl font-bold text-red-600">{outOfStock.length}</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)] flex items-center gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </div>
          <div className="relative">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="pl-8 pr-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 appearance-none">
              <option value="">Todas las categorias ({inventory.length})</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Package size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">{inventory.length === 0 ? 'Sin datos de inventario' : 'Sin resultados'}</p>
            <p className="text-xs text-[var(--text-3)]">{inventory.length === 0 ? 'Verifica la tabla pos_inventory_products.' : 'Intenta con otro termino de busqueda.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('producto')}>Producto <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('category')}>Categoria <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('existencia')}>Stock <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-left px-4 py-3 font-medium">Unidad</th>
                <th className="text-right px-4 py-3 font-medium">Costo unit.</th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('costo_total')}>Valor <ArrowUpDown size={12} className="inline" /></th>
              </tr></thead>
              <tbody>{filtered.slice(0, 300).map((item, i) => (
                <tr key={i} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${item.below_reorder ? 'bg-amber-500/10' : item.existencia <= 0 ? 'bg-red-500/5' : ''}`}>
                  <td className="px-4 py-3 font-medium text-[var(--text-1)]">
                    {item.producto}
                    {item.below_reorder && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">reorden</span>}
                    {item.existencia <= 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-500">sin stock</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-2)]">{item.category}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${item.below_reorder ? 'text-amber-400 font-bold' : item.existencia <= 0 ? 'text-red-500 font-bold' : 'text-[var(--text-1)]'}`}>{item.existencia.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{item.unidad}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(item.costo_unitario)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-1)]">{formatCurrency(item.costo_total)}</td>
                </tr>
              ))}</tbody>
            </table>
            {filtered.length > 300 && <p className="p-3 text-center text-xs text-[var(--text-3)]">Mostrando 300 de {filtered.length} productos</p>}
          </div>
        )}
      </div>
    </>
  )
}
