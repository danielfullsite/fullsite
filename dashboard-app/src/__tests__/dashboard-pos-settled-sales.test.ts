import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchMock = vi.hoisted(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon'; return vi.fn() })
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } } }))
vi.mock('@/lib/fetch-with-timeout', () => ({ fetchWithTimeout: fetchMock }))
import { getDashboardFromPosOrders, getRecentDays, getLatestDay, getDateRange } from '@/lib/data'
const sale = (id: string, extra: Record<string, unknown> = {}) => ({ id, dia_venta: '2026-09-09', status: 'cerrada', total: 100, subtotal: 100, iva: 0, descuento: 0, propina: 0, mesa: 1, mesero: 'Ana', personas: 1, items: [], pagos: [], created_at: '2026-09-10T07:00:00Z', ...extra })
function serve(rows: ReturnType<typeof sale>[], cap = 1000) {
  fetchMock.mockImplementation(async (url: string) => {
    const after = new URL(url, 'https://synthetic.invalid').searchParams.get('id')?.slice(4, -1)
    return Response.json(rows.filter(r => !after || r.id > after).slice(0, cap))
  })
}
beforeEach(() => { fetchMock.mockReset() })
describe('settled POS sales reader', () => {
  it('reads more than 5000 rows despite a smaller server cap using stable scoped keyset pages', async () => {
    serve(Array.from({ length: 5107 }, (_, i) => sale(String(i).padStart(6, '0'))), 700)
    const [day] = await getDashboardFromPosOrders(30, 'restaurant-a', 'branch-a')
    expect(day.tickets_count).toBe(5107)
    expect(day.ventas_dia).toBe(510700)
    expect(fetchMock).toHaveBeenCalledTimes(9)
    for (const [url] of fetchMock.mock.calls) {
      const p = new URL(url, 'https://synthetic.invalid').searchParams
      expect(p.get('client_id')).toBe('eq.restaurant-a')
      expect(p.get('location_id')).toBe('eq.branch-a')
      expect(p.get('order')).toBe('id.asc')
      expect(p.has('offset')).toBe(false)
      expect(p.has('created_at')).toBe(false)
      expect(p.get('dia_venta')).toMatch(/^gte\./)
    }
  })
  it('rejects a mid-page failure instead of returning partial sales', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([sale('a')])).mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
  it('uses business day, counts paid kitchen work, excludes partial/deferred/cancelled sales and invents no methods', async () => {
    serve([
      sale('a', { caja_stream_id: 'stream', status: 'preparando', payment_status: 'pagada', caja_financial_snapshot: { payments: [{ payment_id: 'p1', status: 'accepted', amount_cents: 10000, method: 'external', provider: 'bank' }] } }),
      sale('b', { caja_stream_id: 'stream', status: 'enviada', payment_status: 'pendiente', pagos: [{ metodo: 'cash', monto: 40 }] }),
      sale('c', { payment_status: 'pendiente' }), sale('d', { status: 'cancelada', payment_status: 'pagada' }),
      sale('e', { caja_stream_id: 'stream', status: 'lista', payment_status: 'pagada' }),
    ])
    const [day] = await getDashboardFromPosOrders(30, 'restaurant-a')
    expect(day.fecha).toBe('2026-09-09')
    expect(day.ventas_dia).toBe(200)
    expect(day.tickets_count).toBe(2)
    expect(day.efectivo).toBe(0)
    expect(day.tarjeta).toBe(0)
    expect(day.pago_métodos).toEqual([{ nombre: 'external:bank', total: 100 }])
  })
  it('counts legacy children instead of split parents and Caja accounts once through the parent', async () => {
    serve([sale('a', { status: 'dividida', payment_status: 'pagada' }), sale('b', { parent_order_id: 'a', total: 40 }), sale('c', { parent_order_id: 'a', total: 60 }), sale('d'), sale('e', { parent_order_id: 'd' }), sale('f', { caja_stream_id: 'stream', payment_status: 'pagada', status: 'preparando' }), sale('g', { parent_order_id: 'f' })])
    const [day] = await getDashboardFromPosOrders(30, 'restaurant-a')
    expect(day.ventas_dia).toBe(300)
    expect(day.tickets_count).toBe(4)
  })
  it('normalizes legacy string JSON while ignoring rejected payments and cancelled products', async () => {
    serve([sale('a', { pagos: JSON.stringify([{ metodo: 'Efectivo', monto: 100 }, { metodo: 'Tarjeta', monto: 100, estado: 'rechazado' }]), items: JSON.stringify([{ nombre: 'Cafe', precio: 100, cantidad: 1 }, { nombre: 'Otro', precio: 50, cancelled: true }]) })])
    const [day] = await getDashboardFromPosOrders(30, 'restaurant-a')
    expect(day.efectivo).toBe(100)
    expect(day.tarjeta).toBe(0)
    expect(day.platillos_top).toEqual([{ nombre: 'Cafe', total: 100, cantidad: 1 }])
  })
  it('does not turn rejected attempts into a fallback receipt, and rejects corrupt payment detail', async () => {
    serve([sale('a', { metodo_pago: 'Efectivo', pagos: [{ metodo: 'Efectivo', monto: 100, estado: 'rechazado' }] })])
    expect((await getDashboardFromPosOrders(30, 'restaurant-a'))[0].pago_métodos).toEqual([])
    serve([sale('a', { pagos: '{invalid' })])
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
  it('rejects missing business day, repeated pages and malformed responses', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([sale('a', { dia_venta: null })]))
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    fetchMock.mockImplementation(async () => Response.json([sale('a')]))
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    fetchMock.mockResolvedValue(Response.json({ error: 'unavailable' }))
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
})


describe('report source fallback', () => {
  it('preserves real Wansoft history when POS is unavailable, including latest day', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/pos_orders')
      ? new Response('', { status: 503 })
      : Response.json([{ fecha: '2026-09-08', ventas_dia: 1234, tickets_count: 2 }]))
    expect((await getRecentDays(30, 'restaurant-a'))[0].ventas_dia).toBe(1234)
    expect((await getLatestDay('restaurant-a'))?.fecha).toBe('2026-09-08')
  })
  it('propagates unavailable when neither source provides confirmed data', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/pos_orders')
      ? new Response('', { status: 503 }) : Response.json([]))
    await expect(getRecentDays(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    await expect(getLatestDay('restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    await expect(getDateRange('2020-01-01', '2020-01-07', 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
  it('historical date ranges look back to the requested start, not merely the interval length', async () => {
    fetchMock.mockImplementation(async () => Response.json([]))
    await getDateRange('2020-01-01', '2020-01-07', 'restaurant-a')
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/pos_orders'))!
    const cutoff = new URL(call[0], 'https://synthetic.invalid').searchParams.get('dia_venta')!.slice(4)
    expect(cutoff <= '2020-01-01').toBe(true)
  })
})
