// Local Network Access — el espacio de direcciones se declara ANTES de resolver
// el destino, y Chromium rechaza el request si el valor no corresponde.
//
// Evidencia de campo, consola de Chrome en la terminal Entrada (AMALAY,
// 2026-08-31), con el POS servido desde https://app.fullsite.mx:
//
//   Access to fetch at 'http://127.0.0.1:7717/health' ... has been blocked by
//   CORS policy: Request had a target IP address space of `local` yet the
//   resource is in address space `loopback`.
//
// El codigo declaraba `'local'` siempre. Con eso el request al bridge se
// bloqueaba antes de salir del navegador: sin impresion y sin comanda a cocina.
// En las terminales no se veia porque el build 1.3.9 desactiva las puertas de
// PNA — el switch tapaba el bug en vez de arreglarlo.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { localNetworkFetch, targetAddressSpaceFor } from '@/lib/local-network-fetch'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('targetAddressSpaceFor — loopback vs local', () => {
  it('REGRESION: 127.0.0.1 es loopback, no local', () => {
    // El caso exacto que Chromium rechazaba.
    expect(targetAddressSpaceFor('http://127.0.0.1:7717/events')).toBe('loopback')
  })

  it('cubre el 127.0.0.0/8 completo, no solo el .1', () => {
    expect(targetAddressSpaceFor('http://127.0.0.2:7717/health')).toBe('loopback')
    expect(targetAddressSpaceFor('http://127.1.2.3:7717/health')).toBe('loopback')
  })

  it('localhost e IPv6 ::1 tambien son loopback', () => {
    expect(targetAddressSpaceFor('http://localhost:7717/print')).toBe('loopback')
    expect(targetAddressSpaceFor('http://[::1]:7717/print')).toBe('loopback')
  })

  it('la caja por LAN sigue siendo local — el otro caso real', () => {
    // Terminal con pos_bridge_host apuntando a la caja.
    expect(targetAddressSpaceFor('http://192.168.1.71:7717/events')).toBe('local')
    expect(targetAddressSpaceFor('http://10.0.0.5:7717/print')).toBe('local')
  })

  it('acepta URL y Request, no solo string', () => {
    expect(targetAddressSpaceFor(new URL('http://127.0.0.1:7717/health'))).toBe('loopback')
    expect(targetAddressSpaceFor(new Request('http://192.168.1.71:7717/health'))).toBe('local')
  })

  it('ante una URL invalida cae a local — el comportamiento anterior', () => {
    expect(targetAddressSpaceFor('no-es-una-url')).toBe('local')
  })
})

describe('localNetworkFetch — lo que realmente se le pasa a fetch', () => {
  it('manda loopback cuando el bridge es 127.0.0.1', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)

    await localNetworkFetch('http://127.0.0.1:7717/events', { method: 'POST' })

    const [, init] = spy.mock.calls[0]
    expect(init.targetAddressSpace).toBe('loopback')
    expect(init.method).toBe('POST')   // no pisa el resto del init
  })

  it('manda local cuando el bridge es la caja por LAN', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)

    await localNetworkFetch('http://192.168.1.71:7717/print')

    expect(spy.mock.calls[0][1].targetAddressSpace).toBe('local')
  })

  it('conserva headers y body — es un envoltorio, no un reemplazo', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)

    await localNetworkFetch('http://127.0.0.1:7717/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"command_type":"ORDER_SENT"}',
    })

    const [, init] = spy.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body).command_type).toBe('ORDER_SENT')
    expect(init.targetAddressSpace).toBe('loopback')
  })
})
