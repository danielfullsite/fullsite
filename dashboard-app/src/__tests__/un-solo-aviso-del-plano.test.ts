// EL MISMO HECHO NO SE AVISA DOS VECES.
//
// Campo, AMALAY, 2026-09-13, y reproducido en una terminal limpia el 14: el plano
// de mesas pintaba DOS franjas amarillas idénticas, una encima de la otra, las dos
// diciendo «La caja todavía no confirmó todas las cuentas».
//
// Las dos nacían del mismo dato —`salon.completa === false`— por caminos
// distintos: `avisoDeProcedencia(procedenciaSalon)` y `planoNoVerificado`. Juntas
// se comían ~150 px de los 632 útiles que tiene una caja a 1024×768, que es justo
// el espacio donde van las mesas.
//
// Y había algo peor que la repetición: cuando NO hay conexión con la caja,
// `planoNoVerificado` seguía diciendo «no confirmó las cuentas» —sólo mira
// `completa`— cuando la causa real es que no hay con quién confirmar.
// `avisoDeProcedencia` sí distingue las dos causas, así que manda él.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const plano = readFileSync(new URL('../app/pos/mesas/page.tsx', import.meta.url), 'utf8')
const sinComentarios = plano.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

describe('el plano de mesas avisa una sola vez', () => {
  it('REGRESION: hay UNA sola franja de aviso, no dos', () => {
    // La franja se reconoce por su fondo ámbar; dos ocurrencias son dos banners.
    const franjas = sinComentarios.match(/bg-amber-500\/15 border-b border-amber-500\/30/g) || []
    expect(franjas.length, `se esperaba una franja de aviso y hay ${franjas.length}`).toBe(1)
  })

  it('REGRESION: un solo botón «Reintentar» en los avisos', () => {
    const reintentar = sinComentarios.match(/Reintentar/g) || []
    expect(reintentar.length, 'dos botones «Reintentar» significan dos avisos').toBe(1)
  })

  it('el título del aviso sale de la fuente que SÍ distingue la causa', () => {
    // `avisoDeProcedencia` separa «no confirmó» de «sin conexión con la caja».
    // `planoNoVerificado` sólo queda como respaldo cuando aún no hay lectura.
    expect(sinComentarios).toMatch(/avisoDeProcedencia\(procedenciaSalon\)\s*\)\s*\|\|\s*planoNoVerificado/)
  })

  it('se conserva la consecuencia para quien opera', () => {
    // El aviso sin el «qué hago con esto» es ruido: es la única línea que le dice
    // al mesero por qué no debe sentar a nadie todavía.
    expect(plano).toMatch(/confirma en la caja antes de sentar/i)
    expect(plano).toMatch(/no reflejar las cuentas/i)
  })
})
