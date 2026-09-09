import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { esCuentaDeCobroDeSplit, cuentaDeSplit, cuentaCompleta } from '@/lib/liquidacion-de-orden'

// LA MISMA COMIDA SE DESCONTABA CINCO VECES.
//
// Al cobrar cada cuenta de un split, `/api/pos/save-order` llamaba a
// `r1_reconcile_order(client_id, order_id)`, que recorre los items de ESA orden y
// escribe en `pos_reconciliation_results`. Esa tabla tiene la clave unica
//
//     UNIQUE (client_id, order_id, order_item_id)     <- leida de la base el 2026-09-08
//
// asi que cada cuenta, al traer su propio `order_id` (`{orden}-C1`..`-CN`), estrenaba
// linaje de inventario y descontaba de nuevo. Y en el split PAREJO cada cuenta lleva
// TODOS los renglones (pos/page.tsx: `payingItems = activeItems`). Una mesa de 4:
//
//     la madre al enviar a cocina    1x
//     C1, C2, C3, C4                 4x
//     ─────────────────────────────────
//     cinco veces la misma comida
//
// No sale del cajon: sale del inventario y del numero que gobierna las compras. Un food
// cost inflado ordena de mas y esconde la merma real.

describe('se reconoce una cuenta de cobro de split', () => {
  it('el formato que produce el cobro hoy', () => {
    expect(esCuentaDeCobroDeSplit('abc-C1')).toBe(true)
    expect(esCuentaDeCobroDeSplit('abc-C12')).toBe(true)
  })

  it('y el del modelo durable de este modulo', () => {
    expect(esCuentaDeCobroDeSplit(cuentaDeSplit('abc', 3))).toBe(true)
  })

  it('la orden MADRE no lo es — es la que consume', () => {
    expect(esCuentaDeCobroDeSplit('abc')).toBe(false)
    expect(esCuentaDeCobroDeSplit(cuentaCompleta('abc'))).toBe(false)
  })
})

describe('ningun id real se confunde con una cuenta de split', () => {
  it('un UUID no colisiona', () => {
    // `generateId()` devuelve crypto.randomUUID(): hex MINUSCULA. La `C` mayuscula del
    // sufijo no puede aparecer ahi. Este es el caso que haria perder el descuento de
    // inventario de una orden normal, que es el error opuesto y peor.
    for (const id of [
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'c1c2c3c4-c5c6-c7c8-c9c0-c1c2c3c4c5c6',
      '00000000-0000-0000-0000-000000000001',
    ]) expect(esCuentaDeCobroDeSplit(id)).toBe(false)
  })

  it('ni el id de respaldo base36', () => {
    expect(esCuentaDeCobroDeSplit('m9x2k1-a7f3b2c91')).toBe(false)
  })

  it('ni algo que solo se le parezca', () => {
    expect(esCuentaDeCobroDeSplit('abc-C')).toBe(false)       // sin numero
    expect(esCuentaDeCobroDeSplit('abc-c1')).toBe(false)      // minuscula: no es el formato del cobro
    expect(esCuentaDeCobroDeSplit('abc-C1-extra')).toBe(false) // no termina ahi
  })

  it('y no truena con basura', () => {
    expect(esCuentaDeCobroDeSplit('')).toBe(false)
    expect(esCuentaDeCobroDeSplit(null as unknown as string)).toBe(false)
    expect(esCuentaDeCobroDeSplit(undefined as unknown as string)).toBe(false)
  })
})

describe('save-order no reconcilia una cuenta de split', () => {
  const ruta = readFileSync(
    join(__dirname, '..', 'app', 'api', 'pos', 'save-order', 'route.ts'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('consulta si el id es una cuenta de cobro', () => {
    expect(ruta).toMatch(/esCuentaDeCobroDeSplit\(order_id\)/)
  })

  it('y eso apaga la reconciliacion en el primer guardado', () => {
    expect(ruta).toMatch(/shouldReconcile = isFirstExecution && !esCobroDeSplit/)
  })

  it('tambien en el replay idempotente — si no, la cola lo descontaria al reintentar', () => {
    expect(ruta).toMatch(/isIdempotentReplay && committedRevision != null && !esCobroDeSplit/)
  })

  it('la orden normal SIGUE reconciliando: apagarlo de mas seria peor', () => {
    // Perder el descuento de una orden normal es el error opuesto y mas caro: el
    // inventario nunca bajaria y el food cost saldria irreal por el otro lado.
    expect(ruta).toMatch(/isFirstExecution/)
    expect(ruta).not.toMatch(/shouldReconcile = false\b/)
  })
})
