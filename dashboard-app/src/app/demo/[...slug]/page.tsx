'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Construction, ArrowLeft, Sparkles } from 'lucide-react'

// Catch-all for demo pages that don't have dedicated implementations yet
// Shows a "coming soon" placeholder with the page name

const PAGE_NAMES: Record<string, string> = {
  sucursales: 'Sucursales',
  ventas: 'Ventas',
  cortes: 'Cortes de Caja',
  meseros: 'Reporte de Meseros',
  platillos: 'Reporte de Platillos',
  tendencias: 'Tendencias',
  propinas: 'Propinas',
  ingresos: 'Ingresos',
  'estado-resultados': 'Estado de Resultados',
  nomina: 'Nómina',
  facturacion: 'Facturación CFDI',
  inventario: 'Inventario',
  'food-cost': 'Food Cost',
  proveedores: 'Proveedores',
  ecommerce: 'eCommerce',
  reportes: 'Reportes',
  'pos-platillos': 'Platillos POS',
  'pos-grupos': 'Grupos POS',
  'pos-modificadores': 'Modificadores',
  'pos-horarios': 'Horarios',
  'pos-tamanos': 'Tamaños',
  'pos-promociones': 'Promociones',
  'pos-pagos': 'Formas de Pago',
  'tienda-articulos': 'Artículos Tienda',
  'tienda-grupos': 'Grupos Tienda',
  'tienda-precios': 'Tipos de Precio',
  'tienda-promos': 'Promociones Tienda',
  domicilio: 'Domicilio',
  'gift-cards': 'Tarjetas de Regalo',
  agentes: 'Agentes IA',
  resenas: 'Reseñas',
  coach: 'Coach',
  chat: 'Chat IA',
}

export default function DemoCatchAll() {
  const pathname = usePathname()
  const slug = pathname.replace('/demo/', '')
  const pageName = PAGE_NAMES[slug] || slug.charAt(0).toUpperCase() + slug.slice(1)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
          <Construction size={32} className="text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{pageName}</h1>
        <p className="text-[var(--text-3)] mb-6">
          Este módulo está incluido en tu suscripción. Se configura durante el onboarding con datos reales de tu restaurante.
        </p>
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4 mb-6 text-left">
          <p className="text-sm text-[var(--text-2)] mb-3 flex items-center gap-2"><Sparkles size={14} className="text-emerald-400" /> Lo que incluye:</p>
          <ul className="space-y-2 text-sm text-[var(--text-3)]">
            <li>• Datos en tiempo real conectados a tu POS</li>
            <li>• Reportes automáticos diarios y semanales</li>
            <li>• Alertas inteligentes por Telegram</li>
            <li>• Historial completo exportable</li>
          </ul>
        </div>
        <div className="flex gap-3 justify-center">
          <Link href="/demo/dashboard" className="flex items-center gap-2 px-4 py-2.5 bg-[var(--line-soft)] text-[var(--text-2)] rounded-lg hover:bg-[var(--line)] text-sm">
            <ArrowLeft size={16} /> Dashboard
          </Link>
          <a
            href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20el%20módulo%20de%20{pageName}."
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 text-[var(--text-1)] rounded-lg hover:bg-emerald-600 text-sm font-bold"
          >
            Activar módulo
          </a>
        </div>
      </div>
    </div>
  )
}
