// ─────────────────────────────────────────────────────────────────────────────
// La navegación del punto de venta, en un solo lugar.
//
// Vivía dentro del JSX de `pos/page.tsx`, así que el caparazón no podía usarla
// sin copiarla — y una lista de rutas con dos copias termina teniendo dos
// contenidos. Aquí está una vez; quien la pinte decide cómo se ve.
//
// Sólo lo que un operador toca EN SERVICIO. El back-office —recetas, food cost,
// compras, inventario, facturas de proveedor, analítica— vive en el dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Grid3X3, ChefHat, Wine, Bike, Clock, Receipt, Stamp,
  Users, Lock, Settings, Monitor, QrCode, FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type PosNavItem = {
  href: string
  icon: LucideIcon
  label: string
  /** Permiso que hay que tener para verlo. Lo evalúa quien la pinta. */
  section: string
  /** Estación KDS que debe existir en el tenant, si aplica. */
  estacion?: 'cocina' | 'barra'
}

export type PosNavGroup = { title: string; icon: LucideIcon; items: PosNavItem[] }

export const POS_NAV: PosNavGroup[] = [
  { title: 'Operación', icon: Grid3X3, items: [
    { href: '/pos/mesas', icon: Grid3X3, label: 'Mesas', section: 'mesas' },
    { href: '/pos/cocina', icon: ChefHat, label: 'Cocina', section: 'cocina', estacion: 'cocina' },
    { href: '/pos/barra', icon: Wine, label: 'Barra', section: 'barra', estacion: 'barra' },
    { href: '/pos/delivery', icon: Bike, label: 'Domicilio', section: 'delivery' },
  ] },
  { title: 'Caja & Turno', icon: Receipt, items: [
    { href: '/pos/turno', icon: Clock, label: 'Turno', section: 'turno' },
    { href: '/pos/corte', icon: Receipt, label: 'Corte de caja', section: 'corte' },
    { href: '/pos/facturacion', icon: Stamp, label: 'Facturación', section: 'facturacion' },
  ] },
  { title: 'Personal', icon: Users, items: [
    { href: '/pos/asistencia', icon: Clock, label: 'Checador', section: 'configuracion' },
    { href: '/pos/staff', icon: Users, label: 'Empleados', section: 'configuracion' },
    { href: '/pos/huella', icon: Lock, label: 'Huellas', section: 'configuracion' },
  ] },
  { title: 'Terminal', icon: Settings, items: [
    { href: '/pos/configuracion', icon: Settings, label: 'Configuración', section: 'configuracion' },
    { href: '/pos/monitor', icon: Monitor, label: 'Monitor', section: 'configuracion' },
    { href: '/pos/qr', icon: QrCode, label: 'QR Mesas', section: 'qr' },
    { href: '/pos/historial', icon: FileText, label: 'Historial', section: 'historial' },
    { href: '/pos/auditoria', icon: FileText, label: 'Auditoria', section: 'auditoria' },
  ] },
]

/** Nombre corto de la pantalla actual, para la barra de estado. */
export function nombreDePantalla(pathname: string): string {
  if (pathname === '/pos') return 'Venta'
  for (const g of POS_NAV) {
    const hit = g.items.find(i => pathname === i.href || pathname.startsWith(i.href + '/'))
    if (hit) return hit.label
  }
  return 'Punto de venta'
}

/**
 * Filtra la navegación con los dos criterios reales: qué permisos tiene la
 * persona y qué estaciones KDS existen en este restaurante. Los mismos que ya
 * aplicaba `pos/page.tsx`; aquí se escriben una vez.
 */
export function navVisible(
  puedeVer: (section: string) => boolean,
  tieneEstacion: (k: 'cocina' | 'barra') => boolean,
): PosNavGroup[] {
  return POS_NAV
    .map(g => ({
      ...g,
      items: g.items.filter(i => puedeVer(i.section) && (!i.estacion || tieneEstacion(i.estacion))),
    }))
    .filter(g => g.items.length > 0)
}
