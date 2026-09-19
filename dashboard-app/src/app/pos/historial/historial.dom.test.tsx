// Guardián de la migración visual de /pos/historial (fase 2 del rediseño V2).
//
// Aquí el riesgo no es el estilo: es que la migración se lleve por delante la
// deduplicación, el respaldo offline o el mapeo de la reimpresión — tres cosas
// que no se ven en una captura de pantalla y que sólo se notan en campo, tarde.
//
// `formatMXN` NO se simula: se usa el real, para que las cantidades que se
// afirman aquí sean las que de verdad sale impresas.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

const printTicketCSS = vi.fn()
const getCachedOrders = vi.fn()

vi.mock('@/lib/pos-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pos-data')>()
  return { ...actual, getClientId: () => 'amalay' }
})
vi.mock('@/lib/printer', () => ({ printTicketCSS: (...a: unknown[]) => printTicketCSS(...a) }))
vi.mock('@/lib/pos-offline-db', () => ({ getCachedOrders: () => getCachedOrders() }))

import HistorialPage from './page'

type Orden = {
  id: string; mesa: number; mesero: string; personas: number; status: string
  subtotal: number; iva: number; total: number; descuento: number
  metodo_pago: string | null; items: string; notas: string | null
  created_at: string; closed_at: string | null
}

const orden = (o: Partial<Orden> = {}): Orden => ({
  id: 'ord-0001-aaaa',
  mesa: 7,
  mesero: 'Aldo Ruiz',
  personas: 2,
  status: 'cerrada',
  subtotal: 500,
  iva: 80,
  total: 580,
  descuento: 0,
  metodo_pago: 'Efectivo',
  items: JSON.stringify([{ nombre: 'Chilaquiles Verdes', cantidad: 2, subtotal: 584, modificadores: ['Sin picante'] }]),
  notas: null,
  created_at: '2026-09-19T18:30:00.000Z',
  closed_at: '2026-09-19T19:10:00.000Z',
  ...o,
})

function muchas(n: number): Orden[] {
  return Array.from({ length: n }, (_, i) => orden({
    id: `ord-${String(i).padStart(5, '0')}`,
    mesa: (i % 40) + 1,
    mesero: `Mesero ${i % 7}`,
    total: 100 + i,
    status: i % 5 === 0 ? 'cancelada' : 'cerrada',
    created_at: new Date(Date.UTC(2026, 8, 19, 12, i % 60)).toISOString(),
  }))
}

/** Respuesta OK de PostgREST. */
function responde(rows: Orden[]) {
  return { ok: true, json: async () => rows } as unknown as Response
}

beforeEach(() => {
  printTicketCSS.mockReset()
  getCachedOrders.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => responde([])))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('historial — los tres tamaños', () => {
  it('VACÍO: lo dice y no pinta lista', async () => {
    render(<HistorialPage />)
    expect(await screen.findByTestId('historial-vacio')).toBeTruthy()
    expect(screen.getByText('Sin ordenes para esta fecha')).toBeTruthy()
    expect(screen.getByText('0 ordenes')).toBeTruthy()
    expect(screen.queryByTestId('historial-lista')).toBeNull()
  })

  it('UNA ORDEN: la pinta con mesa, mesero, estado, hora, método y personas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden()])))
    render(<HistorialPage />)

    const fila = await screen.findByTestId('historial-orden')
    expect(within(fila).getByText('Mesa 7')).toBeTruthy()
    expect(within(fila).getByText('Aldo Ruiz')).toBeTruthy()
    expect(within(fila).getByText('Cerrada')).toBeTruthy()
    expect(within(fila).getByText(/Efectivo/)).toBeTruthy()
    expect(within(fila).getByText(/2 personas/)).toBeTruthy()
    expect(within(fila).getByText('$580.00')).toBeTruthy()
    expect(screen.getByText('1 ordenes')).toBeTruthy()
  })

  it('500 ÓRDENES: las pinta TODAS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde(muchas(500))))
    render(<HistorialPage />)

    await screen.findByTestId('historial-lista')
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(500)
    expect(screen.getByText('500 ordenes')).toBeTruthy()
  })
})

