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
} from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/meseros', label: 'Meseros', icon: Users },
  { href: '/platillos', label: 'Platillos', icon: UtensilsCrossed },
  { href: '/tendencias', label: 'Tendencias', icon: TrendingUp },
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

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-14 justify-between">
        <div className="flex items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0 mr-8">
            <span className="text-[#1a1a1a] font-black text-xl tracking-tight">
              fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </Link>

          {/* Nav tabs */}
          <nav className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide -mb-px">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href))
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap
                    border-b-2 transition-all duration-150 rounded-t-md
                    ${
                      isActive
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-soft hover:text-text hover:bg-surface/80'
                    }
                  `}
                >
                  <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Date indicator */}
        <div className="hidden md:flex items-center gap-2 text-xs text-text-soft shrink-0">
          <Calendar size={13} className="text-text-muted" />
          <span className="font-medium">Hoy: {getTodayFormatted()}</span>
        </div>
      </div>
    </header>
  )
}
