// Guardián de la migración visual de /pos/auditoria (fase 2 del rediseño V2).
//
// Esta pantalla no se rediseñó para que se vea distinta: se rediseñó para que
// use el mismo vocabulario que el resto del POS. Lo que estas pruebas protegen
// es lo ÚNICO que no puede cambiar — el dato, el filtro y la acción.
//
// Para que el guardián valga, cada aserción nació de quitar algo de la pantalla
// y comprobar que la prueba truena: el conteo de la cabecera, la línea de
// motivo, el prefijo del id (que un Tag en mayúsculas habría corrompido) y el
// desglose de `details` son los cuatro puntos donde una migración se lleva
// datos por delante sin que nadie lo note.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { AuditLogEntry } from '@/lib/pos-data'

const getAuditLog = vi.fn()

vi.mock('@/lib/pos-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pos-data')>()
  return { ...actual, getAuditLog: (...a: unknown[]) => getAuditLog(...a) }
})

import AuditoriaPage from './page'

const entrada = (o: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 1,
  client_id: 'amalay',
  order_id: null,
  action: 'order_created',
  actor: 'Eduardo',
  mesa: null,
  details: null,
  reason: null,
  approved_by: null,
  created_at: '2026-09-19T18:30:00.000Z',
  ...o,
})

/** N entradas estables, con una de cada tres cancelada. */
function muchas(n: number): AuditLogEntry[] {
  return Array.from({ length: n }, (_, i) => entrada({
    id: i + 1,
    action: i % 3 === 0 ? 'item_cancelled' : 'item_added',
    actor: `Mesero ${i % 7}`,
    mesa: (i % 40) + 1,
    order_id: `ord-${String(i).padStart(5, '0')}`,
  }))
}

beforeEach(() => { getAuditLog.mockReset() })
afterEach(cleanup)

describe('auditoría — los tres tamaños', () => {
  it('VACÍA: dice que no hay nada y los contadores quedan en cero', async () => {
    getAuditLog.mockResolvedValue([])
    render(<AuditoriaPage />)

    expect(await screen.findByTestId('auditoria-vacio')).toBeTruthy()
    expect(screen.getByText('Sin eventos registrados')).toBeTruthy()
    expect(screen.getByText('0 eventos')).toBeTruthy()
    expect(screen.getByText('0 cancelaciones')).toBeTruthy()
    expect(screen.queryByTestId('auditoria-lista')).toBeNull()
  })

  it('UNA FILA: pinta la fila y NO el estado vacío', async () => {
    getAuditLog.mockResolvedValue([entrada({ action: 'payment_processed', actor: 'Celeste' })])
    render(<AuditoriaPage />)

    await screen.findByTestId('auditoria-lista')
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(1)
    expect(screen.queryByTestId('auditoria-vacio')).toBeNull()
    expect(screen.getByText('Pago procesado')).toBeTruthy()
    expect(screen.getByText('Celeste')).toBeTruthy()
    expect(screen.getByText('1 eventos')).toBeTruthy()
  })

  it('500 FILAS: las pinta TODAS — sin corte, sin "ver más", sin virtualizar', async () => {
    getAuditLog.mockResolvedValue(muchas(500))
    render(<AuditoriaPage />)

    await screen.findByTestId('auditoria-lista')
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(500)
    expect(screen.getByText('500 eventos')).toBeTruthy()
    // 0,3,6… → 167 de 500
    expect(screen.getByText('167 cancelaciones')).toBeTruthy()
  })
})

