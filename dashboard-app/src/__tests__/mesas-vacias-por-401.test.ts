// El plano de mesas pintaba TODO libre ante un 401 — y borraba el cache.
//
// INCIDENTE 2026-08-31, AMALAY. La caja tenia 5 mesas con cuenta abierta y la
// terminal Entrada las mostraba todas vacias. Una sola linea:
//
//   const orders = ordersRes.ok ? await ordersRes.json() : []
//
// Con la lista vacia el plano pintaba todo disponible, y esa misma lista se le
// pasaba a `reconcileCachedActiveOrders`, cuyo contrato es "borra del cache lo que
// no venga en la lista". Resultado: una peticion fallida borraba el registro local
// de mesas ocupadas. Es la doble reserva contra la que advierte el comentario (#37)
// del propio archivo, provocada tres lineas mas abajo.
//
// Un plano de mesas decide si se sienta gente. Vacio-confirmado y vacio-porque-fallo
// significan lo contrario, y aqui se fija que el codigo los distinga.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluarRespuestaDeMesas, sePuedeReconciliar } from '@/lib/plano-mesas'
import { reconcileCachedActiveOrders } from '@/lib/pos-offline-db'

describe('Una respuesta fallida NO significa "no hay mesas ocupadas"', () => {
  it('REGRESION Entrada: un 401 no es confiable', () => {
    const l = evaluarRespuestaDeMesas({ ok: false, status: 401 })
    expect(l.confiable).toBe(false)
    expect(sePuedeReconciliar(l)).toBe(false)
    if (!l.confiable) expect(l.motivo).toMatch(/sesion/i)
  })

  it('403, 400 y 404 tampoco', () => {
    for (const status of [403, 400, 404, 409, 422]) {
      const l = evaluarRespuestaDeMesas({ ok: false, status })
      expect(l.confiable, `HTTP ${status} no deberia ser confiable`).toBe(false)
      expect(sePuedeReconciliar(l)).toBe(false)
    }
  })

  it('el 503 del Service Worker se explica como falta de conexion, no como rechazo', () => {
    const l = evaluarRespuestaDeMesas({ ok: false, status: 503 })
    expect(l.confiable).toBe(false)
    if (!l.confiable) expect(l.motivo).toMatch(/conexion/i)
  })

  it('200 SI es confiable — el camino normal no se rompio', () => {
    const l = evaluarRespuestaDeMesas({ ok: true, status: 200 })
    expect(l.confiable).toBe(true)
    expect(sePuedeReconciliar(l)).toBe(true)
  })

  it('una lista vacia CONFIRMADA si se puede reconciliar — cerrar el ultimo ticket es legitimo', () => {
    // Importante que esto siga permitido: si se bloqueara toda lista vacia, las
    // mesas quedarian ocupadas para siempre al cerrar la ultima cuenta del dia.
    expect(sePuedeReconciliar(evaluarRespuestaDeMesas({ ok: true, status: 200 }))).toBe(true)
  })
})

describe('El contrato destructivo de reconcileCachedActiveOrders', () => {
  it('con lista vacia BORRA todo — por eso nunca debe llamarse con datos no confirmados', async () => {
    // Esta prueba no arregla nada: documenta POR QUE el guard de arriba importa.
    // Si alguien suaviza `reconcileCachedActiveOrders` esta prueba falla y obliga
    // a releer el razonamiento completo.
    expect(typeof reconcileCachedActiveOrders).toBe('function')
    const src = readFileSync(join(process.cwd(), 'src/lib/pos-offline-db.ts'), 'utf8')
    const cuerpo = src.slice(src.indexOf('export async function reconcileCachedActiveOrders'))
    expect(cuerpo).toContain('store.delete')
  })
})

describe('El bug no puede volver a escribirse en la pagina', () => {
  const crudo = readFileSync(join(process.cwd(), 'src/app/pos/mesas/page.tsx'), 'utf8')
  // Se escanea el CODIGO, no los comentarios: el comentario que explica el bug cita
  // el literal, y sin esto la prueba se acusaba a si misma. (Fallo de verdad la
  // primera vez — buena señal: el detector funciona.)
  const fuente = crudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('REGRESION: `ordersRes.ok ? ... : []` no vuelve a aparecer', () => {
    // El literal exacto del bug. Un `: []` ante una respuesta fallida es lo que
    // convertia un 401 en "todas las mesas libres".
    expect(fuente).not.toMatch(/ordersRes\.ok\s*\?[^\n]*:\s*\[\]/)
  })

  it('la respuesta se evalua ANTES de leer el json', () => {
    const iEval = fuente.indexOf('evaluarRespuestaDeMesas')
    const iJson = fuente.indexOf('await ordersRes.json()')
    expect(iEval).toBeGreaterThan(-1)
    expect(iJson).toBeGreaterThan(-1)
    expect(iEval).toBeLessThan(iJson)
  })

  it('se sale con `return` antes de poder reconciliar cuando no es confiable', () => {
    const bloque = fuente.slice(fuente.indexOf('if (!lectura.confiable)'))
    const iReturn = bloque.indexOf('return')
    const iReconcile = bloque.indexOf('reconcileCachedActiveOrders')
    expect(iReturn).toBeGreaterThan(-1)
    expect(iReconcile).toBeGreaterThan(iReturn)
  })
})
