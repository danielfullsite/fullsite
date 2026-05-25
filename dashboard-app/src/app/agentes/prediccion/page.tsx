'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Target, TrendingUp, TrendingDown, Zap } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

interface Comparison {
  label: string
  valor: number
  diferencia_pct: number
}

interface BoostSuggestion {
  category: string
  potencial: number
  razon: string
}

interface PredictionData {
  ventas_actuales?: number
  proyeccion_cierre?: number
  gap?: number
  avance_pct?: number
  comparaciones?: Comparison[]
  boost_suggestions?: BoostSuggestion[]
  summary?: string
  hora_corte?: string
}

export default function PrediccionPage() {
  const [data, setData] = useState<PredictionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'predictor')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as PredictionData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading prediction:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const comparaciones = data?.comparaciones || []
  const boosts = data?.boost_suggestions || []

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Prediccion de Cierre</h2>
            <p className="text-sm text-[var(--text-3)]">Proyeccion al final del dia {fecha && `· ${fecha}`}{data?.hora_corte && ` · corte ${data.hora_corte}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Big projection number */}
      <div className="bg-[var(--surface)] rounded-xl border border-blue-200 shadow-sm p-6 mb-6 text-center">
        <p className="text-xs text-blue-500 font-medium mb-2 uppercase tracking-wider">Proyeccion al cierre</p>
        <p className="text-4xl font-bold text-blue-600 mb-1">{formatCurrency(data?.proyeccion_cierre)}</p>
        {data?.avance_pct != null && (
          <div className="mt-3">
            <div className="w-full max-w-xs mx-auto bg-[var(--surface-2)] rounded-full h-2.5">
              <div className="h-2.5 rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(data.avance_pct, 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--text-2)] mt-1">{data.avance_pct.toFixed(0)}% avance</p>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Ventas actuales</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(data?.ventas_actuales)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Proyeccion cierre</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(data?.proyeccion_cierre)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Gap restante</p>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(data?.gap)}</p>
        </div>
      </div>

      {/* Comparisons */}
      {comparaciones.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm mb-6">
          <div className="px-4 py-3 border-b border-[var(--line-soft)]">
            <h3 className="text-sm font-bold text-[var(--text-1)]">Comparativos</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {comparaciones.map((c, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-[var(--text-1)]">{c.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-[var(--text-2)]">{formatCurrency(c.valor)}</span>
                  <span className={`flex items-center gap-1 text-sm font-bold tabular-nums ${c.diferencia_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {c.diferencia_pct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {c.diferencia_pct > 0 ? '+' : ''}{c.diferencia_pct?.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boost suggestions */}
      {boosts.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
          <div className="px-4 py-3 border-b border-[var(--line-soft)]">
            <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
              <Zap size={14} className="text-amber-500" /> Sugerencias para impulsar ventas
            </h3>
          </div>
          <div className="divide-y divide-slate-50">
            {boosts.map((b, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--text-1)]">{b.category}</span>
                  <span className="text-sm font-bold text-emerald-600">+{formatCurrency(b.potencial)}</span>
                </div>
                <p className="text-xs text-[var(--text-2)]">{b.razon}</p>
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
          Sin datos de prediccion. El agente corre automaticamente.
        </div>
      )}
    </>
  )
}
