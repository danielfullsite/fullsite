'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, CalendarClock, Check, Gauge, Loader2, Pause, ShieldCheck } from 'lucide-react'
import {
  cadenceMeter, DEFAULT_WHATSAPP_CADENCE, normalizeCadence,
  type WhatsAppCadence,
} from '@/lib/whatsapp-automation'

const days = [
  ['D', 0], ['L', 1], ['M', 2], ['M', 3], ['J', 4], ['V', 5], ['S', 6],
] as const

const statusLabel = {
  draft: 'Borrador', pending_review: 'Esperando aprobación', approved: 'Aprobada', paused: 'Pausada',
} as const

interface AutomationResponse extends WhatsAppCadence {
  configured?: boolean
  sentLast24Hours?: number
}

export default function WhatsAppAutomationPanel({ segment, audienceSize }: { segment: string; audienceSize: number }) {
  const [cadence, setCadence] = useState<WhatsAppCadence>(DEFAULT_WHATSAPP_CADENCE)
  const [sentLast24Hours, setSentLast24Hours] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const meter = useMemo(() => cadenceMeter(cadence, sentLast24Hours), [cadence, sentLast24Hours])

  useEffect(() => {
    fetch('/api/crm/whatsapp/automation', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(response))
      .then((data: AutomationResponse) => {
        setCadence(normalizeCadence(data))
        setSentLast24Hours(Number(data.sentLast24Hours) || 0)
      })
      .catch(() => setNotice('La configuración aparecerá al aplicar la migración de CRM.'))
      .finally(() => setLoading(false))
  }, [])

  const update = <K extends keyof WhatsAppCadence>(key: K, value: WhatsAppCadence[K]) => {
    setCadence(current => ({ ...current, [key]: value, status: 'draft', aiStatus: 'draft' }))
    setNotice('Cambios sin aprobar.')
  }

  const persist = async (action: 'save' | 'request_review' | 'approve' | 'pause' | 'request_ai_review' | 'approve_ai' | 'pause_ai') => {
    setSaving(true)
    setNotice('')
    try {
      const response = await fetch('/api/crm/whatsapp/automation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, segment, cadence }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar.')
      setCadence(normalizeCadence(result))
      setNotice(action === 'approve_ai' ? 'Concierge de IA aprobado para responder automáticamente.'
        : action === 'request_ai_review' ? 'Concierge de IA enviado a revisión.'
          : action === 'pause_ai' ? 'Respuestas de IA pausadas.'
      : action === 'approve' ? 'Campaña aprobada. Quedará lista para el programador automático.'
        : action === 'request_review' ? 'Campaña enviada a revisión.'
          : action === 'pause' ? 'Automatización pausada.' : 'Borrador guardado.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo guardar.')
    } finally { setSaving(false) }
  }

  const meterTone = meter.level === 'full' || meter.level === 'high' ? 'bg-rose-500'
    : meter.level === 'medium' ? 'bg-amber-400' : 'bg-emerald-500'

  return <section className="mb-6 overflow-hidden rounded-2xl border border-emerald-900/25 bg-[var(--surface)]">
    <div className="grid xl:grid-cols-[1.35fr_.65fr]">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-400"><CalendarClock size={19} /></div>
            <div><h3 className="font-bold text-[var(--text-1)]">Piloto automático con aprobación</h3><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--text-4)]">Fullsite prepara la salida; tú revisas una vez y apruebas. Los límites y el descanso por contacto se aplican antes de cada lote.</p></div>
          </div>
          <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold ${cadence.status === 'approved' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : cadence.status === 'pending_review' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-[var(--line)] text-[var(--text-3)]'}`}>{statusLabel[cadence.status]}</span>
        </div>

        <div className="mt-6 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-[var(--text-3)]">Cada cuánto
            <select value={cadence.frequencyDays} onChange={event => update('frequencyDays', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] outline-none focus:border-emerald-500/50">
              <option value={1}>Todos los días</option><option value={3}>Cada 3 días</option><option value={7}>Cada semana</option><option value={14}>Cada 2 semanas</option><option value={30}>Cada mes</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-3)]">Máximo por día<input type="number" min="1" max="250" value={cadence.dailyLimit} onChange={event => update('dailyLimit', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] outline-none focus:border-emerald-500/50" /></label>
          <label className="text-xs text-[var(--text-3)]">Personas por lote<input type="number" min="1" max="250" value={cadence.batchSize} onChange={event => update('batchSize', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] outline-none focus:border-emerald-500/50" /></label>
          <label className="text-xs text-[var(--text-3)]">Descanso por contacto<input type="number" min="1" max="365" value={cadence.cooldownDays} onChange={event => update('cooldownDays', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)] outline-none focus:border-emerald-500/50" /><span className="mt-1 block text-[10px] text-[var(--text-4)]">días sin repetir mensaje</span></label>
        </div>

        <div className="mt-5 grid gap-4 border-t border-[var(--line-soft)] pt-5 sm:grid-cols-3">
          <label className="text-xs text-[var(--text-3)]">Tope por minuto<input type="number" min="1" max="20" value={cadence.minuteLimit} onChange={event => update('minuteLimit', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)]" /></label>
          <label className="text-xs text-[var(--text-3)]">Tope mensual<input type="number" min="1" max="5000" value={cadence.monthlyLimit} onChange={event => update('monthlyLimit', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)]" /></label>
          <label className="text-xs text-[var(--text-3)]">Confianza mínima IA<input type="number" min="0.5" max="1" step="0.01" value={cadence.aiConfidenceThreshold} onChange={event => update('aiConfidenceThreshold', Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-semibold text-[var(--text-1)]" /></label>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="flex items-center gap-2 text-sm font-bold text-[var(--text-1)]"><Bot size={16} className="text-blue-400" /> Concierge de IA</p><p className="mt-1 text-xs text-[var(--text-4)]">Contesta preguntas y reúne datos de reservación; alergias, cobros, quejas y baja pasan a una persona.</p></div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {cadence.aiStatus === 'approved' ? <button disabled={saving} onClick={() => persist('pause_ai')} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-bold text-amber-400">Pausar IA</button>
              : cadence.aiStatus === 'pending_review' ? <button disabled={saving} onClick={() => persist('approve_ai')} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Aprobar IA</button>
                : <button disabled={saving} onClick={() => persist('request_ai_review')} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Enviar IA a revisión</button>}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-[var(--line-soft)] pt-5 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1"><p className="text-xs text-[var(--text-3)]">Días permitidos</p><div className="mt-2 flex flex-wrap gap-1.5">{days.map(([label, day], index) => {
            const active = cadence.sendDays.includes(day)
            return <button key={`${label}-${index}`} type="button" onClick={() => update('sendDays', active ? cadence.sendDays.filter(value => value !== day) : [...cadence.sendDays, day].sort())} className={`grid h-9 w-9 place-items-center rounded-full text-xs font-bold transition ${active ? 'bg-emerald-600 text-white' : 'border border-[var(--line)] text-[var(--text-4)] hover:text-[var(--text-1)]'}`} aria-pressed={active}>{label}</button>
          })}</div></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-[var(--text-3)]">Desde<input type="time" value={cadence.windowStart} onChange={event => update('windowStart', event.target.value)} className="mt-1.5 block rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-1)]" /></label><label className="text-xs text-[var(--text-3)]">Hasta<input type="time" value={cadence.windowEnd} onChange={event => update('windowEnd', event.target.value)} className="mt-1.5 block rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-1)]" /></label></div>
        </div>
      </div>

      <aside className="border-t border-emerald-900/20 bg-[#073e32] p-5 text-white sm:p-6 xl:border-l xl:border-t-0">
        <div className="flex items-center gap-2 text-emerald-200"><Gauge size={18} /><p className="text-sm font-semibold">Medidor de saturación</p></div>
        <p className="mt-6 text-4xl font-black tabular-nums">{meter.percent}%</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className={`h-full rounded-full ${meterTone}`} style={{ width: `${meter.percent}%` }} /></div>
        <p className="mt-3 text-xs leading-5 text-emerald-100/70">{sentLast24Hours} enviados en 24 h · quedan {meter.remaining}. Ritmo sugerido: uno cada {meter.spacingMinutes} min dentro del horario.</p>
        <div className="mt-5 border-t border-white/10 pt-4 text-xs text-emerald-100/75"><p><strong className="text-white">{audienceSize}</strong> contactos en el segmento actual</p><p className="mt-1">Zona horaria: Monterrey</p></div>
      </aside>
    </div>

    <div className="flex flex-col gap-3 border-t border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-xs text-[var(--text-4)]">{loading ? 'Leyendo configuración…' : notice || 'Ningún mensaje sale sin campaña aprobada y consentimiento vigente.'}</p>
      <div className="flex flex-wrap gap-2">
        {cadence.status === 'approved' ? <button disabled={saving} onClick={() => persist('pause')} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-bold text-amber-400"><Pause size={14} /> Pausar</button> : <>
          <button disabled={saving} onClick={() => persist('save')} className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-bold text-[var(--text-2)]">Guardar borrador</button>
          {cadence.status !== 'pending_review' && <button disabled={saving} onClick={() => persist('request_review')} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950"><ShieldCheck size={14} /> Enviar a revisión</button>}
          {cadence.status === 'pending_review' && <button disabled={saving} onClick={() => persist('approve')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><Check size={14} /> Aprobar automatización</button>}
        </>}
        {saving && <Loader2 size={16} className="my-auto animate-spin text-emerald-400" />}
      </div>
    </div>
  </section>
}
