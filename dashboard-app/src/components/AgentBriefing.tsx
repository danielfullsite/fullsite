'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, Bot } from 'lucide-react'
import { getDeepTable } from '@/lib/data'
import { agentName } from '@/lib/agent-names'

interface Det {
  agent_id: string
  summary: string
  priority: string
  fecha: string
}

function kind(p: string): 'crit' | 'warn' {
  return p === 'critical' ? 'crit' : 'warn'
}
// Severidad vía tokens semánticos → crisp en dark Y light.
const K = {
  crit: { label: 'Alerta', color: 'var(--crit)', soft: 'var(--crit-soft)', ink: 'var(--crit-ink)' },
  warn: { label: 'Ojo', color: 'var(--warn)', soft: 'var(--warn-soft)', ink: 'var(--warn-ink)' },
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
        list.sort((a, b) => (a.priority === 'critical' ? 0 : 1) - (b.priority === 'critical' ? 0 : 1))
        setDets(list.slice(0, 3))
        setReady(true)
      })
      .catch(() => setReady(true))
    return () => { alive = false }
  }, [])

  if (!ready || dets.length === 0) return null

  return (
    <div className="rounded-2xl border p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--accent-line)', background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
      <div className="flex items-center gap-2 mb-3.5">
        <Sparkles size={17} style={{ color: 'var(--accent-ink)' }} />
        <b className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
          Buenos días — {dets.length === 1 ? '1 cosa para hoy' : `${dets.length} cosas para hoy`}
        </b>
        <span className="ml-auto text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5" style={{ color: 'var(--accent-ink)' }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />tus agentes IA
        </span>
      </div>
      <div className="space-y-2.5">
        {dets.map((d, i) => {
          const k = K[kind(d.priority)]
          return (
            <Link
              key={`${d.agent_id}-${i}`}
              href="/mission-control"
              className="flex items-stretch gap-3 rounded-xl border p-3 transition-colors"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
            >
              <span className="w-1.5 rounded-full flex-shrink-0" style={{ background: k.color }} />
              <span className="relative grid place-items-center flex-shrink-0 rounded-full self-start" style={{ width: 34, height: 34, background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                <Bot size={17} />
                <span className="absolute rounded-full animate-pulse" style={{ width: 9, height: 9, right: -1, bottom: -1, background: 'var(--accent)', border: '2px solid var(--surface)' }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>{agentName(d.agent_id)}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: k.soft, color: k.ink }}>{k.label}</span>
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-ink)' }}>Agente IA · en vivo</div>
                <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>{d.summary}</p>
              </div>
            </Link>
          )
        })}
      </div>
      <Link href="/mission-control" className="inline-flex items-center gap-1.5 mt-3.5 text-xs font-semibold" style={{ color: 'var(--accent-ink)' }}>
        Ver todas las detecciones <ArrowRight size={13} />
      </Link>
    </div>
  )
}
