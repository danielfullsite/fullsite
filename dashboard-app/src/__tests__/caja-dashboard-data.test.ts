import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.hoisted(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://report-fixture.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic' })
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-session' } } }) } } }))
vi.mock('@/lib/fetch-with-timeout', () => ({ fetchWithTimeout: vi.fn() }))
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { getDashboardFromPosOrders, getRecentDays, getDateRange } from '@/lib/data'
const network = vi.mocked(fetchWithTimeout)
const legacy = (id = 'legacy') => ({ id, mesa: 1, mesero: 'Ana', personas: 1, total: 100, subtotal: 100, iva: 0, descuento: 0, propina: 0,
  metodo_pago: 'Efectivo', pagos: null, items: [], status: 'cerrada', created_at: '2026-09-08T15:00:00Z' })
const partial = () => ({ ...legacy('caja'), turno_id: 'turn', status: 'entregada', payment_status: 'pendiente', caja_stream_id: 'stream', financial_revision: 2,
  created_at: '2026-08-01T15:00:00Z', updated_at: '2026-09-08T15:00:00Z', caja_financial_snapshot: {
    order_id: 'caja', turno_id: 'turn', revision: 2, order_revision: 1, currency: 'MXN', total_cents: 10000, paid_cents: 3000, reserved_cents: 0, balance_cents: 7000, status: 'open',
    accounts: [{ account_id: 'full', total_cents: 10000, paid_cents: 3000, reserved_cents: 0, balance_cents: 7000 }],
    payments: [{ payment_id: 'paid', account_id: 'full', amount_cents: 3000, method: 'cash', status: 'accepted', accepted_at: '2026-09-08T15:00:00Z' }],
  } })
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T20:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('the real dashboard query includes partial Caja money by payment date and keeps closed legacy money', async () => {
  network.mockResolvedValue(Response.json([partial(), legacy()]))
  const rows = await getDashboardFromPosOrders(7, 'fixture-restaurant', 'branch-2')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ fecha: '2026-09-08', ventas_dia: 130, efectivo: 130, propinas_total: 0, tickets_count: 2 })
  const query = String(network.mock.calls[0][0])
  expect(query).toContain('client_id=eq.fixture-restaurant')
  expect(query).toContain('location_id=eq.branch-2')
  expect(query).toContain('updated_at.gte.')
  expect(query).not.toContain('status=eq.cerrada')
})
it('fetches the next page so a shift with more than 1000 rows is not silently truncated', async () => {
  network.mockResolvedValueOnce(Response.json(Array.from({ length: 1000 }, (_, i) => legacy(`order-${i}`))))
    .mockResolvedValueOnce(Response.json([legacy('last')]))
  const rows = await getDashboardFromPosOrders(7, 'fixture-restaurant')
  expect(rows[0].ventas_dia).toBe(100100)
  expect(String(network.mock.calls[1][0])).toContain('offset=1000')
})
it('an unavailable or inconsistent Caja report fails explicitly instead of falling back to historical Wansoft totals', async () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'fullsite_data_source' ? 'fullsite' : null })
  network.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }))
  await expect(getRecentDays(7, 'fixture-restaurant')).rejects.toThrow('reporte completo')
  expect(network).toHaveBeenCalledTimes(1)
  const bad = partial(); bad.caja_financial_snapshot.paid_cents = 10000
  network.mockResolvedValue(Response.json([bad]))
  await expect(getDashboardFromPosOrders(7, 'fixture-restaurant')).rejects.toThrow()
})
it('keeps the configured Wansoft report available before cutover if the optional POS supplement fails', async () => {
  network.mockImplementation(async url => String(url).includes('/pos_orders') ? Response.json({ error: 'unavailable' }, { status: 503 })
    : Response.json([{ fecha: '2026-09-08', ventas_dia: 700, tickets_count: 7 }]))
  const rows = await getRecentDays(7, 'fixture-restaurant')
  expect(rows[0]).toMatchObject({ fecha: '2026-09-08', ventas_dia: 700 })
})
it('a historical date range queries far enough back instead of using its duration from today', async () => {
  network.mockImplementation(async url => String(url).includes('/wansoft_daily') ? Response.json([])
    : Response.json([{ ...legacy(), created_at: '2026-08-10T15:00:00Z' }]))
  const rows = await getDateRange('2026-08-10', '2026-08-10', 'fixture-restaurant', 'branch-2')
  expect(rows).toHaveLength(1)
  expect(rows[0].fecha).toBe('2026-08-10')
  const url = new URL(String(network.mock.calls.find(([u]) => String(u).includes('/pos_orders'))![0]))
  expect(url.searchParams.get('or')).toMatch(/created_at.gte.2026-08-/)
  expect(url.searchParams.get('location_id')).toBe('eq.branch-2')
})
