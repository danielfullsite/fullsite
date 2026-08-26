import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Regresión: `pause` era la única de las 5 Delivery Store APIs que fallaba.
 *
 * El sumario del workflow decía "4/5 OK" y nunca cuál, así que llevaba días ahí sin que
 * nadie pudiera arreglarlo. Con el desglose salió:
 *
 *   pause: FALLA — {"error":"error transforming request: ... toField: status,
 *                    error: unknown enum value string:PAUSED"}
 *
 * Causa: el enum de LECTURA y el de ESCRITURA de Uber no son el mismo. El GET .../status
 * devuelve PAUSED, y ese valor se reusó para el POST update-store-status, que lo rechaza.
 * ACTIVATE->ONLINE sí pasaba, y por eso el par quedó descuadrado: ONLINE / PAUSED.
 *
 * Evidencia: run day3 32943685915 (2026-08-26).
 */

const RUTA = '@/lib/integrations/uber-eats/delivery-store'

/** Captura el body completo que se le manda a Uber, sin salir a la red. */
async function bodyEnviado(action: 'PAUSE' | 'ACTIVATE'): Promise<Record<string, unknown>> {
  let capturado: Record<string, unknown> = {}
  vi.doMock('@/lib/integrations/uber-eats/oauth', () => ({
    uberFetch: async (_path: string, opts: { body?: string }) => {
      capturado = JSON.parse(opts.body ?? '{}')
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) }
    },
  }))
  vi.doMock('@/lib/integrations/uber-eats/audit-logger', () => ({ auditLog: async () => {} }))
  vi.resetModules()
  const { updateDeliveryStoreStatus } = await import(RUTA)
  await updateDeliveryStoreStatus('store-de-prueba', action, 'corr-test')
  return capturado
}

const statusEnviado = async (a: 'PAUSE' | 'ACTIVATE') => (await bodyEnviado(a)).status as string

describe('Uber — enum de estado de tienda (escritura)', () => {
  afterEach(() => { vi.doUnmock('@/lib/integrations/uber-eats/oauth'); vi.unstubAllEnvs() })

  it('EL BUG: PAUSE ya no manda PAUSED, que es el enum que Uber rechaza', async () => {
    const enviado = await statusEnviado('PAUSE')
    expect(enviado).not.toBe('PAUSED')
  })

  it('EL FIX: PAUSE manda OFFLINE, la contraparte real de ONLINE', async () => {
    expect(await statusEnviado('PAUSE')).toBe('OFFLINE')
  })

  it('ACTIVATE sigue mandando ONLINE (no se toca lo que ya pasaba)', async () => {
    expect(await statusEnviado('ACTIVATE')).toBe('ONLINE')
  })

  it('el par es coherente: los dos valores del mismo enum ONLINE/OFFLINE', async () => {
    const pause = await statusEnviado('PAUSE')
    const activate = await statusEnviado('ACTIVATE')
    expect([activate, pause].sort()).toEqual(['OFFLINE', 'ONLINE'])
  })

  it('el override por env sigue funcionando, para no depender de un deploy si Uber cambia el enum', async () => {
    vi.stubEnv('UBER_STORE_STATUS_PAUSED', 'SUSPENDED')
    expect(await statusEnviado('PAUSE')).toBe('SUSPENDED')
  })
})

/** Guarda del cableado: el default no debe volver a PAUSED por un revert descuidado. */
describe('Uber — el default de PAUSE no vuelve a PAUSED', () => {
  it('el fuente ya no usa PAUSED como valor por defecto del POST', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/integrations/uber-eats/delivery-store.ts'),
      'utf-8',
    )
    expect(src).toContain("process.env.UBER_STORE_STATUS_PAUSED || 'OFFLINE'")
    expect(src).not.toContain("process.env.UBER_STORE_STATUS_PAUSED || 'PAUSED'")
  })
})

/**
 * Segunda capa del mismo bug. Con OFFLINE ya aceptado, Uber pidió otra cosa:
 *   {"field":"is_offline_until","description":"is_offline_until timestamp is needed
 *     when setting store offline"}
 * Evidencia: run day3 32944479542 (2026-08-26).
 */
describe('Uber — pausar exige decir hasta cuándo', () => {
  afterEach(() => { vi.doUnmock('@/lib/integrations/uber-eats/oauth'); vi.unstubAllEnvs() })

  it('PAUSE manda is_offline_until, que es lo que Uber reclamaba', async () => {
    const body = await bodyEnviado('PAUSE')
    expect(body).toHaveProperty('is_offline_until')
    expect(typeof body.is_offline_until).toBe('string')
  })

  it('es un ISO 8601 válido y en el FUTURO (una pausa que ya venció no pausa nada)', async () => {
    const body = await bodyEnviado('PAUSE')
    const t = Date.parse(body.is_offline_until as string)
    expect(Number.isNaN(t)).toBe(false)
    expect(t).toBeGreaterThan(Date.now())
    expect(body.is_offline_until).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('ACTIVATE NO lo manda: sólo aplica al poner la tienda offline', async () => {
    const body = await bodyEnviado('ACTIVATE')
    expect(body).not.toHaveProperty('is_offline_until')
    expect(body.status).toBe('ONLINE')
  })

  it('la ventana se configura por env sin tocar código', async () => {
    vi.stubEnv('UBER_STORE_PAUSE_MINUTES', '15')
    const body = await bodyEnviado('PAUSE')
    const min = (Date.parse(body.is_offline_until as string) - Date.now()) / 60_000
    expect(min).toBeGreaterThan(13)
    expect(min).toBeLessThan(17)
  })

  it('un env basura cae al default de 60 min en vez de mandar una fecha inválida', async () => {
    vi.stubEnv('UBER_STORE_PAUSE_MINUTES', 'abc')
    const body = await bodyEnviado('PAUSE')
    const min = (Date.parse(body.is_offline_until as string) - Date.now()) / 60_000
    expect(min).toBeGreaterThan(58)
    expect(min).toBeLessThan(62)
  })
})
