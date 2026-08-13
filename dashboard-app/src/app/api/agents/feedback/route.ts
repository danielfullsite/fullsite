// Feedback de los agentes — el loop de mejora del producto.
// El dueño marca cada detección como Aplicado / Recordar / Descartado; se
// persiste por (client_id, agent_id) para que sobreviva recargas y se vuelva
// señal real: qué insights sirven y cuáles son ruido (descartados).
//
// Autenticado (session del dashboard) + service key con client_id inyectado.

import { requireAuth, getClientId } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const ACTIONS = new Set(['aplicado', 'recordar', 'descartado'])

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  const clientId = getClientId(request)
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/agent_feedback?client_id=eq.${encodeURIComponent(clientId)}&select=agent_id,action,updated_at`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, cache: 'no-store' }
    )
    const rows = res.ok ? await res.json() : []
    return Response.json({ feedback: Array.isArray(rows) ? rows : [] })
  } catch {
    return Response.json({ feedback: [] })
  }
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  const clientId = getClientId(request)
  let body: { agent_id?: string; action?: string; insight_fecha?: string; insight_summary?: string; note?: string }
  try { body = await request.json() } catch { return Response.json({ error: 'bad json' }, { status: 400 }) }
  const { agent_id, action, insight_fecha, insight_summary, note } = body
  if (!agent_id || !action || !ACTIONS.has(action)) {
    return Response.json({ error: 'agent_id/action inválidos' }, { status: 400 })
  }
  try {
    const res = await fetch(`${SB_URL}/rest/v1/agent_feedback`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        client_id: clientId,
        agent_id,
        action,
        insight_fecha: insight_fecha || null,
        insight_summary: insight_summary || null,
        note: note || null,
        updated_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) return Response.json({ error: `write failed ${res.status}` }, { status: 500 })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'write failed' }, { status: 500 })
  }
}
