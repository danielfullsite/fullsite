// H3 · El POS consume a Pedro, y sabe cuándo NO puede confiar en lo que ve.
//
// ── EL HUECO QUE CIERRA ──────────────────────────────────────────────────────
//
// El reenvío de lectura hacia la caja se construyó, se probó… y NADIE lo usaba.
// El mapa de mesas seguía sondeando Supabase cada 3 s, así que sin internet cada
// terminal se quedaba con lo suyo: tres cajas, tres versiones del salón. Es el
// reporte de campo del 2026-09-02 (Eduardo Esquivel, AMALAY).
//
// ── QUÉ SE PRUEBA AQUÍ, Y CÓMO ───────────────────────────────────────────────
//
// Un servidor HTTP REAL en un puerto real hace de Pedro y contesta lo que
// contestaría de verdad. Las aserciones son sobre lo que el cliente concluyó a
// partir de una respuesta que viajó por la red — no sobre el texto del código.
//
// La regla que sostiene todo: una lectura degradada NUNCA se usa como si fuera
// autoritativa. Presentar un salón parcial como la verdad es exactamente el bug
// que costó la semana.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

let puerto = 0
let respuesta: { status: number; cuerpo: unknown } = { status: 200, cuerpo: {} }
const pedidos: string[] = []
let servidor: http.Server

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    pedidos.push(req.url || '')
    res.writeHead(respuesta.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(respuesta.cuerpo))
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()))
  puerto = (servidor.address() as AddressInfo).port

  // El cliente pregunta a `getBridgeUrl()`; se le apunta al Pedro de mentiras.
  vi.doMock('@/lib/bridge-url', () => ({ getBridgeUrl: () => `http://127.0.0.1:${puerto}` }))
  // `localNetworkFetch` mete cabeceras de red privada que aquí no hacen falta.
  vi.doMock('@/lib/local-network-fetch', () => ({
    localNetworkFetch: (u: string, init?: RequestInit) => fetch(u, init),
  }))
})

afterAll(async () => {
  await new Promise<void>((r) => { servidor.closeAllConnections?.(); servidor.close(() => r()) })
})

const cargar = () => import('@/lib/pedro-cliente')

const SALON_DE_LA_CAJA = {
  sequence: 42,
  authoritative: true,
  source: 'caja',
  kds_orders: [
    { id: 'o-1', mesa: 3, mesero: 'Ana', status: 'enviada', total: 540, created_at: '2026-09-03T20:00:00Z' },
    { id: 'o-2', mesa: 7, mesero: 'Luis', status: 'preparando', total: 1200.5, created_at: '2026-09-03T20:10:00Z' },
  ],
}

describe('Cuando la caja contesta', () => {
  it('REGRESION: la lectura es AUTORITATIVA y trae el salón completo', async () => {
    respuesta = { status: 200, cuerpo: SALON_DE_LA_CAJA }
    const { leerSalon, debeUsarPedro } = await cargar()

    const s = await leerSalon()

    expect(s.autoritativa).toBe(true)
    expect(s.procedencia).toBe('caja')
    expect(s.sequence).toBe(42)
    expect(s.ordenes).toHaveLength(2)
    expect(debeUsarPedro(s), 'con la caja viva, Pedro manda sobre la nube').toBe(true)
  })

  it('las órdenes se traducen a lo que pinta el mapa de mesas', async () => {
    respuesta = { status: 200, cuerpo: SALON_DE_LA_CAJA }
    const { leerSalon, aOrdenesDelSalon } = await cargar()

    const ordenes = aOrdenesDelSalon((await leerSalon()).ordenes)

    expect(ordenes.map(o => o.mesa)).toEqual([3, 7])
    expect(ordenes[1].total).toBeCloseTo(1200.5, 2)
    expect(ordenes[0].mesero).toBe('Ana')
  })

  it('no hay nada que avisarle al operador', async () => {
    respuesta = { status: 200, cuerpo: SALON_DE_LA_CAJA }
    const { leerSalon, avisoDeProcedencia } = await cargar()
    expect(avisoDeProcedencia(await leerSalon())).toBeNull()
  })
})

describe('Cuando se perdió la caja', () => {
  const DEGRADADO = {
    sequence: 3, authoritative: false, source: 'local-degradado',
    kds_orders: [{ id: 'solo-mia', mesa: 1, mesero: 'Ana', status: 'enviada', total: 100 }],
  }

  it('REGRESION: NO se usa como autoritativa, aunque venga con 200 y con datos', async () => {
    // Es la regla entera. Ese `kds_orders` tiene UNA orden y parece un salón
    // válido: es lo que vio ESTA terminal, no el restaurante. Con tres cajas, lo
    // que falta son justo las mesas de las otras dos.
    respuesta = { status: 200, cuerpo: DEGRADADO }
    const { leerSalon, debeUsarPedro } = await cargar()

    const s = await leerSalon()

    expect(s.procedencia).toBe('local-degradado')
    expect(s.autoritativa).toBe(false)
    expect(debeUsarPedro(s), 'un salón parcial NUNCA sustituye al real').toBe(false)
  })

  it('REGRESION: se le AVISA al operador', async () => {
    respuesta = { status: 200, cuerpo: DEGRADADO }
    const { leerSalon, avisoDeProcedencia } = await cargar()

    const aviso = avisoDeProcedencia(await leerSalon())

    expect(aviso).toBeTruthy()
    expect(aviso).toMatch(/caja/i)
    expect(aviso, 'debe decir qué puede faltar, no sólo que algo pasó').toMatch(/terminal/i)
  })
})

