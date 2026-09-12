import { beforeEach, describe, expect, it, vi } from 'vitest'

const SERVICE = 'SERVICE_KEY_SENTINEL'
const URLBASE = 'https://staging.supabase.co'

type Auth = {
  clientId: string
  staffId: string
  staffName: string
  role: string
  authType: 'shift_token'
}

type Call = { url: string; method: string; body?: Record<string, unknown> }

const state = vi.hoisted(() => ({
  auth: {
    clientId: 'amalay', staffId: 'staff-mesero', staffName: 'Ana', role: 'mesero', authType: 'shift_token',
  } as Auth,
  existing: null as null | Record<string, unknown>,
  calls: [] as Call[],
  managerApproval: false,
  approvalCalls: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/api-auth', async (original) => {
  const real = await original<typeof import('@/lib/api-auth')>()
  return { ...real, withPOSAuth: vi.fn(async () => state.auth) }
})

vi.mock('@/lib/manager-approval', () => ({
  verifyManagerApproval: vi.fn(async (options: Record<string, unknown>) => {
    state.approvalCalls.push(options)
    return state.managerApproval
      ? { ok: true, mode: 'online:gerente', solicitanteNivel: 2 }
      : { ok: false, mode: 'blocked', solicitanteNivel: 1 }
  }),
}))

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    state.calls.push({ url, method: init?.method ?? 'GET', body })

    if (url.includes('/rest/v1/pos_orders') && url.includes('select=mesero,descuento,items,status')) {
      return response(state.existing ? [state.existing] : [])
    }
    if (url.includes('/rest/v1/clients')) return response([{ iva_rate: '0.16' }])
    if (url.includes('/rest/v1/pos_turnos')) return response([{ id: 'turn-1', closed_at: null }])
    if (url.includes('/rest/v1/rpc/r1_save_order')) {
      return response({ ok: true, revision: 2, first_execution: false })
    }
    if (url.includes('/rest/v1/pos_orders') && url.includes('select=items,total,descuento,mesero')) {
      return response(state.existing ? [state.existing] : [])
    }
    return response([])
  }))
}

function item(subtotal = 100) {
  return {
    id: 'line-1', menuItemId: 'menu-1', nombre: 'Platillo', precio: subtotal,
    precioExtra: 0, cantidad: 1, subtotal, modificadores: [], notas: '',
  }
}

function payload(extra: Record<string, unknown> = {}) {
  return {
    order_id: 'order-1', expected_revision: 0, turno_id: 'turn-1',
    status: 'enviada', mesero: 'Ana', items: [item()],
    subtotal: 100, descuento: 0, iva: 16, total: 116,
    ...extra,
  }
}

async function save(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/pos/save-order/route')
  return POST({ json: async () => body } as unknown as import('next/server').NextRequest)
}

function rpcBody(): Record<string, unknown> | undefined {
  return state.calls.find(call => call.url.includes('/rest/v1/rpc/r1_save_order'))?.body
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.auth = {
    clientId: 'amalay', staffId: 'staff-mesero', staffName: 'Ana', role: 'mesero', authType: 'shift_token',
  }
  state.existing = null
  state.calls = []
  state.managerApproval = false
  state.approvalCalls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = URLBASE
  process.env.SUPABASE_SERVICE_KEY = SERVICE
  installFetch()
})

