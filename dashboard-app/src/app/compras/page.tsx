'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, Search, Truck, ArrowDown, Clock } from 'lucide-react'
import { sbApi } from '@/lib/supabase-api'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

interface Product {
  id: number
  name: string
  unit: string
  cost_per_unit: number
  stock: number
  reorder_point: number
  category: string
}

interface Movement {
  id: number
  product_id: number
  movement_type: string
  quantity: number
  actor: string
  notes: string
  created_at: string
  product_name?: string
}

export default function ComprasPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'reorder' | 'movements'>('reorder')

  useEffect(() => {
    async function load() {
      try {
        const [prods, movs] = await Promise.all([
          sbApi('pos_inventory_products?active=eq.true&reorder_point=gt.0&order=category.asc,name.asc&select=id,name,unit,cost_per_unit,stock,reorder_point,category'),
          sbApi('pos_inventory_movements?order=created_at.desc&limit=50&select=id,product_id,movement_type,quantity,actor,notes,created_at'),
        ])
        if (Array.isArray(prods)) {
          setProducts(prods.map((p: any) => ({
            ...p,
            stock: p.stock ?? 0,
            cost_per_unit: p.cost_per_unit ?? 0,
            reorder_point: p.reorder_point ?? 0,
            category: p.category || 'SIN CATEGORIA',
          })))
        }
        if (Array.isArray(movs) && Array.isArray(prods)) {
          const prodMap = new Map(prods.map((p: any) => [p.id, p.name]))
          setMovements(movs.map((m: any) => ({
            ...m,
            product_name: prodMap.get(m.product_id) || `#${m.product_id}`,
          })))
        }
      } catch (err) {
        console.error('Error loading compras:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>

  // Products needing reorder
  const needsReorder = products.filter(p => p.stock <= p.reorder_point)
  const allWithReorderPoint = products

  const filtered = (tab === 'reorder' ? needsReorder : allWithReorderPoint)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()))

  // Group by category
  const grouped = filtered.reduce<Record<string, Product[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {})
  const categoryKeys = Object.keys(grouped).sort()

  // KPIs
  const totalNeedReorder = needsReorder.length
  const totalCostReorder = needsReorder.reduce((s, p) => s + ((p.reorder_point - p.stock) * p.cost_per_unit), 0)
  const categories = [...new Set(needsReorder.map(p => p.category))]
  const topCategory = categories
    .map(c => ({ name: c, count: needsReorder.filter(p => p.category === c).length }))
    .sort((a, b) => b.count - a.count)[0]

  // Category breakdown for reorder items
  const categoryBreakdown = categories
    .map(c => ({
      name: c,
      count: needsReorder.filter(p => p.category === c).length,
    }))
    .sort((a, b) => b.count - a.count)

  return (
    <>
      <PageHeader title="Compras / Reorden" subtitle="Productos por reabastecer desde inventario" />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Productos por reordenar</p>
          <p className="text-2xl font-bold text-red-400">{totalNeedReorder}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Costo estimado reorden</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalCostReorder)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Categorias afectadas</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{categories.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-3)] mb-1">Categoria critica</p>
          <p className="text-sm font-bold text-[var(--text-1)]">{topCategory?.name || '—'}</p>
          <p className="text-xs text-[var(--text-3)]">{topCategory?.count || 0} productos</p>
        </div>
      </div>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 flex items-center gap-2"><Truck size={14} className="text-blue-400" /> Reorden por categoria</h3>
          <div className="space-y-2">
            {categoryBreakdown.slice(0, 8).map(d => (
              <div key={d.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-1)]">{d.name}</span>
                  <span className="text-[var(--text-2)]">{d.count} productos ({totalNeedReorder > 0 ? ((d.count / totalNeedReorder) * 100).toFixed(1) : 0}%)</span>
                </div>
                <div className="w-full bg-[var(--surface-2)] rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-red-500" style={{ width: `${totalNeedReorder > 0 ? (d.count / totalNeedReorder) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex gap-3 mb-4">
        <div className="flex gap-1">
          <button onClick={() => setTab('reorder')}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1 ${tab === 'reorder' ? 'bg-red-500 text-white' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
            <AlertTriangle size={12} /> Por reordenar ({totalNeedReorder})
          </button>
          <button onClick={() => setTab('movements')}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1 ${tab === 'movements' ? 'bg-blue-500 text-white' : 'bg-[var(--surface-2)] text-[var(--text-3)]'}`}>
            <Clock size={12} /> Movimientos recientes
          </button>
        </div>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto o categoria..."
            className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-sm text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      {/* Reorder Tab — Products grouped by category */}
      {tab === 'reorder' && (
        <>
          {categoryKeys.length > 0 ? categoryKeys.map(cat => (
            <div key={cat} className="mb-4">
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2 px-1">{cat} ({grouped[cat].length})</h3>
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Producto</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Stock</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Reorden</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Faltan</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Costo/U</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line-soft)]">
                    {grouped[cat].map(p => {
                      const deficit = p.reorder_point - p.stock
                      return (
                        <tr key={p.id} className="hover:bg-[var(--surface-2)]">
                          <td className="px-4 py-2.5 text-sm text-[var(--text-1)]">{p.name}</td>
                          <td className={`px-4 py-2.5 text-sm text-right tabular-nums ${p.stock <= 0 ? 'text-red-400 font-bold' : 'text-orange-400'}`}>{p.stock.toLocaleString()} {p.unit}</td>
                          <td className="px-4 py-2.5 text-sm text-[var(--text-3)] text-right tabular-nums">{p.reorder_point.toLocaleString()} {p.unit}</td>
                          <td className="px-4 py-2.5 text-sm text-red-400 font-semibold text-right tabular-nums flex items-center justify-end gap-1">
                            <ArrowDown size={12} /> {deficit > 0 ? deficit.toLocaleString() : 0}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-[var(--text-2)] text-right tabular-nums">{formatCurrency(p.cost_per_unit)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )) : (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center">
              <Package size={32} className="text-emerald-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-[var(--text-1)] mb-2">Inventario OK</h3>
              <p className="text-sm text-[var(--text-3)]">No hay productos por debajo del punto de reorden.</p>
            </div>
          )}
        </>
      )}

      {/* Movements Tab */}
      {tab === 'movements' && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
          {movements.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)]">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Fecha</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Producto</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Tipo</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Cantidad</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Actor</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--text-3)]">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {movements.map(m => {
                  const typeColor = m.movement_type === 'entrada' ? 'text-emerald-400' : m.movement_type === 'merma' ? 'text-red-400' : 'text-yellow-400'
                  return (
                    <tr key={m.id} className="hover:bg-[var(--surface-2)]">
                      <td className="px-4 py-2.5 text-xs text-[var(--text-3)] tabular-nums">{new Date(m.created_at).toLocaleDateString('es-MX')} {new Date(m.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-2.5 text-sm text-[var(--text-1)]">{m.product_name}</td>
                      <td className={`px-4 py-2.5 text-xs font-medium uppercase ${typeColor}`}>{m.movement_type}</td>
                      <td className={`px-4 py-2.5 text-sm text-right tabular-nums ${m.quantity >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-3)]">{m.actor || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--text-3)] max-w-[200px] truncate">{m.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <Clock size={32} className="text-blue-400 mx-auto mb-3" />
              <h3 className="text-base font-bold text-[var(--text-1)] mb-2">Sin movimientos</h3>
              <p className="text-sm text-[var(--text-3)]">No hay movimientos de inventario registrados.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
