'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import ChatWidget from '@/components/ChatWidget'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'

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

  // Page title map
  const pageTitles: Record<string, string> = {
    '/': 'Dashboard',
    '/ventas': 'Ventas',
    '/cortes': 'Cortes',
    '/meseros': 'Meseros',
    '/platillos': 'Platillos',
    '/tendencias': 'Tendencias',
    '/reportes': 'Reportes',
    '/inventario': 'Inventario',
    '/chat': 'Chat IA',
  }

  const pageTitle = pageTitles[pathname] || 'Dashboard'

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-h-screen min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-slate-100">
          <div className="flex items-center justify-between px-6 lg:px-8 h-14">
            {/* Left: page title */}
            <div className="flex items-center gap-2 ml-12 lg:ml-0">
              <h1 className="text-sm font-semibold text-slate-900">{pageTitle}</h1>
            </div>

            {/* Center: search */}
            <div className="hidden md:flex items-center flex-1 max-w-md mx-8">
              <div className="relative w-full">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                  readOnly
                />
              </div>
            </div>

            {/* Right: status */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                <div className="pulse-dot" />
                <span className="font-medium">En vivo</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
      <ChatWidget />
    </div>
  )
}
