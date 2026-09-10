// Local Network Access — el valor del enum no es igual en todos los Chromium.
//
// INCIDENTE 2026-08-31, caja de AMALAY. El POS guardaba la orden pero la comanda no
// llegaba a cocina ("no hay conexión con la caja"). Pedro estaba vivo y aceptaba POST
// desde fuera: el request moría DENTRO del navegador.
//
// Local Network Access renombró los espacios: `local` -> `loopback`, `private` -> `local`.
// Ese renombre es reciente. Las terminales corren Electron 33 = Chromium 130, donde
// `targetAddressSpace` ya existe pero sólo acepta `local`/`private`/`public`. Un valor
// inválido en un campo CONOCIDO de RequestInit no se ignora: revienta el fetch.
//
// El error que motivó usar `loopback` se capturó en Chrome, que se autoactualiza. El
// arreglo sirvió para el navegador y rompió las terminales — que es donde vive el POS.
//
// La regla que estas pruebas fijan: si el motor rechaza la declaración, se reintenta sin
// ella; si de verdad no hay red, NO se reintenta y el error sube tal cual.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { localNetworkFetch, targetAddressSpaceFor } from '@/lib/local-network-fetch'

const OK = () => new Response('{}', { status: 200 })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('El espacio de direcciones se deriva del destino', () => {
  it('loopback para 127.0.0.0/8, localhost y ::1', () => {
    expect(targetAddressSpaceFor('http://127.0.0.1:7717/events')).toBe('loopback')
    expect(targetAddressSpaceFor('http://127.1.2.3:7717/x')).toBe('loopback')
    expect(targetAddressSpaceFor('http://localhost:7717/x')).toBe('loopback')
    expect(targetAddressSpaceFor('http://[::1]:7717/x')).toBe('loopback')
  })

  it('local para la LAN — la caja vista desde otra terminal', () => {
    expect(targetAddressSpaceFor('http://192.168.1.71:7717/events')).toBe('local')
  })
})

