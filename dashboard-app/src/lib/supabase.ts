import { createClient } from '@supabase/supabase-js'

// SOLO RAMA DE PREVIEW (redesign/ds-v2.2) — NO MERGEAR A MAIN.
// El entorno Preview de Vercel no inyecta las NEXT_PUBLIC_* al build, y estas vars
// se incrustan en el bundle del browser en tiempo de build (no en runtime). Para que
// el preview del rediseño conecte al AMALAY real sin depender de la config de env de
// Vercel, usamos como fallback la URL + anon key PÚBLICA (la misma que prod ya sirve
// en el bundle de app.fullsite.mx a cualquier browser; los datos los protege RLS).
// En prod/main las env vars SÍ existen → el fallback nunca se usa.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qjiomlvudfmzuvqvhwpk.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqaW9tbHZ1ZGZtenV2cXZod3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODQ5MTUsImV4cCI6MjA5MTM2MDkxNX0', 'nv1ctxRJbc8kzD5gPypoxZ4uLtxOX61Me2ype5GBXyU'].join('.')

// Single client instance — used by both data queries and auth
let _client: ReturnType<typeof createClient> | null = null

export function getSupabase() {
  if (!_client) {
    let url = supabaseUrl
    let key = supabaseAnonKey
    if (!url || !key) {
      // Durante `next build` (prerender de páginas estáticas como /_not-found) las
      // env vars públicas pueden no estar inyectadas — no tumbar el build por eso.
      // En runtime real (server o browser) SÍ exigimos las vars: config faltante
      // debe fallar ruidoso, no correr con un cliente muerto.
      const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'
      if (isBuildPhase) {
        url = 'https://placeholder.supabase.co'
        key = 'placeholder-anon-key-build-only'
      } else {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
      }
    }
    // Wrap fetch with a 4s timeout so ALL Supabase calls (auth refresh,
    // REST, realtime handshake) abort quickly when the network cable is
    // physically disconnected — prevents Electron renderer freeze.
    const fetchWithTimeout: typeof fetch = (input, init) => {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 4000)
      // Merge with any existing signal from the caller
      const signal = (init?.signal)
        ? (() => {
            // Abort if EITHER our timeout OR the caller's signal fires
            const merged = new AbortController()
            const done = () => merged.abort()
            ctrl.signal.addEventListener('abort', done, { once: true })
            init.signal.addEventListener('abort', done, { once: true })
            return merged.signal
          })()
        : ctrl.signal
      return fetch(input, { ...init, signal }).finally(() => clearTimeout(tid))
    }
    _client = createClient(url, key, {
      global: { fetch: fetchWithTimeout },
    })
  }
  return _client
}

// Lazy export — doesn't crash at import time when env vars are missing (CI/tests)
let _supabase: ReturnType<typeof createClient> | null = null
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop) {
    if (!_supabase) _supabase = getSupabase()
    return (_supabase as any)[prop]
  }
})

// Server-side client with service role key
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )
}
