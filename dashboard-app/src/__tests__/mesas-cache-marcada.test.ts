// Un 200 del Service Worker puede ser una respuesta GUARDADA, no fresca.
//
// INCIDENTE 2026-08-31, AMALAY. La terminal Entrada mostraba solo las mesas 1 a 5
// con la mesa 7 abierta desde las 22:45. La caja, correcta. El plano refresca cada
// 3 segundos, asi que "no habia refrescado" no lo explicaba.
//
// El mecanismo: Entrada iba lenta. `networkFirstWithCache` acota el intento de red;
// al pasarse, cae al catch y devuelve la copia guardada CON SU 200 ORIGINAL. Para la
// pagina era indistinguible de un dato fresco: la pintaba como verdad y ademas la
// reconciliaba a IndexedDB, volviendo permanente lo viejo.
//
// `cache: 'no-store'` NO alcanza: afecta la pata de red, pero el SW igual sirve la
// copia desde el catch. Por eso el arreglo va en el SW (marcar) y en la pagina (leer
// la marca). Servir cache sin red se CONSERVA — es lo que sostiene el offline. Lo
// que se prohibe es servirla sin decirlo.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluarRespuestaDeMesas, sePuedeReconciliar } from '@/lib/plano-mesas'

const conMarca = (v: string | null) => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n === 'X-Fullsite-Stale' ? v : null) },
})

describe('Un 200 marcado como guardado no es verdad fresca', () => {
  it('REGRESION Entrada: 200 con X-Fullsite-Stale NO es confiable', () => {
    const l = evaluarRespuestaDeMesas(conMarca('1'))
    expect(l.confiable).toBe(false)
    expect(sePuedeReconciliar(l)).toBe(false)
    if (!l.confiable) expect(l.motivo).toMatch(/guardados/i)
  })

  it('un 200 SIN la marca sigue siendo confiable — el camino normal no se rompio', () => {
    expect(evaluarRespuestaDeMesas(conMarca(null)).confiable).toBe(true)
  })

  it('una respuesta sin headers no truena — pantallas y pruebas viejas siguen sirviendo', () => {
    expect(evaluarRespuestaDeMesas({ ok: true, status: 200 }).confiable).toBe(true)
  })

  it('la marca gana sobre el status: ni un 200 la salva', () => {
    // Importante el orden: si se evaluara `res.ok` primero, la marca no serviria.
    expect(evaluarRespuestaDeMesas(conMarca('1')).confiable).toBe(false)
  })
})

describe('El Service Worker marca lo que sirve de cache', () => {
  const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')

  it('las respuestas de API guardadas salen marcadas — SE LLAMA, no solo se define', () => {
    // La primera version de esta prueba solo buscaba el texto del helper. Borrar la
    // LLAMADA pasaba 9/9: el helper seguia definido y nunca se usaba. Una prueba que
    // no falla con el bug puesto no prueba nada. Ahora se exige el punto de uso, en
    // la rama que devuelve cache.
    expect(sw).toContain("headers.set('X-Fullsite-Stale', '1')")
    expect(sw).toMatch(/if \(cached\) return esApi \? marcarComoGuardada\(cached\) : cached/)
  })

  it('las rutas de API pasan esApi=true', () => {
    expect(sw).toMatch(/networkFirstWithCache\(request,\s*API_CACHE,\s*true\)/)
  })

  it('REGRESION: ignoreSearch NO aplica a API — el query string ES la consulta', () => {
    // Con ignoreSearch, un `pos_orders?status=in.(enviada)` podia responderse con el
    // cache de un `pos_orders?` distinto. Para HTML si es correcto (/pos?mesa=3
    // empata con /pos), por eso la rama sigue existiendo para no-API.
    const cuerpo = sw.slice(sw.indexOf('async function networkFirstWithCache'))
    const bloque = cuerpo.slice(0, cuerpo.indexOf('\n}\n'))
    expect(bloque).toContain('esApi')
    const iEsApi = bloque.indexOf('const cached = esApi')
    const iIgnore = bloque.indexOf('ignoreSearch')
    expect(iEsApi).toBeGreaterThan(-1)
    expect(iIgnore).toBeGreaterThan(iEsApi) // ignoreSearch queda en la rama NO-api
  })

  it('la version del SW subio — sin esto las terminales no adoptan el cambio', () => {
    const m = /const CACHE_VERSION = 'v(\d+)'/.exec(sw)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(43)
  })
})

describe('Las consultas del plano piden datos frescos', () => {
  // Se escanea CODIGO, no comentarios: el comentario que explica el arreglo cita
  // 'no-store' y hacia que la prueba se contara a si misma. (Mismo tropiezo que en
  // mesas-vacias-por-401; la regla es que estos escaneres siempre limpien primero.)
  const pagina = readFileSync(join(process.cwd(), 'src/app/pos/mesas/page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it("las dos consultas de estado vivo llevan cache: 'no-store'", () => {
    // No basta por si solo (el SW sirve desde el catch), pero evita que el cache HTTP
    // del navegador meta una tercera capa de datos viejos.
    const bloque = pagina.slice(pagina.indexOf('const [ordersRes, resRes]'))
    const hasta = bloque.slice(0, bloque.indexOf('])'))
    expect((hasta.match(/no-store/g) || []).length).toBe(2)
  })
})
