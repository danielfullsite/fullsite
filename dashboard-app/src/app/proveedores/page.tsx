'use client'

import { useEffect, useState } from 'react'
import { Truck, DollarSign, ShoppingCart, BarChart3 } from 'lucide-react'
import { getLatestDeep } from '@/lib/data'
import { formatCurrency } from '@/lib/format'

interface SupplierItem {
  proveedor?: string
  nombre?: string
  total: number
  num_compras?: number
}

export default function ProveedoresPage() {
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const row = await getLatestDeep('wansoft_suppliers')
        if (row?.data) {
          // Data might be array or dict
          const d = row.data
          if (Array.isArray(d)) {
            setSuppliers(d)
          } else if (typeof d === 'object' && d !== null) {
            // Convert dict to array
            const arr = Object.entries(d as Record<string, unknown>).map(([key, val]) => ({
              proveedor: key,
              total: typeof val === 'number' ? val : 0,
            }))
            setSuppliers(arr)
          }
          setFecha(row.fecha as string || '')
        }
      } catch (err) {
        console.error('Error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalSpend = suppliers.reduce((s, sup) => s + (sup.total || 0), 0)
  const sorted = [...suppliers].sort((a, b) => (b.total || 0) - (a.total || 0))
  const topSupplier = sorted[0]
  const topPct = totalSpend > 0 && topSupplier ? Math.round((topSupplier.total / totalSpend) * 100) : 0

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Proveedores</h2>
        <p className="text-sm text-[var(--text-3)]">Gasto por proveedor últimos 30 dias {fecha && `· ${fecha}`}</p>
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
          <p className="text-lg font-bold text-[var(--text-1)] truncate">{topSupplier?.proveedor || topSupplier?.nombre || '--'}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><BarChart3 size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Concentracion</span></div>
          <p className="text-2xl font-bold text-amber-400">{topPct}%</p>
          <p className="text-xs text-[var(--text-3)]">del gasto en 1 proveedor</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        {sorted.length === 0 ? (
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
                <th className="text-right px-4 py-3 font-medium">Compras</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">% del gasto</th>
                <th className="px-4 py-3 font-medium w-40"></th>
              </tr></thead>
              <tbody>{sorted.map((sup, i) => {
                const pct = totalSpend > 0 ? (sup.total / totalSpend) * 100 : 0
                return (
                  <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                    <td className="px-4 py-3 text-[var(--text-3)]">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-[var(--text-1)]">{sup.proveedor || sup.nombre || 'N/A'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{sup.num_compras || '--'}</td>
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
