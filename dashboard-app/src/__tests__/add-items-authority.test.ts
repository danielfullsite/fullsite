import { beforeEach, describe, expect, it, vi } from 'vitest'

type Auth = { clientId: string; staffId: string; staffName: string; role: string; authType: 'shift_token' }
type Call = { url: string; method: string; body?: Record<string, unknown> }

const state = vi.hoisted(() => ({
  auth: { clientId: 'tenant-a', staffId: 'm1', staffName: 'Ana', role: 'mesero', authType: 'shift_token' } as Auth,
  order: { id: 'order-1', mesero: 'Ana', status: 'enviada' } as Record<string, unknown> | null,
  menu: [{ id: 'menu-1', price: 100 }] as Array<Record<string, unknown>>,
  combos: [] as Array<Record<string, unknown>>,
  calls: [] as Call[],
}))

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => state.auth),
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
    if (url.includes('/rest/v1/pos_menu_items')) return response(state.menu)
    if (url.includes('/rest/v1/pos_combos')) return response(state.combos)
    if (url.includes('/rest/v1/rpc/r1_add_items')) return response({ ok: true, revision: 3 })
    return response([])
  }))
}

function line(extra: Record<string, unknown> = {}) {
  return {
    id: 'line-1', menuItemId: 'menu-1', nombre: 'Platillo', precio: 100,
    precioExtra: 0, cantidad: 1, subtotal: 100, modificadores: [], notas: '',
    ...extra,
  }
}

async function add(items = [line()]) {
  const { POST } = await import('@/app/api/pos/add-items/route')
  return POST({ json: async () => ({ order_id: 'order-1', items }) } as unknown as import('next/server').NextRequest)
}

const rpc = () => state.calls.find(call => call.url.includes('/rest/v1/rpc/r1_add_items'))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.auth = { clientId: 'tenant-a', staffId: 'm1', staffName: 'Ana', role: 'mesero', authType: 'shift_token' }
  state.order = { id: 'order-1', mesero: 'Ana', status: 'enviada' }
  state.menu = [{ id: 'menu-1', price: 100 }]
  state.combos = []
  state.calls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-test'
  installFetch()
})

describe('add-items respeta dueño de cuenta y precios del tenant', () => {
  it('un mesero no puede añadir renglones a la cuenta de otro', async () => {
    state.order = { id: 'order-1', mesero: 'Beatriz', status: 'enviada' }

    const result = await add()

    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ ok: false, error: 'ORDER_NOT_OWNED' })
    expect(rpc()).toBeUndefined()
  })

  it('rechaza precio base manipulado antes de llamar la RPC', async () => {
    const result = await add([line({ precio: 1, subtotal: 1 })])

    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ ok: false, error: 'MENU_PRICE_CHANGED' })
    expect(rpc()).toBeUndefined()
  })

  it('rechaza subtotal que no corresponde a precio, extras y cantidad', async () => {
    const result = await add([line({ cantidad: 2, subtotal: 100 })])

    expect(result.status).toBe(400)
    expect(await result.json()).toMatchObject({ ok: false, error: 'INVALID_ITEM_SUBTOTAL' })
    expect(rpc()).toBeUndefined()
  })

  it('un renglón legítimo de su cuenta se agrega usando siempre el tenant firmado', async () => {
    const result = await add([line({ precioExtra: 25, subtotal: 125 })])

    expect(result.status).toBe(200)
    expect(state.calls.find(call => call.url.includes('/rest/v1/pos_orders'))?.url).toContain('client_id=eq.tenant-a')
    expect(rpc()?.body).toMatchObject({ p_client_id: 'tenant-a', p_order_id: 'order-1' })
  })

  it('un admin puede colaborar sobre una cuenta ajena, pero no cambiar el precio del menú', async () => {
    state.auth = { clientId: 'tenant-a', staffId: 'a1', staffName: 'Admin', role: 'admin', authType: 'shift_token' }
    state.order = { id: 'order-1', mesero: 'Beatriz', status: 'enviada' }

    expect((await add()).status).toBe(200)
    state.calls = []
    expect((await add([line({ precio: 1, subtotal: 1 })])).status).toBe(409)
  })

  it('preserva separadores de tiempo válidos de $0', async () => {
    const result = await add([line({
      menuItemId: '__tiempo__', nombre: 'XX TIEMPO: 2 XX', precio: 0, subtotal: 0,
    })])

    expect(result.status).toBe(200)
    expect(rpc()?.body?.p_items).toEqual(expect.arrayContaining([
      expect.objectContaining({ menuItemId: '__tiempo__', subtotal: 0 }),
    ]))
  })

  it('preserva un combo válido aunque sus precios proporcionales sean menores al menú', async () => {
    state.menu = [{ id: 'menu-1', name: 'Uno', price: 80 }, { id: 'menu-2', name: 'Dos', price: 70 }]
    state.combos = [{
      id: 'combo-1', price: 100,
      items: [{ menu_item_id: 'menu-1', substitutions: [] }, { menu_item_id: 'menu-2', substitutions: [] }],
    }]
    const comboEvidence = { _comboId: 'combo-1', _comboGroupId: 'group-1' }

    const result = await add([
      line({ id: 'c1', menuItemId: 'menu-1', precio: 60, subtotal: 60, ...comboEvidence }),
      line({ id: 'c2', menuItemId: 'menu-2', precio: 40, subtotal: 40, ...comboEvidence }),
    ])

    expect(result.status).toBe(200)
  })

  it('rechaza evidencia de combo válida en nombre pero con precio total rebajado', async () => {
    state.menu = [{ id: 'menu-1', name: 'Uno', price: 80 }, { id: 'menu-2', name: 'Dos', price: 70 }]
    state.combos = [{
      id: 'combo-1', price: 100,
      items: [{ menu_item_id: 'menu-1', substitutions: [] }, { menu_item_id: 'menu-2', substitutions: [] }],
    }]
    const comboEvidence = { _comboId: 'combo-1', _comboGroupId: 'group-1' }

    const result = await add([
      line({ id: 'c1', menuItemId: 'menu-1', precio: 1, subtotal: 1, ...comboEvidence }),
      line({ id: 'c2', menuItemId: 'menu-2', precio: 1, subtotal: 1, ...comboEvidence }),
    ])

    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ ok: false, error: 'INVALID_COMBO_PRICE' })
  })

  it('rechaza repetir una opción de un slot y omitir otro slot del combo', async () => {
    state.menu = [{ id: 'menu-1', name: 'Uno', price: 80 }, { id: 'menu-2', name: 'Dos', price: 70 }]
    state.combos = [{
      id: 'combo-1', price: 100,
      items: [{ menu_item_id: 'menu-1', substitutions: [] }, { menu_item_id: 'menu-2', substitutions: [] }],
    }]
    const comboEvidence = { _comboId: 'combo-1', _comboGroupId: 'group-1' }

    const result = await add([
      line({ id: 'c1', menuItemId: 'menu-1', precio: 50, subtotal: 50, ...comboEvidence }),
      line({ id: 'c2', menuItemId: 'menu-1', precio: 50, subtotal: 50, ...comboEvidence }),
    ])

    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ ok: false, error: 'INVALID_COMBO_ITEM' })
    expect(rpc()).toBeUndefined()
  })
})
