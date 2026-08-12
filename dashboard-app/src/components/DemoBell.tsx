'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, AlertTriangle, AlertCircle, Info, TrendingUp, Sparkles, X } from 'lucide-react'

// Notificaciones sintéticas para el demo (Casa Montaña) — estilo skeleton.
// Detecciones accionables con impacto en $ y lenguaje humano.
type DemoKind = 'crit' | 'warn' | 'ok' | 'info'
interface DemoNotif { name: string; kind: DemoKind; text: string; impact?: string; ago: string }

const DEMO_NOTIFS: DemoNotif[] = [
  { name: 'Anomalías de venta', kind: 'crit', impact: '−$4,300', text: 'Ticket promedio 22% abajo vs el viernes pasado en la comida (1–4 pm).', ago: 'hace 10 min' },
  { name: 'Clientes en riesgo', kind: 'ok', impact: '+$2,400', text: '8 clientes frecuentes sin visita en 30+ días — lanza una campaña de recuperación.', ago: 'hace 1 h' },
  { name: 'Anti-Fraude', kind: 'warn', text: '2 cancelaciones post-cobro con el mismo mesero hoy. Vale la pena revisarlo.', ago: 'hace 2 h' },
  { name: 'Menu Engineering', kind: 'info', text: '“Pescado a la talla” es tu estrella: 72% de margen y sube 8% esta semana.', ago: 'hace 3 h' },
  { name: 'Predicción de Cierre', kind: 'info', impact: '+6%', text: 'Vas a cerrar el día en ~$41,200, arriba del promedio de sábado.', ago: 'hace 4 h' },
]

const KIND: Record<DemoKind, { label: string; box: string; tag: string; Icon: typeof Bell }> = {
  crit: { label: 'Alerta', box: 'bg-red-500/10 text-red-400', tag: 'bg-red-500/15 text-red-300', Icon: AlertTriangle },
  warn: { label: 'Ojo', box: 'bg-amber-500/10 text-amber-400', tag: 'bg-amber-500/15 text-amber-300', Icon: AlertCircle },
  ok: { label: 'Oportunidad', box: 'bg-emerald-500/10 text-emerald-400', tag: 'bg-emerald-500/15 text-emerald-300', Icon: TrendingUp },
  info: { label: 'Info', box: 'bg-sky-500/10 text-sky-400', tag: 'bg-sky-500/15 text-sky-300', Icon: Info },
}

export default function DemoBell() {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const unread = seen ? 0 : DEMO_NOTIFS.length

  return (
    <div ref={ref} className="fixed top-3.5 right-4 z-[60]">
      <button
        onClick={() => { setOpen(o => !o); setSeen(true) }}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors shadow-lg"
        aria-label="Notificaciones"
      >
        <Bell size={18} className="text-[var(--text-2)]" strokeWidth={1.9} />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">{unread}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 w-[380px] max-w-[calc(100vw-2rem)] max-h-[500px] rounded-2xl border border-[var(--line)] overflow-hidden shadow-2xl"
          style={{ background: 'var(--panel)' }}
        >
          <div className="flex items-center gap-2 px-4 py-3.5 border-b border-[var(--line)]">
            <Sparkles size={15} className="text-emerald-400" />
            <b className="text-[13px] font-bold text-[var(--text-1)]">Notificaciones</b>
            <span className="ml-auto text-[11px] font-mono text-[var(--text-4)]">hoy · {DEMO_NOTIFS.length}</span>
            <button onClick={() => setOpen(false)} className="p-1 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)]" aria-label="Cerrar"><X size={15} /></button>
          </div>
          <div className="overflow-y-auto max-h-[440px]">
            {DEMO_NOTIFS.map((n, i) => {
              const k = KIND[n.kind]
              const Icon = k.Icon
              const impactColor = n.impact?.startsWith('−') ? 'text-red-400' : 'text-emerald-400'
              return (
                <div key={i} className="flex gap-3 px-4 py-3 border-t border-[var(--line-soft)] first:border-t-0 hover:bg-[var(--surface-2)] transition-colors">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${k.box}`}><Icon size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-semibold text-[var(--text-1)]">{n.name}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                      <span className="ml-auto text-[10px] font-mono text-[var(--text-4)] whitespace-nowrap">{n.ago}</span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-1 leading-snug">{n.text}</p>
                    {n.impact && <p className={`text-[11px] font-mono font-bold mt-1 ${impactColor}`}>{n.impact}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
