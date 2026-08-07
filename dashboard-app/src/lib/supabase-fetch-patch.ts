'use client'

/**
 * Patches global fetch to automatically inject the user's auth token
 * for any request to Supabase REST API. This fixes RLS issues where
 * admin pages use bare anon key instead of authenticated JWT.
 *
 * Import this once in the root layout to apply globally.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

let patched = false

export function patchSupabaseFetch() {
  if (patched || typeof window === 'undefined') return
  patched = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url

    // BUG-019: tenant isolation is enforced at the DB with RLS scoped to the
    // authenticated user's client_users membership. The bare anon key is no
    // longer allowed on POS tables, so EVERY direct Supabase REST call (dashboard
    // AND POS) must carry the device's session JWT. We inject it here for any
    // request that still uses the bare anon key as Bearer.
    //
    // Public QR pages (/menu/[mesa]) have NO session and must NOT hit POS tables
    // directly — they use the get_public_menu() RPC (granted to anon). Those
    // calls target /rest/v1/rpc/get_public_menu and keep the anon key.
    if (url.includes(SUPABASE_URL) && url.includes('/rest/v1/')) {
      const headers = new Headers(init?.headers)
      const currentAuth = headers.get('Authorization')

      // If using the bare anon key AND a session exists, upgrade to the user JWT.
      if (currentAuth === `Bearer ${SUPABASE_KEY}`) {
        try {
          const hostname = new URL(SUPABASE_URL).hostname.split('.')[0]
          const stored = localStorage.getItem(`sb-${hostname}-auth-token`)
          if (stored) {
            const parsed = JSON.parse(stored)
            if (parsed.access_token) {
              headers.set('Authorization', `Bearer ${parsed.access_token}`)
            }
          }
        } catch {}
      }

      return originalFetch(input, { ...init, headers })
    }

    return originalFetch(input, init)
  }
}
