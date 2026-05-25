'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, AlertTriangle, TrendingUp, Users, UtensilsCrossed, Shield, Truck, Trash2, Clock, ChefHat, HandCoins, CloudSun, Target, RefreshCw, Timer, Package, MessageCircle, BarChart3, Calendar, Zap, FileText, Activity, Bell, Sparkles, Settings } from 'lucide-react'
import { getDeepTable } from '@/lib/data'

interface AgentResult {
  agent_id: string
  fecha: string
  data: unknown
  summary: string
  priority: string
  updated_at: string
}

const AGENTS = [
  { id: 'anomaly', name: 'Anomalías', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10', desc: 'Detecta métricas fuera de patrón', href: '/agentes/anomalias' },
  { id: 'predictor', name: 'Predicción de Cierre', icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10', desc: 'Proyecta cómo cierra el día', href: '/agentes/prediccion' },
  { id: 'upselling', name: 'Upselling', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', desc: 'Oportunidades de venta adicional', href: '/agentes/upselling' },
  { id: 'menu-engineering', name: 'Menu Engineering', icon: UtensilsCrossed, color: 'text-violet-500', bg: 'bg-violet-500/10', desc: 'Matriz BCG del menú', href: '/agentes/menu' },
  { id: 'staffing', name: 'Staffing', icon: Users, color: 'text-amber-500', bg: 'bg-amber-500/10', desc: 'Optimización de personal', href: '/agentes/staffing' },
  { id: 'antifraud', name: 'Anti-Fraude', icon: Shield, color: 'text-[var(--text-2)]', bg: 'bg-[var(--surface-2)]', desc: 'Detección de patrones sospechosos', href: '/agentes/antifraude' },
  { id: 'kitchen', name: 'Calidad Cocina', icon: ChefHat, color: 'text-orange-500', bg: 'bg-orange-500/10', desc: 'Cancelaciones y calidad', href: '/agentes/cocina' },
  { id: 'table-time', name: 'Tiempo de Mesa', icon: Clock, color: 'text-cyan-500', bg: 'bg-cyan-500/10', desc: 'Velocidad de atención', href: '/agentes/tiempo-mesa' },
  { id: 'tips', name: 'Propinas', icon: HandCoins, color: 'text-emerald-600', bg: 'bg-emerald-500/10', desc: 'Patrones de servicio', href: '/agentes/propinas-agente' },
  { id: 'suppliers', name: 'Proveedores', icon: Truck, color: 'text-blue-600', bg: 'bg-blue-500/10', desc: 'Gasto y concentración', href: '/agentes/proveedores-agente' },
  { id: 'waste', name: 'Desperdicio', icon: Trash2, color: 'text-red-600', bg: 'bg-red-500/10', desc: 'Compras vs consumo', href: '/agentes/desperdicio' },
  { id: 'climate', name: 'Clima + Eventos', icon: CloudSun, color: 'text-sky-500', bg: 'bg-sky-500/10', desc: 'Pronóstico × historial', href: '/agentes/clima' },
  { id: 'hermes', name: 'Hermes', icon: Bot, color: 'text-indigo-500', bg: 'bg-indigo-500/10', desc: 'Mejora continua de agentes', href: '/agentes/hermes' },
  { id: 'speed-of-service', name: 'Velocidad', icon: Timer, color: 'text-cyan-600', bg: 'bg-cyan-500/10', desc: 'Tiempo de preparación por platillo', href: '/agentes/velocidad' },
  { id: 'inventory-auto-order', name: 'Auto-Orden', icon: Package, color: 'text-teal-500', bg: 'bg-teal-500/10', desc: 'OC automática cuando baja stock', href: '/agentes/auto-orden' },
  { id: 'daily-briefing', name: 'Briefing Diario', icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10', desc: 'Resumen 7 AM en Telegram', href: '/agentes/briefing' },
  { id: 'weekly-summary', name: 'Reporte Semanal', icon: BarChart3, color: 'text-purple-500', bg: 'bg-purple-500/10', desc: 'Ejecutivo cada lunes', href: '/agentes/semanal' },
  { id: 'wansoft-query', name: 'KB 24/7', icon: MessageCircle, color: 'text-green-500', bg: 'bg-green-500/10', desc: 'Preguntas on-demand por Telegram', href: '/agentes/kb' },
  { id: 'reservas', name: 'Reservaciones', icon: Calendar, color: 'text-amber-500', bg: 'bg-amber-500/10', desc: 'Alertas de reservas pendientes', href: '/agentes/reservas' },
  { id: 'wansoft-staleness', name: 'Monitor Sync', icon: Activity, color: 'text-red-500', bg: 'bg-red-500/10', desc: 'Alerta si datos >24h sin sync', href: '/agentes/sync' },
  { id: 'proactive-alerts', name: 'Alertas Proactivas', icon: Bell, color: 'text-red-600', bg: 'bg-red-500/10', desc: 'Clima, eventos, dias festivos', href: '/agentes/alertas' },
  { id: 'intraday-sales', name: 'Ventas Intraday', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/10', desc: 'Avance de ventas en tiempo real', href: '/agentes/intraday' },
  { id: 'menu-gap', name: 'Análisis de Menú', icon: Sparkles, color: 'text-violet-600', bg: 'bg-violet-500/10', desc: 'Gaps y oportunidades del menú', href: '/agentes/menu-gap' },
  { id: 'config-validator', name: 'Config Validator', icon: Settings, color: 'text-[var(--text-2)]', bg: 'bg-[var(--surface-2)]', desc: 'Verifica configuración del cliente', href: '/agentes/config' },
  { id: 'orquestador', name: 'Orquestador', icon: Bot, color: 'text-[var(--text-1)]', bg: 'bg-[var(--surface-2)]', desc: 'Cerebro central — despacha agentes', href: '/agentes/orquestador' },
]

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500/100 text-white',
  warning: 'bg-amber-500/15 text-amber-400',
  info: 'bg-emerald-500/15 text-emerald-400',
}

export default function AgentesPage() {
  const [results, setResults] = useState<Record<string, AgentResult>>({})
  const [loading, setLoading] = useState(true)

  async function loadResults() {
    try {
      const data = await getDeepTable('agent_results', 50)
      const map: Record<string, AgentResult> = {}
      for (const row of data) {
        const r = row as unknown as AgentResult
        // Keep latest per agent
        if (!map[r.agent_id] || r.fecha > map[r.agent_id].fecha) {
          map[r.agent_id] = r
        }
      }
      setResults(map)
    } catch (err) {
      console.error('Error loading agent results:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadResults() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const activeCount = Object.keys(results).length
  const criticalCount = Object.values(results).filter(r => r.priority === 'critical').length
  const warningCount = Object.values(results).filter(r => r.priority === 'warning').length

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Agentes de IA</h2>
          <p className="text-sm text-[var(--text-3)]">26 agentes monitoreando tu operación 24/7</p>
        </div>
        <button onClick={() => { setLoading(true); loadResults() }}
          className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Agentes activos</p>
          <p className="text-2xl font-bold text-[var(--text-1)]">{activeCount} <span className="text-sm font-normal text-[var(--text-3)]">/ 26</span></p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Alertas críticas</p>
          <p className={`text-2xl font-bold ${criticalCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{criticalCount}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-4">
          <p className="text-xs text-[var(--text-2)] font-medium mb-1">Advertencias</p>
          <p className={`text-2xl font-bold ${warningCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{warningCount}</p>
        </div>
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AGENTS.map(agent => {
          const result = results[agent.id]
          const Icon = agent.icon
          const hasData = !!result
          const timeSince = result?.updated_at ? getTimeSince(result.updated_at) : null

          const agentHref = (agent as { href?: string }).href
          const cardClass = `bg-[var(--surface)] rounded-xl border shadow-sm p-5 transition-all hover:shadow-md block ${
            result?.priority === 'critical' ? 'border-red-300 bg-red-500/10/30' :
            result?.priority === 'warning' ? 'border-amber-200' : 'border-[var(--line)]'
          } ${agentHref ? 'cursor-pointer' : ''}`

          const card = (<>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${agent.bg} flex items-center justify-center`}>
                    <Icon size={20} className={agent.color} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--text-1)]">{agent.name}</h3>
                    <p className="text-xs text-[var(--text-3)]">{agent.desc}</p>
                  </div>
                </div>
                {result?.priority && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${priorityColors[result.priority] || priorityColors.info}`}>
                    {result.priority}
                  </span>
                )}
              </div>

              {hasData ? (
                <>
                  <p className="text-sm text-[var(--text-1)] leading-relaxed mb-3">{result.summary || 'Sin resumen'}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-3)]">{timeSince}</span>
                    <span className="text-[11px] text-[var(--text-3)]">{result.fecha}</span>
                  </div>
                </>
              ) : (
                <div className="py-2">
                  <p className="text-xs text-[var(--text-3)]">Sin datos. Se actualiza automáticamente.</p>
                </div>
              )}
          </>)

          return agentHref ? (
            <Link key={agent.id} href={agentHref} className={cardClass}>{card}</Link>
          ) : (
            <div key={agent.id} className={cardClass}>{card}</div>
          )
        })}
      </div>
    </>
  )
}

function getTimeSince(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}
