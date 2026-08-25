// ListaAtencion.
//
// Las pruebas de BarraTurno vivían aquí. El componente lo reemplazó
// EstadoOperacion —que además cuenta los DÍAS sin datos, que es lo que a
// BarraTurno le faltaba— y su cobertura se trasladó a resumen-dashboard.test.tsx.
//
// Lo que más se prueba aquí NO es que pinten bien: es que se CALLEN cuando no
// hay nada que decir. Este dashboard venía mostrando "$39,505 por mesa" y
// "$4,197 de nómina" para periodos sin datos, y ese es el defecto que estos
// componentes no pueden repetir.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ListaAtencion from '@/components/dashboard/ListaAtencion'
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
