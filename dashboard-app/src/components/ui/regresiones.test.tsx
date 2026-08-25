import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import { Table, type ColumnDef } from './Table'
import { Dialog } from './Dialog'
import { __resetScrollLockForTests, __scrollLockCount } from './useScrollLock'
import { __resetDialogStackForTests } from './dialogStack'

/**
 * Regresiones de la revisión adversarial del 2026-08-25.
 *
 * Las 62 pruebas originales pasaban y aun así había 6 defectos P0, tres de ellos
 * con pérdida de datos o de dinero. Cada caso de aquí reproduce uno de esos
 * defectos: si alguien revierte el arreglo, esto se pone rojo.
 */

afterEach(() => {
  cleanup()
  __resetScrollLockForTests()
  __resetDialogStackForTests()
})

interface Fila {
  id: number
  nombre: string
  monto: number
  cat: string
}

const FILAS: Fila[] = [
  { id: 1, nombre: 'Arrachera', monto: 320, cat: 'Carnes' },
  { id: 2, nombre: 'Salmón', monto: 410, cat: 'Carnes' },
  { id: 3, nombre: 'Café', monto: 55, cat: 'Bebidas' },
]
const key = (r: Fila) => r.id

describe('P0-4 — collapseRepeated no puede borrar filas', () => {
  it('con render (sin accessor) NO colapsa: comparaba [object Object] y se comía "Bebidas"', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'cat', header: 'Cat', render: ({ row }) => <span>{row.cat}</span>, collapseRepeated: true },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} />)
    const celdas = screen.getAllByRole('row').slice(1).map(r => r.textContent)
    expect(celdas).toEqual(['Carnes', 'Carnes', 'Bebidas'])
  })

  it('con accessor sí colapsa, pero sólo los repetidos de verdad', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'cat', header: 'Cat', accessor: r => r.cat, collapseRepeated: true },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} />)
    expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual([
      'Carnes',
      '',
      'Bebidas',
    ])
  })
})

describe('P0-5 — el pie suma TODO, no la página visible', () => {
  it('footer con limit usa las 3 filas (785), no las 2 mostradas (730)', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'nombre', header: 'N', accessor: r => r.nombre, footer: 'Total' },
      {
        id: 'monto',
        header: 'Monto',
        accessor: r => r.monto,
        numeric: true,
        footer: rows => rows.reduce((s, r) => s + r.monto, 0),
      },
    ]
    const { container } = render(
      <Table rows={FILAS} columns={cols} rowKey={key} showFooterRow limit={2} />,
    )
    expect(screen.getAllByRole('row').filter(r => r.closest('tbody'))).toHaveLength(2)
    expect(within(container.querySelector('tfoot')!).getByText('785')).toBeTruthy()
  })
})

describe('P0-6 — un NaN no puede desordenar la tabla entera', () => {
  it('NaN va al final y el resto conserva su orden', () => {
    interface F { id: number; v: number }
    const filas: F[] = [
      { id: 1, v: 5 },
      { id: 2, v: Number.NaN },
      { id: 3, v: 1 },
      { id: 4, v: 9 },
    ]
    const cols: ColumnDef<F>[] = [{ id: 'v', header: 'V', accessor: r => r.v, sortable: true }]
    render(<Table rows={filas} columns={cols} rowKey={r => r.id} />)
    fireEvent.click(screen.getAllByRole('columnheader')[0])
    const vals = screen.getAllByRole('row').slice(1).map(r => r.textContent)
    expect(vals.slice(0, 3)).toEqual(['1', '5', '9'])
    expect(vals[3]).toBe('NaN')
  })
})

describe('P1-7 — onRowClick y los controles no nativos', () => {
  it('un div[role=button] no dispara además el clic de fila', () => {
    const onRowClick = vi.fn()
    const onDelete = vi.fn()
    const cols: ColumnDef<Fila>[] = [
      {
        id: 'acc',
        header: 'Acciones',
        render: () => (
          <div role="button" tabIndex={0} onClick={onDelete}>
            Eliminar
          </div>
        ),
      },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} onRowClick={onRowClick} />)
    fireEvent.click(screen.getAllByText('Eliminar')[0])
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('P1-9 — ordenar con teclado', () => {
  it('Enter sobre el encabezado ordena, y el th es alcanzable con Tab', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'nombre', header: 'Platillo', accessor: r => r.nombre, sortable: true },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} />)
    const th = screen.getAllByRole('columnheader')[0]
    expect(th.tabIndex).toBe(0)
    fireEvent.keyDown(th, { key: 'Enter' })
    expect(th.getAttribute('aria-sort')).toBe('ascending')
    expect(screen.getAllByRole('row').slice(1)[0].textContent).toBe('Arrachera')
  })

  it('una columna no ordenable no es alcanzable con Tab', () => {
    render(
      <Table
        rows={FILAS}
        columns={[{ id: 'n', header: 'N', accessor: r => r.nombre }]}
        rowKey={key}
      />,
    )
    expect(screen.getAllByRole('columnheader')[0].tabIndex).toBe(-1)
  })
})

describe('P0-2 y P0-3 — dos diálogos apilados', () => {
  function Apilados({ onA, onB }: { onA: () => void; onB: () => void }) {
    return (
      <>
        <Dialog open onClose={onA} title="Cobro">
          <input aria-label="monto" />
        </Dialog>
        <Dialog open onClose={onB} title="Confirmar" layer="dialogNested">
          <button type="button">Sí</button>
        </Dialog>
      </>
    )
  }

  it('un ESC cierra SÓLO el de arriba', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    render(<Apilados onA={onA} onB={onB} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onA).not.toHaveBeenCalled()
  })

  it('el trap de abajo no le roba el foco al de arriba', () => {
    render(<Apilados onA={() => {}} onB={() => {}} />)
    const arriba = screen.getByRole('dialog', { name: 'Confirmar' })
    const si = within(arriba).getByText('Sí')
    si.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(arriba.contains(document.activeElement)).toBe(true)
    expect(screen.getByLabelText('monto')).not.toBe(document.activeElement)
  })
})

