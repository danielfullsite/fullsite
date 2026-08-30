import { describe, expect, it } from 'vitest'
import {
  canAccessPage, sectionForPath, defaultSectionsForRole,
  type DashboardRole,
} from '@/lib/roles'

describe('permisos por empleado — sección y overrides', () => {
  it('sectionForPath mapea las rutas clave a su sección', () => {
    expect(sectionForPath('/estado-resultados')).toBe('finanzas')
    expect(sectionForPath('/nomina')).toBe('finanzas')
    expect(sectionForPath('/inventario-real/entradas')).toBe('inventario')
    expect(sectionForPath('/compras')).toBe('inventario')
    expect(sectionForPath('/agentes')).toBe('agentes')
    expect(sectionForPath('/cortes')).toBe('cortes')
    expect(sectionForPath('/equipo')).toBe('admin')
    expect(sectionForPath('/pos')).toBe('pos')
    expect(sectionForPath('/ventas')).toBe('operacion')
  })

  it('RETROCOMPAT: sin overrides, canAccessPage no cambia para ningún rol', () => {
    const roles: DashboardRole[] = ['dueño', 'gerente', 'capitan', 'cajero', 'mesero', 'staff']
    for (const role of roles) {
      // el override VACÍO derivado del rol debe dar EXACTO lo mismo que sin override
      const paths = ['/', '/ventas', '/estado-resultados', '/inventario-real', '/agentes', '/cortes', '/equipo', '/pos']
      for (const p of paths) {
        expect(canAccessPage(role, p)).toBe(canAccessPage(role, p, undefined))
      }
    }
  })

  it('override RESTRINGE: un dueño con finanzas:false pierde finanzas, conserva el resto', () => {
    expect(canAccessPage('dueño', '/estado-resultados')).toBe(true) // sin override
    expect(canAccessPage('dueño', '/estado-resultados', { finanzas: false })).toBe(false)
    expect(canAccessPage('dueño', '/ventas', { finanzas: false })).toBe(true) // otra sección intacta
  })

  it('override NO ELEVA: un mesero con finanzas:true sigue sin finanzas (el rol es el piso)', () => {
    expect(canAccessPage('mesero', '/estado-resultados', { finanzas: true })).toBe(false)
    expect(canAccessPage('mesero', '/pos', { pos: true })).toBe(true)
  })

  it('rol de inventario simulado: gerente con solo inventario+pos ve eso y nada más', () => {
    const ov = { inventario: true, pos: true, operacion: false, finanzas: false, agentes: false, cortes: false, admin: false }
    expect(canAccessPage('gerente', '/inventario-real', ov)).toBe(true)
    expect(canAccessPage('gerente', '/pos', ov)).toBe(true)
    expect(canAccessPage('gerente', '/ventas', ov)).toBe(false)   // operacion off
    expect(canAccessPage('gerente', '/agentes', ov)).toBe(false)
  })

  it('defaultSectionsForRole reproduce el acceso del rol (finanzas off salvo dueño)', () => {
    expect(defaultSectionsForRole('dueño').finanzas).toBe(true)
    expect(defaultSectionsForRole('gerente').finanzas).toBe(false)
    expect(defaultSectionsForRole('gerente').operacion).toBe(true)
    expect(defaultSectionsForRole('mesero').pos).toBe(true)
    expect(defaultSectionsForRole('mesero').operacion).toBe(false)
    expect(defaultSectionsForRole('cajero').cortes).toBe(true)
  })
})
