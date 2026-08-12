'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bot, Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Zap, Shield, TrendingUp, Package, Users, ChefHat, Star, MessageCircle, FileText, Truck, Trash2, CloudSun, Target, BarChart3, Calendar, Bell, Settings, Timer, Brain, Sparkles, Send, Check, X } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { agentName } from '@/lib/agent-names'

interface AgentRun {
  agent_id: string
  status: string
  output_summary: string
  duration_ms: number
  created_at: string
  trigger_type: string
}

interface AgentResult {
  agent_id: string
  fecha: string
  priority: string
  summary: string
}

const AGENT_META: Record<string, { name: string; icon: typeof Bot; color: string; tentacle: string }> = {
  'anomaly-detector': { name: 'Anomalías', icon: AlertTriangle, color: 'text-red-400', tentacle: 'Inteligencia' },
  'close-predictor': { name: 'Predicción Cierre', icon: Target, color: 'text-blue-400', tentacle: 'Inteligencia' },
  'upselling': { name: 'Upselling', icon: TrendingUp, color: 'text-emerald-400', tentacle: 'Inteligencia' },
  'antifraud-agent': { name: 'Anti-Fraude', icon: Shield, color: 'text-pink-400', tentacle: 'Inteligencia' },
  'cost-variance': { name: 'Varianza Costos', icon: Zap, color: 'text-amber-400', tentacle: 'Inteligencia' },
  'menu-engineering': { name: 'Menu Engineering', icon: Star, color: 'text-violet-400', tentacle: 'Inteligencia' },
  'auto86': { name: 'Auto-86', icon: Package, color: 'text-red-500', tentacle: 'Operaciones' },
  'purchase-predictor': { name: 'Compras', icon: Timer, color: 'text-cyan-400', tentacle: 'Operaciones' },
  'kitchen-quality': { name: 'Cocina', icon: ChefHat, color: 'text-orange-400', tentacle: 'Operaciones' },
  'config-validator': { name: 'Config', icon: Settings, color: 'text-slate-400', tentacle: 'Operaciones' },
  'wansoft-staleness': { name: 'Sync Monitor', icon: Activity, color: 'text-red-400', tentacle: 'Operaciones' },
  'daily-briefing': { name: 'Briefing 7AM', icon: FileText, color: 'text-blue-400', tentacle: 'Reportes' },
  'weekly-amalay': { name: 'Reporte Semanal', icon: BarChart3, color: 'text-purple-400', tentacle: 'Reportes' },
  'intraday-sales': { name: 'Intraday', icon: Zap, color: 'text-yellow-400', tentacle: 'Reportes' },
  'staffing-optimizer': { name: 'Staffing', icon: Users, color: 'text-amber-400', tentacle: 'Personal' },
  'tips-analyzer': { name: 'Propinas', icon: Star, color: 'text-emerald-400', tentacle: 'Personal' },
  'waste-detector': { name: 'Desperdicio', icon: Trash2, color: 'text-red-400', tentacle: 'Personal' },
  'supplier-monitor': { name: 'Proveedores', icon: Truck, color: 'text-blue-400', tentacle: 'Personal' },
  'wansoft-query': { name: 'KB 24/7', icon: MessageCircle, color: 'text-green-400', tentacle: 'Conocimiento' },
  'wansoft-query-feedback': { name: 'KB Feedback', icon: MessageCircle, color: 'text-green-300', tentacle: 'Conocimiento' },
  'climate-events': { name: 'Clima', icon: CloudSun, color: 'text-sky-400', tentacle: 'Conocimiento' },
  'hermes': { name: 'Hermes', icon: Brain, color: 'text-indigo-400', tentacle: 'Meta' },
  'wansoft-browser-scraper': { name: 'Scraper Web', icon: Activity, color: 'text-slate-400', tentacle: 'Data' },
  'wansoft-deep-scraper': { name: 'Deep Scraper', icon: Activity, color: 'text-slate-400', tentacle: 'Data' },
  'reservas-pendientes': { name: 'Reservas', icon: Calendar, color: 'text-amber-400', tentacle: 'Operaciones' },
  // Agentes activos que faltaban en el UI (corren y escriben datos pero no aparecían)
  'table-time': { name: 'Tiempo de Mesa', icon: Timer, color: 'text-cyan-400', tentacle: 'Operaciones' },
  'speed_of_service': { name: 'Velocidad de Servicio', icon: Zap, color: 'text-yellow-400', tentacle: 'Operaciones' },
  'stock-alert': { name: 'Alerta de Stock', icon: Package, color: 'text-orange-400', tentacle: 'Operaciones' },
  'crm-recompra': { name: 'CRM Recompra', icon: Users, color: 'text-emerald-400', tentacle: 'Personal' },
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

interface AgentRunFull extends AgentRun {
  error_message?: string
  tokens_in?: number
  tokens_out?: number
}

interface AgentResultFull extends AgentResult {
  data?: unknown
  client_id?: string
  updated_at?: string
}

// ── Detecciones (DS v2.1) — el agente produce hallazgos accionables, no status planos ──
type DetKind = 'crit' | 'warn' | 'ok' | 'info'
const SEV: Record<DetKind, number> = { crit: 3, warn: 2, ok: 1, info: 0 }
function detKind(p?: string): DetKind {
  if (p === 'critical' || p === 'high') return 'crit'
  if (p === 'warning' || p === 'medium') return 'warn'
  if (p === 'opportunity' || p === 'positive' || p === 'success') return 'ok'
  return 'info'
}
const KIND: Record<DetKind, { label: string; text: string; border: string; bg: string; chip: string; tag: string }> = {
  crit: { label: 'Alerta', text: 'text-red-400', border: 'border-red-500', bg: 'bg-red-500/[0.06]', chip: 'bg-red-500/10 text-red-400', tag: 'bg-red-500/15 text-red-300' },
  warn: { label: 'Ojo', text: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500/[0.06]', chip: 'bg-amber-500/10 text-amber-400', tag: 'bg-amber-500/15 text-amber-300' },
  ok: { label: 'Oportunidad', text: 'text-emerald-400', border: 'border-emerald-500', bg: 'bg-emerald-500/[0.06]', chip: 'bg-emerald-500/10 text-emerald-400', tag: 'bg-emerald-500/15 text-emerald-300' },
  info: { label: 'Info', text: 'text-sky-400', border: 'border-sky-500', bg: 'bg-sky-500/[0.05]', chip: 'bg-sky-500/10 text-sky-400', tag: 'bg-sky-500/15 text-sky-300' },
}

// Render de datos del agente como árbol limpio (reemplaza el volcado de JSON crudo)
function PrettyData({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-[var(--text-4)]">—</span>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-[var(--text-1)]">{String(value)}</span>
  }
  if (depth > 3) return <span className="text-[10px] text-[var(--text-4)]">…</span>
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1.5">
        {value.slice(0, 15).map((item, i) => (
          <div key={i} className="pl-2.5 border-l border-[var(--line-soft)]"><PrettyData value={item} depth={depth + 1} /></div>
        ))}
        {value.length > 15 && <p className="pl-2.5 text-[10px] text-[var(--text-4)]">+{value.length - 15} más</p>}
      </div>
    )
  }
  const entries = Object.entries(value as Record<string, unknown>)
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => {
        const scalar = v === null || ['string', 'number', 'boolean'].includes(typeof v)
        return (
          <div key={k} className={scalar ? 'flex items-baseline justify-between gap-3' : ''}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-3)]">{k.replace(/_/g, ' ')}</span>
            {scalar
              ? <span className="text-xs font-mono tabular-nums text-[var(--text-1)] text-right">{String(v)}</span>
              : <div className="mt-1"><PrettyData value={v} depth={depth + 1} /></div>}
          </div>
        )
      })}
    </div>
  )
}

