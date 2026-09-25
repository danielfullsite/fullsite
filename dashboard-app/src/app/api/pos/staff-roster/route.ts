import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

/**
 * Roster activo del restaurante, para la REVOCACIÓN offline de la Caja (bloque POS, 2026-09-24).
 *
 * La Caja guarda credenciales preparadas hasta 7 días. Antes, un empleado dado de baja seguía
 * entrando offline con la suya mientras no tecleara su PIN con red (que es lo que dispara el
 * 401 que la borraba). Ahora, después de cada entrada con red, la Caja pide este roster y
 * borra —de forma durable— a quien ya no aparece, y aplica los cambios de rol.
 *
 * Sólo ids y roles: ni nombres, ni PIN, ni hash. El tenant sale del token (withPOSAuth), nunca
 * del query. Si la base no contesta: 503 — la Caja no toca nada con un roster que no leyó.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 503 })
  try {
    const r = await fetch(
      `${url}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(auth.clientId)}&active=eq.true&select=id,role&order=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) },
    )
    if (!r.ok) return Response.json({ error: 'ROSTER_UNAVAILABLE' }, { status: 503 })
    const filas = await r.json().catch(() => null)
    if (!Array.isArray(filas)) return Response.json({ error: 'ROSTER_UNAVAILABLE' }, { status: 503 })
    const staff = filas
      .filter(f => typeof f?.id === 'string' && typeof f?.role === 'string')
      .map(f => ({ id: f.id as string, role: f.role as string }))
    return Response.json({ client_id: auth.clientId, staff, as_of: Date.now() })
  } catch {
    return Response.json({ error: 'ROSTER_UNAVAILABLE' }, { status: 503 })
  }
}
