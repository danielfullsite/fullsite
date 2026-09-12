import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { esPing, extraerStoreId, responderPing } from '@/lib/integrations/rappi/ping'
import { normalizeStoreOpen } from '@/lib/integrations/uber-eats/store-status'

describe('Rappi PING por tienda', () => {
  it('reconoce el payload oficial que sólo trae store_id', () => {
    expect(esPing({ store_id: 999 }, null)).toBe(true)
    expect(extraerStoreId({ store_id: 999 })).toBe('999')
  })

  it('responde el status obligatorio sólo cuando la tienda está mapeada', async () => {
    await expect(responderPing('store-ok', async () => 'amalay')).resolves.toEqual({ status: 'OK', description: 'Store on' })
    await expect(responderPing('store-x', async () => null)).resolves.toMatchObject({ status: 'UNAVAILABLE' })
  })

  it('falla cerrado si falta store_id o falla la consulta', async () => {
    await expect(responderPing(null, async () => 'amalay')).resolves.toMatchObject({ status: 'UNAVAILABLE' })
    await expect(responderPing('store-x', async () => { throw new Error('db down') })).resolves.toMatchObject({ status: 'UNAVAILABLE' })
  })
})

describe('normalización de estado Uber', () => {
  it.each(['ONLINE', 'ACTIVE', 'OPEN'])('trata %s como tienda abierta', status => {
    expect(normalizeStoreOpen({ status })).toBe(true)
  })

  it.each(['OFFLINE', 'PAUSED', 'CLOSED'])('trata %s como tienda cerrada', status => {
    expect(normalizeStoreOpen({ store_status: status })).toBe(false)
  })

  it('respeta booleano explícito y no inventa el estado de enums nuevos', () => {
    expect(normalizeStoreOpen({ is_open: true, status: 'OFFLINE' })).toBe(true)
    expect(normalizeStoreOpen({ status: 'FUTURE_VALUE' })).toBeNull()
  })
})

describe('health real de Rappi', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    for (const key of ['RAPPI_CLIENT_ID', 'RAPPI_CLIENT_SECRET', 'RAPPI_WEBHOOK_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) delete process.env[key]
  })

  it('da 503 y ready=false si falta una dependencia', async () => {
    process.env.RAPPI_CLIENT_ID = 'id'
    const { GET } = await import('@/app/api/integrations/rappi/health/route')
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ready: false })
  })

  it('da 200 sólo con toda la configuración requerida', async () => {
    process.env.RAPPI_CLIENT_ID = 'id'
    process.env.RAPPI_CLIENT_SECRET = 'secret'
    process.env.RAPPI_WEBHOOK_SECRET = 'webhook'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'
    process.env.SUPABASE_SERVICE_KEY = 'service'
    const { GET } = await import('@/app/api/integrations/rappi/health/route')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ready: true, service: 'rappi-integration' })
  })
})
