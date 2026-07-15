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

const CLIENT_ID_RE = /^[a-z0-9_-]{1,40}$/i

/** Extract and validate client_id from request header, query param, or body. Falls back to 'amalay'. */
export function getClientId(request: NextRequest): string {
  const fromHeader = request.headers.get('x-client-id')
  if (fromHeader && CLIENT_ID_RE.test(fromHeader)) return fromHeader
  const fromParam = request.nextUrl.searchParams.get('client_id')
  if (fromParam && CLIENT_ID_RE.test(fromParam)) return fromParam
  return 'amalay'
}
