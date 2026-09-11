// El aviso de cierre no puede ser la única copia de un hecho.
//
// LABORATORIO, 2026-09-10 — electron-app/lab/videos-de-eduardo-ui.cjs, «Video de
// Eduardo 3, adversarial»: se pierde SÓLO el ORDER_CLOSED que sale al cobrar y la
// caja se queda creyendo que la mesa debe dinero. El lector de un segundo vuelve a
// pintar el platillo en la pantalla que acaba de cobrarlo, «Cobrar» se enciende, y
// se puede volver a cobrar. Es el video de Eduardo del 2026-08-24 palabra por
// palabra: «se cobra correctamente... si vuelves a ingresar, hay un platillo. Y se
// puede volver a cobrar.»
//
// La regla de aviso-cierre-a-la-lan.test.ts sigue: un aviso que falla NUNCA frena
// un cobro. Estas pruebas cubren la otra mitad: un aviso que falló se guarda y se
// reintenta hasta que llega, con el mismo command_id para que Pedro deduplique.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7717' }))
// Hay una caja a la que avisar (Electron, o puente configurado). Sin eso el aviso
// es de un solo intento y nada de lo de abajo aplica — ver la prueba al final.
let hayCaja = true
vi.mock('@/lib/pedro-cliente', () => ({ requiereCaja: () => hayCaja }))

const CLAVE = 'pos_avisos_lan_pendientes'
const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

const pendientes = () => JSON.parse(store[CLAVE] || '[]') as { command_id: string }[]

/** Lo que salió hacia Pedro, y cuántos pendientes había en el almacén al salir. */
const enviados: { command_id: string; command_type: string; order_id: string; pendientesAlSalir: number }[] = []
/** Cada envío consume el siguiente resultado; el último se repite. */
let plan: Array<{ ok: boolean; status?: number } | Error> = [{ ok: true }]
function programar(...resultados: typeof plan) { plan = resultados }
vi.mock('@/lib/local-network-fetch', () => ({
  localNetworkFetch: async (_url: string, init: RequestInit) => {
    enviados.push({ ...JSON.parse(String(init.body)), pendientesAlSalir: pendientes().length })
    const r = plan.length > 1 ? plan.shift()! : plan[0]
    if (r instanceof Error) throw r
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500) } as Response
  },
}))

beforeEach(() => {
  enviados.length = 0
  localStorage.clear()
  plan = [{ ok: true }]
  hayCaja = true
  vi.resetModules()
})
afterEach(async () => {
  (await import('@/lib/aviso-lan')).detenerReintentos()
  vi.useRealTimers()
})

const cargar = () => import('@/lib/aviso-lan')
const cierre = (op: string, orden = 'ord-1') => ({ opId: op, orderId: orden, clientId: 'amalay', mesa: 3, turnoId: 't1' })

describe('Un aviso que no llegó se guarda; uno que llegó, no', () => {
  it('REGRESION: sin LAN el aviso queda pendiente en disco', async () => {
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden } = await cargar()
    expect(await avisarCierreDeOrden(cierre('op-1'))).toBe(false)
    expect(pendientes().map(p => p.command_id)).toEqual(['cierre:op-1'])
  })

  it('un 502 del reenvío a la caja también lo deja pendiente', async () => {
    // Es lo que devuelve el Pedro de una terminal secundaria cuando la caja no
    // contesta (index.js, «forward to caja failed»): no guarda nada, sólo avisa.
    programar({ ok: false, status: 502 })
    const { avisarCierreDeOrden } = await cargar()
    expect(await avisarCierreDeOrden(cierre('op-2'))).toBe(false)
    expect(pendientes()).toHaveLength(1)
  })

  it('entregado a la primera: no queda nada guardado', async () => {
    programar({ ok: true })
    const { avisarCierreDeOrden } = await cargar()
    expect(await avisarCierreDeOrden(cierre('op-3'))).toBe(true)
    expect(store[CLAVE]).toBeUndefined()
  })

  it('se guarda ANTES de mandar: si la pestaña muere a media llamada, el aviso sobrevive', async () => {
    // El cobro navega al mapa con `location.replace`. Si el aviso se guardara sólo
    // al fallar, una pestaña que muere con el fetch en vuelo lo perdería igual.
    programar({ ok: true })
    const { avisarCierreDeOrden } = await cargar()
    await avisarCierreDeOrden(cierre('op-4'))
    expect(enviados[0].pendientesAlSalir).toBe(1)
    expect(store[CLAVE]).toBeUndefined()
  })
})

