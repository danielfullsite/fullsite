'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import ChatWidget from '@/components/ChatWidget'
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

  const publicPages = ['/login', '/seguridad', '/privacidad', '/terminos', '/demo']
  const isPosRoute = pathname.startsWith('/pos')
  const isPublicPage = publicPages.includes(pathname) || isPosRoute

  useEffect(() => {
    if (!loading) {
      if (!user && !isPublicPage) {
        router.push('/login')
      } else {
        setShowContent(true)
      }
    }
  }, [loading, user, pathname, router, isPublicPage])

  // POS pages: full screen, dark theme, no sidebar — check FIRST
  const isPosPage = isPosRoute
  if (isPosPage) {
    if (!showContent && loading) {
      return (
        <div className="flex items-center justify-center h-screen bg-slate-900">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Cargando POS...</p>
          </div>
        </div>
      )
    }
    return <main className="min-h-screen bg-slate-900">{children}</main>
  }

  // Other public pages (login, privacy, etc.)
  if (isPublicPage) {
    return <>{children}</>
  }

  if (!showContent && loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[240px_1fr] min-h-screen">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className="lg:hidden">
        <Sidebar />
      </div>
      <main className="min-h-screen overflow-auto pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8">
          <PageTransition key={pathname}>
            {children}
          </PageTransition>
        </div>
      </main>
      <ChatWidget />
    </div>
  )
}
