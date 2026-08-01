import { NextRequest, NextResponse } from 'next/server'
import { runAgent, runAllAgents } from '@/lib/agents/engine'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  let body: { client_id?: string; agent_id?: AgentId } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const clientId = body.client_id || ''
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  try {
    if (body.agent_id) {
      const result = await runAgent(body.agent_id, clientId)
      return NextResponse.json({ results: [result] })
    }
    const results = await runAllAgents(clientId)
    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
