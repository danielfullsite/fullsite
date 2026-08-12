'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, Loader2, ShieldCheck, X, Check, AlertTriangle } from 'lucide-react'

// Control Plane · Copiloto de super-admin. Chat con Claude que lee datos de TODOS
// los tenants y propone acciones (crear tenant, flags, activar/desactivar) que el
// humano confirma. Gateado server-side por requirePlatformAdmin2FA.

interface Msg { role: 'user' | 'assistant'; content: string }
interface Pending { tool: string; input: Record<string, unknown>; summary: string }

const SUGERENCIAS = [
  '¿Cómo van las ventas de todos mis clientes?',
  'Dame el resumen de AMALAY de los últimos 7 días',
  '¿Qué agentes fallaron hoy y en qué tenant?',
  '¿Qué necesita mi atención ahora mismo?',
]

export default function CopilotoPage() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [denied, setDenied] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [msgs, pending, busy])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    setPending(null)
    const next = [...msgs, { role: 'user' as const, content: q }]
    setMsgs(next)
    setBusy(true)
    try {
      const res = await fetch('/api/platform/copiloto', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next }),
      })
      if (res.status === 401 || res.status === 403) { setDenied(true); return }
      const j = await res.json().catch(() => ({}))
      if (j.text) setMsgs(m => [...m, { role: 'assistant', content: j.text }])
      if (j.pendingAction) setPending(j.pendingAction)
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: 'Error de red. Intenta de nuevo.' }])
    } finally { setBusy(false) }
  }

  async function confirmAction() {
    if (!pending || busy) return
    const p = pending
    setPending(null)
    setBusy(true)
    try {
      const res = await fetch('/api/platform/copiloto/execute', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: p.tool, input: p.input }),
      })
      const j = await res.json().catch(() => ({}))
      const okMsg = j.ok
        ? `✅ Listo — ${p.summary.toLowerCase()}.`
        : `❌ No se pudo: ${(j.result?.error) || `error ${j.status || ''}`}.`
      setMsgs(m => [...m, { role: 'assistant', content: okMsg }])
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: '❌ Error de red al ejecutar la acción.' }])
    } finally { setBusy(false) }
  }

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-center">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-lg font-bold text-[var(--text-1)]">Acceso denegado</p>
        <p className="text-sm text-[var(--text-4)]">El copiloto es solo para administradores de plataforma.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Sparkles size={20} /></span>
        <div>
          <h1 className="text-xl font-bold text-[var(--text-1)]">Copiloto</h1>
          <p className="text-xs text-[var(--text-4)]">Lee todos tus clientes · propone acciones · tú confirmas</p>
        </div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3">
        {msgs.length === 0 && !busy && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center py-10">
            <span className="w-12 h-12 rounded-2xl grid place-items-center bg-[var(--accent)]/15 text-[var(--accent-bright)]"><Sparkles size={24} /></span>
            <p className="text-sm text-[var(--text-3)]">Pregúntame lo que sea sobre tus clientes.</p>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGERENCIAS.map(s => (
                <button key={s} onClick={() => send(s)} className="text-left text-xs text-[var(--text-2)] rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 hover:border-[var(--accent)] transition-colors">{s}</button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-[var(--accent)] text-[#04130d]' : 'bg-[var(--surface-2)] text-[var(--text-1)]'}`}>{m.content}</div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3.5 py-2.5 bg-[var(--surface-2)] text-[var(--text-4)]"><Loader2 size={16} className="animate-spin" /></div>
          </div>
        )}

        {pending && (
          <div className="rounded-2xl border-l-[3px] border-amber-500 bg-amber-500/[0.07] p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldCheck size={15} className="text-amber-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Confirmar acción</span>
            </div>
            <p className="text-[13px] text-[var(--text-1)] mb-3">{pending.summary}</p>
            <div className="flex gap-2">
              <button onClick={confirmAction} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-500 text-[#04130d] hover:bg-emerald-400"><Check size={14} /> Confirmar</button>
              <button onClick={() => { setPending(null); setMsgs(m => [...m, { role: 'assistant', content: 'Acción cancelada.' }]) }} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg py-2 px-3 bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)]"><X size={14} /> Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); send(input) }} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Escríbele al copiloto…"
          className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
        />
        <button type="submit" disabled={busy || !input.trim()} className="grid place-items-center w-12 rounded-xl bg-[var(--accent)] text-[#04130d] disabled:opacity-50">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  )
}
