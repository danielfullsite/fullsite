import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { url: string; method: string; body?: Record<string, unknown> }

const state = vi.hoisted(() => ({
  order: {
    id: 'order-1', status: 'cerrada',
    items: [
      { id: 'l1', menuItemId: 'mkt-1', cantidad: 2, cancelled: false },
      { id: 'l2', menuItemId: 'mkt-1', cantidad: 1, cancelled: false },
      { id: 'l3', menuItemId: 'mkt-2', cantidad: 99, cancelled: true },
    ],
  } as Record<string, unknown> | null,
  calls: [] as Call[],
  alreadyApplied: false,
}))

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => ({
    clientId: 'tenant-a', staffId: 'staff-1', staffName: 'Ana', role: 'cajero', authType: 'shift_token',
  })),
  unauthorized: vi.fn(() => Response.json({ error: 'No autorizado' }, { status: 401 })),
}))

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
  } as unknown as Response
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    state.calls.push({ url, method: init?.method ?? 'GET', body })
    if (url.includes('/rest/v1/pos_orders')) return response(state.order ? [state.order] : [])
    if (url.includes('/rest/v1/rpc/r1_legacy_sale_deduction')) {
      return response(state.alreadyApplied
        ? { ok: true, already_applied: true, deductions: [] }
        : { ok: true, deductions: [{ menu_item_id: 'mkt-1', cantidad: 3 }] })
    }
    return response([])
  }))
}

async function deduct(extra: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/pos/deduct-market/route')
  return POST({ json: async () => ({
    order_id: 'order-1', actor: 'Atacante',
    items: [{ menu_item_id: 'mkt-evil', cantidad: 999999 }],
    ...extra,
  }) } as unknown as import('next/server').NextRequest)
}

const rpc = () => state.calls.find(call => call.url.includes('/rest/v1/rpc/r1_legacy_sale_deduction'))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.order = {
    id: 'order-1', status: 'cerrada',
    items: [
      { id: 'l1', menuItemId: 'mkt-1', cantidad: 2, cancelled: false },
      { id: 'l2', menuItemId: 'mkt-1', cantidad: 1, cancelled: false },
      { id: 'l3', menuItemId: 'mkt-2', cantidad: 99, cancelled: true },
    ],
  }
  state.calls = []
  state.alreadyApplied = false
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-test'
  installFetch()
})

describe('deduct-market sólo descuenta la venta cerrada confirmada', () => {
  it('ignora actor/items del navegador y deriva ambos de sesión y orden tenant-scoped', async () => {
    const result = await deduct()

    expect(result.status).toBe(200)
    expect(state.calls.find(call => call.url.includes('/rest/v1/pos_orders'))?.url).toContain('client_id=eq.tenant-a')
    expect(rpc()?.body).toMatchObject({
      p_client_id: 'tenant-a', p_order_id: 'order-1', p_actor: 'Ana',
      p_items: [{ menu_item_id: 'mkt-1', cantidad: 3 }],
    })
  })

  it('no permite usar un order_id inexistente como llave de deducción', async () => {
    state.order = null

    const result = await deduct({ order_id: 'inventada' })

    expect(result.status).toBe(404)
    expect(await result.json()).toMatchObject({ ok: false, error: 'ORDER_NOT_FOUND' })
    expect(rpc()).toBeUndefined()
  })

  it('no descuenta inventario de una orden todavía abierta', async () => {
    state.order = { id: 'order-1', status: 'enviada', items: [{ menuItemId: 'mkt-1', cantidad: 2 }] }

    const result = await deduct()

    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ ok: false, error: 'ORDER_NOT_CLOSED' })
    expect(rpc()).toBeUndefined()
  })

  it('conserva la respuesta idempotente de la RPC en replay', async () => {
    state.alreadyApplied = true

    const result = await deduct()

    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ ok: true, already_applied: true })
  })
})
