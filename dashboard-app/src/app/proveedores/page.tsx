'use client'

import { useEffect, useState } from 'react'
import { Truck, DollarSign, ShoppingCart, BarChart3, Search, Phone, Mail } from 'lucide-react'
import { formatCurrency } from '@/lib/format'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Supplier {
  id: string
  name: string
  rfc: string
  phone: string
  email: string
  giro: string
  clave_wansoft: string
  payment_terms: number
}

export default function ProveedoresPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pos_suppliers?client_id=eq.amalay&select=id,name,rfc,phone,email,giro,clave_wansoft,payment_terms&order=name.asc&limit=500`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (res.ok) {
          const data = await res.json()
          setSuppliers(data)
        }
      } catch (err) {
        console.error('Error loading suppliers:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name?.toLowerCase().includes(q) || s.rfc?.toLowerCase().includes(q) || s.giro?.toLowerCase().includes(q) || s.clave_wansoft?.toLowerCase().includes(q)
  })

  const giros = [...new Set(suppliers.map(s => s.giro).filter(Boolean))].sort()
  const conEmail = suppliers.filter(s => s.email && s.email.includes('@')).length
  const conTelefono = suppliers.filter(s => s.phone && s.phone.length > 5).length

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Proveedores</h2>
        <p className="text-sm text-[var(--text-3)]">{suppliers.length} proveedores registrados · {giros.length} categorías</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Truck size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Total proveedores</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{suppliers.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Mail size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Con email</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{conEmail}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Phone size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Con teléfono</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{conTelefono}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><BarChart3 size={16} className="text-purple-500" /><span className="text-xs text-[var(--text-2)] font-medium">Categorías</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{giros.length}</p>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar proveedor, RFC, categoría..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-transparent text-[var(--text-1)]"
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Truck size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">{suppliers.length === 0 ? 'Sin proveedores' : 'Sin resultados'}</p>
            <p className="text-xs text-[var(--text-3)]">{suppliers.length === 0 ? 'Sube el Excel de proveedores.' : 'Intenta con otro término.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Proveedor</th>
                <th className="text-left px-4 py-3 font-medium">RFC</th>
                <th className="text-left px-4 py-3 font-medium">Categoría</th>
                <th className="text-left px-4 py-3 font-medium">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-right px-4 py-3 font-medium">Crédito</th>
              </tr></thead>
              <tbody>{filtered.map((sup, i) => (
                <tr key={sup.id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3 text-[var(--text-3)]">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-[var(--text-1)]">{sup.name}</td>
                  <td className="px-4 py-3 text-[var(--text-2)] font-mono text-xs">{sup.rfc || '—'}</td>
                  <td className="px-4 py-3">
                    {sup.giro ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400">{sup.giro}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{sup.phone || '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-2)] text-xs">{sup.email || '—'}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-2)]">{sup.payment_terms > 0 ? `${sup.payment_terms}d` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-[var(--line-soft)] text-xs text-[var(--text-3)]">
          {filtered.length} de {suppliers.length} proveedores
        </div>
      </div>
    </>
  )
}
