'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

// /demo redirects to:
// - /demo/dashboard if already logged in as demo user
// - /login if not logged in

export default function DemoRedirect() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (user?.user_metadata?.client_id === 'demo') {
      router.replace('/demo/dashboard')
    } else {
      router.replace('/login')
    }
  }, [user, loading, router])

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
