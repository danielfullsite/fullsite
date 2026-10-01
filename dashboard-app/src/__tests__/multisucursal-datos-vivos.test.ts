import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El comparativo multisucursal leía la sucursal SÓLO de wansoft_daily.
 *
 * `getDashboardFromPosOrders` —la que trae los datos VIVOS— no propagaba locationId,
 * y el merge de getRecentDays PREFIERE esos datos vivos sobre los históricos.
 * Resultado: las cinco marcas de un grupo salían con números idénticos, porque todas
 * mostraban la suma del tenant completo.
 *
 * Desde el fix server-side, el camino vivo pega a /api/dashboard/pos-daily con
 * client_id y location_id como parámetros; la RUTA los traduce a filtros eq. sobre
 * pos_orders (eso se prueba en pos-daily-route.test.ts). Aquí se mira que el CLIENTE
 * propague la sucursal a esa petición viva, que es donde vivía el bug.
 */

vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-report-session' } } }) } } }))

const URLS: string[] = []

// El camino vivo (/api/dashboard/pos-daily) responde { orders: [] }; el resto
// (wansoft_daily por PostgREST) responde un arreglo. Ambos vacíos y ok.
function respuestaVacia(url: string) {
  const body: unknown = url.includes('/pos-daily') ? { orders: [] } : []
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  URLS.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input.toString()
    URLS.push(u)
    return respuestaVacia(u)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** Las peticiones que fueron al camino de datos vivos (/api/dashboard/pos-daily). */
function urlsVivas() {
  return URLS.filter(u => u.includes('/pos-daily'))
}

describe('datos vivos filtrados por sucursal', () => {
  it('getDashboardFromPosOrders filtra por sucursal cuando se le pasa', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo', 'diezmex-rosta')

    const urls = urlsVivas()
    expect(urls.length, 'debió consultar el camino vivo').toBeGreaterThan(0)
    expect(urls[0]).toContain('client_id=diezmex-demo')
    expect(urls[0], 'sin este filtro las 5 marcas muestran la suma del grupo')
      .toContain('location_id=diezmex-rosta')
  })

  it('sin sucursal NO agrega el filtro — el grupo completo sigue funcionando', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo')

    const urls = urlsVivas()
    expect(urls[0]).toContain('client_id=diezmex-demo')
    expect(urls[0], 'el roll-up del grupo no debe filtrarse').not.toContain('location_id')
  })

  it('null y undefined se tratan igual: sin filtro', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo', null)
    expect(urlsVivas()[0]).not.toContain('location_id')
  })

  it('getRecentDays propaga la sucursal al camino vivo, no sólo al histórico', async () => {
    const { getRecentDays } = await import('../lib/data')
    await getRecentDays(30, 'diezmex-demo', 'diezmex-casa-oso')

    const pos = urlsVivas()
    expect(pos.length, 'getRecentDays consulta el camino vivo primero').toBeGreaterThan(0)
    // Éste es el corazón del bug: antes esta petición salía sin sucursal.
    expect(pos[0]).toContain('location_id=diezmex-casa-oso')

    const historico = URLS.filter(u => u.includes('/wansoft_daily'))
    if (historico.length) {
      expect(historico[0], 'el histórico ya filtraba y debe seguir haciéndolo')
        .toContain('location_id=eq.diezmex-casa-oso')
    }
  })

  // getMonthlyData y getDateRange RECIBÍAN locationId y lo tiraban al llamar a
  // getDashboardFromPosOrders. Alimentan Tendencias, Reportes de ingresos y
  // Estado de resultados: esas tres pantallas mostraban el total del grupo en
  // cada sucursal aunque /sucursales ya comparara bien.
  it('getMonthlyData no tira la sucursal que recibe', async () => {
    const { getMonthlyData } = await import('../lib/data')
    await getMonthlyData('diezmex-demo', 'diezmex-manteca')
    const pos = urlsVivas()
    expect(pos.length, 'getMonthlyData consulta el camino vivo').toBeGreaterThan(0)
    expect(pos[0], 'alimenta Tendencias').toContain('location_id=diezmex-manteca')
  })

  it('getDateRange no tira la sucursal que recibe', async () => {
    const { getDateRange } = await import('../lib/data')
    await getDateRange('2026-08-01', '2026-08-28', 'diezmex-demo', 'diezmex-macadam')
    const pos = urlsVivas()
    expect(pos.length, 'getDateRange consulta el camino vivo').toBeGreaterThan(0)
    expect(pos[0], 'alimenta Reportes de ingresos y Estado de resultados')
      .toContain('location_id=diezmex-macadam')
  })

  it('el tenant siempre va en la consulta, con o sin sucursal', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(7, 'otro-tenant', 'otra-sucursal')
    // Aislamiento: filtrar por sucursal nunca debe reemplazar el filtro de tenant.
    const u = urlsVivas()[0]
    expect(u).toContain('client_id=otro-tenant')
    expect(u).toContain('location_id=otra-sucursal')
  })
})
