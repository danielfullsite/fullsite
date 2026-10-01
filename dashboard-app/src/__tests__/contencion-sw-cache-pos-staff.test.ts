// Contención PR3 (P-00, 2026-09-24): la versión del Service Worker sube junto con la
// migración que saca `pin` de lo que `authenticated` puede leer en pos_staff.
//
// Por qué importa: sw.js cachea /rest/v1/pos_staff (API_CACHE_PATTERNS). Las respuestas
// que ya estén en Cache Storage de una terminal no se invalidan con un cambio de
// privilegios en la base; solo el `activate` de un SW con CACHE_VERSION nueva borra los
// caches viejos. Esta prueba es de trinquete: si alguien revierte el bump o quita la
// limpieza del `activate`, falla.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')

describe('SW: el cache de pos_staff se invalida con la contención de PIN', () => {
  it('CACHE_VERSION es v49 o mayor', () => {
    const m = /const CACHE_VERSION = 'v(\d+)'/.exec(sw)
    expect(m, 'sw.js debe declarar CACHE_VERSION').not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(49)
  })

  it('los nombres de cache dependen de CACHE_VERSION (si no, el bump no purga nada)', () => {
    expect(sw).toMatch(/const API_CACHE = `fullsite-api-\$\{CACHE_VERSION\}`/)
    expect(sw).toMatch(/const DYNAMIC_CACHE = `fullsite-dynamic-\$\{CACHE_VERSION\}`/)
    expect(sw).toMatch(/const STATIC_CACHE = `fullsite-static-\$\{CACHE_VERSION\}`/)
  })

  it('activate borra todo cache que no sea de la versión actual', () => {
    const i = sw.indexOf("addEventListener('activate'")
    expect(i).toBeGreaterThan(-1)
    const bloque = sw.slice(i, i + 800)
    expect(bloque).toContain('key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== API_CACHE')
    expect(bloque).toContain('caches.delete(key)')
  })

  it('pos_staff sigue siendo una ruta que el SW cachea (por eso hace falta el bump)', () => {
    expect(sw).toContain('/\\/rest\\/v1\\/pos_staff/')
  })
})
