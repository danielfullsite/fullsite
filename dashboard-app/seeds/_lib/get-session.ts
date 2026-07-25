/**
 * Helper: sign in with demo credentials and return a valid Supabase session
 * for injection into Playwright's browser localStorage.
 */
import { getAdminClient } from './supabase.ts'

export async function getDemoSession() {
  // Use the admin client's createClient with anon key to sign in
  // (admin client uses service key, can't use for auth.signIn — need anon client)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'demo@fullsite.mx',
      password: 'fullsite2026!',
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Auth failed: ${res.status} ${err}`)
  }

  const session = await res.json()
  // Extract project ref from URL: https://PROJECTREF.supabase.co
  const projectRef = url.replace('https://', '').split('.')[0]

  return { session, projectRef, anonKey }
}
