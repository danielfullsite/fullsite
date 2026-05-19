'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import Link from 'next/link'

interface Anomaly {
  metrica: string
  actual: number
  esperado: number
  diferencia_pct: number
  prioridad: string
}

interface AgentData {
  anomalies?: Anomaly[]
  summary?: string
  fecha?: string
}

export default function AnomaliasPage() {
  const [data, setData] = useState<AgentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'anomaly')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as AgentData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading anomalies:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const anomalies = data?.anomalies || []
  const critical = anomalies.filter(a => a.prioridad === 'critical' || a.prioridad === 'alta')
  const warning = anomalies.filter(a => a.prioridad === 'warning' || a.prioridad === 'media')

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Detección de Anomalías</h2>
            <p className="text-sm text-slate-400">Métricas fuera de patrón {fecha && `· ${fecha}`}</p>
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

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <p className="text-xs text-slate-500 font-medium mb-1">Total anomalías</p>
          <p className="text-2xl font-bold text-slate-900">{anomalies.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5 bg-red-50/30">
          <p className="text-xs text-red-600 font-medium mb-1">Alta prioridad</p>
          <p className="text-2xl font-bold text-red-600">{critical.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-5 bg-amber-50/30">
          <p className="text-xs text-amber-600 font-medium mb-1">Media prioridad</p>
          <p className="text-2xl font-bold text-amber-600">{warning.length}</p>
        </div>
      </div>

      {/* Anomalies table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {anomalies.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Sin anomalías detectadas. El agente corre automáticamente.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-3 font-medium">Métrica</th>
                  <th className="text-right px-4 py-3 font-medium">Actual</th>
                  <th className="text-right px-4 py-3 font-medium">Esperado</th>
                  <th className="text-right px-4 py-3 font-medium">Diferencia</th>
                  <th className="text-center px-4 py-3 font-medium">Prioridad</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, i) => {
                  const isHigh = a.prioridad === 'critical' || a.prioridad === 'alta'
                  const isMed = a.prioridad === 'warning' || a.prioridad === 'media'
                  return (
                    <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${isHigh ? 'bg-red-50/50' : isMed ? 'bg-amber-50/30' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900 flex items-center gap-2">
                        {isHigh && <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />}
                        {isMed && <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />}
                        {a.metrica}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {typeof a.actual === 'number' ? a.actual.toLocaleString('es-MX') : a.actual}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {typeof a.esperado === 'number' ? a.esperado.toLocaleString('es-MX') : a.esperado}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${isHigh ? 'text-red-600' : isMed ? 'text-amber-600' : 'text-slate-600'}`}>
                        {a.diferencia_pct > 0 ? '+' : ''}{a.diferencia_pct?.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          isHigh ? 'bg-red-500 text-white' : isMed ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {a.prioridad}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
