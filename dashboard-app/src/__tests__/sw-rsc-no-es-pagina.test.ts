// Una respuesta RSC no sirve como pagina.
//
// INCIDENTE 2026-08-31, AMALAY. La pantalla de empleados (/pos/staff) mostraba el
// payload de Next en crudo como texto plano:
//
//   :HL["/_next/static/chunks/04b11kykjbv~h.css","style"]
//   {"children":{"name":"staff","param":null,...}},"staleTime":300,"buildId":"..."
//
// CADENA
//
// Al navegar dentro del POS, Next pide la MISMA URL con cabecera RSC. Esa peticion
// trae `accept: */*`, asi que NO entra por la rama de navegacion (que filtra por
// `accept: text/html`): cae al catch-all stale-while-revalidate, que la guarda bajo
// la URL. Su content-type es `text/x-component`.
//
// Despues, al abrir esa URL como pagina, el match exacto falla —la entrada trae
// `Vary: RSC, Next-Router-State-Tree`— pero el respaldo con `ignoreVary: true`
// empata igual y devuelve el flight como si fuera HTML.
//
// `ignoreVary` NO se quita: existe por una razon buena y probada (que /pos?mesa=1
// empate con /pos cacheado durante un corte, T-25). Lo que se agrega es el filtro
// por content-type al SERVIR una navegacion.
//
// El SW no se puede importar como modulo, asi que estas pruebas leen su fuente. Es
// el mismo enfoque que offline-sw.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
const cuerpoNavegacion = (() => {
  const i = sw.indexOf('async function navigationFromCache')
  return sw.slice(i, sw.indexOf('\n}\n', i))
})()

describe('Una navegacion nunca recibe un payload RSC', () => {
  it('REGRESION: la entrada de cache se filtra por content-type antes de servirse', () => {
    expect(sw).toContain('function esRespuestaRSC')
    expect(sw).toContain('text/x-component')
    expect(cuerpoNavegacion, 'el filtro debe aplicarse AL SERVIR la navegacion')
      .toContain('esRespuestaRSC')
  })

  it('si la entrada es RSC, se va a la red en vez de servirla', () => {
    // El `null` es lo que fuerza el camino de red: sin eso, `cached` seguiria
    // trayendo el flight y el navegador lo pintaria como texto.
    expect(cuerpoNavegacion).toMatch(/esRespuestaRSC\(flexible\)\s*\?\s*flexible\s*:\s*null/)
    expect(cuerpoNavegacion).toContain('if (!cached) return networkFirstWithCache')
  })

  it('ignoreVary SIGUE existiendo — se conserva a proposito', () => {
    // Quitarlo romperia que /pos?mesa=1 empate con /pos cacheado durante un corte,
    // que es de lo que depende el arranque en frio (T-25). El arreglo es el filtro,
    // no quitar el emparejamiento flexible.
    expect(cuerpoNavegacion).toContain('ignoreVary: true')
    expect(cuerpoNavegacion).toContain('ignoreSearch: true')
  })

  it('el match exacto se sigue intentando primero', () => {
    const iExacto = cuerpoNavegacion.indexOf('caches.match(request)')
    const iFlexible = cuerpoNavegacion.indexOf('ignoreVary: true')
    expect(iExacto).toBeGreaterThan(-1)
    expect(iExacto, 'exacto antes que flexible').toBeLessThan(iFlexible)
  })

  it('la version del SW subio — sin eso las terminales no lo adoptan', () => {
    const m = /const CACHE_VERSION = 'v(\d+)'/.exec(sw)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(45)
  })
})
