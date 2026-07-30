import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Single client instance — used by both data queries and auth
let _client: ReturnType<typeof createClient> | null = null

export function getSupabase() {
  if (!_client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
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
    _client = createClient(supabaseUrl, supabaseAnonKey, {
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
