import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { Table, type ColumnDef } from './Table'

/**
 * Cada caso apunta a una regresión concreta encontrada en el barrido de 95 tablas
 * (2026-08-24). El archivo y la línea van en el nombre de la prueba para que, si
 * alguna falla dentro de un año, se sepa qué se estaba protegiendo.
 */

afterEach(cleanup)

interface Fila {
  id: number
  nombre: string
  monto: number
  cat: string
}

const FILAS: Fila[] = [
  { id: 1, nombre: 'Arrachera', monto: 320, cat: 'Carnes' },
  { id: 2, nombre: 'Salmón', monto: 410, cat: 'Pescados' },
  { id: 3, nombre: 'Café', monto: 55, cat: 'Bebidas' },
]

const COLS: ColumnDef<Fila>[] = [
  { id: 'nombre', header: 'Platillo', accessor: r => r.nombre, sortable: true },
  { id: 'cat', header: 'Categoría', accessor: r => r.cat },
  { id: 'monto', header: 'Monto', accessor: r => r.monto, numeric: true, sortable: true },
]

const key = (r: Fila) => r.id

describe('Table — columnas y alineación', () => {
  it('emite exactamente un <th> por columna y ninguno extra', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(3)
  })

  it('align es declarativo, no se deduce del texto del header (admin/tienda/articulos:118)', () => {
    const cols: ColumnDef<Fila>[] = [
      // El header dice "Precio" pero la columna NO es numérica: no debe alinearse a la derecha.
      { id: 'x', header: 'Precio', accessor: r => r.nombre },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} />)
    expect(screen.getAllByRole('columnheader')[0].className).toContain('text-left')
  })

  it('numeric aplica text-right y tabular-nums en el th y en el td', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    const th = screen.getAllByRole('columnheader')[2]
    expect(th.className).toContain('text-right')
    expect(th.className).toContain('tabular-nums')
    const celda = screen.getByText('320')
    expect(celda.className).toContain('text-right')
    expect(celda.className).toContain('tabular-nums')
  })

  it('hideBelow se propaga a la celda de footer de esa columna (toma-fisica:419 se descuadra por olvidarlo)', () => {
    const cols: ColumnDef<Fila>[] = [
      { id: 'nombre', header: 'Platillo', accessor: r => r.nombre },
      { id: 'cat', header: 'Cat', accessor: r => r.cat, hideBelow: 'md', footer: 'total' },
    ]
    const { container } = render(<Table rows={FILAS} columns={cols} rowKey={key} showFooterRow />)
    const th = screen.getAllByRole('columnheader')[1]
    expect(th.className).toContain('hidden md:table-cell')
    const pie = container.querySelector('tfoot td:nth-child(2)')
    expect(pie?.className).toContain('hidden md:table-cell')
  })

  it('emite th y td reales, nunca div[role=cell] — la impresión del corte depende de eso', () => {
    const { container } = render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    expect(container.querySelectorAll('th').length).toBe(3)
    expect(container.querySelectorAll('tbody td').length).toBe(9)
    expect(container.querySelectorAll('[role="cell"]').length).toBe(0)
  })

  it('caption sr-only se emite cuando se pasa', () => {
    const { container } = render(<Table rows={FILAS} columns={COLS} rowKey={key} caption="Ventas del día" />)
    const cap = container.querySelector('caption')
    expect(cap?.textContent).toBe('Ventas del día')
    expect(cap?.className).toContain('sr-only')
  })
})

