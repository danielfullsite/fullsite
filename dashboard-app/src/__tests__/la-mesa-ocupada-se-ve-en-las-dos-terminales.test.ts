import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA MESA OCUPADA EN LA CAJA SE VEIA LIBRE EN LA ENTRADA.
//
// Reportado por Daniel el 2026-09-08 como el bug mayor: «una mesa ocupada no se
// reflejaba en otro punto de venta que no fuera el punto de venta con el que ocupé la
// mesa; no estaba todo en sintonía».
//
// CAUSA RAIZ. Dos llaves de localStorage dicen donde vive la caja, y `getBridgeUrl()`
// -por donde pasa `leerSalon()`, que llena el MAPA DE MESAS- solo leia una:
//
//   consumidor                                  FULLSITE_BRIDGE_URL   pos_bridge_host
//   bridge-client.ts:31-34 (WebSocket)                 si                  si
//   server-discovery.ts:357 (descubrimiento)           --                  si
//   pedro-cliente.ts:28 (requiereCaja)                 si                  si
//   getBridgeUrl()                                     si                  NO
//
// `pos_bridge_host` es la que escribe `setPosServerHost()` desde el parametro
// `?bridge=`, o sea la via real de instalacion de una terminal secundaria. En esa
// terminal el WebSocket SI hablaba con la caja y `requiereCaja()` SI devolvia true,
// pero el estado del salon se pedia a 127.0.0.1 -- a si misma.
//
// Con Electron, esa terminal levanta su propio servidor local: contesta 200 con SU
// salon vacio, `debeUsarPedro` lo toma como autoritativo y pinta las mesas LIBRES.
// Dos terminales, dos verdades, y una mesa que se puede sentar dos veces.

const KEY = 'FULLSITE_BRIDGE_URL'
const HOST = 'pos_bridge_host'

let almacen: Record<string, string>
beforeEach(() => {
  almacen = {}
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in almacen ? almacen[k] : null),
    setItem: (k: string, v: string) => { almacen[k] = v },
    removeItem: (k: string) => { delete almacen[k] },
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

const cargar = async () => (await import('@/lib/bridge-url')).getBridgeUrl

describe('una terminal secundaria apunta a la CAJA, no a si misma', () => {
  it('EL CASO REAL: con pos_bridge_host, el salon se pide a la caja', async () => {
    almacen[HOST] = '192.168.1.71'
    expect((await cargar())()).toBe('http://192.168.1.71:7717')
  })

  it('y ese es el mismo destino que ya usaba el WebSocket', async () => {
    // Si los dos no coinciden, la terminal escucha eventos de la caja y lee el salon
    // de otro lado: el defecto vuelve por la puerta de atras.
    almacen[HOST] = '192.168.1.71'
    const cliente = readFileSync(join(__dirname, '..', 'lib', 'bridge-client.ts'), 'utf8')
    expect(cliente).toMatch(/ws:\/\/\$\{stored\}:\$\{LOCAL_PORT\}\/ws/)
    expect((await cargar())()).toContain('192.168.1.71')
  })

  it('respeta el puerto si el host ya lo trae', async () => {
    almacen[HOST] = '192.168.1.71:7788'
    expect((await cargar())()).toBe('http://192.168.1.71:7788')
  })

  it('y acepta un host que venga como URL completa', async () => {
    almacen[HOST] = 'http://192.168.1.71:7717/'
    expect((await cargar())()).toBe('http://192.168.1.71:7717')
  })
})

describe('lo que NO se puede romper', () => {
  it('la CAJA misma sigue leyendose en loopback', async () => {
    // Sin ninguna llave, la caja se lee a si misma. Es lo correcto: ella ES la caja.
    expect((await cargar())()).toBe('http://127.0.0.1:7717')
  })

  it('la URL completa gana sobre la IP', async () => {
    // El laboratorio multi-terminal levanta dos Pedros con puertos distintos en la
    // misma maquina y fija FULLSITE_BRIDGE_URL. Si la IP ganara, se romperia.
    almacen[KEY] = 'http://127.0.0.1:7999'
    almacen[HOST] = '192.168.1.71'
    expect((await cargar())()).toBe('http://127.0.0.1:7999')
  })

  it('un valor vacio no cuenta como configurado', async () => {
    almacen[KEY] = '   '
    almacen[HOST] = '192.168.1.71'
    expect((await cargar())()).toBe('http://192.168.1.71:7717')
  })

  it('con todo vacio, loopback', async () => {
    almacen[KEY] = ''
    almacen[HOST] = '  '
    expect((await cargar())()).toBe('http://127.0.0.1:7717')
  })

  it('si localStorage lanza, no tumba el POS', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => {}, removeItem: () => {},
    })
    expect((await cargar())()).toBe('http://127.0.0.1:7717')
  })

  it('en el servidor devuelve el default sin tocar almacenamiento', async () => {
    vi.stubGlobal('window', undefined)
    expect((await cargar())()).toBe('http://127.0.0.1:7717')
  })
})

describe('las tres lecturas de la caja coinciden en el destino', () => {
  // El defecto no fue que una funcion estuviera mal escrita, sino que TRES lugares
  // decidian el mismo dato por su cuenta y uno se quedo atras. Esto lo ancla.
  const lee = (r: string) => readFileSync(join(__dirname, '..', 'lib', r), 'utf8')

  it('getBridgeUrl considera las dos llaves', async () => {
    const src = lee('bridge-url.ts')
    expect(src).toMatch(/FULLSITE_BRIDGE_URL/)
    expect(src).toMatch(/pos_bridge_host/)
  })

  it('requiereCaja considera las dos llaves', () => {
    const src = lee('pedro-cliente.ts')
    expect(src).toMatch(/FULLSITE_BRIDGE_URL/)
    expect(src).toMatch(/pos_bridge_host/)
  })

  it('y leerSalon usa getBridgeUrl, no su propia idea', () => {
    expect(lee('pedro-cliente.ts')).toMatch(/getBridgeUrl\(\)\}\/state/)
  })
})
