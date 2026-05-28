/**
 * Authenticated Supabase REST API helper for admin pages.
 * Uses the logged-in user's JWT token instead of bare anon key.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getAuthToken(): string {
  if (typeof window === 'undefined') return SUPABASE_KEY
  try {
    const hostname = new URL(SUPABASE_URL).hostname.split('.')[0]
    const stored = localStorage.getItem(`sb-${hostname}-auth-token`)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.access_token) return parsed.access_token
    }
  } catch {}
  return SUPABASE_KEY
}

export async function sbApi(path: string, opts?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json',
      Prefer: opts?.method === 'GET' || !opts?.method ? 'return=representation' : 'return=representation',
      ...opts?.headers,
    },
  })
  return res.ok ? res.json() : []
}
