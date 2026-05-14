import { getSupabase } from './supabase'

// Re-export the same singleton — no duplicate GoTrueClient
export function createClient() {
  return getSupabase()
}
