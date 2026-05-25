'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  UtensilsCrossed,
  TrendingUp,
  MessageCircle,
  Menu,
  X,
  DollarSign,
  ClipboardList,
  Package,
  FileBarChart,
  LogOut,
  Calendar,
  HandCoins,
  Banknote,
  FileSpreadsheet,
  UserCheck,
  ShoppingCart,
  Monitor,
  Settings,
  Sparkles,
  PieChart,
  Truck,
  Bot,
  Stamp,
  Bell,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessPage } from '@/contexts/AuthContext'
import ThemeToggle from '@/components/ThemeToggle'

const navSections = [
  {
    label: 'Principal',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/ventas', label: 'Ventas', icon: DollarSign },
      { href: '/cortes', label: 'Cortes', icon: ClipboardList },
    ],
  },
  {
    label: 'Reportes',
    items: [
      { href: '/meseros', label: 'Meseros', icon: Users },
      { href: '/platillos', label: 'Platillos', icon: UtensilsCrossed },
      { href: '/tendencias', label: 'Tendencias', icon: TrendingUp },
      { href: '/propinas', label: 'Propinas', icon: HandCoins },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/ingresos', label: 'Ingresos', icon: Banknote },
      { href: '/estado-resultados', label: 'Estado de Resultados', icon: FileSpreadsheet },
      { href: '/nomina', label: 'Nomina', icon: UserCheck },
      { href: '/pos/facturacion', label: 'Facturacion CFDI', icon: Stamp },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { href: '/inventario', label: 'Inventario', icon: Package },
      { href: '/food-cost', label: 'Food Cost', icon: PieChart },
      { href: '/proveedores', label: 'Proveedores', icon: Truck },
      { href: '/ecommerce', label: 'eCommerce', icon: ShoppingCart },
      { href: '/reportes', label: 'Reportes', icon: FileBarChart },
    ],
  },
  {
    label: 'POS',
    items: [
      { href: '/pos', label: 'Punto de Venta', icon: Monitor },
    ],
  },
  {
    label: 'POS Restaurante',
    items: [
      { href: '/admin/menu', label: 'Platillos', icon: UtensilsCrossed },
      { href: '/admin/grupos', label: 'Grupos', icon: Package },
      { href: '/admin/modificadores', label: 'Modificadores', icon: Settings },
      { href: '/admin/horarios', label: 'Horarios', icon: Calendar },
      { href: '/admin/tamaños', label: 'Tamaños', icon: Settings },
      { href: '/admin/promociones', label: 'Promociones', icon: Sparkles },
      { href: '/admin/formas-pago', label: 'Formas de Pago', icon: Banknote },
      { href: '/admin/domicilio', label: 'Domicilio', icon: Truck },
      { href: '/admin/tarjetas-regalo', label: 'Tarjetas de Regalo', icon: ShoppingCart },
    ],
  },
  {
    label: 'POS Tienda',
    items: [
      { href: '/admin/tienda/articulos', label: 'Artículos', icon: Package },
      { href: '/admin/tienda/grupos', label: 'Grupos', icon: Settings },
      { href: '/admin/tienda/precios', label: 'Tipos de Precio', icon: DollarSign },
      { href: '/admin/tienda/promociones', label: 'Promociones', icon: Sparkles },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      { href: '/agentes', label: 'Agentes IA', icon: Bot },
      { href: '/coach', label: 'Coach', icon: Sparkles },
      { href: '/chat', label: 'Chat IA', icon: MessageCircle },
    ],
  },
]

function getTodayFormatted(): string {
  return new Date().toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, role, clientConfig, signOut } = useAuth()

  const sidebarContent = (
    <aside className="flex flex-col h-screen sticky top-0 w-full border-r border-[var(--line)]" style={{ background: 'var(--surface)' }}>
      {/* Logo — safe-pt for standalone PWA mode */}
      <div className="px-5 py-5 border-b border-[var(--line-soft)] safe-pt">
        <Link href="/" className="flex items-center logo-hover">
          <span className="text-[var(--text-1)] font-black text-xl tracking-tight">
            fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
          </span>
        </Link>
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {navSections.map((section) => {
          const visibleItems = section.items.filter(item => canAccessPage(role, item.href))
          if (visibleItems.length === 0) return null
          return (
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href))
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-[var(--line-soft)]">
        {/* Date + Theme toggle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
            <Calendar size={12} />
            <span className="font-medium">{getTodayFormatted()}</span>
          </div>
          <ThemeToggle />
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2 mb-2">
          <div className="pulse-dot" />
          <span className="text-xs text-[var(--text-3)] font-medium">Conectado</span>
        </div>

        {/* Client name */}
        {clientConfig && (
          <p className="text-[11px] text-[var(--text-4)] mb-3 truncate">
            {clientConfig.name || clientConfig.id}
          </p>
        )}

        {/* Logout */}
        {user && (
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-xs text-[var(--text-3)] hover:text-red-500 transition-colors w-full px-2 py-1.5 rounded-md hover:bg-red-500/10"
          >
            <LogOut size={14} />
            <span>Cerrar sesion</span>
          </button>
        )}
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg shadow-md border border-[var(--line)]"
        style={{ background: 'var(--surface)', color: 'var(--text-1)' }}
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop sidebar — static in flex layout */}
      <div className="hidden lg:flex flex-shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile sidebar — slide in */}
      <div
        className={`lg:hidden fixed top-0 left-0 h-full z-40 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  )
}