describe('Table — orden', () => {
  function textos(): string[] {
    return screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent ?? '')
  }

  it('tres clics ordenan asc, desc y vuelven a asc', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    const th = screen.getAllByRole('columnheader')[0]
    fireEvent.click(th)
    expect(textos()).toEqual(['Arrachera', 'Café', 'Salmón'])
    fireEvent.click(th)
    expect(textos()).toEqual(['Salmón', 'Café', 'Arrachera'])
    fireEvent.click(th)
    expect(textos()).toEqual(['Arrachera', 'Café', 'Salmón'])
  })

  it('ordenar NO muta el array recibido por props (nomina:664 y estado-resultados:297 hoy sí lo mutan)', () => {
    const original = [...FILAS]
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    fireEvent.click(screen.getAllByRole('columnheader')[2])
    expect(FILAS).toEqual(original)
  })

  it('los nulos quedan al final tanto en asc como en desc', () => {
    interface F { id: number; v: number | null }
    const filas: F[] = [{ id: 1, v: 5 }, { id: 2, v: null }, { id: 3, v: 1 }]
    const cols: ColumnDef<F>[] = [{ id: 'v', header: 'V', accessor: r => r.v, sortable: true }]
    render(<Table rows={filas} columns={cols} rowKey={r => r.id} />)
    const th = screen.getAllByRole('columnheader')[0]
    fireEvent.click(th)
    let celdas = screen.getAllByRole('row').slice(1).map(r => r.textContent)
    expect(celdas[celdas.length - 1]).toBe('')
    fireEvent.click(th)
    celdas = screen.getAllByRole('row').slice(1).map(r => r.textContent)
    expect(celdas[celdas.length - 1]).toBe('')
  })

  it('columnas sin sortable no responden al clic (en nómina sólo 6 de 10 ordenan)', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    const th = screen.getAllByRole('columnheader')[1]
    expect(th.className).not.toContain('cursor-pointer')
    fireEvent.click(th)
    expect(screen.getAllByRole('row').slice(1)[0].textContent).toContain('Arrachera')
  })

  it('rowOrderIsMeaningful con una columna sortable avisa en desarrollo (control-efectivo, cortes)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Table rows={FILAS} columns={COLS} rowKey={key} rowOrderIsMeaningful />)
    expect(spy.mock.calls.some(c => String(c[0]).includes('rowOrderIsMeaningful'))).toBe(true)
    spy.mockRestore()
  })

  it('aria-sort refleja la columna activa', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} />)
    const th = screen.getAllByRole('columnheader')[0]
    fireEvent.click(th)
    expect(th.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(th)
    expect(th.getAttribute('aria-sort')).toBe('descending')
  })
})

