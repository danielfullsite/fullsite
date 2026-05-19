'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Users, AlertCircle } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import Link from 'next/link'

interface DayStaffing {
  dia: string
  ventas_promedio: number
  meseros: number
  ventas_por_mesero: number
  personas: number
  recomendacion?: string
}

interface CoverageGap {
  mesero: string
  dias_faltantes: string[]
}

interface StaffingData {
  por_dia?: DayStaffing[]
  recomendaciones?: string[]
  coverage_gaps?: CoverageGap[]
  summary?: string
}

export default function StaffingPage() {
  const [data, setData] = useState<StaffingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'staffing')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as StaffingData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading staffing:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const porDia = data?.por_dia || []
  const recomendaciones = data?.recomendaciones || []
  const gaps = data?.coverage_gaps || []
  const maxVPM = porDia.length > 0 ? Math.max(...porDia.map(d => d.ventas_por_mesero)) : 0
  const minVPM = porDia.length > 0 ? Math.min(...porDia.map(d => d.ventas_por_mesero)) : 0

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Optimizacion de Staffing</h2>
            <p className="text-sm text-slate-400">Cobertura de personal por dia {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary */}
      {data?.summary && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-6">
          <p className="text-sm text-slate-700 leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* Staffing table by DOW */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users size={14} className="text-amber-500" /> Staffing por dia de la semana
          </h3>
        </div>
        {porDia.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Sin datos de staffing. El agente corre automaticamente.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">Dia</th>
                  <th className="text-right px-4 py-3 font-medium">Ventas prom.</th>
                  <th className="text-right px-4 py-3 font-medium"># Meseros</th>
                  <th className="text-right px-4 py-3 font-medium">Ventas/Mesero</th>
                  <th className="text-right px-4 py-3 font-medium">Personas</th>
                  <th className="text-left px-4 py-3 font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {porDia.map((d, i) => {
                  const isMax = d.ventas_por_mesero === maxVPM
                  const isMin = d.ventas_por_mesero === minVPM && porDia.length > 1
                  return (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${isMax ? 'bg-red-50/30' : isMin ? 'bg-emerald-50/30' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{d.dia}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{formatCurrency(d.ventas_promedio)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{d.meseros}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${isMax ? 'text-red-600' : isMin ? 'text-emerald-600' : 'text-slate-700'}`}>
                        {formatCurrency(d.ventas_por_mesero)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{d.personas}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">{d.recomendacion || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {recomendaciones.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Recomendaciones</h3>
          </div>
          <div className="p-4 space-y-2">
            {recomendaciones.map((rec, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-sm text-slate-700">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coverage gaps */}
      {gaps.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertCircle size={14} className="text-red-500" /> Gaps de cobertura
            </h3>
          </div>
          <div className="divide-y divide-slate-50">
            {gaps.map((g, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">{g.mesero}</span>
                <div className="flex gap-1.5">
                  {g.dias_faltantes.map((d, j) => (
                    <span key={j} className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium">{d}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center text-slate-400 text-sm">
          Sin datos de staffing. El agente corre automaticamente.
        </div>
      )}
    </>
  )
}
