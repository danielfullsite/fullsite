'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, TrendingUp, Users, Coffee } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

interface Opportunity {
  categoria: string
  actual: number
  esperado: number
  gap_pct: number
}

interface MeseroGap {
  mesero: string
  bebidas_persona: number
  promedio_general: number
  gap_pct: number
  oportunidad: string
}

interface BebidasAnalysis {
  promedio_general: number
  meta: number
  por_mesero?: { mesero: string; bebidas_persona: number }[]
}

interface UpsellingData {
  opportunities?: Opportunity[]
  mesero_gaps?: MeseroGap[]
  bebidas_analysis?: BebidasAnalysis
  potencial_total?: number
  summary?: string
}

export default function UpsellingPage() {
  const [data, setData] = useState<UpsellingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'upselling')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as UpsellingData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading upselling:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const opportunities = data?.opportunities || []
  const meseroGaps = data?.mesero_gaps || []
  const bebidas = data?.bebidas_analysis
  const bebidasPorMesero = bebidas?.por_mesero || []
  const maxBPP = bebidasPorMesero.length > 0 ? Math.max(...bebidasPorMesero.map(b => b.bebidas_persona)) : 0

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Oportunidades de Upselling</h2>
            <p className="text-sm text-slate-400">Venta adicional por categoria y mesero {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Potencial total */}
      {data?.potencial_total != null && (
        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm p-6 mb-6 text-center bg-emerald-50/30">
          <p className="text-xs text-emerald-600 font-medium mb-2 uppercase tracking-wider">Potencial de upselling diario</p>
          <p className="text-4xl font-bold text-emerald-600">{formatCurrency(data.potencial_total)}</p>
        </div>
      )}

      {/* Opportunities table */}
      {opportunities.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-500" /> Oportunidades por categoria
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">Categoria</th>
                  <th className="text-right px-4 py-3 font-medium">Actual</th>
                  <th className="text-right px-4 py-3 font-medium">Esperado</th>
                  <th className="text-right px-4 py-3 font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{o.categoria}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(o.actual)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(o.esperado)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`tabular-nums font-bold ${o.gap_pct > 20 ? 'text-red-600' : o.gap_pct > 10 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {o.gap_pct > 0 ? '-' : '+'}{Math.abs(o.gap_pct)?.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-mesero upselling gaps */}
      {meseroGaps.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Users size={14} className="text-amber-500" /> Gaps por mesero
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">Mesero</th>
                  <th className="text-right px-4 py-3 font-medium">Bebidas/persona</th>
                  <th className="text-right px-4 py-3 font-medium">Promedio gral.</th>
                  <th className="text-right px-4 py-3 font-medium">Gap</th>
                  <th className="text-left px-4 py-3 font-medium">Oportunidad</th>
                </tr>
              </thead>
              <tbody>
                {meseroGaps.map((m, i) => {
                  const isBad = m.gap_pct > 15
                  return (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${isBad ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{m.mesero}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{m.bebidas_persona?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{m.promedio_general?.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${isBad ? 'text-red-600' : 'text-amber-600'}`}>
                        {m.gap_pct > 0 ? '-' : '+'}{Math.abs(m.gap_pct)?.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">{m.oportunidad || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bebidas por persona analysis */}
      {bebidas && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Coffee size={14} className="text-blue-500" /> Bebidas por persona
            </h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Promedio general</p>
                <p className="text-xl font-bold text-slate-900">{bebidas.promedio_general?.toFixed(2)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Meta</p>
                <p className="text-xl font-bold text-emerald-600">{bebidas.meta?.toFixed(2)}</p>
              </div>
            </div>
            {bebidasPorMesero.length > 0 && (
              <div className="space-y-2.5">
                {bebidasPorMesero.map((b, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-700">{b.mesero}</span>
                      <span className={`text-xs tabular-nums font-bold ${b.bebidas_persona >= (bebidas.meta || 1) ? 'text-emerald-600' : b.bebidas_persona >= (bebidas.promedio_general || 0) ? 'text-slate-700' : 'text-red-600'}`}>
                        {b.bebidas_persona?.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${b.bebidas_persona >= (bebidas.meta || 1) ? 'bg-emerald-500' : b.bebidas_persona >= (bebidas.promedio_general || 0) ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${maxBPP > 0 ? (b.bebidas_persona / maxBPP) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {data?.summary && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mt-6">
          <p className="text-sm text-slate-700 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {!data && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 text-sm">
          Sin datos de upselling. El agente corre automaticamente.
        </div>
      )}
    </>
  )
}
