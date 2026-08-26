/**
 * Metrics endpoint — returns agent precision, value saved, and engagement stats
 * for the last 30 days.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sbGet } from '@/lib/agents/engine'
import { requireTenant } from '@/lib/api-auth'
import type { AgentMetrics } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

interface EventRow {
  outcome: string | null
  estimated_value: number | null
  created_at: string
  status: string
  agent_id: string
}

export async function GET(req: NextRequest) {
  const pedido = req.nextUrl.searchParams.get('client_id') || ''
  if (!pedido) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  // sbGet usa la service key (ignora RLS): el tenant tiene que salir de la sesión.
  const ctx = await requireTenant(req, pedido)
  if (ctx instanceof Response) return ctx
  const clientId = ctx.clientId

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  try {
    const rows = await sbGet<EventRow>(
      'agent_events',
      `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${cutoff}&select=outcome,estimated_value,created_at,status,agent_id&limit=500`,
    )

    const withOutcome = rows.filter(r => r.outcome !== null)
    const correct       = withOutcome.filter(r => r.outcome === 'correct').length
    const falsePositive = withOutcome.filter(r => r.outcome === 'false_positive').length
    const precisionRate = withOutcome.length > 0 ? correct / withOutcome.length : null

    const totalEstimated  = rows.reduce((s, r) => s + (r.estimated_value ?? 0), 0)
    const totalValidated  = rows
      .filter(r => r.outcome === 'correct')
      .reduce((s, r) => s + (r.estimated_value ?? 0), 0)

    const metrics: AgentMetrics = {
      total_decisions: rows.length,
      correct,
      false_positives: falsePositive,
      precision_rate: precisionRate ?? 0,
      total_value_estimated: Math.round(totalEstimated),
      total_value_validated: Math.round(totalValidated),
      avg_time_to_action_min: null, // requires acknowledged_at column — future
    }

    // Per-agent breakdown
    const byAgent = rows.reduce<Record<string, { total: number; correct: number; fp: number }>>((m, r) => {
      const a = r.agent_id
      if (!m[a]) m[a] = { total: 0, correct: 0, fp: 0 }
      m[a].total++
      if (r.outcome === 'correct') m[a].correct++
      if (r.outcome === 'false_positive') m[a].fp++
      return m
    }, {})

    return NextResponse.json({ metrics, by_agent: byAgent, period_days: 30 })
  } catch (err) {
    console.error('[agents/metrics]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
