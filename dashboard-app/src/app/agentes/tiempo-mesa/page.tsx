'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Clock } from 'lucide-react'
import { getDeepTable } from '@/lib/data'

export default function TiempoMesaPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')
  const [summary, setSummary] = useState('')

  async function load() {
    setLoading(true)
    try {
      const rows = await getDeepTable('agent_results', 50)
      const result = rows.find(r => (r as any).agent_id === 'table-time')
      if (result) {
        const d = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data
        setData(d as Record<string, unknown>)
        setFecha((result as any).fecha || '')
        setSummary((result as any).summary || '')
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-[var(--line)] border-t-transparent rounded-full animate-spin" /></div>

  // Render all data keys as sections
  const entries = data ? Object.entries(data).filter(([k, v]) => v && k !== 'total_insights') : []

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/agentes" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-[var(--text-1)]">Tiempo de Mesa</h2>
          <p className="text-sm text-[var(--text-3)]">{summary} {fecha && `· ${fecha}`}</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><RefreshCw size={16} /></button>
      </div>

      {!data ? (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-8 text-center text-[var(--text-3)]">Sin datos. Se actualiza automáticamente.</div>
      ) : (
        <div className="space-y-4">
          {entries.map(([key, value]) => (
            <div key={key} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-3 capitalize">{key.replace(/_/g, ' ')}</h3>
              {Array.isArray(value) ? (
                value.length === 0 ? <p className="text-sm text-[var(--text-3)]">Sin datos</p> :
                <div className="space-y-2">
                  {(value as Record<string, unknown>[]).map((item, i) => (
                    <div key={i} className="bg-[var(--surface-2)] rounded-lg px-4 py-3 text-sm text-[var(--text-1)]">
                      {Object.entries(item).map(([k, v]) => (
                        <span key={k} className="mr-4"><span className="text-[var(--text-3)]">{k}:</span> <span className="font-medium">{String(v)}</span></span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : typeof value === 'object' && value !== null ? (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="text-sm"><span className="text-[var(--text-3)]">{k}:</span> <span className="font-medium text-[var(--text-1)]">{String(v)}</span></div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-1)] font-medium">{String(value)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
