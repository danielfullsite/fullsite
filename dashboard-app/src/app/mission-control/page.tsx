'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bot, Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Zap, Shield, TrendingUp, Package, Users, ChefHat, Star, MessageCircle, FileText, Truck, Trash2, CloudSun, Target, BarChart3, Calendar, Bell, Settings, Timer, Brain } from 'lucide-react'
import { getDeepTable } from '@/lib/data'

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

export default function MissionControlPage() {
  const [runs, setRuns] = useState<AgentRunFull[]>([])
  const [results, setResults] = useState<AgentResultFull[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

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

  // Recent activity feed (last 20 runs)
  const recentFeed = [...runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 15)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-1)] flex items-center gap-2">
            <Bot size={20} className="text-emerald-500" /> Mission Control
          </h2>
          <p className="text-sm text-[var(--text-3)]">Agentic OS — {Object.keys(AGENT_META).length} agentes en tiempo real</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-emerald-400">LIVE</span>
          </div>
          <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Agentes activos</p>
          <p className="text-2xl font-bold text-emerald-400">{activeAgents}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Ejecuciones 24h</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{totalRuns24h}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Errores 24h</p>
          <p className={`text-2xl font-bold ${errors24h > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{errors24h}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Alertas críticas</p>
          <p className={`text-2xl font-bold ${criticalAlerts > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{criticalAlerts}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs text-[var(--text-3)]">Duración promedio</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{(avgDuration / 1000).toFixed(1)}s</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent grid by tentacle */}
        <div className="lg:col-span-2 space-y-4">
          {Array.from(tentacles.entries()).map(([tentacle, agentIds]) => (
            <div key={tentacle}>
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">{tentacle}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {agentIds.map(id => {
                  const meta = AGENT_META[id]
                  const run = latestRuns.get(id)
                  const result = latestResults.get(id)
                  const Icon = meta?.icon || Bot
                  const isError = run?.status === 'error'
                  const isRecent = run && (Date.now() - new Date(run.created_at).getTime()) < 3600000

                  return (
                    <div key={id} onClick={() => setSelectedAgent(id)} className={`bg-[var(--surface)] rounded-lg border p-3 transition-all cursor-pointer hover:shadow-md ${
                      isError ? 'border-red-500/30 bg-red-500/5' :
                      isRecent ? 'border-emerald-500/20' : 'border-[var(--line)]'
                    } ${selectedAgent === id ? 'ring-2 ring-emerald-500/50' : ''}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon size={14} className={meta?.color || 'text-[var(--text-3)]'} />
                        <span className="text-xs font-bold text-[var(--text-1)] truncate">{meta?.name || id}</span>
                        {run && (
                          <span className={`ml-auto w-2 h-2 rounded-full flex-shrink-0 ${
                            isError ? 'bg-red-500' : isRecent ? 'bg-emerald-500 animate-pulse' : 'bg-[var(--text-4)]'
                          }`} />
                        )}
                      </div>
                      {run ? (
                        <div className="text-[10px] text-[var(--text-3)] space-y-0.5">
                          <p>{timeAgo(run.created_at)} · {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : ''}</p>
                          {result?.summary && <p className="truncate text-[var(--text-2)]">{result.summary}</p>}
                          {result?.priority === 'critical' && <p className="text-red-400 font-bold">CRÍTICO</p>}
                          {result?.priority === 'warning' && <p className="text-amber-400">⚠ {result.summary?.slice(0, 40)}</p>}
                        </div>
                      ) : (
                        <p className="text-[10px] text-[var(--text-4)]">Sin datos</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Right panel: agent detail or live feed */}
        <div>
          {selectedAgent ? (() => {
            const meta = AGENT_META[selectedAgent]
            const Icon = meta?.icon || Bot
            const agentRuns = runs.filter(r => r.agent_id === selectedAgent).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            const latestRun = agentRuns[0]
            const result = latestResults.get(selectedAgent)
            const resultData = result?.data
            const successCount = agentRuns.filter(r => r.status === 'success').length
            const errorCount = agentRuns.filter(r => r.status === 'error').length

            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
                    <Icon size={16} className={meta?.color || 'text-[var(--text-3)]'} />
                    {meta?.name || selectedAgent}
                  </h3>
                  <button onClick={() => setSelectedAgent(null)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] px-2 py-1 rounded hover:bg-[var(--surface-2)]">
                    Cerrar
                  </button>
                </div>

                {/* Agent summary */}
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4 space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-[var(--text-1)]">{agentRuns.length}</p>
                      <p className="text-[10px] text-[var(--text-4)] uppercase">Runs</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-emerald-400">{successCount}</p>
                      <p className="text-[10px] text-[var(--text-4)] uppercase">OK</p>
                    </div>
                    <div>
                      <p className={`text-lg font-bold ${errorCount > 0 ? 'text-red-400' : 'text-[var(--text-1)]'}`}>{errorCount}</p>
                      <p className="text-[10px] text-[var(--text-4)] uppercase">Errores</p>
                    </div>
                  </div>

                  {latestRun && (
                    <div className="border-t border-[var(--line-soft)] pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-3)]">Ultimo run</span>
                        <span className="text-xs text-[var(--text-2)]">{new Date(latestRun.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-3)]">Status</span>
                        <span className={`text-xs font-bold ${latestRun.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{latestRun.status === 'success' ? 'OK' : 'Error'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-3)]">Duracion</span>
                        <span className="text-xs text-[var(--text-2)]">{latestRun.duration_ms ? `${(latestRun.duration_ms / 1000).toFixed(1)}s` : '--'}</span>
                      </div>
                      {latestRun.trigger_type && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--text-3)]">Trigger</span>
                          <span className="text-xs text-[var(--text-2)]">{latestRun.trigger_type}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Output summary */}
                  {latestRun?.output_summary && (
                    <div className="border-t border-[var(--line-soft)] pt-3">
                      <p className="text-xs font-bold text-[var(--text-2)] mb-1">Resultado</p>
                      <p className="text-xs text-[var(--text-2)] whitespace-pre-wrap">{latestRun.output_summary}</p>
                    </div>
                  )}

                  {/* Error message */}
                  {latestRun?.error_message && (
                    <div className="border-t border-[var(--line-soft)] pt-3">
                      <p className="text-xs font-bold text-red-400 mb-1">Error</p>
                      <p className="text-xs text-red-300 whitespace-pre-wrap">{latestRun.error_message}</p>
                    </div>
                  )}

                  {/* Agent result data */}
                  {result && (
                    <div className="border-t border-[var(--line-soft)] pt-3">
                      <p className="text-xs font-bold text-[var(--text-2)] mb-1">Analisis ({result.fecha})</p>
                      {result.summary && <p className="text-xs text-[var(--text-2)] mb-2">{result.summary}</p>}
                      {resultData != null && (
                        <div className="bg-[var(--bg)] rounded-lg p-2 max-h-[200px] overflow-y-auto">
                          <pre className="text-[10px] text-[var(--text-3)] whitespace-pre-wrap">{typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Run history */}
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--line-soft)]">
                    <p className="text-xs font-bold text-[var(--text-2)]">Historial de ejecuciones</p>
                  </div>
                  <div className="divide-y divide-[var(--line-soft)] max-h-[300px] overflow-y-auto">
                    {agentRuns.slice(0, 20).map((run, i) => (
                      <div key={`${run.created_at}-${i}`} className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${run.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <span className="text-[11px] text-[var(--text-2)]">
                            {new Date(run.created_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {run.output_summary && <span className="text-[10px] text-[var(--text-3)] truncate max-w-[150px]">{run.output_summary}</span>}
                          <span className="text-[10px] text-[var(--text-4)]">{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })() : (
            <>
              <h3 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">Feed en vivo</h3>
              <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-hidden">
                <div className="divide-y divide-[var(--line-soft)] max-h-[600px] overflow-y-auto">
                  {recentFeed.map((run, i) => {
                    const meta = AGENT_META[run.agent_id]
                    const Icon = meta?.icon || Bot
                    return (
                      <div key={`${run.agent_id}-${run.created_at}-${i}`} className="px-3 py-2.5 flex items-start gap-2.5">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          run.status === 'error' ? 'bg-red-500/10' : 'bg-emerald-500/10'
                        }`}>
                          {run.status === 'error' ? (
                            <AlertTriangle size={12} className="text-red-400" />
                          ) : (
                            <Icon size={12} className={meta?.color || 'text-emerald-400'} />
                          )}
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
                        {run.duration_ms && (
                          <span className="text-[10px] text-[var(--text-4)] flex-shrink-0">{(run.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
