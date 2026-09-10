// Regresión — persistOrder debe distinguir un insert NUEVO de un duplicado.
//
// El bug: con `Prefer: return=minimal`, PostgREST devuelve body vacío tanto para un
// insert nuevo como para un duplicado suprimido por resolution=ignore-duplicates. La
// detección `responseText === ''` daba `was_duplicate = true` SIEMPRE, así que
// handleNewOrder se saltaba `acceptOrder` para toda orden real nueva: la orden aparecía
// en el KDS pero Uber la auto-cancelaba tras la ventana de aceptación (~11 min).
//
// Fix: `return=representation` (insert nuevo -> [row]; conflicto ignorado -> []) +
// detección por conteo de filas.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function makeOrder() {
  return {
    provider_order_id: 'ORD-123',
    client_id: 'amalay',
    customer_name: 'Ana García',
    customer_phone: '+528112345678',
    delivery_address: 'Av. Garza Sada 1234',
    total: 300,
    subtotal: 275,
    delivery_fee: 25,
    items: [
      { name: 'Chilaquiles', quantity: 2, unit_price: 120, notes: '', modifiers: [{ name: 'Con huevo' }] },
    ],
    notes: null,
    estimated_pickup_at: null,
    raw_payload: {},
  } as unknown as Parameters<typeof import('@/app/api/integrations/uber-eats/webhook/route')['persistOrder']>[0]
}

describe('persistOrder — detección de duplicado (guarda el accept de órdenes reales)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.example.co'
    process.env.SUPABASE_SERVICE_KEY = 'service-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...ORIGINAL_ENV }
  })

  it('pide return=representation al insertar en delivery_orders (nunca return=minimal)', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify([{ id: 'uber-ORD-123' }]), { status: 201 })
    }))
    const { persistOrder } = await import('@/app/api/integrations/uber-eats/webhook/route')
    await persistOrder(makeOrder(), 'evt-1')

    const post = calls.find((c) => c.url.includes('/delivery_orders'))
    expect(post, 'debe hacer POST a /delivery_orders').toBeTruthy()
    const prefer = String((post!.init.headers as Record<string, string>).Prefer ?? '')
    expect(prefer).toContain('return=representation')
    expect(prefer).not.toContain('return=minimal')
    expect(prefer).toContain('resolution=ignore-duplicates')
  })

  it('insert nuevo ([row]) => was_duplicate=false (handleNewOrder dispara accept)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'uber-ORD-123' }]), { status: 201 })))
    const { persistOrder } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await persistOrder(makeOrder(), 'evt-1')
    expect(res).toEqual({ ok: true, was_duplicate: false })
  })

  it('conflicto ignorado ([]) => was_duplicate=true (no re-acepta ni duplica)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 201 })))
    const { persistOrder } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await persistOrder(makeOrder(), 'evt-1')
    expect(res).toEqual({ ok: true, was_duplicate: true })
  })

  it('error del servidor (5xx) => ok=false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const { persistOrder } = await import('@/app/api/integrations/uber-eats/webhook/route')
    const res = await persistOrder(makeOrder(), 'evt-1')
    expect(res.ok).toBe(false)
  })
})
