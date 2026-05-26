'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Shield, AlertTriangle, DollarSign, Bot, RefreshCw, Zap, Eye } from 'lucide-react'
import { getDeepTable, getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

interface AgentROI {
  agentId: string
  agentName: string
  icon: string
  color: string
  metric: string
  value: number
  description: string
  runs: number
}

export default function ROIPage() {
  const [roiData, setRoiData] = useState<AgentROI[]>([])
  const [totalSaved, setTotalSaved] = useState(0)
  const [loading, setLoading] = useState(true)
  const [daysActive, setDaysActive] = useState(0)
  const [totalRuns, setTotalRuns] = useState(0)
  const [monthlyValue, setMonthlyValue] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const [agentResults, agentRuns, salesData] = await Promise.all([
        getDeepTable('agent_results', 100),
        getDeepTable('agent_runs', 500),
        getRecentDays(30),
      ])

      // Count total runs
      setTotalRuns(agentRuns.length)

      // Calculate days active from sales data
      setDaysActive(salesData.length)

      // Monthly ventas for context
      const monthlyVentas = salesData.reduce((s, d) => s + ((d as any).ventas_dia || 0), 0)

      // Parse agent results to calculate ROI per agent
      const resultsMap = new Map<string, any[]>()
      for (const r of agentResults) {
        const aid = (r as any).agent_id
        if (!resultsMap.has(aid)) resultsMap.set(aid, [])
        resultsMap.get(aid)!.push(r)
      }

      // Count runs per agent
      const runsMap = new Map<string, number>()
      for (const r of agentRuns) {
        const aid = (r as any).agent_id
        runsMap.set(aid, (runsMap.get(aid) || 0) + 1)
      }

      const roi: AgentROI[] = []

      // 1. Anti-fraude: risk score tracking
      const antifraudResults = resultsMap.get('antifraud') || []
      let fraudSaved = 0
      for (const r of antifraudResults) {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        const findings = parsed?.total_findings || 0
        // Each fraud finding is worth ~$1,840 avg ticket × risk
        fraudSaved += findings * 1840
      }
      roi.push({
        agentId: 'antifraud',
        agentName: 'Anti-Fraude',
        icon: 'shield',
        color: 'text-red-400',
        metric: 'Fraudes prevenidos',
        value: fraudSaved,
        description: `${antifraudResults.length} auditorías completadas`,
        runs: runsMap.get('antifraud-agent') || 0,
      })

      // 2. Anomalías: alertas tempranas
      const anomalyResults = resultsMap.get('anomaly') || []
      let anomaliesDetected = 0
      for (const r of anomalyResults) {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        anomaliesDetected += (parsed?.anomalies?.length || 0)
      }
      // Each anomaly caught early saves ~$500 avg (staff correction, avoided waste)
      const anomalySaved = anomaliesDetected * 500
      roi.push({
        agentId: 'anomaly',
        agentName: 'Detector de Anomalías',
        icon: 'alert',
        color: 'text-amber-400',
        metric: 'Anomalías detectadas',
        value: anomalySaved,
        description: `${anomaliesDetected} alertas tempranas`,
        runs: runsMap.get('anomaly-detector') || 0,
      })

      // 3. Upselling: revenue opportunities
      const upsellingResults = resultsMap.get('upselling') || []
      let upsellingOpps = 0
      for (const r of upsellingResults) {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        upsellingOpps += (parsed?.total_insights || parsed?.opportunities?.length || 0)
      }
      // Conservative: 10% of opportunities convert at $150 avg
      const upsellValue = upsellingOpps * 150 * 0.1
      roi.push({
        agentId: 'upselling',
        agentName: 'Upselling',
        icon: 'trending',
        color: 'text-emerald-400',
        metric: 'Oportunidades detectadas',
        value: upsellValue,
        description: `${upsellingOpps} sugerencias generadas`,
        runs: runsMap.get('upselling') || 0,
      })

      // 4. Close Predictor: revenue forecasting
      const predictorRuns = runsMap.get('close-predictor') || 0
      roi.push({
        agentId: 'predictor',
        agentName: 'Predicción de Cierre',
        icon: 'eye',
        color: 'text-blue-400',
        metric: 'Predicciones generadas',
        value: 0, // Value is informational
        description: `${predictorRuns} predicciones en tiempo real`,
        runs: predictorRuns,
      })

      // 5. Staffing: labor optimization
      const staffingRuns = runsMap.get('staffing-optimizer') || 0
      // Conservative: $3,200/week savings from optimized scheduling × weeks active
      const weeksActive = Math.ceil(salesData.length / 7)
      const staffingSaved = weeksActive * 3200
      roi.push({
        agentId: 'staffing',
        agentName: 'Staffing Optimizer',
        icon: 'zap',
        color: 'text-violet-400',
        metric: 'Ahorro en nómina',
        value: staffingSaved,
        description: `${staffingRuns} análisis de horarios`,
        runs: staffingRuns,
      })

      // 6. Daily Briefing: time saved (15 min/day × $500/hr manager time)
      const briefingRuns = runsMap.get('daily-briefing') || 0
      const briefingValue = briefingRuns * (15 / 60) * 500
      roi.push({
        agentId: 'briefing',
        agentName: 'Briefing Diario',
        icon: 'bot',
        color: 'text-sky-400',
        metric: 'Tiempo ahorrado',
        value: briefingValue,
        description: `${briefingRuns} briefings × 15 min = ${Math.round(briefingRuns * 15 / 60)}h ahorradas`,
        runs: briefingRuns,
      })

      // Sort by value
      roi.sort((a, b) => b.value - a.value)

      const total = roi.reduce((s, r) => s + r.value, 0)
      setRoiData(roi)
      setTotalSaved(total)
      setMonthlyValue(salesData.length > 0 ? total / Math.ceil(salesData.length / 30) : total)
    } catch (err) {
      console.error('Error loading ROI:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const iconMap: Record<string, any> = {
    shield: Shield,
    alert: AlertTriangle,
    trending: TrendingUp,
    eye: Eye,
    zap: Zap,
    bot: Bot,
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <PageHeader title="ROI Dashboard" subtitle="Valor generado por los agentes de IA" />
        <button onClick={load} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Hero KPI */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-2xl border border-emerald-500/20 p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-center">
          <div className="lg:col-span-2">
            <p className="text-xs font-medium text-emerald-400 uppercase tracking-wider mb-2">Valor total generado</p>
            <p className="text-4xl font-black text-[var(--text-1)] tracking-tight">{formatCurrency(totalSaved)}</p>
            <p className="text-sm text-[var(--text-3)] mt-1">~{formatCurrency(monthlyValue)}/mes estimado</p>
          </div>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
            <p className="text-xs text-[var(--text-3)] mb-1">Ejecuciones totales</p>
            <p className="text-xl font-bold text-[var(--text-1)]">{totalRuns.toLocaleString()}</p>
            <p className="text-[11px] text-[var(--text-3)]">en {daysActive} días</p>
          </div>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4">
            <p className="text-xs text-[var(--text-3)] mb-1">Costo Fullsite</p>
            <p className="text-xl font-bold text-[var(--text-1)]">$4,999<span className="text-xs font-normal text-[var(--text-3)]">/mes</span></p>
            <p className="text-[11px] text-emerald-400 font-medium">ROI: {monthlyValue > 0 ? `${((monthlyValue / 4999) * 100).toFixed(0)}%` : '—'}</p>
          </div>
        </div>
      </div>

      {/* Agent ROI breakdown */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--line-soft)]">
          <h3 className="text-sm font-bold text-[var(--text-1)]">Valor por agente</h3>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {roiData.map(agent => {
            const Icon = iconMap[agent.icon] || Bot
            const pctOfTotal = totalSaved > 0 ? (agent.value / totalSaved) * 100 : 0
            return (
              <div key={agent.agentId} className="px-4 py-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg bg-[var(--surface-2)] flex items-center justify-center`}>
                      <Icon size={16} className={agent.color} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-1)]">{agent.agentName}</h4>
                      <p className="text-xs text-[var(--text-3)]">{agent.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-base font-bold ${agent.value > 0 ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>
                      {agent.value > 0 ? `+${formatCurrency(agent.value)}` : 'Informacional'}
                    </p>
                    <p className="text-[11px] text-[var(--text-3)]">{agent.runs} ejecuciones</p>
                  </div>
                </div>
                {agent.value > 0 && (
                  <div className="ml-12">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[var(--surface-2)] rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${pctOfTotal}%` }} />
                      </div>
                      <span className="text-[11px] text-[var(--text-3)] tabular-nums w-10 text-right">{pctOfTotal.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Methodology note */}
      <div className="mt-4 px-4 py-3 bg-[var(--surface-2)] rounded-lg">
        <p className="text-[11px] text-[var(--text-3)] leading-relaxed">
          <strong className="text-[var(--text-2)]">Metodología:</strong> Anti-fraude: hallazgos × $1,840 ticket promedio. Anomalías: alertas × $500 corrección promedio. Upselling: 10% conversión × $150 promedio. Staffing: $3,200/semana ahorro estimado. Briefing: 15 min/día × $500/hr gerente. Estos son estimados conservadores basados en benchmarks de la industria restaurantera en México.
        </p>
      </div>
    </>
  )
}
