import { NextRequest, NextResponse } from 'next/server'
import { runAgent, runAllAgents } from '@/lib/agents/engine'
import type { AgentId } from '@/lib/agents/types'
import { requireTenant } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  let body: { client_id?: string; agent_id?: AgentId } = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  // El tenant NO lo decide quien llama. Antes esta ruta tomaba client_id del
  // cuerpo, sin sesión, y corría los agentes con la service key: cualquiera
  // podía disparar los agentes de otro restaurante y escribirle filas.
  const auth = await requireTenant(req, body.client_id)
  if (auth instanceof Response) return auth
  const clientId = auth.clientId

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
