import { NextRequest } from 'next/server'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Verify session from fs-at cookie or Authorization header. Returns user id or null. */
export async function getSessionUserId(request: NextRequest): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const token = request.cookies.get('fs-at')?.value || bearer
  if (!token) return null
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id || null
  } catch {
    return null
  }
}

/** Quick auth guard — returns 401 Response if not authenticated, null if OK */
export async function requireAuth(request: NextRequest): Promise<Response | null> {
  const userId = await getSessionUserId(request)
  if (!userId) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  return null
}
