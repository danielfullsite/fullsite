import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El comparativo multisucursal leía la sucursal SÓLO de wansoft_daily.
 *
 * `getDashboardFromPosOrders` —la que trae los datos VIVOS de pos_orders— no
 * aceptaba locationId, y el merge de getRecentDays PREFIERE esos datos vivos
 * sobre los históricos. Resultado: las cinco marcas de un grupo salían con
 * números idénticos, porque todas mostraban la suma del tenant completo.
 *
 * Medido en staging el 2026-08-28 con el fixture diezmex-demo, que sí tiene
 * datos distinguibles por sucursal:
 *
 *     Rosta          $347,795   (376 tickets)
 *     Atletico Cafe  $347,710   (375)
 *     Café Macadam   $335,332   (376)
 *     Casa Oso       $333,887   (375)
 *     Tacos Manteca  $333,389   (375)
 *
 * Sin el arreglo, las cinco mostraban $1,698,113 — la suma — y el comparativo
 * no comparaba nada. Es el defecto que reventaría en la primera demo a un grupo.
 *
 * Estas pruebas miran la URL que se construye, que es donde vive el bug.
 */

const URLS: string[] = []

function respuestaVacia() {
  return {
    ok: true,
    status: 200,
    json: async () => [],
    text: async () => '[]',
  } as unknown as Response
}

beforeEach(() => {
  URLS.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    URLS.push(typeof input === 'string' ? input : input.toString())
    return respuestaVacia()
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** Las peticiones que fueron a pos_orders — el camino de datos vivos. */
function urlsDePosOrders() {
  return URLS.filter(u => u.includes('/pos_orders'))
}

describe('datos vivos filtrados por sucursal', () => {
  it('getDashboardFromPosOrders filtra por sucursal cuando se le pasa', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo', 'diezmex-rosta')

    const urls = urlsDePosOrders()
    expect(urls.length, 'debió consultar pos_orders').toBeGreaterThan(0)
    expect(urls[0]).toContain('client_id=eq.diezmex-demo')
    expect(urls[0], 'sin este filtro las 5 marcas muestran la suma del grupo')
      .toContain('location_id=eq.diezmex-rosta')
  })

  it('sin sucursal NO agrega el filtro — el grupo completo sigue funcionando', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo')

    const urls = urlsDePosOrders()
    expect(urls[0]).toContain('client_id=eq.diezmex-demo')
    expect(urls[0], 'el roll-up del grupo no debe filtrarse').not.toContain('location_id')
  })

  it('null y undefined se tratan igual: sin filtro', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(30, 'diezmex-demo', null)
    expect(urlsDePosOrders()[0]).not.toContain('location_id')
  })

  it('getRecentDays propaga la sucursal al camino vivo, no sólo al histórico', async () => {
    const { getRecentDays } = await import('../lib/data')
    await getRecentDays(30, 'diezmex-demo', 'diezmex-casa-oso')

    const pos = urlsDePosOrders()
    expect(pos.length, 'getRecentDays consulta pos_orders primero').toBeGreaterThan(0)
    // Éste es el corazón del bug: antes esta petición salía sin sucursal.
    expect(pos[0]).toContain('location_id=eq.diezmex-casa-oso')

    const historico = URLS.filter(u => u.includes('/wansoft_daily'))
    if (historico.length) {
      expect(historico[0], 'el histórico ya filtraba y debe seguir haciéndolo')
        .toContain('location_id=eq.diezmex-casa-oso')
    }
  })

  // getMonthlyData y getDateRange RECIBÍAN locationId y lo tiraban al llamar a
  // getDashboardFromPosOrders. Alimentan Tendencias, Reportes de ingresos y
  // Estado de resultados: esas tres pantallas mostraban el total del grupo en
  // cada sucursal aunque /sucursales ya comparara bien. Se arreglaron después
  // que el resto, así que son las que menos rodaje tienen.
  it('getMonthlyData no tira la sucursal que recibe', async () => {
    const { getMonthlyData } = await import('../lib/data')
    await getMonthlyData('diezmex-demo', 'diezmex-manteca')
    const pos = urlsDePosOrders()
    expect(pos.length, 'getMonthlyData consulta pos_orders').toBeGreaterThan(0)
    expect(pos[0], 'alimenta Tendencias').toContain('location_id=eq.diezmex-manteca')
  })

  it('getDateRange no tira la sucursal que recibe', async () => {
    const { getDateRange } = await import('../lib/data')
    await getDateRange('2026-08-01', '2026-08-28', 'diezmex-demo', 'diezmex-macadam')
    const pos = urlsDePosOrders()
    expect(pos.length, 'getDateRange consulta pos_orders').toBeGreaterThan(0)
    expect(pos[0], 'alimenta Reportes de ingresos y Estado de resultados')
      .toContain('location_id=eq.diezmex-macadam')
  })

  it('el tenant siempre va en la consulta, con o sin sucursal', async () => {
    const { getDashboardFromPosOrders } = await import('../lib/data')
    await getDashboardFromPosOrders(7, 'otro-tenant', 'otra-sucursal')
    // Aislamiento: filtrar por sucursal nunca debe reemplazar el filtro de tenant.
    const u = urlsDePosOrders()[0]
    expect(u).toContain('client_id=eq.otro-tenant')
    expect(u).toContain('location_id=eq.otra-sucursal')
  })
})
