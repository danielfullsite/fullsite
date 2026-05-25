'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  UtensilsCrossed,
  TrendingUp,
  MessageCircle,
  Calendar,
  LogOut,
  DollarSign,
  ClipboardList,
  Package,
  FileBarChart,
  Bell,
  BellOff,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useState, useEffect } from 'react'
import { isPushSupported, getPushPermission, subscribeToPush, unsubscribeFromPush, getExistingSubscription } from '@/lib/push-notifications'
import ThemeToggle from '@/components/ThemeToggle'

const mainNavItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ventas', label: 'Ventas', icon: DollarSign },
  { href: '/cortes', label: 'Cortes', icon: ClipboardList },
  { href: '/meseros', label: 'Meseros', icon: Users },
  { href: '/platillos', label: 'Platillos', icon: UtensilsCrossed },
]

const secondaryNavItems = [
  { href: '/tendencias', label: 'Tendencias', icon: TrendingUp },
  { href: '/reportes', label: 'Reportes', icon: FileBarChart },
  { href: '/inventario', label: 'Inventario', icon: Package },
  { href: '/chat', label: 'Chat IA', icon: MessageCircle },
]

function getTodayFormatted(): string {
  return new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function TopNav() {
  const pathname = usePathname()
  const { user, clientConfig, signOut } = useAuth()
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushSupported, setPushSupported] = useState(false)

  useEffect(() => {
    if (isPushSupported()) {
      setPushSupported(true)
      getExistingSubscription().then(sub => setPushEnabled(!!sub))
    }
  }, [])

  const togglePush = async () => {
    if (pushEnabled) {
      await unsubscribeFromPush()
      setPushEnabled(false)
    } else {
      const sub = await subscribeToPush()
      setPushEnabled(!!sub)
    }
  }

  const renderNavItem = (item: { href: string; label: string; icon: typeof LayoutDashboard }) => {
    const isActive =
      pathname === item.href ||
      (item.href !== '/' && pathname.startsWith(item.href))
    const Icon = item.icon
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap
          rounded-md transition-all duration-150 relative
          ${
            isActive
              ? 'bg-blue-50 text-blue-600 nav-active-dot'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }
        `}
      >
        <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
        <span className="hidden sm:inline">{item.label}</span>
      </Link>
    )
  }

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl border-b border-[var(--line)]" style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-14 justify-between">
        <div className="flex items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0 mr-6 logo-hover">
            <span className="text-[var(--text-1)] font-black text-xl tracking-tight">
              fullsite<span className="logo-dot inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </Link>

          {/* Nav tabs */}
          <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            {mainNavItems.map(renderNavItem)}

            {/* Separator */}
            <div className="w-px h-5 bg-slate-200 mx-1.5 shrink-0" />

            {secondaryNavItems.map(renderNavItem)}
          </nav>
        </div>

        {/* Right side: date + user info + logout */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Date indicator with live pulse */}
          <div className="hidden md:flex items-center gap-2 text-xs text-[var(--text-3)] bg-[var(--surface-2)] px-2.5 py-1.5 rounded-md border border-[var(--line-soft)]">
            <div className="pulse-dot" />
            <Calendar size={12} />
            <span className="font-medium">{getTodayFormatted()}</span>
          </div>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Push notification toggle */}
          {pushSupported && (
            <button
              onClick={togglePush}
              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors ${
                pushEnabled
                  ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
              title={pushEnabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}
            >
              {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
            </button>
          )}

          {user && (
            <>
              {/* Client name badge */}
              {clientConfig && (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md bg-slate-50 text-xs font-medium text-slate-500 border border-slate-200/80">
                  {clientConfig.name || clientConfig.id}
                </span>
              )}

              {/* Logout button */}
              <button
                onClick={signOut}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-md hover:bg-red-50"
                title="Cerrar sesión"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Salir</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
