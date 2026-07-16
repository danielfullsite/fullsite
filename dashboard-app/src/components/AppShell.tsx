'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import ChatWidget from '@/components/ChatWidget'
import NotificationBell from '@/components/NotificationBell'
import { PageTransition } from '@/components/motion'
import { useEffect, useState } from 'react'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 2000)
    return () => clearTimeout(timer)
  }, [])

  // Build offline empaquetado (terminales POS): arrancar directo en /pos.
  // El gate de PIN del POS funciona sin internet; el login de Supabase no.
  const isOfflineBuild = process.env.NEXT_PUBLIC_CAPACITOR_OFFLINE === '1'
  useEffect(() => {
    if (isOfflineBuild && pathname === '/') {
      router.replace('/pos')
    }
  }, [isOfflineBuild, pathname, router])

  const publicPages = ['/login', '/seguridad', '/privacidad', '/terminos', '/reservar', '/factura', '/demo-live', '/cocina', '/barra']
  const isPosRoute = pathname.startsWith('/pos')
  const isKdsRoute = pathname.startsWith('/cocina') || pathname.startsWith('/barra')
  const isDemoRoute = pathname.startsWith('/demo')
  const isPublicPage = publicPages.includes(pathname) || isPosRoute || isKdsRoute || isDemoRoute

  // Demo user: always redirect to /demo/* world
  const isDemoUser = user?.user_metadata?.client_id === 'demo'

  useEffect(() => {
    if (!loading) {
      if (!user && !isPublicPage) {
        // En build offline no hay login de Supabase: todo va al POS (gate de PIN propio)
        router.push(isOfflineBuild ? '/pos' : '/login')
      } else if (isDemoUser && !isDemoRoute) {
        // Demo user trying to access real dashboard → redirect to demo
        router.push('/demo/dashboard')
      } else {
        setShowContent(true)
      }
    }
  }, [loading, user, pathname, router, isPublicPage, isDemoUser, isDemoRoute, isOfflineBuild])

  // POS pages: full screen, dark theme, no sidebar
  if (isPosRoute) {
    if (!showContent && loading) {
      return (
        <div className="flex items-center justify-center h-screen bg-[var(--bg)]">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[var(--text-3)] text-sm">Cargando POS...</p>
          </div>
        </div>
      )
    }
    return <main className="min-h-screen bg-[var(--surface)]">{children}</main>
  }

  // Public pages (login, privacy, etc.)
  if (isPublicPage) {
    return <>{children}</>
  }

  if (!showContent && loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg)]">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[var(--text-3)] text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[240px_1fr] min-h-screen bg-[var(--bg)] overflow-x-hidden">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className="lg:hidden">
        <Sidebar />
      </div>
      <main className="min-h-screen overflow-x-hidden overflow-y-auto lg:pt-0 relative min-w-0" style={{ paddingTop: 'max(3.5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))' }}>
        {/* Notification bell — top right */}
        <div className="absolute right-4 lg:right-8 z-30 hidden lg:block" style={{ top: '1.25rem' }}>
          <NotificationBell />
        </div>
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto min-w-0">
          <PageTransition key={pathname}>
            {children}
          </PageTransition>
        </div>
      </main>
      <ChatWidget />
    </div>
  )
}
