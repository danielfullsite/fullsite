'use client'

import { useEffect } from 'react'
import { patchSupabaseFetch } from '@/lib/supabase-fetch-patch'

export default function SupabasePatch() {
  useEffect(() => {
    patchSupabaseFetch()
  }, [])
  return null
}
