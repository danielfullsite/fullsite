// Regresión: el contrato de estado de tienda de Uber usa el campo `status` con el
// enum ONLINE/PAUSED — no `action` con ACTIVATE, y no ACTIVE.
//
// Qué se rompió (2026-08-26): updateDeliveryStoreStatus mandaba {action:"ACTIVATE"},
// así que el campo `status` llegaba vacío y Uber respondía
//   bad_request — field_violations:[{field:"status", description:"invalid store status: UNKNOWN"}]
// Eso mantuvo el cert #1 (Activate Integration) en rojo. En paralelo,
// getDeliveryStoreStatus comparaba contra "ACTIVE", así que is_open salía false
// aunque Uber reportara la tienda abierta.
//
// El enum lo confirmó el propio Uber: GET /v1/delivery/store/{id}/status devolvió
// {"status":"ONLINE"} para el store a4f298f4 el 2026-08-26.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/integrations/uber-eats/oauth', () => ({
  uberFetch: vi.fn(),
}))
vi.mock('@/lib/integrations/audit-logger', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}))

import { uberFetch } from '@/lib/integrations/uber-eats/oauth'
import { updateDeliveryStoreStatus, getDeliveryStoreStatus } from '@/lib/integrations/uber-eats/delivery-store'

const STORE = 'a4f298f4-202f-47f5-b375-d2eefec0126c'
const mocked = uberFetch as unknown as ReturnType<typeof vi.fn>

function bodyOf(callIndex = 0): Record<string, unknown> {
  const init = mocked.mock.calls[callIndex][1] as { body?: string }
  return JSON.parse(init.body ?? '{}')
}

beforeEach(() => {
  mocked.mockReset()
})

describe('contrato de estado de tienda (Uber)', () => {
  it('ACTIVATE manda status:ONLINE — nunca action:ACTIVATE', async () => {
    mocked.mockResolvedValue(new Response('', { status: 200 }))

    const res = await updateDeliveryStoreStatus(STORE, 'ACTIVATE', 'corr-1')

    expect(res.ok).toBe(true)
    const body = bodyOf()
    expect(body).toEqual({ status: 'ONLINE' })
    expect(body).not.toHaveProperty('action')
  })

  it('PAUSE manda status:PAUSED', async () => {
    mocked.mockResolvedValue(new Response('', { status: 200 }))

    await updateDeliveryStoreStatus(STORE, 'PAUSE', 'corr-2')

    expect(bodyOf()).toEqual({ status: 'PAUSED' })
  })

  it('pega en update-store-status con token de marketplace', async () => {
    mocked.mockResolvedValue(new Response('', { status: 200 }))

    await updateDeliveryStoreStatus(STORE, 'ACTIVATE', 'corr-3')

    const [path, init] = mocked.mock.calls[0] as [string, { method?: string; tokenType?: string }]
    expect(path).toBe(`/v1/delivery/store/${STORE}/update-store-status`)
    expect(init.method).toBe('POST')
    expect(init.tokenType).toBe('marketplace')
  })

  it('status ONLINE se lee como tienda abierta', async () => {
    mocked.mockResolvedValue(new Response(JSON.stringify({ status: 'ONLINE' }), { status: 200 }))

    const res = await getDeliveryStoreStatus(STORE, 'corr-4')

    expect(res.ok).toBe(true)
    expect(res.is_open).toBe(true)
    expect(res.status).toBe('ONLINE')
  })

  it('status PAUSED se lee como tienda cerrada', async () => {
    mocked.mockResolvedValue(new Response(JSON.stringify({ status: 'PAUSED' }), { status: 200 }))

    expect((await getDeliveryStoreStatus(STORE, 'corr-5')).is_open).toBe(false)
  })

  it('is_open explícito de Uber gana sobre el enum', async () => {
    mocked.mockResolvedValue(new Response(JSON.stringify({ is_open: false, status: 'ONLINE' }), { status: 200 }))

    expect((await getDeliveryStoreStatus(STORE, 'corr-6')).is_open).toBe(false)
  })
})
