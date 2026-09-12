import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method: string; body?: Record<string, unknown> }>,
}))

vi.mock('@/lib/api-auth', async (original) => {
  const real = await original<typeof import('@/lib/api-auth')>()
  return {
    ...real,
    withPOSAuth: vi.fn(async () => ({
      clientId: 'amalay', staffId: 'caja-1', staffName: 'Caja', role: 'cajero', authType: 'shift_token',
    })),
  }
})

vi.mock('@/lib/manager-approval', () => ({
  verifyManagerApproval: vi.fn(async () => ({ ok: false, mode: 'blocked' })),
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

    if (url.includes('/rest/v1/clients')) return response([{ iva_rate: '0.16' }])
    if (url.includes('/rest/v1/pos_turnos')) return response([{ id: 'turno-1', closed_at: null }])
    if (url.includes('/rest/v1/rpc/r1_save_order')) {
      return response({ ok: true, revision: 1, first_execution: false, idempotent_replay: false })
    }
    if (url.includes('/rest/v1/pos_orders') && url.includes('select=items,total,descuento,mesero,status')) {
      return response([{
        items: [{
          id: 'linea-1', menuItemId: 'cafe', nombre: 'Cafe', precio: 100,
          precioExtra: 0, cantidad: 1, subtotal: 100, modificadores: [], notas: '',
        }],
        total: 116, descuento: 0, mesero: 'Ana', status: 'cerrada',
      }])
    }
    // El cafe costaba $100 cuando se capturo sin WAN. Antes del replay el menu
    // vigente subio a $120. La tabla mutable no puede probar cual era el precio
    // autorizado al capturar la venta.
    if (url.includes('/rest/v1/pos_menu_items')) return response([{ id: 'cafe', price: 120 }])
    if (url.includes('/rest/v1/pos_audit_log')) return response([])
    if (url.includes('select=last_inventory_processed_revision')) return response([])
    return response([])
  }))
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.calls = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'SERVICE_KEY_SENTINEL'
  installFetch()
})

describe('un catalogo actual no autoriza el precio de una venta offline historica', () => {
  it('conserva el importe capturado; reprecificarlo romperia el pago ya aceptado', async () => {
    const { POST } = await import('@/app/api/pos/save-order/route')
    const result = await POST({
      json: async () => ({
        order_id: 'offline-1', expected_revision: 0, save_operation_id: 'save-offline-1',
        turno_id: 'turno-1', captured_at: '2026-09-12T10:00:00.000Z', status: 'cerrada',
        mesa: 1, mesero: 'Ana', personas: 1,
        items: [{
          id: 'linea-1', menuItemId: 'cafe', nombre: 'Cafe', precio: 100,
          precioExtra: 0, cantidad: 1, subtotal: 100, modificadores: [], notas: '',
        }],
        subtotal: 100, descuento: 0, iva: 16, total: 116,
        pagos: [{ metodo: 'Efectivo', monto: 116 }],
      }),
    } as unknown as import('next/server').NextRequest)

    expect(result.status).toBe(200)
    const save = state.calls.find(call => call.url.includes('/rest/v1/rpc/r1_save_order_idempotent'))
    expect(save?.body).toMatchObject({ p_subtotal: 100, p_iva: 16, p_total: 116 })
    expect(save?.body?.p_items).toEqual(expect.arrayContaining([
      expect.objectContaining({ menuItemId: 'cafe', precio: 100, subtotal: 100 }),
    ]))

    // Aplicar el catalogo de $120 al replay daria $139.20 con IVA, pero el pago
    // durable que viaja en la misma operacion es $116. No hay una eleccion segura:
    // reprecificar sobrecobra/descuadra; rechazar pierde o atasca una venta legitima.
    expect(Math.round(120 * 1.16 * 100)).toBe(13_920)
    expect(Math.round(116 * 100)).toBe(11_600)

    const audit = state.calls.find(call =>
      call.url.includes('/rest/v1/pos_audit_log') && call.body?.action === 'price_edit_suspect')
    expect(audit?.body).toMatchObject({
      order_id: 'offline-1',
      details: { diff_cents: 2_000, fuente: 'catalogo_pos_menu_items' },
    })
  })
})
