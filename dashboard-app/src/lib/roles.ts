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

export function canAccessPage(role: DashboardRole, path: string): boolean {
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
  'ramonfaur.daniel@gmail.com': 'dueño',
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
