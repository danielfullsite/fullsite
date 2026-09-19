'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, CircleCheck, Radio, UserRoundCheck } from 'lucide-react'

interface Ops {
  configured?: boolean
  provider?: { configured: boolean; enabled: boolean }
  aiEnabled?: boolean
  automationEnabled?: boolean
  conversations?: { open: number; waitingHuman: number }
  last24Hours?: { inbound: number; outbound: number; aiReplies: number; failures: number; critical: number }
  quota?: Record<'minute' | 'day' | 'month', { used: number; hard_limit: number } | null>
}

export default function WhatsAppOperationsStrip() {
  const [ops, setOps] = useState<Ops | null>(null)
  useEffect(() => {
    const load = () => fetch('/api/crm/whatsapp/operations', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(setOps).catch(() => setOps(null))
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const day = ops?.quota?.day
  const dayPercent = day ? Math.min(100, Math.round(day.used / day.hard_limit * 100)) : 0
  const healthy = Boolean(ops?.provider?.configured && ops.provider.enabled && ops.aiEnabled)
  return <section className="mb-5 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
    <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-full ${healthy ? 'bg-emerald-500/12 text-emerald-400' : 'bg-amber-500/12 text-amber-400'}`}>{healthy ? <Radio size={18} /> : <AlertTriangle size={18} />}</span>
        <div><h3 className="text-sm font-bold text-[var(--text-1)]">Centro operativo WhatsApp</h3><p className="mt-1 text-xs text-[var(--text-4)]">{healthy ? 'Proveedor e IA disponibles.' : 'Modo seguro: faltan credenciales o activación.'} Se actualiza cada minuto.</p></div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Metric icon={<Bot size={14} />} label="IA respondió" value={ops?.last24Hours?.aiReplies || 0} />
        <Metric icon={<UserRoundCheck size={14} />} label="Requieren persona" value={ops?.conversations?.waitingHuman || 0} warn />
        <Metric icon={<CircleCheck size={14} />} label="Salientes 24 h" value={ops?.last24Hours?.outbound || 0} />
        <Metric icon={<AlertTriangle size={14} />} label="Alertas críticas" value={ops?.last24Hours?.critical || 0} warn />
      </div>
    </div>
    <div className="grid border-t border-[var(--line-soft)] px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-5">
      <div><div className="flex justify-between text-[11px] text-[var(--text-4)]"><span>Uso diario protegido</span><span>{day?.used || 0} / {day?.hard_limit || '—'}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]"><div className={`h-full rounded-full ${dayPercent >= 80 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${dayPercent}%` }} /></div></div>
      <p className="mt-2 text-[10px] text-[var(--text-4)] sm:mt-0">Los topes se reservan en base de datos antes de cada envío.</p>
    </div>
  </section>
}

function Metric({ icon, label, value, warn = false }: { icon: React.ReactNode; label: string; value: number; warn?: boolean }) {
  return <div><p className={`flex items-center gap-1.5 text-[10px] ${warn && value ? 'text-amber-400' : 'text-[var(--text-4)]'}`}>{icon}{label}</p><p className="mt-0.5 text-lg font-black tabular-nums text-[var(--text-1)]">{value}</p></div>
}