describe('Cuando Pedro no está', () => {
  it('REGRESION: no se usa y NO se alarma — es lo normal fuera de una terminal', async () => {
    respuesta = { status: 503, cuerpo: {} }
    const { leerSalon, debeUsarPedro, avisoDeProcedencia } = await cargar()

    const s = await leerSalon()

    expect(s.procedencia).toBe('sin-pedro')
    expect(debeUsarPedro(s)).toBe(false)
    expect(avisoDeProcedencia(s), 'sin Pedro se cae al camino de antes, sin ruido').toBeNull()
    expect(s.motivo).toMatch(/503/)
  })

  it('una respuesta ilegible tampoco se usa', async () => {
    respuesta = { status: 200, cuerpo: 'esto no es el salón' }
    const { leerSalon, debeUsarPedro } = await cargar()
    expect(debeUsarPedro(await leerSalon())).toBe(false)
  })
})

describe('El cursor y los eventos', () => {
  it('REGRESION: se pide con `since` — sin él la caja devuelve el día entero', async () => {
    pedidos.length = 0
    respuesta = { status: 200, cuerpo: { events: [{ sequence: 43 }, { sequence: 44 }] } }
    const { leerEventosDesde } = await cargar()

    const r = await leerEventosDesde(42)

    expect(pedidos.some(u => u.includes('since=42')), `se pidió: ${pedidos.join(', ')}`).toBe(true)
    expect(r.determinado).toBe(true)
    expect(r.eventos).toHaveLength(2)
  })

  it('REGRESION: un fallo devuelve `determinado: false`, NO una lista vacía', async () => {
    // "No hay nada nuevo" y "no pude preguntar" no son lo mismo. Confundirlos es
    // la familia de bugs que costó la semana; hay un trinquete en CI por eso.
    respuesta = { status: 500, cuerpo: {} }
    const { leerEventosDesde } = await cargar()

    const r = await leerEventosDesde(42)

    expect(r.determinado).toBe(false)
    expect(r.eventos).toEqual([])
    expect(r.motivo).toMatch(/500/)
  })

  it('un cursor inválido no rompe la petición', async () => {
    pedidos.length = 0
    respuesta = { status: 200, cuerpo: { events: [] } }
    const { leerEventosDesde } = await cargar()
    await leerEventosDesde(-5 as number)
    expect(pedidos.some(u => u.includes('since=0'))).toBe(true)
  })
})

describe('Traducción defensiva', () => {
  it('una orden sin id se descarta — no se puede reconciliar con nada', async () => {
    const { aOrdenesDelSalon } = await cargar()
    expect(aOrdenesDelSalon([{ mesa: 3 }, { id: 'ok', mesa: 4 }])).toHaveLength(1)
  })

  it('campos corruptos no tumban el mapa', async () => {
    const { aOrdenesDelSalon } = await cargar()
    const [o] = aOrdenesDelSalon([{ id: 'x', mesa: 'no-numero', total: 'gratis' }])
    expect(o.mesa).toBeNull()
    expect(o.total).toBe(0)
  })
})

// AL FINAL A PROPOSITO: este bloque llama `vi.resetModules()` y re-mockea
// `bridge-url` a un puerto muerto. Todo lo que se importe DESPUES hereda ese
// mock — en medio del archivo dejaba a las pruebas del cursor apuntando a un
// puerto donde nadie escucha. Costo una corrida; queda anotado para que nadie
// lo suba de lugar.
describe('Pedro inalcanzable (va al final: cambia el mock para el resto)', () => {
  it('REGRESION: leerSalon NUNCA lanza aunque la conexión se rechace', async () => {
    // El mapa de mesas no puede quedarse en blanco porque el servidor local no
    // esté. `vi.resetModules()` + `doMock` ANTES del import: mockear después no
    // afecta a un módulo ya cargado — la primera versión de esta prueba fallaba
    // por eso, no por el producto.
    vi.resetModules()
    vi.doMock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:1' }))
    vi.doMock('@/lib/local-network-fetch', () => ({
      localNetworkFetch: (u: string, init?: RequestInit) => fetch(u, init),
    }))
    const { leerSalon: leerSinPedro } = await import('@/lib/pedro-cliente')

    let lanzo = false
    let r
    try { r = await leerSinPedro() } catch { lanzo = true }

    expect(lanzo, 'leerSalon jamás debe lanzar').toBe(false)
    expect(r?.procedencia).toBe('sin-pedro')
    expect(r?.autoritativa).toBe(false)
  })
})
