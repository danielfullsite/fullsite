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

  const publicPages = ['/login', '/seguridad', '/privacidad', '/terminos', '/demo', '/reservar']
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

  const splashScreen = (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="text-center">
        <div className="mb-8 animate-[fadeIn_0.5s_ease-out]">
          <span className="text-white font-black text-5xl tracking-tight">
            fullsite
            <span className="inline-block w-4 h-4 bg-emerald-400 ml-1 mb-1 rounded-none" />
          </span>
        </div>
        <div className="w-48 mx-auto">
          <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
            <div className="h-1 rounded-full bg-emerald-400 animate-[loading_1.5s_ease-in-out_infinite]" />
          </div>
        </div>
        <style>{`
          @keyframes loading {
            0% { width: 0%; }
            50% { width: 70%; }
            100% { width: 100%; }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  )

  // POS pages: full screen, dark theme, no sidebar
  if (isPosRoute) {
    if (!showContent && loading) return splashScreen
    return <main className="min-h-screen bg-[var(--surface)]">{children}</main>
  }

  // Public pages (login, privacy, etc.)
  if (isPublicPage) {
    return <>{children}</>
  }

  if (!showContent && loading) return splashScreen

  return (
    <div className="grid lg:grid-cols-[240px_1fr] min-h-screen bg-[var(--bg)]">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className="lg:hidden">
        <Sidebar />
      </div>
      <main className="min-h-screen overflow-auto lg:pt-0" style={{ paddingTop: 'max(3.5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))' }}>
        <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
          <PageTransition key={pathname}>
            {children}
          </PageTransition>
        </div>
      </main>
      <ChatWidget />
    </div>
  )
}
