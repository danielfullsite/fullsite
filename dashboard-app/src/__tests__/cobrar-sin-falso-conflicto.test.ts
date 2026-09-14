// EL RELOJ DE LA TERMINAL NO PUEDE DECIDIR SI UNA ORDEN TIENE CONFLICTO.
//
// Campo, AMALAY, 2026-09-13 (palabras de Daniel): «al tratar de cobrar me sale
// esta orden fue modificada por otro usuario». Nadie la había modificado.
//
// La cadena: `checkOrderConflict` compara el `updated_at` del servidor contra la
// copia que guardó la pantalla (`loadedUpdatedAt`). Tras Enviar, esa copia se
// releía del servidor — y cuando la relectura fallaba, o no traía fila, o la
// respuesta no era `ok`, el código la rellenaba con `new Date().toISOString()`:
// el reloj de la terminal. Esa marca se guardaba además en la caché local de la
// mesa (`pos_order_<mesa>`), de donde se relee al volver. Dos relojes distintos
// no coinciden jamás → conflicto inventado → no se puede cobrar.
//
// La regla que protege esta prueba: esa marca sale del servidor o no existe.
// `null` significa «no hay conflicto detectable», y la defensa real contra el
// doble cobro sigue siendo la de `saveOrder` — `expected_revision` (OCC) y
// `save_operation_id` (idempotencia).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fuente = readFileSync(new URL('../app/pos/page.tsx', import.meta.url), 'utf8')

describe('la marca de concurrencia nunca se fabrica en el cliente', () => {
  it('REGRESION: ningún camino asigna `loadedUpdatedAt` con el reloj de la terminal', () => {
    const fabricados = fuente
      .split('\n')
      .filter(l => /setLoadedUpdatedAt\s*\(\s*new Date\(\)/.test(l))
    expect(fabricados, `estas líneas inventan la marca:\n${fabricados.join('\n')}`).toHaveLength(0)
  })

  it('REGRESION: la caché de la mesa no guarda un `updatedAt` inventado', () => {
    const cache = fuente.split('\n').filter(l => l.includes('pos_order_${mesa}') && l.includes('localStorage.setItem'))
    expect(cache.length, 'se esperaba una escritura de caché por mesa').toBeGreaterThan(0)
    for (const linea of cache) {
      expect(linea, `la caché no puede sellar la orden con el reloj local:\n${linea}`)
        .not.toMatch(/updatedAt:\s*new Date\(\)\.toISOString\(\)/)
    }
  })

  it('el lector de la marca devuelve null cuando el servidor no contesta, no una fecha', () => {
    const i = fuente.indexOf('const marcaDelServidor = async')
    expect(i, 'debe existir un único lector de la marca').toBeGreaterThan(-1)
    const cuerpo = fuente.slice(i, fuente.indexOf('const checkOrderConflict', i))
    expect(cuerpo).toMatch(/if \(!res\.ok\) return \{ updatedAt: null \}/)
    expect(cuerpo).toMatch(/catch \{ return \{ updatedAt: null \} \}/)
    expect(cuerpo).not.toMatch(/new Date\(\)/)
  })

  it('y con marca nula el chequeo deja pasar el cobro en vez de bloquearlo', () => {
    const i = fuente.indexOf('const checkOrderConflict = async')
    const cuerpo = fuente.slice(i, i + 600)
    // `!loadedUpdatedAt` → `return false` = «no hay conflicto detectable».
    expect(cuerpo).toMatch(/if \(!loadedOrderId \|\| !loadedUpdatedAt\) return false/)
  })
})
