// El tablero de cocina ante un error del servidor.
//
// getKitchenOrders hacía `if (!res.ok) return []`. Un 400 —por ejemplo un
// client_id que la terminal no supo resolver— dejaba la pantalla de cocina
// VACÍA Y EN SILENCIO: sin comandas, sin aviso, y sin caer al caché de
// IndexedDB, porque una respuesta 400 RESUELVE y el `catch` que hace ese rescate
// nunca se alcanzaba.
//
// Importa porque esas pantallas (/pos/cocina, /pos/barra, /pos/panaderia,
// /pos/kds) saltan el login por completo, así que son justo las que pueden
// quedarse sin tenant resuelto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getCachedOrders = vi.fn()
vi.mock('@/lib/pos-offline-db', () => ({
  getCachedOrders: () => getCachedOrders(),
  cacheOrder: vi.fn(),
}))

const COMANDA = {
  id: 'o1', mesa: 4, mesero: 'Valeria', status: 'enviada',
  items: JSON.stringify([{ nombre: 'Latte', cantidad: 1 }]),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

let fetchOriginal: typeof globalThis.fetch

beforeEach(() => {
  fetchOriginal = globalThis.fetch
  getCachedOrders.mockReset()
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => { globalThis.fetch = fetchOriginal })

function responde(status: number, cuerpo: unknown = {}) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  })) as unknown as typeof globalThis.fetch
}

describe('getKitchenOrders — un error del servidor no puede vaciar la cocina', () => {
  it('con 400 muestra lo cacheado, no una pantalla en blanco', async () => {
    responde(400, { error: 'client_id inválido' })
    getCachedOrders.mockResolvedValue([COMANDA])

    const { getKitchenOrders } = await import('@/lib/pos-data')
    const r = await getKitchenOrders()

    expect(getCachedOrders).toHaveBeenCalled()
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('o1')
    // y los items llegan parseados, como los espera el KDS
    expect(Array.isArray(r[0].items)).toBe(true)
  })

  it('con 500 también rescata del caché', async () => {
    responde(500)
    getCachedOrders.mockResolvedValue([COMANDA])

    const { getKitchenOrders } = await import('@/lib/pos-data')
    expect(await getKitchenOrders()).toHaveLength(1)
  })

  it('si tampoco hay caché devuelve vacío, sin reventar', async () => {
    responde(400)
    getCachedOrders.mockResolvedValue([])

    const { getKitchenOrders } = await import('@/lib/pos-data')
    expect(await getKitchenOrders()).toEqual([])
  })

  it('en el camino feliz NO toca el caché', async () => {
    responde(200, [{ ...COMANDA, items: [{ nombre: 'Latte', cantidad: 1 }] }])
    getCachedOrders.mockResolvedValue([])

    const { getKitchenOrders } = await import('@/lib/pos-data')
    const r = await getKitchenOrders()
    expect(r).toHaveLength(1)
  })
})
