// El plano de salón es de cada restaurante, no de AMALAY.
//
// Antes, el respaldo de `getMesasConfig` era el plano físico de AMALAY —33 mesas con
// sus capacidades— compilado dentro del bundle, entregado sólo si el slug era
// literalmente 'amalay'. Cualquier otro restaurante recibía 16 mesas genéricas de
// capacidad 4.
//
// Eso no se veía como falla. Se veía como una configuración: "este restaurante tiene 16
// mesas". Y pegaba en los dos lugares donde el respaldo ES el camino:
//
//   · Arranque en frío sin internet. AMALAY recuperaba su salón; nadie más podía.
//   · /pos/qr, que sólo usa este camino: los QR salían para mesas 1..16 sin importar
//     cómo fuera el salón de verdad.
//
// La lectura en línea nunca estuvo rota —`fetchPosMesas` funciona porque
// supabase-fetch-patch.ts intercepta la petición y le pone credencial— así que boruca y
// esqueleton-demo sí cargaban su plano estando conectados. Lo que faltaba era que
// sobreviviera sin conexión, para todos.
//
// Estas pruebas fijan el contrato nuevo. NO fijan el mobiliario de ningún restaurante:
// las 33 mesas de AMALAY son un dato de AMALAY, y un dato de un cliente no es una
// aserción del producto.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getMesasConfig, cachearPlano } from '@/lib/pos-data'

// El config de node no trae localStorage. Se monta uno mínimo.
class AlmacenFalso {
  private datos = new Map<string, string>()
  get length() { return this.datos.size }
  key(i: number) { return [...this.datos.keys()][i] ?? null }
  getItem(k: string) { return this.datos.get(k) ?? null }
  setItem(k: string, v: string) { this.datos.set(k, String(v)) }
  removeItem(k: string) { this.datos.delete(k) }
  clear() { this.datos.clear() }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new AlmacenFalso())
  vi.stubGlobal('window', globalThis)
})
afterEach(() => { vi.unstubAllGlobals() })

const PLANO_AMALAY = [
  { number: 1, capacity: 4 }, { number: 30, capacity: 8 },
  { number: 40, capacity: 6 }, { number: 63, capacity: 4 },
]
const PLANO_BORUCA = [
  { number: 1, capacity: 2 }, { number: 2, capacity: 2 }, { number: 7, capacity: 6 },
]

describe('el plano de salón es de cada restaurante', () => {
  it('sin caché, cualquier restaurante recibe mesas secuenciales', () => {
    const mesas = getMesasConfig('restaurante-nuevo', 5)
    expect(mesas.map(m => m.number)).toEqual([1, 2, 3, 4, 5])
    expect(mesas.every(m => m.capacity === 4)).toBe(true)
    expect(mesas.every(m => m.status === 'disponible')).toBe(true)
  })

  it('amalay TAMPOCO tiene trato especial sin caché', () => {
    // El corazón del cambio. Antes esto devolvía 33 mesas por el puro slug.
    const mesas = getMesasConfig('amalay', 5)
    expect(mesas).toHaveLength(5)
    expect(mesas.map(m => m.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('con caché, devuelve el plano guardado y respeta capacidades distintas', () => {
    cachearPlano('amalay', PLANO_AMALAY)
    const mesas = getMesasConfig('amalay', 16)

    expect(mesas.map(m => m.number)).toEqual([1, 30, 40, 63])
    expect(mesas.find(m => m.number === 30)?.capacity).toBe(8)
    expect(mesas.find(m => m.number === 40)?.capacity).toBe(6)
    // El plano cacheado manda sobre el conteo pedido: son 4 mesas, no 16.
    expect(mesas).toHaveLength(4)
  })

  it('un restaurante nuevo puede tener SU propio plano — lo que antes no se podía', () => {
    cachearPlano('boruca', PLANO_BORUCA)
    const mesas = getMesasConfig('boruca', 16)
    expect(mesas.map(m => m.number)).toEqual([1, 2, 7])
    expect(mesas.find(m => m.number === 7)?.capacity).toBe(6)
  })

  it('el plano de un restaurante NO se le entrega a otro', () => {
    cachearPlano('amalay', PLANO_AMALAY)
    // Mismo dispositivo, otro tenant: la caché está indexada por clientId.
    const mesas = getMesasConfig('boruca', 3)
    expect(mesas.map(m => m.number)).toEqual([1, 2, 3])
    expect(mesas).toHaveLength(3)
  })

  it('un slug vacío no hereda el plano de nadie', () => {
    // getActiveClientSlug() devuelve '' cuando la sesión aún no resuelve. Antes ese
    // hueco lo cubría el valor por omisión del bundle, que apuntaba a amalay.
    cachearPlano('amalay', PLANO_AMALAY)
    const mesas = getMesasConfig('', 4)
    expect(mesas.map(m => m.number)).toEqual([1, 2, 3, 4])
  })

  it('una caché corrupta no tumba el POS: cae al genérico', () => {
    localStorage.setItem('pos_plano_amalay', 'esto no es json')
    expect(getMesasConfig('amalay', 3).map(m => m.number)).toEqual([1, 2, 3])

    localStorage.setItem('pos_plano_amalay', '{"no":"es un arreglo"}')
    expect(getMesasConfig('amalay', 3)).toHaveLength(3)

    localStorage.setItem('pos_plano_amalay', '[]')
    expect(getMesasConfig('amalay', 3)).toHaveLength(3)
  })

  it('descarta filas sin número en vez de inventar mesas', () => {
    cachearPlano('x', [
      { number: 5, capacity: 4 },
      { number: NaN, capacity: 4 },
      { number: 9, capacity: 2 },
    ])
    expect(getMesasConfig('x', 99).map(m => m.number)).toEqual([5, 9])
  })

  it('una capacidad ausente cae a 4, no a NaN', () => {
    cachearPlano('x', [{ number: 1 } as { number: number; capacity: number }])
    expect(getMesasConfig('x', 1)[0].capacity).toBe(4)
  })

  it('la llave empieza con pos_ para que la barra el guard de cambio de tenant', () => {
    // pos-offline-db.ts limpia todo localStorage que empiece con `pos_` cuando el
    // dispositivo cambia de restaurante. Si la llave no empatara, el plano del tenant
    // anterior sobreviviría al cambio.
    cachearPlano('amalay', PLANO_AMALAY)
    const llaves = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    expect(llaves.some(k => k?.startsWith('pos_'))).toBe(true)
  })

  it('cachear no truena si localStorage está lleno o bloqueado', () => {
    vi.stubGlobal('localStorage', {
      ...new AlmacenFalso(),
      setItem: () => { throw new Error('QuotaExceededError') },
      getItem: () => null,
      length: 0,
      key: () => null,
    })
    expect(() => cachearPlano('amalay', PLANO_AMALAY)).not.toThrow()
    expect(getMesasConfig('amalay', 2)).toHaveLength(2)
  })
})
