'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Utensils, TrendingUp, Users, Receipt, ChefHat,
  BarChart3, MessageSquare, LogOut,
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/demo/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/demo/pos', icon: Utensils, label: 'POS' },
]

const NAV_COMING = [
  { icon: TrendingUp, label: 'Tendencias' },
  { icon: Users, label: 'Meseros' },
  { icon: Receipt, label: 'Reportes' },
  { icon: ChefHat, label: 'Menú' },
  { icon: BarChart3, label: 'Ventas' },
  { icon: MessageSquare, label: 'Chat IA' },
]

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Login page — no sidebar
  if (pathname === '/demo') {
    return <>{children}</>
  }

  // POS page — full screen, no sidebar
  if (pathname === '/demo/pos') {
    return <>{children}</>
  }

  return (
    <div className="grid lg:grid-cols-[240px_1fr] min-h-screen bg-[#0a0a0c]">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col bg-[#0d0d10] border-r border-white/5 p-4">
        <div className="mb-8">
          <span className="text-white font-black text-xl tracking-tight">
            fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
          </span>
          <p className="text-zinc-600 text-xs mt-0.5">Casa Montaña</p>
        </div>

        <nav className="space-y-1 flex-1">
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-zinc-500 hover:text-white hover:bg-white/5'
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            )
          })}

          <div className="pt-4 mt-4 border-t border-white/5">
            <p className="text-zinc-600 text-xs font-medium uppercase tracking-wider px-3 mb-2">Próximamente</p>
            {NAV_COMING.map(item => (
              <div
                key={item.label}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-700 cursor-default"
              >
                <item.icon size={18} />
                {item.label}
                <span className="ml-auto text-[10px] bg-white/5 text-zinc-600 px-1.5 py-0.5 rounded">soon</span>
              </div>
            ))}
          </div>
        </nav>

        {/* CTA + logout */}
        <div className="space-y-2 pt-4 border-t border-white/5">
          <a
            href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20vi%20el%20demo%20de%20Fullsite%20y%20me%20interesa."
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-500 text-white text-sm font-bold rounded-lg hover:bg-emerald-600 transition-colors"
          >
            Quiero esto para mi restaurante
          </a>
          <Link
            href="/demo"
            className="flex items-center gap-2 px-3 py-2 text-zinc-600 text-sm hover:text-zinc-400 transition-colors"
          >
            <LogOut size={16} />
            Salir del demo
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-h-screen overflow-auto">
        {children}
      </main>
    </div>
  )
}