describe('P1-13 — panel sin elementos enfocables', () => {
  it('Tab no deja el foco fuera del diálogo', () => {
    render(
      <div>
        <button type="button">fuera</button>
        <Dialog open onClose={() => {}} title="Aviso" closeButton="none">
          <p>Sólo texto</p>
        </Dialog>
      </div>,
    )
    const fuera = screen.getByText('fuera')
    fuera.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).not.toBe(fuera)
  })
})

describe('P1-14 — autoFocus de React 19', () => {
  it('respeta el campo con autoFocus en vez de enfocar el primero', async () => {
    render(
      <Dialog open onClose={() => {}} title="Movimiento de caja">
        <input aria-label="referencia" />
        <input aria-label="monto" autoFocus />
      </Dialog>,
    )
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(document.activeElement).toBe(screen.getByLabelText('monto'))
  })
})

describe('P1-10 — height="full" no puede quedar anulado', () => {
  it('no emite max-h-[85vh] cuando se pidió una altura explícita', () => {
    render(
      <Dialog open onClose={() => {}} title="Modificadores" height="full">
        <p>x</p>
      </Dialog>,
    )
    const panel = screen.getByRole('dialog')
    expect(panel.className).toContain('h-[calc(100vh-2rem)]')
    expect(panel.className).not.toContain('max-h-[85vh]')
  })

  it('con height="auto" sí conserva el tope de 85vh', () => {
    render(
      <Dialog open onClose={() => {}} title="Normal">
        <p>x</p>
      </Dialog>,
    )
    expect(screen.getByRole('dialog').className).toContain('max-h-[85vh]')
  })
})

describe('P0-1 — el scroll de fondo se congela aunque el body no scrollee', () => {
  it('bloquea un contenedor interno con overflow propio, como el del POS', () => {
    const host = document.createElement('div')
    host.className = 'pos-kiosk'
    host.style.overflow = 'hidden'
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    // jsdom no calcula layout: se fuerzan las medidas para simular un scroller real.
    Object.defineProperty(scroller, 'scrollHeight', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true })
    host.appendChild(scroller)
    document.body.appendChild(host)

    const { unmount } = render(
      <Dialog open onClose={() => {}} title="Cobro">
        <p>x</p>
      </Dialog>,
    )
    expect(scroller.style.overflow).toBe('hidden')
    unmount()
    expect(scroller.style.overflow).toBe('')
    host.remove()
  })

  it('no bloquea el scroll interno del propio panel', () => {
    render(
      <Dialog open onClose={() => {}} title="Larga" layout="flex-column">
        <p>x</p>
      </Dialog>,
    )
    const panel = screen.getByRole('dialog')
    expect(panel.style.overflow).toBe('')
  })

  it('el refcount vuelve a 0 tras cerrar un diálogo simple', () => {
    const { unmount } = render(
      <Dialog open onClose={() => {}} title="T">
        <p>x</p>
      </Dialog>,
    )
    expect(__scrollLockCount()).toBe(1)
    unmount()
    expect(__scrollLockCount()).toBe(0)
  })

  it('open true→false sin desmontar también suelta el lock', () => {
    function App() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            cerrar
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="T">
            <p>x</p>
          </Dialog>
        </>
      )
    }
    render(<App />)
    expect(__scrollLockCount()).toBe(1)
    fireEvent.click(screen.getByText('cerrar'))
    expect(__scrollLockCount()).toBe(0)
    expect(document.body.style.overflow).toBe('')
  })
})

describe('Refuerzo de pruebas que pasaban por la razón equivocada', () => {
  it('align="right" gana aunque el header diga "Nombre" (el par que faltaba)', () => {
    render(
      <Table
        rows={FILAS}
        columns={[{ id: 'x', header: 'Nombre', accessor: r => r.nombre, align: 'right' }]}
        rowKey={key}
      />,
    )
    expect(screen.getAllByRole('columnheader')[0].className).toContain('text-right')
  })

  it('mobileCard renderiza el CONTENIDO de la tarjeta, no sólo las clases', () => {
    render(
      <Table
        rows={FILAS}
        columns={[{ id: 'n', header: 'N', accessor: r => r.nombre }]}
        rowKey={key}
        mobileCard={ctx => <div>tarjeta {ctx.row.nombre}</div>}
      />,
    )
    expect(screen.getByText('tarjeta Arrachera')).toBeTruthy()
  })

  it('los nulos van al final Y el resto se invierte de verdad al pasar a desc', () => {
    interface F { id: number; v: number | null }
    const filas: F[] = [{ id: 1, v: 5 }, { id: 2, v: null }, { id: 3, v: 1 }]
    const cols: ColumnDef<F>[] = [{ id: 'v', header: 'V', accessor: r => r.v, sortable: true }]
    render(<Table rows={filas} columns={cols} rowKey={r => r.id} />)
    const th = screen.getAllByRole('columnheader')[0]
    fireEvent.click(th)
    expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(['1', '5', ''])
    fireEvent.click(th)
    expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(['5', '1', ''])
  })

  it('limit corta DESPUÉS de ordenar, no antes', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'monto', header: 'Monto', accessor: r => r.monto, numeric: true, sortable: true },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} defaultSort={{ columnId: 'monto', dir: 'desc' }} limit={2} />)
    expect(screen.getAllByRole('row').slice(1).map(r => r.textContent)).toEqual(['410', '320'])
  })
})
