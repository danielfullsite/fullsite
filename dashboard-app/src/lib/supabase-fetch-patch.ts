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
    // RPC público (menú QR) no se toca — usa la anon key contra get_public_menu().
    if (url.includes(SUPABASE_URL) && url.includes('/rest/v1/') && !url.includes('/rest/v1/rpc/')) {
      const headers = new Headers(init?.headers)
      const currentAuth = headers.get('Authorization')

      // ¿Hay sesión de Supabase? (dashboard: dueño/gerente)
      let sessionJwt: string | null = null
      try {
        const hostname = new URL(SUPABASE_URL).hostname.split('.')[0]
        const stored = localStorage.getItem(`sb-${hostname}-auth-token`)
        if (stored) sessionJwt = JSON.parse(stored)?.access_token || null
      } catch {}

      // Terminal POS: shiftToken pero SIN sesión de Supabase → rutea por el proxy
      // autenticado /api/pos/db (Fase B anti-hack). El shiftToken no es JWT de
      // Supabase, así que las tablas (con RLS cerrado) solo se alcanzan por aquí.
      const shiftToken = (() => { try { return localStorage.getItem('pos_shift_token') } catch { return null } })()
      if (!sessionJwt && shiftToken && currentAuth === `Bearer ${SUPABASE_KEY}`) {
        const restPath = url.split('/rest/v1/')[1] || ''
        const proxyUrl = `/api/pos/db?path=${encodeURIComponent(restPath)}`
        const proxyHeaders = new Headers(init?.headers)
        proxyHeaders.set('Authorization', `Bearer ${shiftToken}`)
        proxyHeaders.delete('apikey')
        return originalFetch(proxyUrl, { ...init, headers: proxyHeaders })
      }

      // Dashboard: si usa la anon key y hay sesión, sube al JWT del usuario.
      if (currentAuth === `Bearer ${SUPABASE_KEY}` && sessionJwt) {
        headers.set('Authorization', `Bearer ${sessionJwt}`)
      }

      return originalFetch(input, { ...init, headers })
    }

    // FUGA CERRADA (2026-08-30): withPOSAuth ya no ADIVINA el tenant de un
    // usuario con varias membresías — exige el header `x-fullsite-tenant`
    // (validado contra client_users en el server; sin membresía → 401).
    // Se inyecta aquí, en el choke point, para que TODO fetch same-origin a
    // /api/ lo lleve — llamadores presentes y futuros — con el tenant activo
    // que el usuario está VIENDO (getActiveClientSlug). Sin tenant activo no
    // se manda nada y el server aplica su default de una-sola-membresía.
    if ((url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)) ) {
      try {
        const cid = localStorage.getItem('fullsite_client_id')?.toLowerCase().trim()
        if (cid) {
          const headers = new Headers(init?.headers)
          if (!headers.has('x-fullsite-tenant')) headers.set('x-fullsite-tenant', cid)
          return originalFetch(input, { ...init, headers })
        }
      } catch { /* storage bloqueado → sin header, el server decide fail-closed */ }
    }

    return originalFetch(input, init)
  }
}
