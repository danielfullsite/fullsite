'use client'

import { useState, useRef, useEffect } from 'react'
import { CalendarRange, Check } from 'lucide-react'

// Selector de periodo reusable: presets (7/14/30 días) + rango de fechas custom.
// Los módulos de reporte cargan una ventana amplia (p.ej. 90 días) y filtran por
// el rango elegido en el cliente.
export interface DateRange { from: string; to: string }
interface Props {
  period: number
  onPeriod: (n: number) => void
  range: DateRange | null
  onRange: (r: DateRange | null) => void
  presets?: number[]
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function daysAgoISO(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) }

export default function PeriodPicker({ period, onPeriod, range, onRange, presets = [7, 14, 30] }: Props) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(range?.from || daysAgoISO(30))
  const [to, setTo] = useState(range?.to || todayISO())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function apply() {
    if (from && to && from <= to) { onRange({ from, to }); setOpen(false) }
  }

  const label = range ? `${range.from} → ${range.to}` : null

  return (
    <div className="inline-flex items-center gap-2" ref={ref}>
      <div className="inline-flex bg-[var(--surface-2)] rounded-lg p-1 gap-0.5">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => { onRange(null); onPeriod(p) }}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
              !range && period === p ? 'bg-[var(--surface)] text-[var(--text-1)] shadow-sm' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
          >
            {p}d
          </button>
        ))}
      </div>

      <div className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            range ? 'border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-soft)]' : 'border-[var(--line)] text-[var(--text-2)] bg-[var(--surface-2)] hover:text-[var(--text-1)]'
          }`}
          title="Rango de fechas personalizado"
        >
          <CalendarRange size={15} /> {label || 'Rango'}
        </button>
        {open && (
          <div className="absolute right-0 mt-1.5 z-50 rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-xl p-3 w-[280px]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-4)] mb-2">Fechas personalizadas</p>
            <div className="flex items-center gap-2 mb-3">
              <label className="flex-1 text-[11px] text-[var(--text-3)]">Desde
                <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]" />
              </label>
              <label className="flex-1 text-[11px] text-[var(--text-3)]">Hasta
                <input type="date" value={to} min={from} max={todayISO()} onChange={e => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]" />
              </label>
            </div>
            <button onClick={apply} disabled={!from || !to || from > to} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[#04130d] disabled:opacity-50">
              <Check size={14} /> Aplicar rango
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
