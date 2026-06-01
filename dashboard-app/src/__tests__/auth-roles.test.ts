import { describe, it, expect, vi } from 'vitest'

// Mock supabase-browser to avoid env var requirement
vi.mock('@/lib/supabase-browser', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    from: () => ({ select: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: null }) }) }) }) }),
  }),
}))

import { canAccessPage, type DashboardRole } from '@/contexts/AuthContext'

// ─── dueño — full access ─────────────────────────────────────────────────

describe('canAccessPage — dueño', () => {
  const role: DashboardRole = 'dueño'

  it('can access root /', () => expect(canAccessPage(role, '/')).toBe(true))
  it('can access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(true))
  it('can access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(true))
  it('can access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(true))
  it('can access /platillos', () => expect(canAccessPage(role, '/platillos')).toBe(true))
  it('can access /tendencias', () => expect(canAccessPage(role, '/tendencias')).toBe(true))
  it('can access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(true))
  it('can access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(true))
  it('can access /auto86', () => expect(canAccessPage(role, '/auto86')).toBe(true))
  it('can access /ecommerce', () => expect(canAccessPage(role, '/ecommerce')).toBe(true))
  it('can access /reportes', () => expect(canAccessPage(role, '/reportes')).toBe(true))
  it('can access /sucursales', () => expect(canAccessPage(role, '/sucursales')).toBe(true))
  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(true))
  it('can access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(true))
  it('can access /ingresos', () => expect(canAccessPage(role, '/ingresos')).toBe(true))
  it('can access /proveedores', () => expect(canAccessPage(role, '/proveedores')).toBe(true))
  it('can access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(true))
  it('can access /roi', () => expect(canAccessPage(role, '/roi')).toBe(true))
  it('can access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(true))
  it('can access /coach', () => expect(canAccessPage(role, '/coach')).toBe(true))
  it('can access /chat', () => expect(canAccessPage(role, '/chat')).toBe(true))
  it('can access /admin', () => expect(canAccessPage(role, '/admin')).toBe(true))
  it('can access any path', () => expect(canAccessPage(role, '/anything-random')).toBe(true))
})

// ─── gerente — no financials ─────────────────────────────────────────────

describe('canAccessPage — gerente', () => {
  const role: DashboardRole = 'gerente'

  it('can access /', () => expect(canAccessPage(role, '/')).toBe(true))
  it('can access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(true))
  it('can access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(true))
  it('can access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(true))
  it('can access /platillos', () => expect(canAccessPage(role, '/platillos')).toBe(true))
  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(true))
  it('can access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(true))
  it('can access /coach', () => expect(canAccessPage(role, '/coach')).toBe(true))
  it('can access /chat', () => expect(canAccessPage(role, '/chat')).toBe(true))
  it('can access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(true))
  it('can access /reportes', () => expect(canAccessPage(role, '/reportes')).toBe(true))

  // Financial pages — blocked
  it('CANNOT access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('CANNOT access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('CANNOT access /ingresos', () => expect(canAccessPage(role, '/ingresos')).toBe(false))
  it('CANNOT access /proveedores', () => expect(canAccessPage(role, '/proveedores')).toBe(false))
  it('CANNOT access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('CANNOT access /roi', () => expect(canAccessPage(role, '/roi')).toBe(false))
})

// ─── capitan — operations + POS + inventario ─────────────────────────────

describe('canAccessPage — capitan', () => {
  const role: DashboardRole = 'capitan'

  it('can access /', () => expect(canAccessPage(role, '/')).toBe(true))
  it('can access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(true))
  it('can access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(true))
  it('can access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(true))
  it('can access /platillos', () => expect(canAccessPage(role, '/platillos')).toBe(true))
  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(true))
  it('can access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(true))
  it('can access /admin', () => expect(canAccessPage(role, '/admin')).toBe(true))
  it('can access /tendencias', () => expect(canAccessPage(role, '/tendencias')).toBe(true))
  it('can access /auto86', () => expect(canAccessPage(role, '/auto86')).toBe(true))
  it('can access /ecommerce', () => expect(canAccessPage(role, '/ecommerce')).toBe(true))
  it('can access /reportes', () => expect(canAccessPage(role, '/reportes')).toBe(true))
  it('can access /sucursales', () => expect(canAccessPage(role, '/sucursales')).toBe(true))

  // Blocked pages
  it('CANNOT access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('CANNOT access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('CANNOT access /ingresos', () => expect(canAccessPage(role, '/ingresos')).toBe(false))
  it('CANNOT access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('CANNOT access /roi', () => expect(canAccessPage(role, '/roi')).toBe(false))
  it('CANNOT access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(false))
  it('CANNOT access /coach', () => expect(canAccessPage(role, '/coach')).toBe(false))
  it('CANNOT access /chat', () => expect(canAccessPage(role, '/chat')).toBe(false))
})

// ─── cajero — POS + cortes + propinas + ventas ───────────────────────────

describe('canAccessPage — cajero', () => {
  const role: DashboardRole = 'cajero'

  it('can access /', () => expect(canAccessPage(role, '/')).toBe(true))
  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(true))
  it('can access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(true))
  it('can access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(true))

  // Blocked pages
  it('CANNOT access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('CANNOT access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('CANNOT access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(false))
  it('CANNOT access /coach', () => expect(canAccessPage(role, '/coach')).toBe(false))
  it('CANNOT access /chat', () => expect(canAccessPage(role, '/chat')).toBe(false))
  it('CANNOT access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(false))
  it('CANNOT access /platillos', () => expect(canAccessPage(role, '/platillos')).toBe(false))
  it('CANNOT access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(false))
  it('CANNOT access /admin', () => expect(canAccessPage(role, '/admin')).toBe(false))
  it('CANNOT access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('CANNOT access /roi', () => expect(canAccessPage(role, '/roi')).toBe(false))
  it('CANNOT access /ingresos', () => expect(canAccessPage(role, '/ingresos')).toBe(false))
  it('CANNOT access /reportes', () => expect(canAccessPage(role, '/reportes')).toBe(false))
  it('CANNOT access /tendencias', () => expect(canAccessPage(role, '/tendencias')).toBe(false))
})

// ─── mesero — POS only ───────────────────────────────────────────────────

describe('canAccessPage — mesero', () => {
  const role: DashboardRole = 'mesero'

  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /pos/subpage', () => expect(canAccessPage(role, '/pos/kitchen')).toBe(true))

  it('CANNOT access /', () => expect(canAccessPage(role, '/')).toBe(false))
  it('CANNOT access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(false))
  it('CANNOT access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(false))
  it('CANNOT access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(false))
  it('CANNOT access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(false))
  it('CANNOT access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('CANNOT access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('CANNOT access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(false))
  it('CANNOT access /coach', () => expect(canAccessPage(role, '/coach')).toBe(false))
  it('CANNOT access /chat', () => expect(canAccessPage(role, '/chat')).toBe(false))
  it('CANNOT access /admin', () => expect(canAccessPage(role, '/admin')).toBe(false))
  it('CANNOT access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(false))
  it('CANNOT access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
})

// ─── staff — POS only ────────────────────────────────────────────────────

describe('canAccessPage — staff', () => {
  const role: DashboardRole = 'staff'

  it('can access /pos', () => expect(canAccessPage(role, '/pos')).toBe(true))
  it('can access /pos/subpage', () => expect(canAccessPage(role, '/pos/orders')).toBe(true))

  it('CANNOT access /', () => expect(canAccessPage(role, '/')).toBe(false))
  it('CANNOT access /ventas', () => expect(canAccessPage(role, '/ventas')).toBe(false))
  it('CANNOT access /cortes', () => expect(canAccessPage(role, '/cortes')).toBe(false))
  it('CANNOT access /meseros', () => expect(canAccessPage(role, '/meseros')).toBe(false))
  it('CANNOT access /propinas', () => expect(canAccessPage(role, '/propinas')).toBe(false))
  it('CANNOT access /estado-resultados', () => expect(canAccessPage(role, '/estado-resultados')).toBe(false))
  it('CANNOT access /nomina', () => expect(canAccessPage(role, '/nomina')).toBe(false))
  it('CANNOT access /agentes', () => expect(canAccessPage(role, '/agentes')).toBe(false))
  it('CANNOT access /admin', () => expect(canAccessPage(role, '/admin')).toBe(false))
  it('CANNOT access /inventario', () => expect(canAccessPage(role, '/inventario')).toBe(false))
  it('CANNOT access /food-cost', () => expect(canAccessPage(role, '/food-cost')).toBe(false))
  it('CANNOT access /roi', () => expect(canAccessPage(role, '/roi')).toBe(false))
})

// ─── Edge cases ──────────────────────────────────────────────────────────

describe('canAccessPage — edge cases', () => {
  it('unknown role returns false for /', () => {
    expect(canAccessPage('invalid' as DashboardRole, '/')).toBe(false)
  })

  it('unknown role returns false for /pos', () => {
    expect(canAccessPage('invalid' as DashboardRole, '/pos')).toBe(false)
  })

  it('unknown role returns false for /ventas', () => {
    expect(canAccessPage('invalid' as DashboardRole, '/ventas')).toBe(false)
  })

  it('gerente blocked on financial subpaths', () => {
    expect(canAccessPage('gerente', '/estado-resultados/detalle')).toBe(false)
    expect(canAccessPage('gerente', '/nomina/history')).toBe(false)
  })

  it('cajero can access /pos/subpath', () => {
    expect(canAccessPage('cajero', '/pos/checkout')).toBe(true)
  })

  it('capitan can access /ventas/subpath', () => {
    expect(canAccessPage('capitan', '/ventas/detail')).toBe(true)
  })

  it('mesero can access /pos/mesa/5', () => {
    expect(canAccessPage('mesero', '/pos/mesa/5')).toBe(true)
  })

  it('staff cannot access empty path', () => {
    expect(canAccessPage('staff', '')).toBe(false)
  })

  it('dueño can access empty path', () => {
    expect(canAccessPage('dueño', '')).toBe(true)
  })
})
