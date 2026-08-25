// Los dos componentes nuevos del dashboard.
//
// Lo que más se prueba aquí NO es que pinten bien: es que se CALLEN cuando no
// hay nada que decir. Este dashboard venía mostrando "$39,505 por mesa" y
// "$4,197 de nómina" para periodos sin datos, y ese es el defecto que estos
// componentes no pueden repetir.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ListaAtencion from '@/components/dashboard/ListaAtencion'
import BarraTurno, { type Turno, type ResumenTurno } from '@/components/dashboard/BarraTurno'
import type { Atencion } from '@/lib/atencion'

afterEach(cleanup)

const item = (o: Partial<Atencion> = {}): Atencion => ({
  id: 'a1',
  severidad: 'warning',
  titulo: 'Se acabó la arrachera',
  detalle: 'Pide con el proveedor hoy',
  valor: 3400,
  confianza: 0.93,
  href: '/inventario',
  accion: 'Ver inventario',
  ...o,
})

describe('ListaAtencion — callarse cuando no hay nada', () => {
  it('sin pendientes NO renderiza nada', () => {
    const { container } = render(<ListaAtencion items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('mientras carga tampoco renderiza — aparecer y desaparecer arriba molesta', () => {
    const { container } = render(<ListaAtencion items={[item()]} cargando />)
    expect(container.firstChild).toBeNull()
  })
})

describe('ListaAtencion — lo que muestra', () => {
  it('muestra título, detalle, valor y acción', () => {
    render(<ListaAtencion items={[item()]} />)
    expect(screen.getByText('Se acabó la arrachera')).toBeTruthy()
    expect(screen.getByText('Pide con el proveedor hoy')).toBeTruthy()
    expect(screen.getByText(/3,400/)).toBeTruthy()
    expect(screen.getByText('Ver inventario')).toBeTruthy()
  })

  it('el encabezado cuenta bien en singular y en plural', () => {
    const { rerender } = render(<ListaAtencion items={[item()]} />)
    expect(screen.getByText('1 cosa por atender')).toBeTruthy()
    rerender(<ListaAtencion items={[item(), item({ id: 'a2' })]} />)
    expect(screen.getByText('2 cosas por atender')).toBeTruthy()
  })

  it('destaca cuántas son críticas, y sólo si hay', () => {
    const { rerender } = render(<ListaAtencion items={[item({ severidad: 'critical' })]} />)
    expect(screen.getByText('1 crítica')).toBeTruthy()
    rerender(<ListaAtencion items={[item({ severidad: 'info' })]} />)
    expect(screen.queryByText(/crítica/)).toBeNull()
  })

  it('sin valor no inventa un monto', () => {
    render(<ListaAtencion items={[item({ valor: null })]} />)
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('sin destino no pinta botón', () => {
    render(<ListaAtencion items={[item({ href: undefined, accion: undefined })]} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('sin detalle no deja un párrafo vacío', () => {
    const { container } = render(<ListaAtencion items={[item({ detalle: '' })]} />)
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('la gravedad se anuncia a lectores de pantalla, no sólo por color', () => {
    render(<ListaAtencion items={[item({ severidad: 'critical' })]} />)
    expect(screen.getByText('Crítico:')).toBeTruthy()
  })
})

describe('BarraTurno — sin turno abierto', () => {
  const vacio: ResumenTurno = { ventas: null, ordenes: null, personas: null, mesasOcupadas: null, mesasTotal: null }

  it('dice "Sin turno abierto" en vez de mostrar ceros', () => {
    render(<BarraTurno turno={null} resumen={vacio} />)
    expect(screen.getByText('Sin turno abierto')).toBeTruthy()
    // un $0 se leería como "no vendimos", y no es eso
    expect(screen.queryByText('$0')).toBeNull()
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('avisa que las cifras de abajo no son de hoy', () => {
    render(<BarraTurno turno={null} resumen={vacio} />)
    expect(screen.getByText(/no de hoy/)).toBeTruthy()
  })
})

describe('BarraTurno — con turno abierto', () => {
  const turno: Turno = {
    id: 't1',
    numero: 3,
    abiertoPor: 'Pedro',
    abiertoAt: '2026-08-25T18:04:00Z',
    fondoInicial: 2000,
  }

  it('muestra número, quién abrió y a qué hora', () => {
    render(<BarraTurno turno={turno} resumen={{ ventas: 48250.75, ordenes: 117, personas: 118, mesasOcupadas: 7, mesasTotal: 16 }} />)
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText(/Pedro/)).toBeTruthy()
    // formatCurrency redondea a pesos: 48250.75 -> $48,251
    expect(screen.getByText(/48,251/)).toBeTruthy()
    expect(screen.getByText(/117 órdenes · 118 personas/)).toBeTruthy()
  })

  it('un dato ausente sale como guion, NO como cero', () => {
    render(<BarraTurno turno={turno} resumen={{ ventas: null, ordenes: null, personas: null, mesasOcupadas: null, mesasTotal: null }} />)
    // "Llevas" y "En piso" sin dato → guiones, y ningún $0 fabricado
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('las mesas se muestran como ocupadas sobre total', () => {
    render(<BarraTurno turno={turno} resumen={{ ventas: 100, ordenes: 1, personas: 2, mesasOcupadas: 7, mesasTotal: 16 }} />)
    expect(screen.getByText('/ 16')).toBeTruthy()
  })

  it('una hora inválida no revienta ni imprime "Invalid Date"', () => {
    render(<BarraTurno turno={{ ...turno, abiertoAt: 'no-es-fecha' }} resumen={{ ventas: 1, ordenes: 1, personas: 1, mesasOcupadas: 1, mesasTotal: 2 }} />)
    expect(screen.queryByText(/Invalid/)).toBeNull()
  })
})
