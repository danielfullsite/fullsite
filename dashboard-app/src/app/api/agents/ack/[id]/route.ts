import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'
import { withPOSAuth } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'

// BLINDAJE B1 (P0-4): antes PATCHeaba agent_events por id SIN auth ni scoping →
// cualquiera acknowledgeaba eventos de cualquier tenant iterando ids. Ahora exige
// sesión y el filtro incluye client_id del contexto (sin IDOR cross-tenant).

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originBlock = sameOriginOnly(req); if (originBlock) return originBlock
  const auth = await withPOSAuth(req)
  if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    await sbPatch('agent_events', `id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(auth.clientId)}`, { status: 'acknowledged' })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
