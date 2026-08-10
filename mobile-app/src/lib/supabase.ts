// Supabase client for React Native
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
export const CLIENT_ID = process.env.EXPO_PUBLIC_CLIENT_ID

if (!SUPABASE_URL || !SUPABASE_KEY || !CLIENT_ID) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_CLIENT_ID are required',
  )
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