describe('Table — estados', () => {
  it('emptyMode="row" usa colSpan igual al número de columnas (pos/inventario-market:237 va sin colSpan)', () => {
    const { container } = render(
      <Table rows={[]} columns={COLS} rowKey={key} empty="Sin datos" emptyMode="row" />,
    )
    expect(container.querySelector('tbody td')?.getAttribute('colspan')).toBe('3')
  })

  it('emptyMode="replace" no monta ninguna <table>', () => {
    const { container } = render(
      <Table rows={[]} columns={COLS} rowKey={key} empty="Sin datos" emptyMode="replace" />,
    )
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByText('Sin datos')).toBeTruthy()
  })

  it('emptyMode="hidden" devuelve null — el padre oculta su card (ventas x4)', () => {
    const { container } = render(
      <Table rows={[]} columns={COLS} rowKey={key} empty="Sin datos" emptyMode="hidden" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('emptyMode="sibling" deja la tabla montada y agrega el bloque después (clientes, proveedores)', () => {
    const { container } = render(
      <Table rows={[]} columns={COLS} rowKey={key} empty="Sin datos" emptyMode="sibling" />,
    )
    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.getByText('Sin datos')).toBeTruthy()
  })

  it('con mobileCard el vacío aparece en las dos ramas', () => {
    render(
      <Table
        rows={[]}
        columns={COLS}
        rowKey={key}
        empty="Sin datos"
        mobileCard={ctx => <div>{ctx.row.nombre}</div>}
      />,
    )
    expect(screen.getAllByText('Sin datos')).toHaveLength(2)
  })

  it('error tiene prioridad sobre las filas', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} error="Falló la carga" />)
    expect(screen.getByText('Falló la carga')).toBeTruthy()
    expect(screen.queryByText('Arrachera')).toBeNull()
  })

  it('onRetry se dispara una vez por clic', () => {
    const onRetry = vi.fn()
    render(<Table rows={[]} columns={COLS} rowKey={key} error="Falló" onRetry={onRetry} />)
    fireEvent.click(screen.getByText('Reintentar'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('loadingMode="none" con loading=true renderiza la tabla normal (el loading es de página en 17 de 18)', () => {
    render(<Table rows={FILAS} columns={COLS} rowKey={key} loading />)
    expect(screen.getByText('Arrachera')).toBeTruthy()
  })

  it('loadingMode="replace" muestra el bloque de carga en lugar de la tabla', () => {
    const { container } = render(
      <Table rows={FILAS} columns={COLS} rowKey={key} loading loadingMode="replace" />,
    )
    expect(container.querySelector('table')).toBeNull()
  })
})

describe('Table — pie', () => {
  const conPie: ColumnDef<Fila>[] = [
    { id: 'nombre', header: 'Platillo', accessor: r => r.nombre, footer: 'Total' },
    { id: 'monto', header: 'Monto', accessor: r => r.monto, numeric: true, footer: rows => rows.reduce((s, r) => s + r.monto, 0) },
  ]

  it('footerPlacement="tfoot" emite <tfoot>', () => {
    const { container } = render(<Table rows={FILAS} columns={conPie} rowKey={key} showFooterRow />)
    expect(container.querySelector('tfoot')).not.toBeNull()
    expect(within(container.querySelector('tfoot')!).getByText('785')).toBeTruthy()
  })

  it('footerPlacement="tbody" mete la fila en tbody (contabilidad:375, estado-resultados:349)', () => {
    const { container } = render(
      <Table rows={FILAS} columns={conPie} rowKey={key} showFooterRow footerPlacement="tbody" />,
    )
    expect(container.querySelector('tfoot')).toBeNull()
    expect(within(container.querySelector('tbody')!).getByText('785')).toBeTruthy()
  })

  it('renderFooter recibe el colSpan — recetas:295 tiene un formulario en el pie, no un resumen', () => {
    const spy = vi.fn(() => <tr><td>form</td></tr>)
    render(<Table rows={FILAS} columns={COLS} rowKey={key} renderFooter={spy} />)
    expect(spy).toHaveBeenCalledWith(3)
  })

  it('showFooterRow=false no emite fila de totales', () => {
    const { container } = render(<Table rows={FILAS} columns={conPie} rowKey={key} />)
    expect(container.querySelector('tfoot')).toBeNull()
  })
})

describe('Table — filas', () => {
  it('rowClassName recibe rows completo, para comparar contra la fila vecina (variación % de cortes)', () => {
    const vistos: number[] = []
    render(
      <Table
        rows={FILAS}
        columns={COLS}
        rowKey={key}
        rowClassName={ctx => {
          vistos.push(ctx.rows.length)
          return ctx.isLast ? 'ultima' : ''
        }}
      />,
    )
    expect(vistos.every(n => n === 3)).toBe(true)
    expect(screen.getAllByRole('row').slice(1)[2].className).toContain('ultima')
  })

  it('collapseRepeated pinta la celda sólo en el primero del grupo (cierre-inventario:390)', () => {
    const filas: Fila[] = [
      { id: 1, nombre: 'A', monto: 1, cat: 'Carnes' },
      { id: 2, nombre: 'B', monto: 2, cat: 'Carnes' },
      { id: 3, nombre: 'C', monto: 3, cat: 'Bebidas' },
    ]
    const cols: ColumnDef<Fila>[] = [
      { id: 'cat', header: 'Cat', accessor: r => r.cat, collapseRepeated: true },
      { id: 'nombre', header: 'N', accessor: r => r.nombre },
    ]
    render(<Table rows={filas} columns={cols} rowKey={key} />)
    const celdas = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)
    expect(celdas).toEqual(['Carnes', '', 'Bebidas'])
  })

  it('onRowClick NO se dispara si el clic nace de un input (indispensable en toma física)', () => {
    const onRowClick = vi.fn()
    const cols: ColumnDef<Fila>[] = [
      { id: 'n', header: 'N', render: () => <input aria-label="editar" /> },
    ]
    render(<Table rows={FILAS} columns={cols} rowKey={key} onRowClick={onRowClick} />)
    fireEvent.click(screen.getAllByLabelText('editar')[0])
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('onRowClick sí se dispara desde una celda normal', () => {
    const onRowClick = vi.fn()
    render(<Table rows={FILAS} columns={COLS} rowKey={key} onRowClick={onRowClick} />)
    fireEvent.click(screen.getByText('Arrachera'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick.mock.calls[0][0].row.nombre).toBe('Arrachera')
  })

  it('limit corta las filas y limitNotice muestra el total real (inventario:155)', () => {
    render(
      <Table
        rows={FILAS}
        columns={COLS}
        rowKey={key}
        limit={2}
        limitNotice={(shown, total) => `Mostrando ${shown} de ${total}`}
      />,
    )
    expect(screen.getAllByRole('row')).toHaveLength(3) // encabezado + 2
    expect(screen.getByText('Mostrando 2 de 3')).toBeTruthy()
  })

  it('expandable mode="row" inserta un tr hermano con colSpan', () => {
    const { container } = render(
      <Table
        rows={FILAS}
        columns={COLS}
        rowKey={key}
        expandable={{ isExpanded: (_, i) => i === 0, render: () => <div>detalle</div> }}
      />,
    )
    expect(screen.getByText('detalle')).toBeTruthy()
    const tds = Array.from(container.querySelectorAll('tbody td'))
    expect(tds.some(td => td.getAttribute('colspan') === '3')).toBe(true)
  })

  it('striped aplica la clase global .table-striped', () => {
    const { container } = render(<Table rows={FILAS} columns={COLS} rowKey={key} striped />)
    expect(container.querySelector('table')?.className).toContain('table-striped')
  })

  it('mobileCard emite las dos ramas con sus clases de breakpoint', () => {
    const { container } = render(
      <Table rows={FILAS} columns={COLS} rowKey={key} mobileCard={ctx => <div>{ctx.row.nombre}</div>} />,
    )
    expect(container.querySelector('.hidden.sm\\:block')).not.toBeNull()
    expect(container.querySelector('.sm\\:hidden')).not.toBeNull()
  })
})