describe('historial — lo que se rompe sin que se vea', () => {
  it('deduplica la misma orden enviada dos veces', async () => {
    const a = orden({ id: 'uno' })
    const b = orden({ id: 'dos' })   // mismo mesa+mesero+items+minuto
    vi.stubGlobal('fetch', vi.fn(async () => responde([a, b])))
    render(<HistorialPage />)

    await screen.findByTestId('historial-lista')
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(1)
  })

  it('NO deduplica dos órdenes distintas de la misma mesa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([
      orden({ id: 'uno', created_at: '2026-09-19T18:30:00.000Z' }),
      orden({ id: 'dos', created_at: '2026-09-19T19:45:00.000Z' }),
    ])))
    render(<HistorialPage />)

    await screen.findByTestId('historial-lista')
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(2)
  })

  it('sin red cae al caché local en vez de quedarse cargando', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    getCachedOrders.mockResolvedValue([orden({ mesa: 33, mesero: 'Cache' })])
    render(<HistorialPage />)

    const fila = await screen.findByTestId('historial-orden')
    expect(within(fila).getByText('Mesa 33')).toBeTruthy()
    expect(screen.queryByTestId('historial-cargando')).toBeNull()
  })

  it('sin red y sin caché termina en el estado vacío, no en el spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    getCachedOrders.mockRejectedValue(new Error('sin IndexedDB'))
    render(<HistorialPage />)

    expect(await screen.findByTestId('historial-vacio')).toBeTruthy()
  })

  it('consulta con ventana de día y tope de 200, filtrada por tenant', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => responde([]))
    vi.stubGlobal('fetch', f)
    render(<HistorialPage />)
    await screen.findByTestId('historial-vacio')

    const url = String(f.mock.calls[0][0])
    expect(url).toContain('client_id=eq.amalay')
    expect(url).toContain('created_at=gte.')
    expect(url).toContain('created_at=lt.')
    expect(url).toContain('order=created_at.desc')
    expect(url).toContain('limit=200')
  })

  it('cambiar la fecha vuelve a consultar', async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => responde([]))
    vi.stubGlobal('fetch', f)
    render(<HistorialPage />)
    await screen.findByTestId('historial-vacio')
    expect(f).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-09-01' } })
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    expect(String(f.mock.calls[1][0])).toContain('2026-09-01')
  })
})

describe('historial — desplegar y reimprimir', () => {
  it('el detalle aparece al tocar y trae artículos, modificadores y totales', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden({ descuento: 45 })])))
    render(<HistorialPage />)

    const fila = await screen.findByTestId('historial-orden')
    expect(screen.queryByTestId('historial-detalle')).toBeNull()

    fireEvent.click(fila)
    const detalle = screen.getByTestId('historial-detalle')
    expect(within(detalle).getByText('2x Chilaquiles Verdes')).toBeTruthy()
    expect(within(detalle).getByText('Sin picante')).toBeTruthy()
    expect(within(detalle).getByText('Sub: $500.00')).toBeTruthy()
    expect(within(detalle).getByText('IVA: $80.00')).toBeTruthy()
    expect(within(detalle).getByText('Desc: -$45.00')).toBeTruthy()
    expect(within(detalle).getByText('ID: ord-0001')).toBeTruthy()

    fireEvent.click(fila)
    expect(screen.queryByTestId('historial-detalle')).toBeNull()
  })

  it('sin descuento NO muestra la línea de descuento', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden({ descuento: 0 })])))
    render(<HistorialPage />)
    fireEvent.click(await screen.findByTestId('historial-orden'))
    expect(within(screen.getByTestId('historial-detalle')).queryByText(/Desc:/)).toBeNull()
  })

  it('Reimprimir manda el ticket con el mapeo completo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden()])))
    render(<HistorialPage />)
    fireEvent.click(await screen.findByTestId('historial-orden'))
    fireEvent.click(screen.getByText('Reimprimir'))

    expect(printTicketCSS).toHaveBeenCalledTimes(1)
    const t = printTicketCSS.mock.calls[0][0] as Record<string, unknown>
    expect(t.id).toBe('ord-0001-aaaa')
    expect(t.mesa).toBe(7)
    expect(t.mesero).toBe('Aldo Ruiz')
    expect(t.personas).toBe(2)
    expect(t.total).toBe(580)
    expect(t.subtotal).toBe(500)
    expect(t.iva).toBe(80)
    expect(t.metodoPago).toBe('Efectivo')
    expect(t.createdAt).toBeInstanceOf(Date)
    expect(t.closedAt).toBeInstanceOf(Date)
    const items = t.items as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0].nombre).toBe('Chilaquiles Verdes')
    expect(items[0].cantidad).toBe(2)
    // precio se deriva de subtotal/cantidad cuando la orden vieja no lo trae
    expect(items[0].precio).toBe(292)
    expect(items[0].modificadores).toEqual(['Sin picante'])
  })

  it('una orden sin closed_at no inventa fecha de cierre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden({ closed_at: null })])))
    render(<HistorialPage />)
    fireEvent.click(await screen.findByTestId('historial-orden'))
    fireEvent.click(screen.getByText('Reimprimir'))
    expect((printTicketCSS.mock.calls[0][0] as Record<string, unknown>).closedAt).toBeUndefined()
  })

  it('artículos en formato viejo (name/quantity) siguen legibles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([orden({
      items: JSON.stringify([{ name: 'Cafe Americano', quantity: 3, subtotal: 144 }]),
    })])))
    render(<HistorialPage />)
    fireEvent.click(await screen.findByTestId('historial-orden'))
    expect(screen.getByText('3x Cafe Americano')).toBeTruthy()
  })
})