describe('auditoría — el dato que no se puede perder', () => {
  it('muestra acción, mesa, prefijo de orden, actor y hora', async () => {
    getAuditLog.mockResolvedValue([entrada({
      action: 'item_cancelled', actor: 'Jose Reyna', mesa: 12, order_id: 'abcDEF1234567890',
    })])
    render(<AuditoriaPage />)

    const fila = await screen.findByTestId('auditoria-evento')
    expect(within(fila).getByText('Item cancelado')).toBeTruthy()
    expect(within(fila).getByText('Mesa 12')).toBeTruthy()
    expect(within(fila).getByText('Jose Reyna')).toBeTruthy()

    // 8 caracteres, y sin `text-transform` encima.
    //
    // La primera versión de esta prueba sólo afirmaba el texto, y NO servía:
    // jsdom no aplica CSS a `textContent`, así que envolver el id en un `Tag`
    // del kit —que es `uppercase`— la dejaba pasar en verde mientras en pantalla
    // decía ABCDEF12. Comprobado metiendo la mutación y viéndola pasar.
    // Por eso ahora se afirma también la ESTRUCTURA: el id no vive dentro de un
    // Tag (que se marca con `data-tone`) ni lleva la clase `uppercase`.
    const id = within(fila).getByText('abcDEF12')
    expect(id.closest('[data-tone]')).toBeNull()
    expect(id.className).not.toContain('uppercase')
  })

  it('desglosa `details`: item, método, total, monto, de→a y cantidad', async () => {
    getAuditLog.mockResolvedValue([entrada({
      action: 'item_modified',
      details: JSON.stringify({
        item: 'Chilaquiles Verdes', method: 'Efectivo', total: 1240.5,
        amount: 99.9, from: 'abierta', to: 'enviada', cantidad: 3,
      }),
    })])
    render(<AuditoriaPage />)

    const fila = await screen.findByTestId('auditoria-evento')
    expect(within(fila).getByText('Chilaquiles Verdes')).toBeTruthy()
    expect(within(fila).getByText('Efectivo')).toBeTruthy()
    expect(within(fila).getByText('$1240.50')).toBeTruthy()
    expect(within(fila).getByText('$99.90')).toBeTruthy()
    expect(within(fila).getByText('enviada')).toBeTruthy()
    expect(within(fila).getByText('3')).toBeTruthy()
  })

  it('un `details` que no es JSON no rompe la pantalla', async () => {
    getAuditLog.mockResolvedValue([entrada({ details: 'esto no es json {' })])
    render(<AuditoriaPage />)
    expect(await screen.findByTestId('auditoria-evento')).toBeTruthy()
  })

  it('`from`/`to` de tipo objeto NO se pintan — guardián del [object Object]', async () => {
    getAuditLog.mockResolvedValue([entrada({
      details: JSON.stringify({ from: { a: 1 }, to: { b: 2 } }),
    })])
    render(<AuditoriaPage />)
    const fila = await screen.findByTestId('auditoria-evento')
    expect(within(fila).queryByText(/object Object/)).toBeNull()
  })

  it('motivo y aprobador siguen visibles — es la mitad de una cancelación', async () => {
    getAuditLog.mockResolvedValue([entrada({
      action: 'order_cancelled', actor: 'Aldo', reason: 'Error del mesero', approved_by: 'Rodrigo',
    })])
    render(<AuditoriaPage />)

    const fila = await screen.findByTestId('auditoria-evento')
    expect(within(fila).getByText('Error del mesero')).toBeTruthy()
    // Quién lo hizo y quién lo autorizó son dos personas distintas, y las dos
    // tienen que verse: una cancelación autorizada por el mismo que la pidió no
    // es una autorización.
    expect(within(fila).getByText('Aldo')).toBeTruthy()
    expect(within(fila).getByText(/Aprobado:\s*Rodrigo/)).toBeTruthy()
  })

  it('una acción desconocida se muestra con su nombre crudo, no se traga la fila', async () => {
    getAuditLog.mockResolvedValue([entrada({ action: 'accion_del_futuro' })])
    render(<AuditoriaPage />)
    expect(await screen.findByText('accion_del_futuro')).toBeTruthy()
  })
})

