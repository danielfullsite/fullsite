// recipe-sync no mezcla unidades al agregar filas del mismo ingrediente.
// Barrido 2026-09-10 (inventario LENTE-6): 100 g + 1 kg se proyectaba como 101 g.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { agregarPorIngrediente } from '@/lib/recipe-sync-unidades'

describe('agregarPorIngrediente', () => {
  it('REGRESION: 100 g + 1 kg = 1100 g, no 101 g', () => {
    const r = agregarPorIngrediente([
      { ingredient_id: 'harina', quantity: 100, unit: 'g' },
      { ingredient_id: 'harina', quantity: 1, unit: 'kg' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.porIngrediente.get('harina')).toEqual({ quantity: 1100, unit: 'g' })
  })
  it('la tabla del tenant gana y tambien sirve al reves', () => {
    const tabla = [{ from_unit: 'PZA', to_unit: 'CAJA', factor: 1 / 12 }]
    const r = agregarPorIngrediente([
      { ingredient_id: 'huevo', quantity: 1, unit: 'caja' },
      { ingredient_id: 'huevo', quantity: 6, unit: 'pza' },
    ], tabla)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.porIngrediente.get('huevo')!.quantity).toBeCloseTo(1.5, 6)
  })
  it('sin conversion posible se rechaza en vez de inventar', () => {
    const r = agregarPorIngrediente([
      { ingredient_id: 'x', quantity: 1, unit: 'kg' },
      { ingredient_id: 'x', quantity: 1, unit: 'l' },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detalle).toMatch(/no hay conversion/)
  })
  it('misma unidad o ambas vacias: suma directa; una vacia y otra no: rechazo', () => {
    expect(agregarPorIngrediente([{ ingredient_id: 'a', quantity: 1, unit: 'g' }, { ingredient_id: 'a', quantity: 2, unit: 'G' }])).toMatchObject({ ok: true })
    expect(agregarPorIngrediente([{ ingredient_id: 'a', quantity: 1, unit: null }, { ingredient_id: 'a', quantity: 2, unit: null }])).toMatchObject({ ok: true })
    expect(agregarPorIngrediente([{ ingredient_id: 'a', quantity: 1, unit: null }, { ingredient_id: 'a', quantity: 2, unit: 'g' }])).toMatchObject({ ok: false })
  })
  it('REGRESION (fuente): la ruta usa el helper y responde MIXED_UNITS en vez de sumar a ciegas', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/pos/recipe-sync/route.ts'), 'utf8')
    expect(src).toContain('agregarPorIngrediente(')
    expect(src).toContain('MIXED_UNITS')
    expect(src).not.toMatch(/if \(prev\) prev\.quantity \+= q/)
  })
})
