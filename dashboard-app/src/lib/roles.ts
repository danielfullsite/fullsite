// Roles del dashboard — lógica pura compartida entre cliente (AuthContext) y middleware (edge).
// dueño: ve TODO
// gerente: operación + agentes + inventario, NO finanzas
// capitan: operación + POS + inventario/merma, NO finanzas/agentes
// cajero: POS + cortes + propinas
// mesero/staff: solo POS
export type DashboardRole = 'dueño' | 'gerente' | 'capitan' | 'cajero' | 'mesero' | 'staff'

export const FINANCIAL_PAGES = ['/estado-resultados', '/nomina', '/ingresos', '/proveedores', '/food-cost', '/roi']
export const AGENT_PAGES = ['/agentes', '/coach', '/chat']
export const OPERATIONS_PAGES = ['/', '/ventas', '/cortes', '/meseros', '/platillos', '/tendencias', '/propinas', '/inventario', '/auto86', '/ecommerce', '/reportes', '/sucursales']
export const POS_PAGES = ['/pos']
const CAPITAN_PAGES = [...OPERATIONS_PAGES, ...POS_PAGES, '/admin']
const CAJERO_PAGES = ['/pos', '/cortes', '/propinas', '/ventas']

// ─── Secciones de permiso (permisos por empleado, Square/Toast) ───────────────
// La unidad de configuración NO es la página suelta sino la sección funcional.
// docs/product/PERMISOS-POR-EMPLEADO-DESIGN.md.
export type PermSection = 'pos' | 'operacion' | 'finanzas' | 'inventario' | 'agentes' | 'cortes' | 'admin'
export type StaffPermissions = Partial<Record<PermSection, boolean>>

const INVENTORY_PAGES = ['/inventario', '/inventario-real', '/compras', '/recepcion-factura', '/merma']
const CORTES_PAGES = ['/cortes', '/control-efectivo', '/conciliacion']
const ADMIN_PAGES = ['/admin', '/configuracion', '/equipo']

/** Sección funcional a la que pertenece una ruta (o null si no está regulada). */
export function sectionForPath(path: string): PermSection | null {
  const hit = (list: string[]) => list.some(p => path === p || path.startsWith(p + '/'))
  if (hit(FINANCIAL_PAGES)) return 'finanzas'
  if (hit(INVENTORY_PAGES)) return 'inventario'
  if (hit(AGENT_PAGES)) return 'agentes'
  if (hit(CORTES_PAGES)) return 'cortes'
  if (hit(ADMIN_PAGES)) return 'admin'
  if (hit(POS_PAGES)) return 'pos'
  if (hit(OPERATIONS_PAGES)) return 'operacion'
  return null
}

/** Permisos por defecto de un rol — reproduce EXACTO la lógica de canAccessPage.
 *  El override "vacío" de un empleado equivale a estos, así que migrar no cambia
 *  el acceso de nadie. */
export function defaultSectionsForRole(role: DashboardRole): Record<PermSection, boolean> {
  const all = (v: boolean): Record<PermSection, boolean> =>
    ({ pos: v, operacion: v, finanzas: v, inventario: v, agentes: v, cortes: v, admin: v })
  switch (role) {
    case 'dueño':   return all(true)
    case 'gerente': return { ...all(true), finanzas: false }
    case 'capitan': return { pos: true, operacion: true, inventario: true, admin: true, finanzas: false, agentes: false, cortes: false }
    case 'cajero':  return { pos: true, cortes: true, operacion: true, finanzas: false, inventario: false, agentes: false, admin: false }
    default:        return { ...all(false), pos: true } // mesero/staff
  }
}

/**
 * Puerta única de acceso (sidebar Y rebote de URL). `overrides` es OPCIONAL: si
 * trae la sección de `path`, ese booleano manda; si no, cae al comportamiento por
 * rol de siempre. La firma vieja (role, path) sigue válida y sin cambios.
 */
export function canAccessPage(role: DashboardRole, path: string, overrides?: StaffPermissions): boolean {
  if (overrides) {
    const section = sectionForPath(path)
    if (section && Object.prototype.hasOwnProperty.call(overrides, section)) {
      // El override solo puede RESTRINGIR respecto al rol, nunca elevar: un
      // permiso en true igual exige que el rol ya diera acceso (el server valida
      // por rol como piso). Así un mesero con "finanzas:true" no entra a finanzas.
      return overrides[section] === true && canAccessPage(role, path)
    }
  }
  if (role === 'dueño') return true
  if (role === 'gerente') return !FINANCIAL_PAGES.some(p => path.startsWith(p))
  if (role === 'capitan') return CAPITAN_PAGES.some(p => path === p || path.startsWith(p + '/')) || path === '/'
  if (role === 'cajero') return CAJERO_PAGES.some(p => path === p || path.startsWith(p + '/')) || path === '/'
  if (role === 'mesero' || role === 'staff') return POS_PAGES.some(p => path.startsWith(p))
  return false
}

// Fallback por email — solo para usuarios que aún no tienen fila en client_users
// ni app_metadata.role. La fuente de verdad es la BD.
export const ROLE_MAP: Record<string, DashboardRole> = {
  'demo@fullsite.mx': 'dueño',
}

// client_users.role / app_metadata.role usan 'admin' para dueños históricos
export const DB_ROLE_MAP: Record<string, DashboardRole> = {
  admin: 'dueño',
  dueño: 'dueño',
  gerente: 'gerente',
  capitan: 'capitan',
  cajero: 'cajero',
  mesero: 'mesero',
  staff: 'staff',
}

export function resolveRole(dbRole: string | null | undefined, email: string | undefined): DashboardRole {
  if (dbRole && DB_ROLE_MAP[dbRole]) return DB_ROLE_MAP[dbRole]
  return ROLE_MAP[email || ''] || 'staff'
}

// Roles que operan solo en el POS — post-login van a /pos, no al dashboard.
export const POS_ONLY_ROLES: DashboardRole[] = ['mesero', 'staff', 'cajero']

export function resolveLoginRedirect(
  role: DashboardRole | null | undefined,
  clientId: string | null | undefined,
): string {
  if (clientId === 'demo') return '/demo/dashboard'
  if (role && POS_ONLY_ROLES.includes(role)) return '/pos'
  return '/'
}
