import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolve } from 'path'

function loadEnvLocal() {
  const paths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../.env.local'),
  ]
  for (const p of paths) {
    try {
      const content = readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (key && !process.env[key]) process.env[key] = val
      }
      return p
    } catch { /* try next path */ }
  }
  throw new Error('No .env.local found. Run from dashboard-app/ or its parent.')
}

let _client: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (_client) return _client
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local')
  }
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}