describe('Lo pendiente se reintenta hasta que llega, y con el mismo command_id', () => {
  it('REGRESION: el reintento entrega el aviso perdido y lo olvida', async () => {
    programar(new Error('Failed to fetch'), { ok: true })
    const { avisarCierreDeOrden, reintentarAvisosPendientes } = await cargar()
    await avisarCierreDeOrden(cierre('op-5'))
    expect(pendientes()).toHaveLength(1)

    const r = await reintentarAvisosPendientes()

    expect(r).toEqual({ pendientes: 0, entregados: 1 })
    expect(store[CLAVE]).toBeUndefined()
    // Mismo command_id en el reintento: Pedro deduplica por él, así que un
    // reintento de más nunca produce un segundo evento.
    expect(enviados.map(e => e.command_id)).toEqual(['cierre:op-5', 'cierre:op-5'])
  })

  it('si el reintento también falla, sigue pendiente', async () => {
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden, reintentarAvisosPendientes } = await cargar()
    await avisarCierreDeOrden(cierre('op-6'))
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 1, entregados: 0 })
    expect(pendientes()).toHaveLength(1)
  })

  it('dos taps del mismo cobro: UNA entrada pendiente, no dos', async () => {
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden } = await cargar()
    await avisarCierreDeOrden(cierre('op-7'))
    await avisarCierreDeOrden(cierre('op-7'))
    expect(pendientes()).toHaveLength(1)
  })

  it('varios cierres perdidos se entregan todos, en orden', async () => {
    programar(new Error('Failed to fetch'), new Error('Failed to fetch'), { ok: true })
    const { avisarCierreDeOrden, reintentarAvisosPendientes } = await cargar()
    await avisarCierreDeOrden(cierre('op-8', 'ord-8'))
    await avisarCierreDeOrden(cierre('op-9', 'ord-9'))
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 0, entregados: 2 })
    expect(enviados.slice(2).map(e => e.order_id)).toEqual(['ord-8', 'ord-9'])
  })

  it('dos pasadas solapadas comparten la misma: no se manda doble', async () => {
    programar(new Error('Failed to fetch'), { ok: true })
    const { avisarCierreDeOrden, reintentarAvisosPendientes } = await cargar()
    await avisarCierreDeOrden(cierre('op-10'))
    const [a, b] = await Promise.all([reintentarAvisosPendientes(), reintentarAvisosPendientes()])
    expect(a).toEqual(b)
    expect(enviados).toHaveLength(2)
  })

  it('el tope conserva los MÁS RECIENTES', async () => {
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden, MAX_AVISOS_PENDIENTES } = await cargar()
    for (let i = 0; i < MAX_AVISOS_PENDIENTES + 5; i++) await avisarCierreDeOrden(cierre(`op-${i}`, `ord-${i}`))
    const ids = pendientes().map(p => p.command_id)
    expect(ids).toHaveLength(MAX_AVISOS_PENDIENTES)
    expect(ids[ids.length - 1]).toBe(`cierre:op-${MAX_AVISOS_PENDIENTES + 4}`)
    expect(ids).not.toContain('cierre:op-0')
  })
})