describe('save-order usa la autoridad firmada, no los campos financieros del navegador', () => {
  it('un mesero no puede cerrar ni liquidar la orden por POST directo', async () => {
    const result = await save(payload({ status: 'cerrada', pagos: [{ metodo: 'Efectivo', monto: 1 }], total: 1 }))

    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ ok: false, error: 'CLOSE_ORDER_FORBIDDEN' })
    expect(rpcBody()).toBeUndefined()
  })

  it('un mesero no puede anular su cuenta por POST directo', async () => {
    state.existing = { mesero: 'Ana', descuento: 0, items: [item()], status: 'enviada' }

    const result = await save(payload({ expected_revision: 2, status: 'cancelada' }))

    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ ok: false, error: 'CANCEL_ORDER_FORBIDDEN' })
    expect(rpcBody()).toBeUndefined()
  })

  it('un admin con permiso propio sí puede anular', async () => {
    state.auth = {
      clientId: 'amalay', staffId: 'staff-admin', staffName: 'Admin', role: 'admin', authType: 'shift_token',
    }

    const result = await save(payload({ expected_revision: 2, status: 'cancelada' }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({ p_status: 'cancelada' })
  })

  it('un cajero con aprobación firmada puede anular y reintentar la misma operación offline', async () => {
    state.auth = {
      clientId: 'amalay', staffId: 'staff-cajero', staffName: 'Caja', role: 'cajero', authType: 'shift_token',
    }
    state.managerApproval = true

    const result = await save(payload({
      expected_revision: 2, status: 'cancelada', approval_token: 'signed-manager-token',
      save_operation_id: 'offline-cancel-1',
    }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({
      p_status: 'cancelada', p_save_operation_id: 'offline-cancel-1',
    })
    expect(state.approvalCalls).toContainEqual(expect.objectContaining({
      approvalToken: 'signed-manager-token', clientId: 'amalay', solicitanteRol: 'cajero',
    }))
  })

  it('una orden nueva queda a nombre del mesero firmado y sin descuento inventado', async () => {
    const result = await save(payload({ mesero: 'Otro', descuento: 90, subtotal: 1, iva: 0, total: 1 }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({
      p_mesero: 'Ana', p_descuento: 0, p_subtotal: 100, p_iva: 16, p_total: 116,
    })
  })

  it('el alias staff hereda el mismo límite de autoridad del mesero', async () => {
    state.auth = {
      clientId: 'amalay', staffId: 'staff-legacy', staffName: 'Ana', role: 'staff', authType: 'shift_token',
    }

    const result = await save(payload({ mesero: 'Otro', descuento: 90, subtotal: 1, iva: 0, total: 1 }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({
      p_mesero: 'Ana', p_descuento: 0, p_subtotal: 100, p_iva: 16, p_total: 116,
    })
  })

  it('un mesero no puede tomar ni editar la cuenta de otro mesero', async () => {
    state.existing = { mesero: 'Beatriz', descuento: 0, items: [item()], status: 'enviada' }

    const result = await save(payload({ expected_revision: 2, mesero: 'Ana' }))

    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ ok: false, error: 'ORDER_NOT_OWNED' })
    expect(rpcBody()).toBeUndefined()
  })

  it('en su propia cuenta conserva mesero/descuento escritos y reconstruye los agregados', async () => {
    state.existing = { mesero: 'Ana', descuento: 10, items: [item()], status: 'enviada' }

    const result = await save(payload({
      expected_revision: 2, mesero: 'Beatriz', descuento: 95, subtotal: 1, iva: 0, total: 1,
    }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({
      p_mesero: 'Ana', p_descuento: 10, p_subtotal: 100, p_iva: 14.4, p_total: 104.4,
    })
  })

  it.each(['cajero', 'admin'])('%s sí puede cerrar una cuenta legítima', async (role) => {
    state.auth = {
      clientId: 'amalay', staffId: `staff-${role}`, staffName: role, role, authType: 'shift_token',
    }
    state.existing = { mesero: 'Ana', descuento: 0, items: [item()], status: 'enviada', total: 116 }

    const result = await save(payload({
      expected_revision: 2, status: 'cerrada', pagos: [{ metodo: 'Efectivo', monto: 116 }],
      save_operation_id: `replay-${role}`,
    }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({ p_status: 'cerrada', p_total: 116 })
  })

  it('un replay idempotente de cajero conserva operación y autoridad', async () => {
    state.auth = {
      clientId: 'amalay', staffId: 'staff-cajero', staffName: 'Caja', role: 'cajero', authType: 'shift_token',
    }
    state.existing = { mesero: 'Ana', descuento: 0, items: [item()], status: 'cerrada', total: 116 }

    const result = await save(payload({
      expected_revision: 2, status: 'cerrada', pagos: [{ metodo: 'Efectivo', monto: 116 }],
      save_operation_id: 'offline-payment-1',
    }))

    expect(result.status).toBe(200)
    expect(rpcBody()).toMatchObject({ p_save_operation_id: 'offline-payment-1', p_status: 'cerrada' })
  })
})
