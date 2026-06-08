'use client'

import { useEffect, useState } from 'react'
import { Truck, DollarSign, ShoppingCart, BarChart3 } from 'lucide-react'
import { getWansoftData } from '@/lib/data'
import { formatCurrency } from '@/lib/format'

interface SupplierItem {
  proveedor: string
  total: number
  num_productos: number
}

/** Parse double-escaped JSON string from wansoft_data */
function deepParse(val: unknown): unknown {
  if (typeof val !== 'string') return val
  try {
    const parsed = JSON.parse(val)
    if (typeof parsed === 'string') return deepParse(parsed)
    return parsed
  } catch {
    return val
  }
}

export default function ProveedoresPage() {
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const row = await getWansoftData('purchases_by_product')
        if (row?.data) {
          const parsed = deepParse(row.data)
          // Data shape: { Result: [{BuyerName, ProductName, Cost, Quantity, ...}] }
          let items: Array<{ BuyerName?: string; Cost?: number; ProductName?: string }> = []
          if (parsed && typeof parsed === 'object' && 'Result' in (parsed as Record<string, unknown>)) {
            items = (parsed as { Result: typeof items }).Result || []
          } else if (Array.isArray(parsed)) {
            items = parsed
          }

          // Group by BuyerName (proveedor)
          const map: Record<string, { total: number; productos: number }> = {}
          for (const item of items) {
            const name = item.BuyerName || 'Sin proveedor'
            if (!map[name]) map[name] = { total: 0, productos: 0 }
            map[name].total += item.Cost || 0
            map[name].productos += 1
          }

          const result = Object.entries(map)
            .map(([proveedor, data]) => ({ proveedor, total: data.total, num_productos: data.productos }))
            .filter(s => s.total > 0)
            .sort((a, b) => b.total - a.total)

          setSuppliers(result)
          setFecha(row.fecha || '')
        }
      } catch (err) {
        console.error('Error loading proveedores:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalSpend = suppliers.reduce((s, sup) => s + sup.total, 0)
  const topSupplier = suppliers[0]
  const topPct = totalSpend > 0 && topSupplier ? Math.round((topSupplier.total / totalSpend) * 100) : 0

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Proveedores</h2>
        <p className="text-sm text-[var(--text-3)]">Gasto por proveedor {fecha && `· ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Truck size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Proveedores</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{suppliers.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><DollarSign size={16} className="text-red-500" /><span className="text-xs text-[var(--text-2)] font-medium">Gasto total</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalSpend)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><ShoppingCart size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Top proveedor</span></div>
          <p className="text-lg font-bold text-[var(--text-1)] truncate">{topSupplier?.proveedor || '--'}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><BarChart3 size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Concentración</span></div>
          <p className="text-2xl font-bold text-amber-400">{topPct}%</p>
          <p className="text-xs text-[var(--text-3)]">del gasto en 1 proveedor</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        {suppliers.length === 0 ? (
          <div className="p-8 text-center">
            <Truck size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">Sin datos de proveedores</p>
            <p className="text-xs text-[var(--text-3)]">El scraper corre diario y actualiza los datos automáticamente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Proveedor</th>
                <th className="text-right px-4 py-3 font-medium">Productos</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">% del gasto</th>
                <th className="px-4 py-3 font-medium w-40"></th>
              </tr></thead>
              <tbody>{suppliers.map((sup, i) => {
                const pct = totalSpend > 0 ? (sup.total / totalSpend) * 100 : 0
                return (
                  <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3 text-[var(--text-3)]">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{sup.proveedor}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{sup.num_productos}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-1)]">{formatCurrency(sup.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{pct.toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
