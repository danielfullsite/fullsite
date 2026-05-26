'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Building2, DollarSign, Receipt, Users, Utensils,
  TrendingUp, HandCoins, Wallet, FileSpreadsheet, UserCog, Stamp,
  Package, PieChart, Truck, ShoppingCart, BarChart3, Monitor, ChefHat,
  Settings, Calendar, Ruler, Sparkles, CreditCard, Home, Tag, Layers,
  Bot, Star, GraduationCap, MessageSquare, LogOut, Sun, ChevronLeft,
  ChevronRight, Wifi,
} from 'lucide-react'

interface NavItem {
  href?: string
  icon: React.ElementType
  label: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'PRINCIPAL',
    items: [
      { href: '/demo/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/demo/sucursales', icon: Building2, label: 'Sucursales' },
      { href: '/demo/ventas', icon: DollarSign, label: 'Ventas' },
      { href: '/demo/cortes', icon: Receipt, label: 'Cortes' },
    ],
  },
  {
    title: 'REPORTES',
    items: [
      { href: '/demo/meseros', icon: Users, label: 'Meseros' },
      { href: '/demo/platillos', icon: Utensils, label: 'Platillos' },
      { href: '/demo/tendencias', icon: TrendingUp, label: 'Tendencias' },
      { href: '/demo/propinas', icon: HandCoins, label: 'Propinas' },
    ],
  },
  {
    title: 'FINANZAS',
    items: [
      { href: '/demo/ingresos', icon: Wallet, label: 'Ingresos' },
      { href: '/demo/estado-resultados', icon: FileSpreadsheet, label: 'Estado de Resultados' },
      { href: '/demo/nomina', icon: UserCog, label: 'Nómina' },
      { href: '/demo/facturacion', icon: Stamp, label: 'Facturación CFDI' },
    ],
  },
  {
    title: 'OPERACIONES',
    items: [
      { href: '/demo/inventario', icon: Package, label: 'Inventario' },
      { href: '/demo/food-cost', icon: PieChart, label: 'Food Cost' },
      { href: '/demo/proveedores', icon: Truck, label: 'Proveedores' },
      { href: '/demo/ecommerce', icon: ShoppingCart, label: 'eCommerce' },
      { href: '/demo/reportes', icon: BarChart3, label: 'Reportes' },
    ],
  },
  {
    title: 'POS',
    items: [
      { href: '/demo/pos', icon: Monitor, label: 'Punto de Venta' },
    ],
  },
  {
    title: 'POS RESTAURANTE',
    items: [
      { href: '/demo/pos-platillos', icon: Utensils, label: 'Platillos' },
      { href: '/demo/pos-grupos', icon: Layers, label: 'Grupos' },
      { href: '/demo/pos-modificadores', icon: Settings, label: 'Modificadores' },
      { href: '/demo/pos-horarios', icon: Calendar, label: 'Horarios' },
      { href: '/demo/pos-tamanos', icon: Ruler, label: 'Tamaños' },
      { href: '/demo/pos-promociones', icon: Sparkles, label: 'Promociones' },
      { href: '/demo/pos-pagos', icon: CreditCard, label: 'Formas de Pago' },
    ],
  },
  {
    title: 'POS TIENDA',
    items: [
      { href: '/demo/tienda-articulos', icon: Tag, label: 'Artículos' },
      { href: '/demo/tienda-grupos', icon: Layers, label: 'Grupos' },
      { href: '/demo/tienda-precios', icon: DollarSign, label: 'Tipos de Precio' },
      { href: '/demo/tienda-promos', icon: Sparkles, label: 'Promociones' },
    ],
  },
  {
    title: 'DELIVERY',
    items: [
      { href: '/demo/domicilio', icon: Home, label: 'Domicilio' },
      { href: '/demo/gift-cards', icon: Tag, label: 'Tarjetas de Regalo' },
    ],
  },
  {
    title: 'HERRAMIENTAS',
    items: [
      { href: '/demo/agentes', icon: Bot, label: 'Agentes IA' },
      { href: '/demo/resenas', icon: Star, label: 'Reseñas' },
      { href: '/demo/coach', icon: GraduationCap, label: 'Coach' },
      { href: '/demo/chat', icon: MessageSquare, label: 'Chat IA' },
    ],
  },
]

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Login page — no sidebar
  if (pathname === '/demo') return <>{children}</>

  // POS page — full screen
  if (pathname === '/demo/pos') return <>{children}</>

  const sidebarWidth = collapsed ? '64px' : '250px'

  return (
    <div className="flex min-h-screen bg-[#0a0a0c]" style={{ '--sidebar-w': sidebarWidth } as React.CSSProperties}>
      {/* Sidebar */}
      <aside className={`hidden lg:flex flex-col bg-[#0d0d10] border-r border-white/5 flex-shrink-0 overflow-y-auto overflow-x-hidden transition-all duration-200`} style={{ width: sidebarWidth }}>
        {/* Logo */}
        <div className="px-4 py-5 flex items-center justify-between flex-shrink-0">
          {!collapsed && (
            <div>
              <span className="text-white font-black text-xl tracking-tight">
                fullsite<span className="inline-block w-1.5 h-1.5 bg-emerald-500 ml-0.5 mb-0.5" />
              </span>
            </div>
          )}
          {collapsed && <span className="text-white font-black text-lg mx-auto">f<span className="text-emerald-500">.</span></span>}
        </div>

        {/* Nav sections */}
        <nav className="flex-1 px-2 pb-4">
          {NAV.map(section => (
            <div key={section.title} className="mb-3">
              {!collapsed && (
                <p className="text-zinc-600 text-[10px] font-semibold uppercase tracking-wider px-3 mb-1.5">{section.title}</p>
              )}
              {collapsed && <div className="border-t border-white/5 my-2" />}
              {section.items.map(item => {
                const active = item.href ? pathname === item.href || pathname.startsWith(item.href + '/') : false
                const Comp = item.href ? Link : 'div'
                return (
                  <Comp
                    key={item.label}
                    href={item.href || '#'}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors mb-0.5 ${
                      active
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-zinc-500 hover:text-white hover:bg-white/5'
                    } ${collapsed ? 'justify-center px-2' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon size={18} className="flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Comp>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/5 flex-shrink-0 space-y-2">
          {!collapsed && (
            <>
              <div className="flex items-center justify-between text-xs text-zinc-600 px-1">
                <span className="flex items-center gap-1"><Calendar size={12} /> 26 may 2026</span>
                <Sun size={14} className="text-zinc-500" />
              </div>
              <div className="flex items-center gap-2 px-1 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-zinc-500">Conectado</span>
              </div>
              <a
                href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20vi%20el%20demo%20de%20Fullsite%20y%20me%20interesa."
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600"
              >
                Lo quiero para mi restaurante
              </a>
            </>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 px-2 py-1.5 text-zinc-600 text-xs hover:text-zinc-400 w-full rounded-lg hover:bg-white/5">
            {collapsed ? <ChevronRight size={16} className="mx-auto" /> : <><ChevronLeft size={16} /> Colapsar</>}
          </button>
          {!collapsed && (
            <Link href="/demo" className="flex items-center gap-2 px-2 py-1.5 text-zinc-600 text-xs hover:text-zinc-400">
              <LogOut size={14} /> Cerrar sesión
            </Link>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-h-screen overflow-auto">
        {children}
      </main>
    </div>
  )
}
