'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import TopNav from '@/components/TopNav'
import ChatWidget from '@/components/ChatWidget'
import { useEffect, useState } from 'react'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [showContent, setShowContent] = useState(false)

  // Force show after 2 seconds max
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 2000)
    return () => clearTimeout(timer)
  }, [])

  const publicPages = ['/login', '/seguridad', '/privacidad', '/terminos']
  const isPublicPage = publicPages.includes(pathname)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading) {
      if (!user && !isPublicPage) {
        router.push('/login')
      } else {
        setShowContent(true)
      }
    }
  }, [loading, user, pathname, router, isPublicPage])

  // Public pages — no nav chrome
  if (isPublicPage) {
    return <>{children}</>
  }

  // Loading state
  if (!showContent && loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-soft text-sm font-medium">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <TopNav />
      <main className="p-6 lg:p-8 max-w-7xl mx-auto">
        {children}
      </main>
      <ChatWidget />
    </>
  )
}
