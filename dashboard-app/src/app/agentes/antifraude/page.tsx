'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw, Shield, AlertTriangle, CheckCircle } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import Link from 'next/link'

interface Finding {
  titulo: string
  descripcion: string
  nivel: string
  acciones: string[]
}

interface AntifraudData {
  risk_score?: number
  findings?: Finding[]
  summary?: string
}

export default function AntiFraudePage() {
  const [data, setData] = useState<AntifraudData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'antifraud')
      if (result) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(parsed as AntifraudData)
        setFecha((result as any).fecha || '')
      }
    } catch (err) {
      console.error('Error loading antifraud:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const score = data?.risk_score ?? 0
  const findings = data?.findings || []

  function scoreColor(s: number): string {
    if (s >= 70) return 'text-red-600'
    if (s >= 40) return 'text-amber-600'
    return 'text-emerald-600'
  }

  function scoreBg(s: number): string {
    if (s >= 70) return 'border-red-300 bg-red-50/30'
    if (s >= 40) return 'border-amber-200 bg-amber-50/30'
    return 'border-emerald-200 bg-emerald-50/30'
  }

  function scoreLabel(s: number): string {
    if (s >= 70) return 'Riesgo alto'
    if (s >= 40) return 'Riesgo moderado'
    return 'Riesgo bajo'
  }

  function nivelBadge(nivel: string) {
    const n = nivel.toLowerCase()
    if (n === 'alto' || n === 'critical') return 'bg-red-500 text-white'
    if (n === 'medio' || n === 'warning') return 'bg-amber-100 text-amber-700'
    return 'bg-[var(--surface-2)] text-[var(--text-2)]'
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Anti-Fraude</h2>
            <p className="text-sm text-[var(--text-3)]">Deteccion de patrones sospechosos {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Risk score - big number */}
      <div className={`bg-[var(--surface)] rounded-xl border shadow-sm p-6 mb-6 text-center ${scoreBg(score)}`}>
        <p className="text-xs text-[var(--text-2)] font-medium mb-2 uppercase tracking-wider">Risk Score</p>
        <p className={`text-5xl font-bold ${scoreColor(score)}`}>{score}</p>
        <p className={`text-sm font-medium mt-1 ${scoreColor(score)}`}>{scoreLabel(score)}</p>
        <div className="mt-3 w-full max-w-xs mx-auto bg-[var(--surface-2)] rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${score >= 70 ? 'bg-red-500' : score >= 40 ? 'bg-amber-400' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Hallazgos totales</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{findings.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-red-200 shadow-sm p-5 bg-red-50/30">
          <p className="text-xs text-red-600 font-medium mb-1">Riesgo alto</p>
          <p className="text-2xl font-bold text-red-600">{findings.filter(f => f.nivel?.toLowerCase() === 'alto' || f.nivel?.toLowerCase() === 'critical').length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-amber-200 shadow-sm p-5 bg-amber-50/30">
          <p className="text-xs text-amber-600 font-medium mb-1">Riesgo medio</p>
          <p className="text-2xl font-bold text-amber-600">{findings.filter(f => f.nivel?.toLowerCase() === 'medio' || f.nivel?.toLowerCase() === 'warning').length}</p>
        </div>
      </div>

      {/* Findings */}
      {findings.length > 0 ? (
        <div className="space-y-4">
          {findings.map((f, i) => {
            const isHigh = f.nivel?.toLowerCase() === 'alto' || f.nivel?.toLowerCase() === 'critical'
            return (
              <div key={i} className={`bg-[var(--surface)] rounded-xl border shadow-sm p-5 ${isHigh ? 'border-red-200' : 'border-[var(--line)]'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isHigh ? <AlertTriangle size={16} className="text-red-500" /> : <Shield size={16} className="text-[var(--text-3)]" />}
                    <h4 className="text-sm font-bold text-[var(--text-1)]">{f.titulo}</h4>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${nivelBadge(f.nivel)}`}>
                    {f.nivel}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-2)] mb-3">{f.descripcion}</p>
                {f.acciones && f.acciones.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-[var(--text-2)] uppercase">Acciones recomendadas</p>
                    {f.acciones.map((a, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <CheckCircle size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-[var(--text-2)]">{a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-8 text-center text-[var(--text-3)] text-sm">
          Sin hallazgos de fraude. El agente corre automaticamente.
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
          Sin datos de anti-fraude. El agente corre automaticamente.
        </div>
      )}
    </>
  )
}
