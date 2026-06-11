import { NextRequest } from 'next/server'

// Validación de PIN del POS server-side.
// El cliente ya no lee pos_staff directamente (anon revocado por RLS);
// este endpoint consulta con service key y aplica rate limit por IP.

const MAX_ATTEMPTS = 10
const WINDOW_MS = 60_000

const attemptsByIp = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = attemptsByIp.get(ip)
  if (!entry || now > entry.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!checkRateLimit(ip)) {
      return Response.json({ error: 'Demasiados intentos' }, { status: 429 })
    }

    const { pin, client_id } = await request.json()
    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
      return Response.json({ error: 'PIN inválido' }, { status: 400 })
    }
    const clientId = typeof client_id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(client_id) ? client_id : 'amalay'

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_staff?pin=eq.${encodeURIComponent(pin)}&active=eq.true&client_id=eq.${encodeURIComponent(clientId)}&select=id,name,role&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows) && rows.length > 0) {
        return Response.json({ staff: { id: rows[0].id, name: rows[0].name, role: rows[0].role } })
      }
    }

    // Fallback PIN server-side (env sin NEXT_PUBLIC — nunca llega al cliente)
    const fallback = process.env.POS_FALLBACK_PIN
    if (fallback && pin === fallback) {
      return Response.json({ staff: { id: 'admin', name: 'Admin', role: 'admin' } })
    }

    return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
