// F3 de PLAN-PIN-HASH — el script de backfill, contra una base simulada en memoria.
// Ninguna llamada sale de la máquina; PINs y pimienta son sintéticos.
import { describe, it, expect, beforeEach } from 'vitest'
import { correr, hashPin, leerArgs } from '../../scripts/backfill-pin-hash.mjs'
import { hashPinParaBD, _olvidarLlavesMemoizadas } from '@/lib/pos-pin-hash'

const PIMIENTA = 'cd'.repeat(32)
const SB_URL = 'https://sb.fixture.test'

type Fila = { id: string; client_id: string; pin: string; pin_hash: string | null; pin_hash_v: number | null }
let filas: Fila[]
let llamadas: Array<{ metodo: string; url: string; cuerpo?: string }>
let salida: string[]

function fetchFalso(opts: { resetEnMedio?: string } = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input)
    const metodo = init?.method || 'GET'
    llamadas.push({ metodo, url: u, cuerpo: init?.body as string | undefined })
    const q = new URL(u).searchParams
    if (metodo === 'GET') {
      let r = filas.filter(f => (q.get('pin_hash') === 'is.null' ? f.pin_hash === null : f.pin_hash !== null))
      const cid = q.get('client_id')
      if (cid) r = r.filter(f => `eq.${f.client_id}` === cid)
      const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 1000)
      return new Response(JSON.stringify(r.slice(off, off + lim)), { status: 200 })
    }
    // PATCH condicional: id, client_id, pin_hash=is.null
    const id = q.get('id')!.slice(3)
    if (opts.resetEnMedio === id) {
      const f = filas.find(x => x.id === id)!
      f.pin_hash = 'e'.repeat(64); f.pin_hash_v = 1 // alguien lo restableció con F2 activo
    }
    // Como PostgREST: la condición pin_hash=is.null aplica SÓLO si la URL la pide.
    const f = filas.find(x => x.id === id && `eq.${x.client_id}` === q.get('client_id') && (q.get('pin_hash') !== 'is.null' || x.pin_hash === null))
    if (!f) return new Response('[]', { status: 200 })
    Object.assign(f, JSON.parse(String(init?.body)))
    return new Response(JSON.stringify([{ id }]), { status: 200 })
  }
}

beforeEach(() => {
  filas = [
    { id: 'a-1', client_id: 'tenant-a', pin: '4101', pin_hash: null, pin_hash_v: null },
    { id: 'a-2', client_id: 'tenant-a', pin: '1234567890', pin_hash: null, pin_hash_v: null },
    { id: 'b-1', client_id: 'tenant-b', pin: '4101', pin_hash: null, pin_hash_v: null },
  ]
  llamadas = []
  salida = []
  process.env.POS_PIN_PEPPER = PIMIENTA
  _olvidarLlavesMemoizadas()
})

const log = (s: string) => { salida.push(s) }
const base = { url: SB_URL, llave: 'service-key-fixture', pimienta: PIMIENTA, log }

