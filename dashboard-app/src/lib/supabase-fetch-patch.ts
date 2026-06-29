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

    // Only patch Supabase REST API calls — but NOT from POS pages.
    // POS uses anon key with RLS policies for anon role. Replacing it
    // with a user JWT that may be expired causes 401 errors (AUTH-01).
    const isPosPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/pos')
    if (!isPosPage && url.includes(SUPABASE_URL) && url.includes('/rest/v1/')) {
      const headers = new Headers(init?.headers)
      const currentAuth = headers.get('Authorization')

      // If using bare anon key, replace with user's JWT (dashboard pages only)
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
