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
  Building2,
  Mic,
  ShieldOff,
  Ban,
  FileText,
  Clock,
  Bike,
  ScanBarcode,
  ArrowDownUp,
  RotateCcw,
  Undo2,
  FlaskConical,
  Factory,
  Layers,
  ArrowLeftRight,
  Activity,
  Coins,
  Wallet,
  Heart,
  Map,
  Calculator,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { canAccessPage } from '@/contexts/AuthContext'
import { canPlanAccessPage } from '@/lib/plans'
import ThemeToggle from '@/components/ThemeToggle'

const navSections = [
  {
    label: 'Principal',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/roi', label: 'ROI', icon: TrendingUp },
      { href: '/sucursales', label: 'Sucursales', icon: Building2 },
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
      { href: '/costos', label: 'Costos', icon: DollarSign },
      { href: '/estado-resultados', label: 'Estado de Resultados', icon: FileSpreadsheet },
      { href: '/nomina', label: 'Nómina', icon: UserCheck },
      { href: '/pos/facturacion', label: 'Facturación CFDI', icon: Stamp },
      { href: '/notas-credito', label: 'Notas de Crédito', icon: FileText },
      { href: '/facturas', label: 'Facturas Proveedores', icon: FileText },
      { href: '/reporte-fiscal', label: 'Reporte Fiscal', icon: FileSpreadsheet },
      { href: '/conciliacion', label: 'Conciliación', icon: FileSpreadsheet },
      { href: '/egresos', label: 'Egresos', icon: Wallet },
      { href: '/contabilidad', label: 'Contabilidad CONTPAQi', icon: Calculator },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { href: '/inventario-real', label: 'Inventario', icon: Package },
      { href: '/caja', label: 'Caja', icon: Banknote },
      { href: '/cancelaciones', label: 'Cancelaciones', icon: Ban },
      { href: '/acceso', label: 'Control Acceso', icon: Clock },
      { href: '/delivery', label: 'Delivery', icon: Bike },
      { href: '/auto86', label: 'Auto-86', icon: ShieldOff },
      { href: '/food-cost', label: 'Food Cost', icon: PieChart },
      { href: '/compras', label: 'Compras', icon: ShoppingCart },
      { href: '/proveedores', label: 'Proveedores', icon: Truck },
      { href: '/ecommerce', label: 'eCommerce', icon: ShoppingCart },
      { href: '/reportes', label: 'Reportes', icon: FileBarChart },
      { href: '/reportes/ingresos', label: 'Ingresos', icon: FileBarChart },
    ],
  },
  {
    label: 'Inv. Entradas',
    items: [
      { href: '/inventario-real/entradas', label: 'Entradas', icon: Package },
      { href: '/inventario-real/entradas-factura', label: 'Con Factura', icon: FileText },
      { href: '/inventario-real/devoluciones', label: 'Devoluciones', icon: Undo2 },
      { href: '/inventario-real/barcode', label: 'Código Barras', icon: ScanBarcode },
    ],
  },
  {
    label: 'Inv. Control',
    items: [
      { href: '/inventario-real/reorden', label: 'Punto Reorden', icon: ArrowDownUp },
      { href: '/inventario-real/conversiones', label: 'Conversiones', icon: ArrowLeftRight },
      { href: '/inventario-real/presentaciones', label: 'Presentaciones', icon: Layers },
      { href: '/inventario-real/subproductos', label: 'Subproductos', icon: FlaskConical },
    ],
  },
  {
    label: 'Inv. Auditoría',
    items: [
      { href: '/inventario-real/toma-fisica', label: 'Toma Física', icon: ClipboardList },
      { href: '/inventario-real/merma', label: 'Merma', icon: RotateCcw },
      { href: '/inventario-real/movimientos', label: 'Movimientos', icon: Activity },
      { href: '/inventario-real/costos', label: 'Costos Inv.', icon: Coins },
    ],
  },
  {
    label: 'Inv. Compras',
    items: [
      { href: '/inventario-real/orden-compra', label: 'Orden Compra', icon: ShoppingCart },
      { href: '/inventario-real/produccion', label: 'Producción', icon: Factory },
      { href: '/inventario-real/transferencias', label: 'Transferencias', icon: Truck },
    ],
  },
  {
    label: 'POS',
    items: [
      { href: '/pos', label: 'Punto de Venta', icon: Monitor },
      { href: '/pos/plano', label: 'Plano', icon: Map },
    ],
  },
  {
    label: 'POS Restaurante',
    items: [
      { href: '/admin/menu', label: 'Platillos', icon: UtensilsCrossed },
      { href: '/admin/grupos', label: 'Grupos', icon: Package },
      { href: '/admin/modificadores', label: 'Modificadores', icon: Settings },
      { href: '/admin/horarios', label: 'Horarios', icon: Calendar },
      { href: '/admin/promociones', label: 'Promociones', icon: Sparkles },
      { href: '/admin/formas-pago', label: 'Formas de Pago', icon: Banknote },
    ],
  },
  {
    label: 'Herramientas',
    items: [
      { href: '/crm', label: 'CRM', icon: Users },
      { href: '/lealtad', label: 'Lealtad', icon: Heart },
      { href: '/mission-control', label: 'Mission Control', icon: Bot },
      { href: '/agentes', label: 'Agentes IA', icon: Bot },
      { href: '/coach', label: 'Coach', icon: Sparkles },
      { href: '/chat', label: 'Chat IA', icon: MessageCircle },
      { href: '/voice', label: 'Voice Agent', icon: Mic },
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
  const { user, role, clientConfig, locations, locationId, setLocationId, signOut } = useAuth()

  const sidebarContent = (
    <aside className="flex flex-col h-screen sticky top-0 w-full lg:border-r lg:border-[var(--line)]" style={{ background: 'var(--surface)' }}>
      {/* Logo — with safe-area padding on mobile for iPhone notch */}
      <div className="px-5 py-5 lg:border-b lg:border-[var(--line-soft)]" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top, 1.25rem))' }}>
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center logo-hover" onClick={() => setMobileOpen(false)}>
            <span className="text-[var(--text-1)] font-black text-xl tracking-tight">
              fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </Link>
          {/* Close button inside sidebar on mobile */}
          <button
            className="lg:hidden p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Navigation sections */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {navSections.map((section) => {
          const visibleItems = section.items.filter(item =>
            canAccessPage(role, item.href) && canPlanAccessPage(clientConfig?.plan, item.href)
          )
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

      {/* Footer — with safe-area padding on mobile for home indicator */}
      <div className="px-4 py-4 border-t border-[var(--line-soft)]" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}>
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

        {/* Location selector — only when 2+ locations */}
        {locations.length > 1 && (
          <select
            value={locationId || ''}
            onChange={e => setLocationId(e.target.value || null)}
            className="w-full mb-3 px-2 py-1.5 text-xs rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] focus:outline-none focus:border-emerald-500 transition-colors"
          >
            <option value="">Todas las sucursales</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}

        {/* Client name */}
        {clientConfig && (
          <p className="text-[11px] text-[var(--text-4)] mb-3 truncate">
            {clientConfig.display_name || clientConfig.id}
          </p>
        )}

        {/* Logout — always visible, nukes all storage */}
        <button
          onClick={() => {
            try { signOut() } catch {}
            localStorage.clear()
            sessionStorage.clear()
            window.location.href = '/login'
          }}
          className="flex items-center gap-2 text-xs text-[var(--text-3)] hover:text-red-500 transition-colors w-full px-2 py-1.5 rounded-md hover:bg-red-500/10"
        >
          <LogOut size={14} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )

  return (
    <>
      {/* Mobile hamburger — only shows when sidebar is closed */}
      {!mobileOpen && (
        <button
          className="fixed left-4 z-50 lg:hidden p-2 rounded-lg shadow-md border border-[var(--line)]"
          style={{ background: 'var(--surface)', color: 'var(--text-1)', top: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} />
        </button>
      )}

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
        className={`lg:hidden fixed top-0 left-0 h-full z-40 transition-all duration-200 ${
          mobileOpen ? 'translate-x-0 opacity-100 visible' : '-translate-x-full opacity-0 invisible'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  )
}
