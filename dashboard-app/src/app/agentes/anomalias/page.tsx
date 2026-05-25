'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import Link from 'next/link'

interface Anomaly {
  type?: string
  metrica?: string
  severity?: string
  prioridad?: string
  message?: string
  actual?: number
  esperado?: number
  diferencia_pct?: number
}

interface AgentData {
  anomalies?: Anomaly[]
  summary?: string
  today_ventas?: number
  avg_ventas?: number
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
  const critical = anomalies.filter(a => (a.severity || a.prioridad) === 'high' || (a.severity || a.prioridad) === 'critical' || (a.severity || a.prioridad) === 'alta')
  const warning = anomalies.filter(a => (a.severity || a.prioridad) === 'medium' || (a.severity || a.prioridad) === 'warning' || (a.severity || a.prioridad) === 'media')

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Detección de Anomalías</h2>
            <p className="text-sm text-[var(--text-3)]">Métricas fuera de patrón {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary */}
      {data?.summary && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5 mb-6">
          <p className="text-sm text-[var(--text-1)] leading-relaxed">{data.summary}</p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Total anomalías</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{anomalies.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-red-500/20 shadow-sm p-5 bg-red-500/10/30">
          <p className="text-xs text-red-600 font-medium mb-1">Alta prioridad</p>
          <p className="text-2xl font-bold text-red-600">{critical.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-amber-500/20 shadow-sm p-5 bg-amber-500/10/30">
          <p className="text-xs text-amber-400 font-medium mb-1">Media prioridad</p>
          <p className="text-2xl font-bold text-amber-400">{warning.length}</p>
        </div>
      </div>

      {/* Anomalies table */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        {anomalies.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-3)] text-sm">Sin anomalías detectadas. El agente corre automáticamente.</div>
        ) : (
          <div className="divide-y divide-slate-100">
                {anomalies.map((a, i) => {
                  const sev = a.severity || a.prioridad || 'info'
                  const isHigh = sev === 'high' || sev === 'critical' || sev === 'alta'
                  const isMed = sev === 'medium' || sev === 'warning' || sev === 'media'
                  return (
                    <div key={i} className={`px-5 py-4 ${isHigh ? 'bg-red-500/100/10' : isMed ? 'bg-amber-500/10/30' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isHigh ? 'bg-red-100' : isMed ? 'bg-amber-100' : 'bg-blue-100'}`}>
                          <AlertTriangle size={16} className={isHigh ? 'text-red-500' : isMed ? 'text-amber-500' : 'text-blue-500'} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-[var(--text-3)] uppercase">{a.type || 'anomalía'}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              isHigh ? 'bg-red-500/100 text-white' : isMed ? 'bg-amber-100 text-amber-400' : 'bg-[var(--surface-2)] text-[var(--text-2)]'
                            }`}>{sev}</span>
                          </div>
                          <p className="text-sm text-[var(--text-1)] leading-relaxed">{a.message || a.metrica || 'Sin detalle'}</p>
                          {a.actual !== undefined && a.esperado !== undefined && (
                            <p className="text-xs text-[var(--text-3)] mt-1">
                              Actual: {typeof a.actual === 'number' ? `$${a.actual.toLocaleString('es-MX')}` : a.actual} · Esperado: {typeof a.esperado === 'number' ? `$${a.esperado.toLocaleString('es-MX')}` : a.esperado}
                              {a.diferencia_pct !== undefined && <span className={`ml-2 font-bold ${isHigh ? 'text-red-600' : 'text-amber-400'}`}>{a.diferencia_pct > 0 ? '+' : ''}{a.diferencia_pct.toFixed(0)}%</span>}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
          </div>
        )}
      </div>
    </>
  )
}
