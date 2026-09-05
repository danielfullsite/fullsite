import { describe, expect, it } from 'vitest'
import { reconciliarCuenta, type CuentaEditable } from '@/lib/pos-order-reconciliation'
import type { OrderItem } from '@/lib/pos-data'
const item = (id: string, cantidad = 1) => ({ id, nombre: `Dish ${id}`, cantidad, subtotal: 100 * cantidad } as OrderItem)
const base = (): CuentaEditable => ({ items: [item('A')], mesero: 'Ana', personas: 2, discount: 0, notas: '' })

describe('edits while other terminals operate the account', () => {
  it('remote append arrives while keeping a local draft and a local existing-item edit', () => {
    const initial = base()
    const local = { ...initial, items: [item('A', 2), item('local')] }
    const remote = { ...initial, items: [item('A'), item('remote')] }
    const merged = reconciliarCuenta(initial, local, remote)
    expect(merged.conflictos).toEqual([])
    expect(merged.cuenta.items).toEqual([item('A', 2), item('remote'), item('local')])
  })
  it('simultaneous edit to the same item keeps draft and blocks silent revision advancement', () => {
    const initial = base()
    const merged = reconciliarCuenta(initial, { ...initial, items: [item('A', 2)] }, { ...initial, items: [item('A', 3)] })
    expect(merged.conflictos).toEqual(['platillo:A'])
    expect(merged.cuenta.items[0].cantidad).toBe(2)
  })
  it('remote cancellation survives unchanged local view; local edit versus remote removal conflicts', () => {
    const initial = base()
    expect(reconciliarCuenta(initial, initial, { ...initial, items: [] }).cuenta.items).toEqual([])
    const edited = reconciliarCuenta(initial, { ...initial, items: [item('A', 2)] }, { ...initial, items: [] })
    expect(edited.conflictos).toContain('platillo:A')
    expect(edited.cuenta.items[0].cantidad).toBe(2)
  })
  it('metadata updates merge independently and conflicting guest counts are visible', () => {
    const initial = base()
    const merged = reconciliarCuenta(initial, { ...initial, notas: 'Sin sal', personas: 3 }, { ...initial, personas: 4, mesero: 'Luis' })
    expect(merged.cuenta).toMatchObject({ notas: 'Sin sal', personas: 3, mesero: 'Luis' })
    expect(merged.conflictos).toEqual(['personas'])
  })
  it('same change acknowledged remotely is idempotent even with JSON key order changed', () => {
    const initial = base()
    const local = { ...initial, items: [item('A', 2)] }
    const remote = { ...initial, items: [{ subtotal: 200, cantidad: 2, nombre: 'Dish A', id: 'A' } as OrderItem] }
    expect(reconciliarCuenta(initial, local, remote).conflictos).toEqual([])
  })
})
