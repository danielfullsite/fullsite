import { beforeEach, describe, expect, it, vi } from 'vitest'
// El lector server-side (/api/dashboard/pos-daily) devuelve { orders: [...] } ya paginado
// y validado; el cliente sólo agrega. La paginación keyset, el dedupe y el rechazo por
// día de venta faltante viven ahora en la RUTA y se prueban en pos-daily-route.test.ts.
const fetchMock = vi.hoisted(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon'; return vi.fn() })
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } } }))
vi.mock('@/lib/fetch-with-timeout', () => ({ fetchWithTimeout: fetchMock }))
import { getDashboardFromPosOrders, getRecentDays, getLatestDay, getDateRange } from '@/lib/data'
const sale = (id: string, extra: Record<string, unknown> = {}) => ({ id, dia_venta: '2026-09-09', status: 'cerrada', total: 100, subtotal: 100, iva: 0, descuento: 0, propina: 0, mesa: 1, mesero: 'Ana', personas: 1, items: [], pagos: [], created_at: '2026-09-10T07:00:00Z', ...extra })
// La ruta responde { orders }. El cliente hace UNA sola llamada y agrega.
function serve(rows: ReturnType<typeof sale>[]) {
  fetchMock.mockImplementation(async () => Response.json({ orders: rows }))
}
beforeEach(() => { fetchMock.mockReset() })
describe('settled POS sales reader (cliente agrega lo que da la ruta)', () => {
  it('pide la ruta server-side con el tenant y el rango, en una sola llamada', async () => {
    serve([sale('a')])
    const [day] = await getDashboardFromPosOrders(30, 'restaurant-a', 'branch-a')
    expect(day.tickets_count).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const p = new URL(fetchMock.mock.calls[0][0], 'https://synthetic.invalid')
    expect(p.pathname).toBe('/api/dashboard/pos-daily')
    expect(p.searchParams.get('client_id')).toBe('restaurant-a')
    expect(p.searchParams.get('location_id')).toBe('branch-a')
    expect(p.searchParams.get('since')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('rechaza una lectura fallida en vez de devolver ventas parciales', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
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
  it('rechaza una respuesta mal formada (sin arreglo orders)', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'unavailable' }))
    await expect(getDashboardFromPosOrders(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
})


describe('report source fallback', () => {
  it('preserves real Wansoft history when POS is unavailable, including latest day', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/pos-daily')
      ? new Response('', { status: 503 })
      : Response.json([{ fecha: '2026-09-08', ventas_dia: 1234, tickets_count: 2 }]))
    expect((await getRecentDays(30, 'restaurant-a'))[0].ventas_dia).toBe(1234)
    expect((await getLatestDay('restaurant-a'))?.fecha).toBe('2026-09-08')
  })
  it('propagates unavailable when neither source provides confirmed data', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/pos-daily')
      ? new Response('', { status: 503 }) : Response.json([]))
    await expect(getRecentDays(30, 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    await expect(getLatestDay('restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
    await expect(getDateRange('2020-01-01', '2020-01-07', 'restaurant-a')).rejects.toThrow('POS_REPORT_UNAVAILABLE')
  })
  it('historical date ranges look back to the requested start, not merely the interval length', async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes('/pos-daily') ? Response.json({ orders: [] }) : Response.json([]))
    await getDateRange('2020-01-01', '2020-01-07', 'restaurant-a')
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/pos-daily'))!
    const since = new URL(call[0], 'https://synthetic.invalid').searchParams.get('since')!
    expect(since <= '2020-01-01').toBe(true)
  })
})
