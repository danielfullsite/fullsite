// Lectura de las alertas de los agentes.
//
// `fetchEvents` consulta con SUPABASE_SERVICE_KEY, que ignora RLS por diseño. Eso
// convierte a esta ruta en el único punto donde se decide qué tenant se lee: sin
// guardián, un `?client_id=` en la barra de direcciones bastaba para leer las alertas
// de cualquier restaurante. El tenant sale de la sesión (requireTenant lo resuelve
// contra client_users), no del query string.
import { NextRequest, NextResponse } from 'next/server'
import { fetchEvents } from '@/lib/agents/engine'
import { requireTenant } from '@/lib/api-auth'
import type { AgentId } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const pedido    = searchParams.get('client_id') || ''
  const status    = searchParams.get('status') || 'new'
  const agentId   = searchParams.get('agent_id') as AgentId | null
  const limit     = Math.min(Number(searchParams.get('limit') || 50), 100)

  if (!pedido) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

  const ctx = await requireTenant(req, pedido)
  if (ctx instanceof Response) return ctx
  const clientId = ctx.clientId

  try {
    const events = await fetchEvents(clientId, { status, limit, ...(agentId ? { agentId } : {}) })
    return NextResponse.json({ events, count: events.length })
  } catch (err) {
    console.error('[agents/events]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
