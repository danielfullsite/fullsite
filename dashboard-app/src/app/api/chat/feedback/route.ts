import { NextRequest } from 'next/server'
import { requireTenant } from '@/lib/api-auth'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * El feedback no reentrena ni cambia reglas automáticamente. Sólo deja evidencia
 * humana tenant-scoped para que el equipo mida qué respuestas ayudan y corrija el
 * copiloto con muestras reales, no con impresiones.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const requestedClient = typeof body?.client_id === 'string' ? body.client_id : null
  const auth = await requireTenant(request, requestedClient)
  if (auth instanceof Response) return auth

  const id = typeof body?.chat_log_id === 'string' ? body.chat_log_id : ''
  const verdict = body?.verdict
  if (!UUID.test(id) || (verdict !== 'useful' && verdict !== 'not_useful')) {
    return Response.json({ error: 'Feedback inválido' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY!
  const result = await fetch(
    `${url}/rest/v1/chat_logs?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(auth.clientId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        veredicto: verdict,
        veredicto_por: auth.staffId,
        veredicto_at: new Date().toISOString(),
      }),
      cache: 'no-store',
    },
  )
  if (!result.ok) return Response.json({ error: 'No se pudo guardar el feedback' }, { status: 502 })
  return Response.json({ ok: true })
}
