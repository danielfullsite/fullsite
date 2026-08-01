import { NextRequest, NextResponse } from 'next/server'
import { fetchEvents } from '@/lib/agents/engine'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const clientId = searchParams.get('client_id') || ''
  const status    = searchParams.get('status') || 'new'
  const agentId   = searchParams.get('agent_id') as AgentId | null
  const limit     = Math.min(Number(searchParams.get('limit') || 50), 100)

  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  try {
    const events = await fetchEvents(clientId, { status, limit, ...(agentId ? { agentId } : {}) })
    return NextResponse.json({ events, count: events.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
