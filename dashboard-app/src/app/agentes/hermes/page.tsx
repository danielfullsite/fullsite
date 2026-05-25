'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Bot, AlertTriangle, CheckCircle } from 'lucide-react'
import { getDeepTable } from '@/lib/data'

export default function HermesPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')
  const [summary, setSummary] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as Record<string, unknown>).agent_id === 'hermes')
      if (result) {
        const d = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(d as Record<string, unknown>)
        setFecha((result as Record<string, unknown>).fecha as string || '')
        setSummary((result as Record<string, unknown>).summary as string || '')
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>

  const improvements = (data?.improvements || []) as Record<string, unknown>[]
  const healthIssues = (data?.health_issues || []) as Record<string, unknown>[]
  const dataIssues = (data?.data_issues || []) as Record<string, unknown>[]
  const chatIssues = (data?.chat_issues || []) as Record<string, unknown>[]
  const totalIssues = (data?.total_issues || 0) as number
  const criticalCount = (data?.critical_count || 0) as number
  const highCount = (data?.high_count || 0) as number

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-500 text-white',
    high: 'bg-red-500/15 text-red-400',
    medium: 'bg-amber-500/15 text-amber-400',
    low: 'bg-blue-500/15 text-blue-400',
    info: 'bg-[var(--surface-2)] text-[var(--text-2)]',
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Bot size={20} className="text-indigo-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-1)]">Hermes</h2>
            <p className="text-sm text-[var(--text-3)]">{summary} {fecha && `· ${fecha}`}</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><RefreshCw size={16} /></button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Total issues</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalIssues}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-red-500/20 shadow-sm p-5 bg-red-500/8">
          <p className="text-xs text-red-400 font-medium mb-1">Criticos</p>
          <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-amber-500/20 shadow-sm p-5 bg-amber-500/8">
          <p className="text-xs text-amber-400 font-medium mb-1">Altos</p>
          <p className="text-2xl font-bold text-amber-400">{highCount}</p>
        </div>
      </div>

      {!data ? (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-8 text-center text-[var(--text-3)]">Hermes no ha corrido todavía. Corre 2x al día (7am + 11pm).</div>
      ) : (
        <div className="space-y-4">
          {/* Improvements */}
          {improvements.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
              <div className="px-5 py-4 border-b border-[var(--line-soft)]">
                <h3 className="text-sm font-bold text-[var(--text-1)]">Mejoras recomendadas</h3>
              </div>
              <div className="divide-y divide-slate-50">
                {improvements.map((imp, i) => (
                  <div key={i} className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${priorityColors[imp.priority as string] || priorityColors.info}`}>
                        {imp.priority as string}
                      </span>
                      <span className="text-sm font-semibold text-[var(--text-1)]">{imp.title as string}</span>
                    </div>
                    <div className="space-y-1">
                      {((imp.details || []) as string[]).map((d, j) => (
                        <p key={j} className="text-xs text-[var(--text-2)]">• {d}</p>
                      ))}
                    </div>
                    {((imp.fixes || []) as string[]).length > 0 && (
                      <div className="mt-2">
                        {((imp.fixes || []) as string[]).map((f, j) => (
                          <p key={j} className="text-xs text-indigo-600 font-medium">→ {f}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Health Issues */}
          {healthIssues.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Salud de agentes ({healthIssues.length})</h3>
              <div className="space-y-2">
                {healthIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-[var(--text-1)]">{issue.agent as string}:</span>{' '}
                      <span className="text-[var(--text-2)]">{issue.message as string}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Issues */}
          {dataIssues.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Calidad de datos ({dataIssues.length})</h3>
              <div className="space-y-2">
                {dataIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium text-[var(--text-1)]">{issue.agent as string}:</span>{' '}
                      <span className="text-[var(--text-2)]">{issue.message as string}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Issues */}
          {chatIssues.length > 0 && (
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-3">Gaps del chat ({chatIssues.length})</h3>
              <div className="space-y-2">
                {chatIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className="text-violet-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-[var(--text-2)]">{issue.message as string}</span>
                      <p className="text-xs text-indigo-600 mt-1">→ {issue.fix as string}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalIssues === 0 && (
            <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/20 p-8 text-center">
              <CheckCircle size={32} className="mx-auto mb-3 text-emerald-500" />
              <p className="text-emerald-400 font-medium">Todos los agentes funcionando correctamente</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
