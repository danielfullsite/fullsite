import { NextRequest, NextResponse } from 'next/server'
import { runAgent, runAllAgents } from '@/lib/agents/engine'
import type { AgentId } from '@/lib/agents/types'
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'

// BLINDAJE B1 (P0-4): antes esta ruta corría agentes de CUALQUIER tenant sin auth
// (client_id venía del body) → ejecución cross-tenant + DoS de costo LLM por anónimos.
// Ahora exige sesión y deriva client_id del contexto server-side (nunca del body).

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const originBlock = sameOriginOnly(req); if (originBlock) return originBlock
  const auth = await withPOSAuth(req)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const clientId = auth.clientId

  let body: { agent_id?: AgentId } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  try {
    if (body.agent_id) {
      const result = await runAgent(body.agent_id, clientId)
      return NextResponse.json({ results: [result] })
    }
    const results = await runAllAgents(clientId)
    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: 'Error ejecutando agentes' }, { status: 500 })
  }
}
