'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, DollarSign, Search } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }
const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

interface Recipe {
  nombre: string
  precio_venta: number
  costo_total: number
  pct_costo: number
  ingredientes: { nombre: string; porcion: number; um: string; total: number }[]
}

const THRESHOLD_DANGER = 35
const THRESHOLD_WARNING = 30
const THRESHOLD_LOSS = 100

function badge(pct: number) {
  if (pct >= THRESHOLD_LOSS) return { label: 'PÉRDIDA', color: 'bg-red-600 text-white' }
  if (pct >= THRESHOLD_DANGER) return { label: 'ALTO', color: 'bg-red-500/20 text-red-400' }
  if (pct >= THRESHOLD_WARNING) return { label: 'CUIDADO', color: 'bg-amber-500/20 text-amber-400' }
  return { label: 'OK', color: 'bg-emerald-500/20 text-emerald-400' }
}

export default function FoodCostPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'danger' | 'warning' | 'loss'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${SUPABASE_URL}/rest/v1/pos_recipes?client_id=eq.${_cid()}&select=nombre,precio_venta,costo_total,pct_costo,ingredientes&order=pct_costo.desc&limit=500`, { headers: H })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setRecipes(data.filter((r: Recipe) => r.precio_venta > 0))
        setLoading(false)
      })
  }, [])

  const filtered = recipes.filter(r => {
    if (search && !r.nombre.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'loss') return r.pct_costo >= THRESHOLD_LOSS
    if (filter === 'danger') return r.pct_costo >= THRESHOLD_DANGER && r.pct_costo < THRESHOLD_LOSS
    if (filter === 'warning') return r.pct_costo >= THRESHOLD_WARNING && r.pct_costo < THRESHOLD_DANGER
    return true
  })

  const avgCost = recipes.length > 0 ? recipes.reduce((s, r) => s + r.pct_costo, 0) / recipes.length : 0
  const lossCount = recipes.filter(r => r.pct_costo >= THRESHOLD_LOSS).length
  const dangerCount = recipes.filter(r => r.pct_costo >= THRESHOLD_DANGER && r.pct_costo < THRESHOLD_LOSS).length
  const warningCount = recipes.filter(r => r.pct_costo >= THRESHOLD_WARNING && r.pct_costo < THRESHOLD_DANGER).length
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <DollarSign size={24} className="text-amber-400" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Food Cost Monitor</h1>
          <p className="text-sm text-[var(--text-3)]">Alertas automáticas cuando el costo sale del rango</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
          <p className="text-xs text-[var(--text-3)]">Food cost promedio</p>
          <p className={`text-2xl font-bold ${avgCost > THRESHOLD_DANGER ? 'text-red-400' : avgCost > THRESHOLD_WARNING ? 'text-amber-400' : 'text-emerald-400'}`}>{avgCost.toFixed(1)}%</p>
        </div>
        <button onClick={() => setFilter(filter === 'loss' ? 'all' : 'loss')} className={`bg-[var(--surface)] border rounded-xl p-4 text-left ${filter === 'loss' ? 'border-red-500' : 'border-[var(--line)]'}`}>
          <p className="text-xs text-[var(--text-3)]">Pérdida (&gt;100%)</p>
          <p className="text-2xl font-bold text-red-400">{lossCount}</p>
        </button>
        <button onClick={() => setFilter(filter === 'danger' ? 'all' : 'danger')} className={`bg-[var(--surface)] border rounded-xl p-4 text-left ${filter === 'danger' ? 'border-red-500' : 'border-[var(--line)]'}`}>
          <p className="text-xs text-[var(--text-3)]">Alto (&gt;35%)</p>
          <p className="text-2xl font-bold text-red-400">{dangerCount}</p>
        </button>
        <button onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')} className={`bg-[var(--surface)] border rounded-xl p-4 text-left ${filter === 'warning' ? 'border-amber-500' : 'border-[var(--line)]'}`}>
          <p className="text-xs text-[var(--text-3)]">Cuidado (&gt;30%)</p>
          <p className="text-2xl font-bold text-amber-400">{warningCount}</p>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-3 text-[var(--text-3)]" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar receta..."
          className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-[var(--text-1)] placeholder-[var(--text-3)] text-sm" />
      </div>

      {/* Alerts banner */}
      {lossCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-400">{lossCount} receta(s) con PÉRDIDA — costo mayor al precio de venta</p>
            <p className="text-xs text-[var(--text-3)] mt-1">Estas recetas pierden dinero cada vez que se venden. Revisa precios o recetas.</p>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line-soft)] bg-[var(--surface-2)] text-xs text-[var(--text-3)]">
                <th className="text-left px-4 py-3">Receta</th>
                <th className="text-right px-4 py-3">Precio venta</th>
                <th className="text-right px-4 py-3">Costo</th>
                <th className="text-right px-4 py-3">Food cost %</th>
                <th className="text-center px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {filtered.map(r => {
                const b = badge(r.pct_costo)
                const isExpanded = expanded === r.nombre
                return (
                  <tr key={r.nombre} className="cursor-pointer hover:bg-[var(--surface-2)]" onClick={() => setExpanded(isExpanded ? null : r.nombre)}>
                    <td className="px-4 py-3">
                      <p className="text-[var(--text-1)] font-medium">{r.nombre}</p>
                      {isExpanded && r.ingredientes && (
                        <div className="mt-2 space-y-1">
                          {(Array.isArray(r.ingredientes) ? r.ingredientes : []).map((ing, i) => (
                            <div key={i} className="flex justify-between text-xs text-[var(--text-3)]">
                              <span>{ing.nombre} ({ing.porcion} {ing.um})</span>
                              <span>{fmt(ing.total)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-1)]">{fmt(r.precio_venta)}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-1)]">{fmt(r.costo_total)}</td>
                    <td className="px-4 py-3 text-right font-bold text-lg">
                      <span className={r.pct_costo >= THRESHOLD_DANGER ? 'text-red-400' : r.pct_costo >= THRESHOLD_WARNING ? 'text-amber-400' : 'text-emerald-400'}>
                        {r.pct_costo.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${b.color}`}>{b.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
