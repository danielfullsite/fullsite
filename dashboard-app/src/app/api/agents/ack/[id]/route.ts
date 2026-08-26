// Marcar una alerta como vista.
//
// `sbPatch` escribe con SUPABASE_SERVICE_KEY, que ignora RLS. Sin guardián, un POST
// con el id de una fila ajena marcaba como vista la alerta de otro restaurante.
// El filtro por tenant va en el WHERE del PATCH: un id de otro cliente no empata con
// ninguna fila, así que la escritura no ocurre (falla cerrado sin una lectura extra).
import { NextRequest, NextResponse } from 'next/server'
import { sbPatch } from '@/lib/agents/engine'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const ctx = await withPOSAuth(req)
  if (!ctx) return unauthorized('Se requiere sesión')

  try {
    await sbPatch(
      'agent_events',
      `id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(ctx.clientId)}`,
      { status: 'acknowledged' },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
