/**
 * Agent cron endpoint — triggered by Vercel Cron every 30 min during service hours.
 * Runs all 5 agents for the default client and stores events in agent_events.
 *
 * Agents are time-aware and return [] outside service hours, so this is a no-op
 * when the restaurant is closed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runAllAgents } from '@/lib/agents/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
  //
  // Falla CERRADO. La version anterior era `if (cronSecret && ...)`: sin la
  // variable, la condicion entera se saltaba y cualquiera podia disparar la
  // corrida de los 5 agentes — quemando cuota de Groq, escribiendo en
  // agent_events y mandando avisos por Telegram. CRON_SECRET no estaba puesta en
  // produccion, asi que ese era el estado real desde que existe la ruta.
  //
  // Sin secreto la ruta no existe, en vez de existir sin puerta. Mismo patron
  // que /api/onboarding, que ya devolvia 503 cuando le falta el suyo.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron no configurado' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'No client configured' }, { status: 400 })

  try {
    const results = await runAllAgents(clientId)
    const totalEvents = results.reduce((s, r) => s + r.events.length, 0)
    const errors = results.filter(r => r.error).map(r => ({ agent: r.agent_id, error: r.error }))
    return NextResponse.json({
      ok: true,
      client_id: clientId,
      total_events: totalEvents,
      agents: results.map(r => ({ agent: r.agent_id, events: r.events.length, ms: r.duration_ms })),
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