describe('backfill-pin-hash', () => {
  it('el HMAC del script es EXACTAMENTE el de la app (si divergen, F4 no encuentra a nadie)', async () => {
    for (const [cid, pin] of [['tenant-a', '4101'], ['tenant-b', '4101'], ['amalay', '1234567890']]) {
      expect(hashPin(PIMIENTA, cid, pin)).toBe(await hashPinParaBD(cid, pin))
    }
  })

  it('simulación (por omisión): cuenta, no escribe', async () => {
    const r = await correr({ ...base, args: leerArgs([]), fetchImpl: fetchFalso() })
    expect(r).toMatchObject({ modo: 'simulacion', leidas: 3, pendientes: 3, escritas: 0 })
    expect(llamadas.filter(l => l.metodo !== 'GET')).toHaveLength(0)
  })

  it('aplicar exige la confirmación de F2', () => {
    expect(() => leerArgs(['--aplicar'])).toThrow(/confirmo-doble-escritura-activa/)
    expect(() => leerArgs(['--aplicar', '--verificar', '--confirmo-doble-escritura-activa'])).toThrow()
    expect(() => leerArgs(['--cliente', "x';drop"])).toThrow()
  })

  it('aplicar: escribe el hash correcto con PATCH condicional y el PIN nunca viaja en la URL', async () => {
    const r = await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso() })
    expect(r).toMatchObject({ escritas: 3, omitidas_por_carrera: 0 })
    for (const f of filas) {
      expect(f.pin_hash).toBe(await hashPinParaBD(f.client_id, f.pin))
      expect(f.pin_hash_v).toBe(1)
    }
    const patches = llamadas.filter(l => l.metodo === 'PATCH')
    for (const p of patches) {
      expect(p.url).toContain('pin_hash=is.null')
      expect(p.url).not.toMatch(/[?&]pin=/)
      expect(Object.keys(JSON.parse(p.cuerpo!)).sort()).toEqual(['pin_hash', 'pin_hash_v'])
    }
  })

  it('el mismo PIN en dos restaurantes da dos hashes distintos', async () => {
    await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso() })
    expect(filas.find(f => f.id === 'a-1')!.pin_hash).not.toBe(filas.find(f => f.id === 'b-1')!.pin_hash)
  })

  it('carrera: si alguien restablece el PIN entre lectura y escritura, la fila no se pisa', async () => {
    const r = await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso({ resetEnMedio: 'a-2' }) })
    expect(r).toMatchObject({ escritas: 2, omitidas_por_carrera: 1 })
    expect(filas.find(f => f.id === 'a-2')!.pin_hash).toBe('e'.repeat(64))
  })

  it('--cliente acota a un restaurante', async () => {
    const r = await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa', '--cliente', 'tenant-b']), fetchImpl: fetchFalso() })
    expect(r.escritas).toBe(1)
    expect(filas.filter(f => f.pin_hash).map(f => f.id)).toEqual(['b-1'])
  })

  it('verificar: re-deriva y detecta un hash hecho con otra pimienta', async () => {
    await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso() })
    expect((await correr({ ...base, args: leerArgs(['--verificar']), fetchImpl: fetchFalso() })).no_coinciden).toEqual([])
    filas[1].pin_hash = hashPin('ef'.repeat(32), filas[1].client_id, filas[1].pin)
    expect((await correr({ ...base, args: leerArgs(['--verificar']), fetchImpl: fetchFalso() })).no_coinciden).toEqual(['a-2'])
  })

  it('falla cerrado sin pimienta: no lee ni escribe', async () => {
    await expect(correr({ ...base, pimienta: '', args: leerArgs([]), fetchImpl: fetchFalso() })).rejects.toThrow(/POS_PIN_PEPPER/)
    await expect(correr({ ...base, pimienta: 'corta', args: leerArgs([]), fetchImpl: fetchFalso() })).rejects.toThrow()
    expect(llamadas).toHaveLength(0)
  })

  it('una fila con PIN inválido se reporta por id y no se escribe', async () => {
    filas.push({ id: 'a-mal', client_id: 'tenant-a', pin: '12', pin_hash: null, pin_hash_v: null })
    const r = await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso() })
    expect(r.invalidas).toEqual(['a-mal'])
    expect(filas.find(f => f.id === 'a-mal')!.pin_hash).toBeNull()
  })

  it('la salida NUNCA contiene un PIN ni un hash', async () => {
    await correr({ ...base, args: leerArgs(['--aplicar', '--confirmo-doble-escritura-activa']), fetchImpl: fetchFalso() })
    await correr({ ...base, args: leerArgs(['--verificar']), fetchImpl: fetchFalso() })
    const texto = salida.join('\n')
    for (const f of filas) {
      expect(texto).not.toContain(f.pin)
      expect(texto).not.toContain(String(f.pin_hash))
    }
    expect(texto).not.toContain(PIMIENTA)
  })
})
