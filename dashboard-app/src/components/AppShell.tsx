'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import TopNav from '@/components/TopNav'
import ChatWidget from '@/components/ChatWidget'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { loading } = useAuth()

  // Login page gets no chrome
  if (pathname === '/login') {
    return <>{children}</>
  }

  // Show loading spinner while auth is initializing
  if (loading) {
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
