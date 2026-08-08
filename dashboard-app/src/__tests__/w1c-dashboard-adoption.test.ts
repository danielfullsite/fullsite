import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── W1-C — adopción del business date en el dashboard ───────────────────────
// Certifica que getDashboardFromPosOrders():
//   1. agrupa por FECHA OPERATIVA del tenant (no por calendario del timestamp),
//   2. no duplica ni pierde órdenes alrededor del boundary,
//   3. respeta la configuración por tenant (dos zonas → agrupación distinta
//      para los MISMOS instantes), sin -06:00 hardcodeado,
//   4. degrada explícitamente a calendario si el tenant no tiene boundary.

const { mockFetchClientConfig } = vi.hoisted(() => ({ mockFetchClientConfig: vi.fn() }))

vi.mock('@/lib/client-config', () => ({
  fetchClientConfig: mockFetchClientConfig,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

import { getDashboardFromPosOrders } from '@/lib/data'

// Instantes UTC alrededor del boundary 04:00 de Monterrey (UTC-6):
//   A 2026-08-08T05:00:00Z = 23:00 ago-7 local → día operativo 2026-08-07
//   B 2026-08-08T09:59:00Z = 03:59 ago-8 local → día operativo 2026-08-07
//   C 2026-08-08T10:00:00Z = 04:00 ago-8 local → día operativo 2026-08-08 (boundary exacto)
const ORDERS = [
  { mesa: 1, mesero: 'A', personas: 2, total: 100, subtotal: 86, iva: 14, descuento: 0, propina: 0, metodo_pago: 'Efectivo', pagos: null, items: null, status: 'cerrada', created_at: '2026-08-08T05:00:00Z' },
  { mesa: 2, mesero: 'B', personas: 1, total: 200, subtotal: 172, iva: 28, descuento: 0, propina: 0, metodo_pago: 'Efectivo', pagos: null, items: null, status: 'cerrada', created_at: '2026-08-08T09:59:00Z' },
  { mesa: 3, mesero: 'C', personas: 3, total: 400, subtotal: 345, iva: 55, descuento: 0, propina: 0, metodo_pago: 'Efectivo', pagos: null, items: null, status: 'cerrada', created_at: '2026-08-08T10:00:00Z' },
]

function stubOrdersFetch() {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/pos_orders')) return new Response(JSON.stringify(ORDERS), { status: 200 })
    return new Response('[]', { status: 200 })
  }))
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  store['fullsite_client_id'] = 'test-client'
})

describe('W1-C — agrupación del dashboard por fecha operativa', () => {
  it('Monterrey b=04:00: madrugada pertenece al día anterior; boundary al nuevo; sin doble conteo', async () => {
    mockFetchClientConfig.mockResolvedValue({ id: 't', timezone: 'America/Monterrey', business_day_start_local: '04:00:00' })
    const calls = stubOrdersFetch()

    const days = await getDashboardFromPosOrders(30, 'test-client')
    const byFecha = new Map(days.map(d => [d.fecha, d]))

    expect(byFecha.get('2026-08-07')?.ventas_dia).toBe(300)   // A (23:00) + B (03:59)
    expect(byFecha.get('2026-08-08')?.ventas_dia).toBe(400)   // C (04:00 exacto)
    // Sin órdenes perdidas ni duplicadas: la suma de días == suma de órdenes
    expect(days.reduce((s, d) => s + d.ventas_dia, 0)).toBe(700)
    expect(days.reduce((s, d) => s + d.tickets_count, 0)).toBe(3)
    // Sin -06:00 hardcodeado en el query — el rango es un instante UTC de bounds
    const orderUrl = calls.find(u => u.includes('/pos_orders'))!
    expect(orderUrl).not.toContain('-06:00')
    expect(orderUrl).toContain('created_at=gte.')
  })

  it('mismos instantes, tenant en Asia/Tokyo → agrupación distinta (config por tenant)', async () => {
    mockFetchClientConfig.mockResolvedValue({ id: 't2', timezone: 'Asia/Tokyo', business_day_start_local: '04:00:00' })
    stubOrdersFetch()

    const days = await getDashboardFromPosOrders(30, 'test-client')
    const byFecha = new Map(days.map(d => [d.fecha, d]))
    // En Tokio (UTC+9): A=14:00, B=18:59, C=19:00 del 8-ago → TODO cae en 2026-08-08
    expect(byFecha.get('2026-08-08')?.ventas_dia).toBe(700)
    expect(byFecha.has('2026-08-07')).toBe(false)
  })

  it('tenant sin boundary → degradación explícita a calendario (conducta previa)', async () => {
    mockFetchClientConfig.mockResolvedValue({ id: 't3', timezone: 'America/Monterrey', business_day_start_local: null })
    stubOrdersFetch()

    const days = await getDashboardFromPosOrders(30, 'test-client')
    const byFecha = new Map(days.map(d => [d.fecha, d]))
    // Medianoche local: A (23:00 ago-7) → ago-7; B y C (03:59/04:00 ago-8) → ago-8
    expect(byFecha.get('2026-08-07')?.ventas_dia).toBe(100)
    expect(byFecha.get('2026-08-08')?.ventas_dia).toBe(600)
  })
})
