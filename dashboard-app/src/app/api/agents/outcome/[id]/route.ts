// Calificar una alerta como acertada o falso positivo.
//
// Esta es la ruta que alimenta la precisión de los agentes. Sin guardián, cualquiera
// podía marcar como "falso positivo" las alertas de un restaurante ajeno — y el número
// de precisión que sale de aquí dejaba de significar nada. Mismo patrón que ack: el
// tenant va en el WHERE del PATCH.
import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import type { Outcome } from '@/lib/agents/types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const ctx = await withPOSAuth(req)
  if (!ctx) return unauthorized('Se requiere sesión')

  let body: { outcome?: Outcome } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const outcome = body.outcome
  if (!outcome || !['correct', 'false_positive'].includes(outcome)) {
    return NextResponse.json({ error: 'outcome must be correct or false_positive' }, { status: 400 })
  }

  try {
    await sbPatch(
      'agent_events',
      `id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(ctx.clientId)}`,
      { outcome, status: 'resolved' },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
