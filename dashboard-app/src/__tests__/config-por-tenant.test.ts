// La configuración de cada restaurante tiene que venir de la BASE, no del código.
//
// Esto era la raíz de que Fullsite no fuera clonable, y estuvo a la vista todo el
// tiempo: el sidebar decía "coffee-shop" en vez de "Espresso Lab".
//
// fetchClientConfig() consultaba `clients` con la ANON KEY. Esa tabla tiene RLS
// con una sola política, para el rol `authenticated`, y en toda la base no existe
// ni una política para `anon` (0 de 350). Con la anon key la respuesta es 200 con
// arreglo VACÍO — y como el código sólo miraba `res.ok`, caía al fallback en
// silencio.
//
// El fallback tiene UNA entrada: 'demo'. Todos los demás recibían:
//     display_name = su slug · iva_rate 0.16 · 16 mesas · America/Mexico_City
//
// Contra lo que decía su fila:
//     Espresso Lab · IVA 0 · 10 mesas
//
// El IVA es lo grave: dos de los tres tenants cobran 0 y la app aplicaba 16%.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getAuthToken = vi.fn()
vi.mock('@/lib/data', () => ({ getAuthToken: () => getAuthToken() }))

import { fetchClientConfig } from '@/lib/client-config'

const FILA_REAL = {
  id: 'coffee-shop',
  display_name: 'Espresso Lab',
  iva_rate: 0,
  timezone: 'America/Mexico_City',
  mesas: 10,
  city: 'Monterrey, NL',
}

let fetchOriginal: typeof globalThis.fetch
let ultimaLlamada: { url: string; headers: Record<string, string> } | null = null

function responde(cuerpo: unknown, status = 200) {
  globalThis.fetch = vi.fn(async (url: string, opts: RequestInit = {}) => {
    ultimaLlamada = { url: String(url), headers: (opts.headers || {}) as Record<string, string> }
    return { ok: status >= 200 && status < 300, status, json: async () => cuerpo }
  }) as unknown as typeof globalThis.fetch
}

beforeEach(() => {
  fetchOriginal = globalThis.fetch
  ultimaLlamada = null
  getAuthToken.mockReset()
  getAuthToken.mockResolvedValue('token-de-sesion')
})
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks() })

describe('fetchClientConfig', () => {
  it('consulta con el TOKEN DE SESIÓN, no con la anon key', async () => {
    responde([FILA_REAL])
    await fetchClientConfig('coffee-shop')
    expect(getAuthToken).toHaveBeenCalled()
    expect(ultimaLlamada!.headers.Authorization).toBe('Bearer token-de-sesion')
  })

  it('usa los valores de la BASE, no los del código', async () => {
    responde([FILA_REAL])
    const c = await fetchClientConfig('coffee-shop')
    expect(c.display_name).toBe('Espresso Lab')   // no "coffee-shop"
    expect(c.iva_rate).toBe(0)                     // no 0.16
    expect(c.mesas).toBe(10)                       // no 16
  })

  it('un IVA de 0 se respeta — no se confunde con "sin dato"', async () => {
    // `row.iva_rate || 0.16` convertiría el 0 en 16%. Es el defecto de la misma
    // familia que formatCurrency(null) → '$0'.
    responde([{ ...FILA_REAL, iva_rate: 0 }])
    const c = await fetchClientConfig('coffee-shop')
    expect(c.iva_rate).toBe(0)
  })

  it('un restaurante nuevo estrena su propia configuración, no la de nadie', async () => {
    responde([{ id: 'taqueria-nueva', display_name: 'Taquería El Sol', iva_rate: 0.08, timezone: 'America/Tijuana', mesas: 24 }])
    const c = await fetchClientConfig('taqueria-nueva')
    expect(c.display_name).toBe('Taquería El Sol')
    expect(c.iva_rate).toBe(0.08)
    expect(c.mesas).toBe(24)
    expect(c.timezone).toBe('America/Tijuana')
  })

  it('si la fila no se puede leer, avisa en consola en vez de fallar callado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    responde([])
    await fetchClientConfig('restaurante-sin-fila')
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toMatch(/Sin configuración/)
  })
})
