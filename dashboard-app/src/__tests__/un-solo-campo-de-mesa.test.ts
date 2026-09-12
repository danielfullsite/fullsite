// UN SOLO CAMPO DE MESA, Y CON SU GUARDA.
//
// `CIERRE-DEFECTOS-2026-09-06` describió esto: escribir otro número en el campo
// de mesa del editor no mueve la cuenta —vive en Pedro— sino que cambia QUÉ mesa
// lee la pantalla, y los renglones sin enviar que había se anexaban a la cuenta
// de la mesa destino en la primera lectura, sin PIN y sin aviso.
//
// Se corrigió… en uno de los dos campos. El editor tenía DOS entradas ligadas a
// `mesa`: la de la barra superior, con la guarda, y otra en la cabecera de la
// comanda que hacía `setMesa(v)` pelado. Al fundir las dos cabeceras (trabajo
// táctil del 2026-09-12) desapareció la copia sin guarda.
//
// Esta prueba lee el fuente porque es una afirmación sobre el fuente: que no
// vuelva a existir una segunda entrada de mesa. Si alguien añade otra, aquí se
// cae; si alguien le quita la guarda a la que queda, también.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fuente = readFileSync(new URL('../app/pos/page.tsx', import.meta.url), 'utf8')

describe('el editor tiene una sola entrada de mesa', () => {
  it('REGRESION: no hay un segundo campo ligado a `mesa` sin la guarda de transferencia', () => {
    const entradas = fuente.split('<input').filter(fragmento => {
      const cabeza = fragmento.slice(0, 800)
      return /type="number"/.test(cabeza) && /value=\{mesa\}/.test(cabeza)
    })
    expect(entradas.length, 'sólo la barra superior puede tener el campo de mesa').toBe(1)
    // Y esa que queda conserva el desvío a «Transferir mesa» en modo Caja.
    expect(entradas[0]).toMatch(/Para mover esta cuenta usa «Transferir mesa»/)
    expect(entradas[0]).toMatch(/requiereCaja\(\) && orderItems\.length > 0 && newMesa !== mesa/)
  })

  it('el total y el saldo de Caja siguen a la vista, una sola vez', () => {
    expect(fuente.match(/Saldo confirmado en Caja:/g)?.length ?? 0).toBe(1)
    expect(fuente).toMatch(/lecturaCuentaCaja\?\.orden\?\.saldo != null/)
  })
})