describe('historial — filtros', () => {
  it('el filtro de estado deja pasar sólo ese estado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([
      orden({ id: 'a', status: 'cerrada', mesa: 1 }),
      orden({ id: 'b', status: 'cancelada', mesa: 2 }),
      orden({ id: 'c', status: 'enviada', mesa: 3 }),
    ])))
    render(<HistorialPage />)
    await screen.findByTestId('historial-lista')

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'cancelada' } })
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(1)
    expect(screen.getByText('Cancelada')).toBeTruthy()
  })

  it('conserva las 4 opciones de estado con sus valores', async () => {
    render(<HistorialPage />)
    await screen.findByTestId('historial-vacio')
    const opciones = within(screen.getByLabelText('Filtrar por estado') as HTMLElement)
      .getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(opciones).toEqual(['all', 'cerrada', 'cancelada', 'enviada'])
  })

  it('la búsqueda pega contra mesero, id y número de mesa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([
      orden({ id: 'aaa', mesa: 11, mesero: 'Ana' }),
      orden({ id: 'bbb', mesa: 22, mesero: 'Beto', created_at: '2026-09-19T19:00:00.000Z' }),
    ])))
    render(<HistorialPage />)
    await screen.findByTestId('historial-lista')
    const buscar = screen.getByLabelText('Buscar órdenes')

    fireEvent.change(buscar, { target: { value: 'beto' } })
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(1)

    fireEvent.change(buscar, { target: { value: 'aaa' } })
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(1)

    fireEvent.change(buscar, { target: { value: '22' } })
    expect(screen.getAllByTestId('historial-orden')).toHaveLength(1)
  })

  it('el contador de la cabecera cuenta lo FILTRADO', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responde([
      orden({ id: 'a', status: 'cerrada', mesa: 1 }),
      orden({ id: 'b', status: 'cancelada', mesa: 2 }),
    ])))
    render(<HistorialPage />)
    await screen.findByTestId('historial-lista')
    expect(screen.getByText('2 ordenes')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'cancelada' } })
    expect(screen.getByText('1 ordenes')).toBeTruthy()
  })

  it('la salida a /pos sigue ahí', async () => {
    render(<HistorialPage />)
    await screen.findByTestId('historial-vacio')
    expect(screen.getByLabelText('Volver al punto de venta').getAttribute('href')).toBe('/pos')
  })
})

describe('historial — estado de carga', () => {
  it('mientras carga muestra el spinner y NO el vacío', async () => {
    let resolver: (v: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolver = r })))
    render(<HistorialPage />)

    expect(screen.getByTestId('historial-cargando')).toBeTruthy()
    expect(screen.queryByTestId('historial-vacio')).toBeNull()

    resolver(responde([]))
    expect(await screen.findByTestId('historial-vacio')).toBeTruthy()
  })
})
