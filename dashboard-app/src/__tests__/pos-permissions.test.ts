import { describe, it, expect } from 'vitest'
import { getPermissions, hasPermission, PERMISSION_PROFILES, PERMISSION_LABELS, PERMISSION_GROUPS } from '../lib/pos-permissions'

describe('getPermissions', () => {
  it('returns admin permissions for admin role', () => {
    const perms = getPermissions('admin')
    expect(perms.cancelar_ordenes).toBe(true)
    expect(perms.configurar_iva).toBe(true)
  })
  it('returns mesero permissions for unknown role', () => {
    const perms = getPermissions('unknown')
    expect(perms.cancelar_ordenes).toBe(false)
    expect(perms.registro_comanda).toBe(true)
  })
})

describe('hasPermission', () => {
  it('admin has cancelar_ordenes', () => expect(hasPermission('admin', 'cancelar_ordenes')).toBe(true))
  it('gerente does NOT have cancelar_ordenes', () => expect(hasPermission('gerente', 'cancelar_ordenes')).toBe(false))
  it('capitan does NOT have cancelar_ordenes', () => expect(hasPermission('capitan', 'cancelar_ordenes')).toBe(false))
  it('cajero does NOT have cancelar_ordenes', () => expect(hasPermission('cajero', 'cancelar_ordenes')).toBe(false))
  it('mesero does NOT have cancelar_ordenes', () => expect(hasPermission('mesero', 'cancelar_ordenes')).toBe(false))
})

describe('Eduardo critical rule: only admin can cancel orders', () => {
  it('ONLY admin has cancelar_ordenes', () => {
    for (const [role, perms] of Object.entries(PERMISSION_PROFILES)) {
      if (role === 'admin') {
        expect(perms.cancelar_ordenes).toBe(true)
      } else {
        expect(perms.cancelar_ordenes).toBe(false)
      }
    }
  })
})

describe('role hierarchy makes sense', () => {
  it('admin has more permissions than gerente', () => {
    const admin = getPermissions('admin')
    const gerente = getPermissions('gerente')
    const adminCount = Object.values(admin).filter(v => v).length
    const gerenteCount = Object.values(gerente).filter(v => v).length
    expect(adminCount).toBeGreaterThan(gerenteCount)
  })
  it('gerente has more permissions than capitan', () => {
    const gerente = getPermissions('gerente')
    const capitan = getPermissions('capitan')
    const gerenteCount = Object.values(gerente).filter(v => v).length
    const capitanCount = Object.values(capitan).filter(v => v).length
    expect(gerenteCount).toBeGreaterThan(capitanCount)
  })
  it('capitan has more permissions than cajero', () => {
    const capitan = getPermissions('capitan')
    const cajero = getPermissions('cajero')
    const capitanCount = Object.values(capitan).filter(v => v).length
    const cajeroCount = Object.values(cajero).filter(v => v).length
    expect(capitanCount).toBeGreaterThan(cajeroCount)
  })
  it('cajero has more permissions than mesero', () => {
    const cajero = getPermissions('cajero')
    const mesero = getPermissions('mesero')
    const cajeroCount = Object.values(cajero).filter(v => v).length
    const meseroCount = Object.values(mesero).filter(v => v).length
    expect(cajeroCount).toBeGreaterThan(meseroCount)
  })
})

describe('mesero basic permissions', () => {
  const p = getPermissions('mesero')
  it('can open restaurant accounts', () => expect(p.abrir_cuentas_restaurante).toBe(true))
  it('can register comanda', () => expect(p.registro_comanda).toBe(true))
  it('can see own accounts only', () => expect(p.ver_cuentas_propias).toBe(true))
  it('cannot close accounts', () => expect(p.cerrar_cuentas).toBe(false))
  it('cannot give discounts', () => expect(p.descuentos_ordenes_pct).toBe(false))
  it('cannot do corte', () => expect(p.corte_turno).toBe(false))
  it('cannot see reports', () => expect(p.reportes).toBe(false))
  it('cannot configure anything', () => expect(p.configurar_impresora).toBe(false))
})

describe('cajero permissions', () => {
  const p = getPermissions('cajero')
  it('can close accounts', () => expect(p.cerrar_cuentas).toBe(true))
  it('can do corte turno', () => expect(p.corte_turno).toBe(true))
  it('can do corte X', () => expect(p.corte_x).toBe(true))
  it('cannot do corte Z', () => expect(p.corte_z).toBe(false))
  it('cannot give discounts', () => expect(p.descuentos_ordenes_pct).toBe(false))
})

describe('PERMISSION_LABELS', () => {
  it('has label for every permission', () => {
    const perms = getPermissions('admin')
    for (const key of Object.keys(perms)) {
      expect(PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS]).toBeTruthy()
    }
  })
})

describe('PERMISSION_GROUPS', () => {
  it('covers all permissions', () => {
    const allKeys = PERMISSION_GROUPS.flatMap(g => g.keys)
    const permKeys = Object.keys(getPermissions('admin'))
    for (const key of permKeys) {
      expect(allKeys).toContain(key)
    }
  })
  it('has 7 groups', () => expect(PERMISSION_GROUPS.length).toBe(7))
})

describe('5 roles exist', () => {
  it('admin, gerente, capitan, cajero, mesero', () => {
    expect(Object.keys(PERMISSION_PROFILES)).toEqual(['admin', 'gerente', 'capitan', 'cajero', 'mesero'])
  })
})