describe('El temporizador de reintentos se enciende solo y se apaga solo', () => {
  it('arranca al fallar un aviso, entrega en el siguiente tic y se detiene al vaciarse', async () => {
    vi.useFakeTimers()
    programar(new Error('Failed to fetch'), { ok: true })
    const { avisarCierreDeOrden, hayReintentosProgramados } = await cargar()
    await avisarCierreDeOrden(cierre('op-11'))
    expect(hayReintentosProgramados()).toBe(true)

    await vi.advanceTimersByTimeAsync(3_100)

    expect(store[CLAVE]).toBeUndefined()
    expect(hayReintentosProgramados()).toBe(false)
  })

  it('sigue intentando mientras siga fallando', async () => {
    vi.useFakeTimers()
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden, hayReintentosProgramados } = await cargar()
    await avisarCierreDeOrden(cierre('op-12'))
    await vi.advanceTimersByTimeAsync(9_500)
    expect(enviados.length).toBeGreaterThanOrEqual(4)
    expect(hayReintentosProgramados()).toBe(true)
    expect(pendientes()).toHaveLength(1)
  })

  it('sin pendientes no arranca nada', async () => {
    const { asegurarReintentos, hayReintentosProgramados } = await cargar()
    expect(asegurarReintentos()).toBe(false)
    expect(hayReintentosProgramados()).toBe(false)
  })

  it('sin una caja a la que avisar (POS web sin Electron ni puente) es de un solo intento: nada se guarda ni se reintenta', async () => {
    // Un tenant que usa el POS desde el navegador no tiene Pedro. Guardar el aviso
    // y reintentarlo cada 3 s ahí sería un temporizador eterno contra 127.0.0.1.
    hayCaja = false
    programar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden, hayReintentosProgramados } = await cargar()
    expect(await avisarCierreDeOrden(cierre('op-web'))).toBe(false)
    expect(enviados).toHaveLength(1)
    expect(store[CLAVE]).toBeUndefined()
    expect(hayReintentosProgramados()).toBe(false)
  })

  it('con pendientes de una sesión anterior, el arranque los reintenta', async () => {
    // El cajero cobró, la LAN falló, y la terminal navegó al mapa (navegación
    // completa) o se reinició. Lo pendiente no puede depender de que alguien
    // vuelva a abrir una mesa.
    store[CLAVE] = JSON.stringify([{ command_id: 'cierre:viejo', command_type: 'ORDER_CLOSED', order_id: 'ord-v', client_id: 'amalay' }])
    programar({ ok: true })
    const { asegurarReintentos, reintentarAvisosPendientes } = await cargar()
    expect(asegurarReintentos()).toBe(true)
    await reintentarAvisosPendientes()
    expect(enviados.map(e => e.command_id)).toEqual(['cierre:viejo'])
    expect(store[CLAVE]).toBeUndefined()
  })

  it('un almacén corrupto no rompe nada: se trata como vacío', async () => {
    store[CLAVE] = '{esto no es json'
    programar({ ok: true })
    const { avisarCierreDeOrden, leerAvisosPendientes } = await cargar()
    expect(leerAvisosPendientes()).toEqual([])
    expect(await avisarCierreDeOrden(cierre('op-13'))).toBe(true)
  })

  it('una entrada sin order_id en el almacén se ignora, no se manda', async () => {
    store[CLAVE] = JSON.stringify([{ command_id: 'x', command_type: 'ORDER_CLOSED', client_id: 'amalay' }])
    const { reintentarAvisosPendientes } = await cargar()
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 0, entregados: 0 })
    expect(enviados).toHaveLength(0)
  })
})

describe('El cableado existe en el layout del POS', () => {
  // El POS navega al mapa con `location.replace` (navegación completa): el módulo
  // que arrancó el reintento muere con la página. El layout es lo único que vive en
  // TODAS las rutas del POS, y ya arranca así la cola de impresión.
  it('REGRESION: pos/layout.tsx arranca los reintentos al montar', () => {
    const layout = fs.readFileSync(path.join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(layout).toMatch(/import\('@\/lib\/aviso-lan'\)\.then\(m => m\.asegurarReintentos\(\)\)/)
  })

  it('REGRESION: cuando Caja dice «cerrada», la pantalla pinta sólo lo que la caché conserva', () => {
    // Laboratorio 2026-09-10, corrida 6: el aviso llegó tarde, Caja liberó la mesa,
    // y la pantalla que la había cobrado seguía mostrando el café con «Cobrar» a
    // la vista. La caché ya se limpiaba (18eff681); la pantalla no.
    const pos = fs.readFileSync(path.join(process.cwd(), 'src/app/pos/page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const rama = pos.slice(pos.indexOf("if (result.estado === 'cerrada')"))
    const cierre = rama.slice(0, rama.indexOf('return result'))
    expect(cierre).toMatch(/const queda = olvidarCuentaCerrada\('cerrada-en-caja'\)/)
    expect(cierre).toMatch(/setOrderItems\(propios\)/)
    expect(cierre).toMatch(/setSentItemIds\(new Set\(\)\)/)
  })
})
