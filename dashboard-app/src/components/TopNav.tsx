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
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

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
          rounded-md transition-all duration-150
          ${
            isActive
              ? 'bg-blue-50 text-blue-600'
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
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-14 justify-between">
        <div className="flex items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0 mr-6">
            <span className="text-[#1a1a1a] font-black text-xl tracking-tight">
              fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
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
          {/* Date indicator */}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 px-2.5 py-1.5 rounded-md">
            <Calendar size={12} />
            <span className="font-medium">{getTodayFormatted()}</span>
          </div>

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
                title="Cerrar sesion"
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
