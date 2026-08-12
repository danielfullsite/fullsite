'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, AlertTriangle, AlertCircle, TrendingUp, Bot } from 'lucide-react'
import { getDeepTable } from '@/lib/data'

interface Det {
  agent_id: string
  summary: string
  priority: string
  fecha: string
}

const NAMES: Record<string, string> = {
  'anomaly-detector': 'Anomalías de venta', 'close-predictor': 'Predicción de Cierre',
  'upselling': 'Upselling', 'menu-engineering': 'Menu Engineering', 'staffing-optimizer': 'Staffing',
  'antifraud-agent': 'Anti-Fraude', 'kitchen-quality': 'Calidad de Cocina', 'table-time': 'Tiempo de Mesa',
  'speed_of_service': 'Velocidad de Servicio', 'tips-analyzer': 'Propinas', 'supplier-monitor': 'Proveedores',
  'waste-detector': 'Desperdicio', 'cost-variance': 'Varianza de Costos', 'climate-events': 'Clima',
  'stock-alert': 'Alerta de Stock', 'auto86': 'Auto-86', 'crm-recompra': 'Clientes en riesgo',
  'daily-briefing': 'Briefing', 'weekly-amalay': 'Reporte Semanal', 'intraday-sales': 'Ventas Intraday',
  'hermes': 'Salud del Sistema',
}

function kind(p: string): 'crit' | 'warn' {
  return p === 'critical' ? 'crit' : 'warn'
}
const K = {
  crit: { label: 'Alerta', box: 'bg-red-500/10 text-red-400', tag: 'bg-red-500/15 text-red-300', Icon: AlertTriangle },
  warn: { label: 'Ojo', box: 'bg-amber-500/10 text-amber-400', tag: 'bg-amber-500/15 text-amber-300', Icon: AlertCircle },
}

export default function AgentBriefing() {
  const [dets, setDets] = useState<Det[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    getDeepTable('agent_results', 60)
      .then(rows => {
        if (!alive) return
        const seen = new Set<string>()
        const list: Det[] = []
        for (const r of rows as unknown as Det[]) {
          if (r.priority !== 'critical' && r.priority !== 'warning') continue
          if (seen.has(r.agent_id)) continue
          seen.add(r.agent_id)
          list.push(r)
        }
        // críticas primero, top 3
        list.sort((a, b) => (a.priority === 'critical' ? 0 : 1) - (b.priority === 'critical' ? 0 : 1))
        setDets(list.slice(0, 3))
        setReady(true)
      })
      .catch(() => setReady(true))
    return () => { alive = false }
  }, [])

  if (!ready || dets.length === 0) return null

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-transparent p-4 sm:p-5 mb-5">
      <div className="flex items-center gap-2 mb-3.5">
        <Sparkles size={17} className="text-emerald-400" />
        <b className="text-sm font-bold text-[var(--text-1)]">
          Buenos días — {dets.length === 1 ? '1 cosa para hoy' : `${dets.length} cosas para hoy`}
        </b>
        <span className="ml-auto text-[11px] font-mono text-[var(--text-4)] hidden sm:inline">de tus agentes IA</span>
      </div>
      <div className="space-y-2.5">
        {dets.map((d, i) => {
          const k = K[kind(d.priority)]
          const Icon = k.Icon
          return (
            <Link
              key={`${d.agent_id}-${i}`}
              href="/mission-control"
              className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${k.box}`}><Icon size={15} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-[var(--text-1)]">{NAMES[d.agent_id] || d.agent_id}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${k.tag}`}>{k.label}</span>
                </div>
                <p className="text-xs text-[var(--text-2)] mt-0.5 leading-snug">{d.summary}</p>
              </div>
            </Link>
          )
        })}
      </div>
      <Link href="/mission-control" className="inline-flex items-center gap-1.5 mt-3.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
        Ver todas las detecciones <ArrowRight size={13} />
      </Link>
    </div>
  )
}
