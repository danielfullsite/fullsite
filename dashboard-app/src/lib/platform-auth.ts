import { NextRequest } from 'next/server'

// Auth de admin de plataforma (god-mode cross-tenant). Reusa el patrón de
// api/platform/overview: sesión válida + email en PLATFORM_ADMIN_EMAILS.
// Falla cerrada — sin token o sin allowlist → null.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function bearerToken(request: NextRequest) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.cookies.get('fs-at')?.value || ''
}

function platformAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Devuelve el email si el request es de un admin de plataforma; null si no. */
export async function requirePlatformAdmin(request: NextRequest): Promise<string | null> {
  const token = bearerToken(request)
  if (!token || !SB_URL || !SB_ANON) return null
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null)
  if (!res?.ok) return null
  const user = (await res.json().catch(() => null)) as { email?: string } | null
  const email = user?.email?.toLowerCase()
  if (!email) return null
  return platformAdminEmails().has(email) ? email : null
}
