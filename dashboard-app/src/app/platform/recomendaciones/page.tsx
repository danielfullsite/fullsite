'use client'

import { useState, useEffect, useCallback } from 'react'
import { Lightbulb, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'

// Control Plane · Asesor de producto (proactivo). Le dice al super-admin qué le
// falta / podría mejorar, cruzando el estado real con un checklist de POS completo.
interface Rec { titulo: string; por_que: string; impacto: 'alto' | 'medio' | 'bajo'; area: string }

const IMPACT: Record<string, { label: string; cls: string; order: number }> = {
  alto: { label: 'Alto impacto', cls: 'text-red-400 border-red-500/30 bg-red-500/10', order: 0 },
  medio: { label: 'Medio', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10', order: 1 },
  bajo: { label: 'Bajo', cls: 'text-sky-400 border-sky-500/30 bg-sky-500/10', order: 2 },
}

export default function RecomendacionesPage() {
  const [recs, setRecs] = useState<Rec[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [denied, setDenied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/platform/advisor', { credentials: 'include' })
      if (res.status === 401 || res.status === 403) { setDenied(true); return }
      const j = await res.json().catch(() => ({}))
      if (j.error && (!j.recommendations || j.recommendations.length === 0)) setErr(j.error)
      const list: Rec[] = Array.isArray(j.recommendations) ? j.recommendations : []
      list.sort((a, b) => (IMPACT[a.impacto]?.order ?? 3) - (IMPACT[b.impacto]?.order ?? 3))
      setRecs(list)
    } catch { setErr('Error de red') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-amber-500/15 text-amber-400"><Lightbulb size={20} /></span>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[var(--text-1)]">Recomendaciones</h1>
          <p className="text-xs text-[var(--text-4)]">Qué te falta o podrías mejorar · revisado contra tu plataforma</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-2)] hover:text-[var(--text-1)] disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
        </button>
      </div>

      {loading && recs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-72 gap-3 text-[var(--text-4)]">
          <Loader2 size={22} className="animate-spin" />
          <p className="text-sm">Analizando tu plataforma…</p>
        </div>
      ) : recs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center mt-6">
          <p className="text-sm text-[var(--text-3)]">No pude generar recomendaciones ahora{err ? ` (${err})` : ''}.</p>
          <button onClick={load} className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#04130d]">Reintentar</button>
        </div>
      ) : (
        <div className="grid gap-2.5 mt-5">
          {recs.map((r, i) => {
            const imp = IMPACT[r.impacto] || IMPACT.bajo
            return (
              <div key={i} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-[var(--text-4)] tabular-nums pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-[var(--text-1)]">{r.titulo}</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${imp.cls}`}>{imp.label}</span>
                      {r.area && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--text-3)]">{r.area}</span>}
                    </div>
                    <p className="text-[13px] text-[var(--text-2)] leading-relaxed">{r.por_que}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