export default function MissionControlPage() {
  const [runs, setRuns] = useState<AgentRunFull[]>([])
  const [results, setResults] = useState<AgentResultFull[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  // Chat + acciones del drawer del agente
  type ChatMsg = { role: 'user' | 'assistant'; content: string }
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>({})
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [actioned, setActioned] = useState<Record<string, 'aplicado' | 'recordar' | 'descartado'>>({})

  const load = useCallback(async () => {
    try {
      const [runsData, resultsData] = await Promise.all([
        getDeepTable('agent_runs', 200),
        getDeepTable('agent_results', 100),
      ])
      setRuns(runsData as unknown as AgentRun[])
      setResults(resultsData as unknown as AgentResult[])
    } catch (e) {
      console.error('Mission control load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const i = setInterval(() => { load() }, 30000)
    return () => clearInterval(i)
  }, [load])

  // Aggregate: latest run per agent
  const latestRuns = new Map<string, AgentRun>()
  for (const r of runs) {
    if (!latestRuns.has(r.agent_id) || new Date(r.created_at) > new Date(latestRuns.get(r.agent_id)!.created_at)) {
      latestRuns.set(r.agent_id, r)
    }
  }

  // Latest result per agent
  const latestResults = new Map<string, AgentResultFull>()
  for (const r of results) {
    if (!latestResults.has(r.agent_id)) latestResults.set(r.agent_id, r)
  }

  // Stats
  const totalRuns24h = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000).length
  const errors24h = runs.filter(r => r.status === 'error' && Date.now() - new Date(r.created_at).getTime() < 86400000).length
  const criticalAlerts = Array.from(latestResults.values()).filter(r => r.priority === 'critical').length
  const activeAgents = latestRuns.size
  const avgDuration = runs.length > 0 ? Math.round(runs.slice(0, 50).reduce((s, r) => s + (r.duration_ms || 0), 0) / Math.min(runs.length, 50)) : 0

  // Group by tentacle
  const tentacles = new Map<string, string[]>()
  for (const [id, meta] of Object.entries(AGENT_META)) {
    if (!tentacles.has(meta.tentacle)) tentacles.set(meta.tentacle, [])
    tentacles.get(meta.tentacle)!.push(id)
  }

  // Recent activity feed (last 15 runs)
  const recentFeed = [...runs].filter(r => r.agent_id !== 'smoke-test').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 15)

  // Detecciones — hallazgos de los agentes (color-coded), ordenados por severidad
  const detections = Array.from(latestResults.values())
    .filter(r => r.summary)
    .map(r => {
      const meta = AGENT_META[r.agent_id]
      return { agent_id: r.agent_id, name: agentName(r.agent_id), icon: meta?.icon || Bot, kind: detKind(r.priority), summary: r.summary, fecha: r.fecha }
    })
    .sort((a, b) => SEV[b.kind] - SEV[a.kind])
  const briefing = detections.filter(d => d.kind === 'crit' || d.kind === 'warn').slice(0, 3)

  // Mensaje de bienvenida del agente (basado en su última detección)
  function introFor(id: string): ChatMsg {
    const meta = AGENT_META[id]
    const r = latestResults.get(id)
    const name = meta?.name || id
    return {
      role: 'assistant',
      content: r?.summary
        ? `Soy el agente de ${name}. Detecté: ${r.summary} ¿Quieres que te explique por qué o qué hacer?`
        : `Soy el agente de ${name}. Pregúntame lo que quieras sobre lo que analizo.`,
    }
  }

  async function sendChat() {
    const agent = selectedAgent
    const q = chatInput.trim()
    if (!agent || !q || chatLoading) return
    const meta = AGENT_META[agent]
    const result = latestResults.get(agent)
    const prev = chats[agent] ?? [introFor(agent)]
    const next: ChatMsg[] = [...prev, { role: 'user', content: q }]
    setChats(c => ({ ...c, [agent]: next }))
    setChatInput('')
    setChatLoading(true)
    try {
      const res = await fetch('/api/agents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: meta?.name || agent,
          summary: result?.summary || '',
          data: result?.data,
          messages: next.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const j = await res.json().catch(() => ({ reply: '' }))
      setChats(c => ({ ...c, [agent]: [...next, { role: 'assistant', content: j.reply || 'No pude responder ahora.' }] }))
    } catch {
      setChats(c => ({ ...c, [agent]: [...next, { role: 'assistant', content: 'No pude responder ahora. Intenta de nuevo.' }] }))
    } finally {
      setChatLoading(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[var(--text-1)] tracking-tight flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl grid place-items-center bg-emerald-500/10 text-emerald-400"><Bot size={19} /></span>
            Mission Control
          </h2>
          <p className="text-sm text-[var(--text-3)] mt-0.5">Agentic OS — {Object.keys(AGENT_META).length} agentes en tiempo real</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400">LIVE</span>
          </div>
          <button onClick={load} className="p-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] hover:bg-[var(--panel)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Briefing — "N cosas para hoy" */}
      {briefing.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-transparent p-5">
          <div className="flex items-center gap-2 mb-3.5">
            <Sparkles size={17} className="text-emerald-400" />
            <b className="text-sm font-bold text-[var(--text-1)]">{briefing.length === 1 ? '1 cosa para hoy' : `${briefing.length} cosas para hoy`}</b>
            <span className="ml-auto text-[11px] font-mono text-[var(--text-4)]">actualizado {recentFeed[0] ? timeAgo(recentFeed[0].created_at) : '—'}</span>
          </div>
          <div className="space-y-2.5">
            {briefing.map((det, i) => {
              const k = KIND[det.kind]
              const Icon = det.icon
              return (
                <div key={`${det.agent_id}-${i}`} onClick={() => setSelectedAgent(det.agent_id)} className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 cursor-pointer transition-colors hover:bg-[var(--surface-2)]">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${k.chip}`}><Icon size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[var(--text-1)]">{det.name}</span>
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                    </div>
                    <p className="text-xs text-[var(--text-2)] mt-0.5 leading-snug">{det.summary}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([
          { l: 'Agentes activos', v: String(activeAgents), c: 'text-emerald-400', Ic: Bot },
          { l: 'Ejecuciones 24h', v: String(totalRuns24h), c: 'text-[var(--text-1)]', Ic: Activity },
          { l: 'Errores 24h', v: String(errors24h), c: errors24h > 0 ? 'text-red-400' : 'text-emerald-400', Ic: AlertTriangle },
          { l: 'Alertas críticas', v: String(criticalAlerts), c: criticalAlerts > 0 ? 'text-red-400' : 'text-emerald-400', Ic: Shield },
          { l: 'Duración prom.', v: `${(avgDuration / 1000).toFixed(1)}s`, c: 'text-[var(--text-1)]', Ic: Clock },
        ]).map((k, i) => {
          const Ic = k.Ic
          return (
            <div key={i} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]"><Ic size={12} />{k.l}</div>
              <p className={`text-2xl font-extrabold mt-2 tabular-nums ${k.c}`}>{k.v}</p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: detections + agents */}
        <div className="lg:col-span-2 space-y-5">
          {/* Detecciones */}
          <section>
            <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2.5 flex items-center gap-2">
              Detecciones <span className="text-[var(--text-4)] font-mono normal-case tracking-normal">{detections.length}</span>
            </h3>
            {detections.length > 0 ? (
              <div className="space-y-2">
                {detections.map((det, i) => {
                  const k = KIND[det.kind]
                  const Icon = det.icon
                  return (
                    <div key={`${det.agent_id}-${i}`} onClick={() => setSelectedAgent(det.agent_id)} className={`rounded-xl border-l-[3px] ${k.border} ${k.bg} p-3.5 cursor-pointer transition-transform hover:translate-x-0.5`}>
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={k.text} />
                        <span className="text-[13px] font-semibold text-[var(--text-1)]">{det.name}</span>
                        <span className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                      </div>
                      <p className="text-xs text-[var(--text-2)] mt-1.5 leading-snug">{det.summary}</p>
                      <p className="text-[10px] text-[var(--text-4)] mt-1.5 font-mono">{det.fecha}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] p-8 text-center">
                <CheckCircle2 size={26} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-[var(--text-2)]">Todo en orden</p>
                <p className="text-xs text-[var(--text-4)] mt-0.5">Sin detecciones activas de los agentes.</p>
              </div>
            )}
          </section>

          {/* Agentes por tentáculo */}
          {Array.from(tentacles.entries()).map(([tentacle, agentIds]) => (
            <section key={tentacle}>
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2.5">{tentacle}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {agentIds.map(id => {
                  const meta = AGENT_META[id]
                  const run = latestRuns.get(id)
                  const result = latestResults.get(id)
                  const Icon = meta?.icon || Bot
                  const isError = run?.status === 'error'
                  const isRecent = run && (Date.now() - new Date(run.created_at).getTime()) < 3600000
                  return (
                    <div key={id} onClick={() => setSelectedAgent(id)} className={`rounded-xl border bg-[var(--surface)] p-3.5 cursor-pointer transition-all hover:-translate-y-0.5 ${
                      selectedAgent === id ? 'ring-1 ring-emerald-500/50 border-emerald-500/40' : 'border-[var(--line)] hover:border-emerald-500/30'
                    }`}>
                      <div className="flex items-center gap-2.5 mb-2">
                        <span className="w-8 h-8 rounded-lg grid place-items-center bg-[var(--surface-2)] border border-[var(--line)] flex-shrink-0"><Icon size={15} className={meta?.color || 'text-[var(--text-3)]'} /></span>
                        <span className="text-xs font-bold text-[var(--text-1)] truncate flex-1">{meta?.name || id}</span>
                        {run && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isError ? 'bg-red-500' : isRecent ? 'bg-emerald-500 animate-pulse' : 'bg-[var(--text-4)]'}`} />}
                      </div>
                      {run ? (
                        <>
                          <p className="text-[10px] text-[var(--text-4)] font-mono">{timeAgo(run.created_at)}{run.duration_ms ? ` · ${(run.duration_ms / 1000).toFixed(1)}s` : ''}</p>
                          {result?.summary && <p className="text-[11px] text-[var(--text-2)] mt-1 truncate">{result.summary}</p>}
                        </>
                      ) : (
                        <p className="text-[10px] text-[var(--text-4)]">Sin datos</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Right: agent detail or live feed */}
        <div>
          {selectedAgent ? (() => {
            const meta = AGENT_META[selectedAgent]
            const Icon = meta?.icon || Bot
            const result = latestResults.get(selectedAgent)
            const k = KIND[result ? detKind(result.priority) : 'info']
            const reco = result?.priority === 'critical'
              ? 'Atiéndelo hoy — puede estar costándote dinero. Toca Aplicar para avisar al equipo.'
              : result?.priority === 'warning'
                ? 'Vale la pena revisarlo hoy. Toca Aplicar para darle seguimiento.'
                : 'Para tu información. Pregúntale al agente si quieres el detalle.'
            const act = actioned[selectedAgent]

            return (
              <div className="space-y-3 lg:sticky lg:top-4">
                {/* Header */}
                <div className="flex items-center gap-2.5">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center flex-shrink-0 ${k.chip}`}><Icon size={17} /></span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-[var(--text-1)] truncate">{agentName(selectedAgent)}</h3>
                    <p className="text-[11px] text-[var(--text-4)]">Agente IA · analiza en vivo</p>
                  </div>
                  <button onClick={() => setSelectedAgent(null)} className="w-7 h-7 rounded-lg grid place-items-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] flex-shrink-0"><X size={16} /></button>
                </div>

                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4 space-y-4">
                  {/* Detección */}
                  <div className={`rounded-xl border-l-[3px] ${k.border} ${k.bg} p-3`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                      {result?.fecha && <span className="ml-auto text-[10px] font-mono text-[var(--text-4)]">{result.fecha}</span>}
                    </div>
                    <p className="text-[13px] text-[var(--text-1)] leading-snug">{result?.summary || 'Sin detección reciente.'}</p>
                  </div>

                  {/* Qué analizó */}
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-4)] mb-2">Qué analizó</p>
                    <ul className="space-y-1.5">
                      <li className="flex gap-2 text-xs text-[var(--text-2)] leading-snug"><span className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />Comparó tus datos recientes contra tu histórico.</li>
                      <li className="flex gap-2 text-xs text-[var(--text-2)] leading-snug"><span className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />Señal: {result?.summary || 'sin detalle'}</li>
                      {result?.fecha && <li className="flex gap-2 text-xs text-[var(--text-2)] leading-snug"><span className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0" />Último análisis: {result.fecha}.</li>}
                    </ul>
                  </div>

                  {/* Evidencia */}
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-4)] mb-2">Evidencia</p>
                    <div className="rounded-xl bg-[var(--bg)] border border-[var(--line-soft)] p-2">
                      <svg viewBox="0 0 300 56" preserveAspectRatio="none" className="w-full h-14">
                        <defs><linearGradient id="evg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity="0.35" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
                        <path d="M0 44 C 40 40, 60 30, 90 32 S 150 20, 190 24 S 250 14, 300 18 L 300 56 L 0 56 Z" fill="url(#evg)" />
                        <path d="M0 44 C 40 40, 60 30, 90 32 S 150 20, 190 24 S 250 14, 300 18" fill="none" stroke="#34d399" strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>

                  {/* Recomendación */}
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-4)] mb-1.5">Recomendación</p>
                    <p className="text-xs text-[var(--text-2)] leading-snug">{reco}</p>
                  </div>

                  {/* Acciones */}
                  <div className="flex gap-2">
                    <button onClick={() => setActioned(a => ({ ...a, [selectedAgent]: 'aplicado' }))} className={`flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 transition-colors ${act === 'aplicado' ? 'bg-emerald-500 text-[#04130d]' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'}`}>
                      <Check size={14} />{act === 'aplicado' ? 'Aplicado' : 'Aplicar'}
                    </button>
                    <button onClick={() => setActioned(a => ({ ...a, [selectedAgent]: 'recordar' }))} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--panel)] transition-colors">
                      <Clock size={14} />Recordar
                    </button>
                    <button onClick={() => { setActioned(a => ({ ...a, [selectedAgent]: 'descartado' })); setSelectedAgent(null) }} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-3)] hover:bg-[var(--panel)] transition-colors">
                      <X size={14} />Descartar
                    </button>
                  </div>

                  {/* Habla con el agente */}
                  <div className="border-t border-[var(--line-soft)] pt-3">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-4)] mb-2 flex items-center gap-1.5"><Sparkles size={12} className="text-emerald-400" />Habla con el agente</p>
                    <div className="space-y-2 max-h-[240px] overflow-y-auto mb-2.5 pr-1">
                      {(chats[selectedAgent] ?? [introFor(selectedAgent)]).map((m, i) => (
                        <div key={i} className={`max-w-[88%] px-3 py-2 rounded-2xl text-xs leading-snug ${m.role === 'user' ? 'ml-auto bg-emerald-500/[0.12] border border-emerald-500/25 text-[var(--text-1)] rounded-br-md' : 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] rounded-bl-md'}`}>{m.content}</div>
                      ))}
                      {chatLoading && <div className="bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-3)] max-w-[60%] px-3 py-2 rounded-2xl rounded-bl-md text-xs">escribiendo…</div>}
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); sendChat() }} className="flex gap-2">
                      <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Pregúntale al agente…" className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] rounded-full px-3.5 py-2 text-xs text-[var(--text-1)] outline-none focus:border-emerald-500/40 min-w-0" />
                      <button type="submit" disabled={!chatInput.trim() || chatLoading} className="w-9 h-9 rounded-full bg-emerald-500 text-[#04130d] grid place-items-center disabled:opacity-40 flex-shrink-0"><Send size={15} /></button>
                    </form>
                  </div>
                </div>
              </div>
            )
          })() : (
            <div className="lg:sticky lg:top-4">
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2.5">Feed en vivo</h3>
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden">
                <div className="divide-y divide-[var(--line-soft)] max-h-[600px] overflow-y-auto">
                  {recentFeed.map((run, i) => {
                    const meta = AGENT_META[run.agent_id]
                    const Icon = meta?.icon || Bot
                    return (
                      <div key={`${run.agent_id}-${run.created_at}-${i}`} className="px-3 py-2.5 flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${run.status === 'error' ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                          {run.status === 'error' ? <AlertTriangle size={12} className="text-red-400" /> : <Icon size={12} className={meta?.color || 'text-emerald-400'} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--text-1)]">{meta?.name || run.agent_id}</span>
                            <span className="text-[10px] text-[var(--text-4)]">{timeAgo(run.created_at)}</span>
                          </div>
                          <p className="text-[11px] text-[var(--text-3)] truncate">
                            {run.output_summary || (run.status === 'error' ? 'Error en ejecución' : 'Completado')}
                          </p>
                        </div>
                        {run.duration_ms && <span className="text-[10px] text-[var(--text-4)] flex-shrink-0">{(run.duration_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
