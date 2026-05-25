'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Star, Puzzle, Dog, Zap, UtensilsCrossed } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

interface MenuItem {
  nombre: string
  ventas: number
  margen_pct: number
}

interface Recommendation {
  accion: string
  item: string
  impacto_estimado: number
  detalle: string
}

interface RevenueSegment {
  nombre: string
  total: number
  pct: number
}

interface MenuData {
  estrellas?: MenuItem[]
  caballos?: MenuItem[]
  rompecabezas?: MenuItem[]
  perros?: MenuItem[]
  revenue_distribution?: RevenueSegment[]
  recommendations?: Recommendation[]
  summary?: string
}

export default function MenuEngineeringPage() {
  const [data, setData] = useState<MenuData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'menu-engineering')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as MenuData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading menu engineering:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const quadrants = [
    { key: 'estrellas', label: 'Estrellas', desc: 'Alta popularidad + alto margen', icon: Star, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', items: data?.estrellas || [] },
    { key: 'caballos', label: 'Caballos de Trabajo', desc: 'Alta popularidad + bajo margen', icon: Zap, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', items: data?.caballos || [] },
    { key: 'rompecabezas', label: 'Rompecabezas', desc: 'Baja popularidad + alto margen', icon: Puzzle, color: 'text-violet-500', bg: 'bg-violet-50', border: 'border-violet-200', items: data?.rompecabezas || [] },
    { key: 'perros', label: 'Perros', desc: 'Baja popularidad + bajo margen', icon: Dog, color: 'text-[var(--text-3)]', bg: 'bg-[var(--surface-2)]', border: 'border-[var(--line)]', items: data?.perros || [] },
  ]

  const revDist = data?.revenue_distribution || []
  const recommendations = data?.recommendations || []
  const maxRev = revDist.length > 0 ? Math.max(...revDist.map(r => r.pct)) : 0

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Menu Engineering</h2>
            <p className="text-sm text-[var(--text-3)]">Matriz BCG del menu {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* BCG Matrix - 4 quadrants */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {quadrants.map(q => {
          const Icon = q.icon
          return (
            <div key={q.key} className={`bg-[var(--surface)] rounded-xl border ${q.border} shadow-sm p-5`}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-lg ${q.bg} flex items-center justify-center`}>
                  <Icon size={16} className={q.color} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">{q.label}</h3>
                  <p className="text-[11px] text-[var(--text-3)]">{q.desc}</p>
                </div>
                <span className="ml-auto text-xs font-medium text-[var(--text-3)]">{q.items.length} items</span>
              </div>
              {q.items.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">Sin datos</p>
              ) : (
                <div className="space-y-1.5">
                  {q.items.slice(0, 8).map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-1)] truncate max-w-[180px]">{item.nombre}</span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-[var(--text-2)] text-xs">{formatCurrency(item.ventas)}</span>
                        <span className={`tabular-nums text-xs font-bold ${item.margen_pct >= 60 ? 'text-emerald-600' : item.margen_pct >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                          {item.margen_pct?.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                  {q.items.length > 8 && (
                    <p className="text-[11px] text-[var(--text-3)] pt-1">+{q.items.length - 8} mas</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Revenue distribution (text-based bars) */}
      {revDist.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-6">
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <UtensilsCrossed size={14} className="text-violet-500" /> Distribucion de ingresos
          </h3>
          <div className="space-y-2.5">
            {revDist.slice(0, 10).map((seg, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[var(--text-1)]">{seg.nombre}</span>
                  <span className="text-xs tabular-nums text-[var(--text-2)]">{formatCurrency(seg.total)} ({seg.pct?.toFixed(1)}%)</span>
                </div>
                <div className="w-full bg-[var(--surface-2)] rounded-full h-2">
                  <div className="h-2 rounded-full bg-violet-500 transition-all" style={{ width: `${maxRev > 0 ? (seg.pct / maxRev) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top 5 recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--line-soft)]">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Top {Math.min(recommendations.length, 5)} Recomendaciones</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {recommendations.slice(0, 5).map((rec, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm font-medium text-[var(--text-1)]">{rec.item}</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-600">+{formatCurrency(rec.impacto_estimado)}</span>
                </div>
                <p className="text-xs text-[var(--text-2)] ml-7">{rec.accion} — {rec.detalle}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {data?.summary && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mt-6">
          <p className="text-sm text-[var(--text-1)] leading-relaxed">{data.summary}</p>
        </div>
      )}

      {!data && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center text-[var(--text-3)] text-sm">
          Sin datos de menu engineering. El agente corre automaticamente.
        </div>
      )}
    </>
  )
}