describe('Motor MODERNO: acepta la declaración', () => {
  it('manda targetAddressSpace y no reintenta', async () => {
    const f = vi.fn().mockResolvedValue(OK())
    vi.stubGlobal('fetch', f)

    const r = await localNetworkFetch('http://127.0.0.1:7717/events', { method: 'POST' })

    expect(r.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', targetAddressSpace: 'loopback' })
  })
})

describe('Motor VIEJO (Chromium 130): no conoce `loopback`', () => {
  it('conserva credencial, Headers, señal, cuerpo y método en el primer request y fallback', async () => {
    const values: Record<string, string> = { FULLSITE_LAN_SECRET: 'synthetic-lan-secret', fullsite_client_id: 'test', FULLSITE_TERMINAL_ID: 'pos2', FULLSITE_LOCATION_ID: 'principal' }
    vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] || null })
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError("Invalid targetAddressSpace enum loopback"))
      .mockResolvedValueOnce(OK())
    vi.stubGlobal('fetch', f)
    const signal = new AbortController().signal
    const body = '{"command_id":"stable","command_type":"ORDER_SENT"}'
    await localNetworkFetch('http://127.0.0.1:7717/events', {
      method: 'POST', headers: new Headers({ 'Content-Type': 'application/json', 'X-Trace': 'test-trace' }), signal, body,
    })
    expect(f).toHaveBeenCalledTimes(2)
    for (const [, init] of f.mock.calls) {
      const h = new Headers(init.headers)
      expect(h.get('x-fullsite-lan')).toBe(values.FULLSITE_LAN_SECRET)
      expect(h.get('x-fullsite-restaurante')).toBe('test')
      expect(h.get('x-fullsite-sucursal')).toBe('principal')
      expect(h.get('content-type')).toBe('application/json')
      expect(h.get('x-trace')).toBe('test-trace')
      expect(init.signal).toBe(signal)
      expect(init.body).toBe(body)
      expect(init.method).toBe('POST')
    }
    expect(f.mock.calls[1][1]).not.toHaveProperty('targetAddressSpace')
  })

  it('REGRESION: reintenta sin la declaración y la comanda sale', async () => {
    // Ésta es la caja de AMALAY. Antes, este TypeError llegaba al POS como
    // "no hay conexión con la caja" y la comanda nunca salía.
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to read the 'targetAddressSpace' property: The provided value 'loopback' is not a valid enum value."))
      .mockResolvedValueOnce(OK())
    vi.stubGlobal('fetch', f)

    const r = await localNetworkFetch('http://127.0.0.1:7717/events', { method: 'POST' })

    expect(r.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
    // El reintento va SIN la declaración.
    expect(f.mock.calls[1][1]).not.toHaveProperty('targetAddressSpace')
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'POST' })
  })

  it('también cubre el throw síncrono del constructor de Request', async () => {
    let primera = true
    const f = vi.fn().mockImplementation(() => {
      if (primera) {
        primera = false
        throw new TypeError("'loopback' is not a valid value for enumeration TargetAddressSpace")
      }
      return Promise.resolve(OK())
    })
    vi.stubGlobal('fetch', f)

    const r = await localNetworkFetch('http://127.0.0.1:7717/events')

    expect(r.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('Un fallo de red REAL no se disfraza de incompatibilidad', () => {
  it('"Failed to fetch" NO reintenta — el error sube tal cual', async () => {
    // Si aquí reintentáramos, un bloqueo legítimo del navegador se veria como si
    // hubiéramos encontrado la puerta de atrás, y esconderíamos el problema real.
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', f)

    await expect(localNetworkFetch('http://127.0.0.1:7717/events')).rejects.toThrow(/failed to fetch/i)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('un error que no es TypeError sube sin tocarse', async () => {
    const f = vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'))
    vi.stubGlobal('fetch', f)

    await expect(localNetworkFetch('http://127.0.0.1:7717/events')).rejects.toThrow(/aborted/i)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('un timeout de AbortSignal tampoco reintenta', async () => {
    const f = vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'))
    vi.stubGlobal('fetch', f)

    await expect(localNetworkFetch('http://127.0.0.1:7717/events')).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(1)
  })
})

it('remembers an unsupported address-space value instead of rejecting every local poll', async () => {
  const f = vi.fn((_input, init) => {
    if (init.targetAddressSpace === 'loopback') return Promise.reject(new TypeError('Invalid targetAddressSpace enum loopback'))
    return Promise.resolve(OK())
  })
  vi.stubGlobal('fetch', f)
  for (let n = 0; n < 20; n++) await localNetworkFetch('http://127.0.0.1:7717/state')
  expect(f).toHaveBeenCalledTimes(21)
  expect(console.warn).toHaveBeenCalledTimes(1)
  await localNetworkFetch('http://192.168.1.71:7717/state')
  expect(f.mock.calls.at(-1)?.[1].targetAddressSpace).toBe('local')
})
it('a real disconnection still propagates once after address-space compatibility was learned', async () => {
  const f = vi.fn().mockRejectedValueOnce(new TypeError('Invalid targetAddressSpace enum loopback')).mockResolvedValueOnce(OK())
  vi.stubGlobal('fetch', f)
  await localNetworkFetch('http://127.0.0.1:7717/state')
  f.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(localNetworkFetch('http://127.0.0.1:7717/events', { method: 'POST' })).rejects.toThrow('Failed to fetch')
  expect(f).toHaveBeenCalledTimes(3)
  expect(f.mock.calls[2][1]).not.toHaveProperty('targetAddressSpace')
})
it('an unrelated invalid enum is not treated as an unsupported local address space', async () => {
  const f = vi.fn().mockRejectedValue(new TypeError('Invalid request cache enum value'))
  vi.stubGlobal('fetch', f)
  await expect(localNetworkFetch('http://127.0.0.1:7717/state')).rejects.toThrow('Invalid request cache enum')
  expect(f).toHaveBeenCalledTimes(1)
})
it('an address-space policy denial is not cached as missing enum support', async () => {
  const f = vi.fn().mockRejectedValueOnce(new TypeError('Local address space access denied by policy')).mockResolvedValue(OK())
  vi.stubGlobal('fetch', f)
  await expect(localNetworkFetch('http://127.0.0.1:7717/state')).rejects.toThrow('denied by policy')
  expect(f).toHaveBeenCalledTimes(1)
  await localNetworkFetch('http://127.0.0.1:7717/state')
  expect(f.mock.calls[1][1].targetAddressSpace).toBe('loopback')
})