describe('auditoría — filtros y acciones', () => {
  it('el filtro de acción deja pasar sólo esa acción', async () => {
    getAuditLog.mockResolvedValue([
      entrada({ id: 1, action: 'item_cancelled', actor: 'Ana' }),
      entrada({ id: 2, action: 'item_added', actor: 'Beto' }),
      entrada({ id: 3, action: 'item_cancelled', actor: 'Cira' }),
    ])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-lista')

    fireEvent.change(screen.getByLabelText('Filtrar por acción'), { target: { value: 'item_cancelled' } })
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(2)
    expect(screen.queryByText('Beto')).toBeNull()
  })

  it('conserva las 8 opciones del filtro, con sus mismos valores', async () => {
    getAuditLog.mockResolvedValue([])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-vacio')

    const opciones = within(screen.getByLabelText('Filtrar por acción') as HTMLElement)
      .getAllByRole('option')
      .map(o => (o as HTMLOptionElement).value)
    expect(opciones).toEqual([
      'all', 'item_cancelled', 'order_cancelled', 'item_added',
      'item_modified', 'discount_applied', 'payment_processed', 'status_changed',
    ])
  })

  it('la búsqueda pega contra actor, orden, motivo y details', async () => {
    getAuditLog.mockResolvedValue([
      entrada({ id: 1, actor: 'Ana', order_id: 'zzz-1' }),
      entrada({ id: 2, actor: 'Beto', reason: 'derrame' }),
      entrada({ id: 3, actor: 'Cira', details: JSON.stringify({ item: 'Croissant' }) }),
    ])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-lista')
    const buscar = screen.getByLabelText('Buscar en la auditoría')

    fireEvent.change(buscar, { target: { value: 'ana' } })
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(1)

    fireEvent.change(buscar, { target: { value: 'zzz-1' } })
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(1)

    fireEvent.change(buscar, { target: { value: 'derrame' } })
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(1)

    fireEvent.change(buscar, { target: { value: 'croissant' } })
    expect(screen.getAllByTestId('auditoria-evento')).toHaveLength(1)
  })

  it('una búsqueda sin resultados cae al MISMO estado vacío', async () => {
    getAuditLog.mockResolvedValue([entrada({ actor: 'Ana' })])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-lista')

    fireEvent.change(screen.getByLabelText('Buscar en la auditoría'), { target: { value: 'nadie' } })
    expect(screen.getByTestId('auditoria-vacio')).toBeTruthy()
    // El contador de la cabecera cuenta lo CARGADO, no lo filtrado.
    expect(screen.getByText('1 eventos')).toBeTruthy()
  })

  it('el botón Actualizar vuelve a consultar', async () => {
    getAuditLog.mockResolvedValue([])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-vacio')
    expect(getAuditLog).toHaveBeenCalledTimes(1)
    expect(getAuditLog).toHaveBeenCalledWith(200)

    fireEvent.click(screen.getByLabelText('Actualizar'))
    await waitFor(() => expect(getAuditLog).toHaveBeenCalledTimes(2))
  })

  it('la salida a /pos sigue ahí — en kiosko no hay botón de regresar del navegador', async () => {
    getAuditLog.mockResolvedValue([])
    render(<AuditoriaPage />)
    await screen.findByTestId('auditoria-vacio')
    expect(screen.getByLabelText('Volver al punto de venta').getAttribute('href')).toBe('/pos')
  })
})

describe('auditoría — estado de carga', () => {
  it('mientras carga muestra el spinner y NO el vacío', async () => {
    let resolver: (v: AuditLogEntry[]) => void = () => {}
    getAuditLog.mockReturnValue(new Promise<AuditLogEntry[]>(r => { resolver = r }))
    render(<AuditoriaPage />)

    expect(screen.getByTestId('auditoria-cargando')).toBeTruthy()
    expect(screen.queryByTestId('auditoria-vacio')).toBeNull()

    resolver([])
    expect(await screen.findByTestId('auditoria-vacio')).toBeTruthy()
  })
})
