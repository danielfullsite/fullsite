// EnVista — monta a sus hijos cuando entran en pantalla.
//
// Lo que más importa aquí NO es que retrase el montaje: es que NUNCA retenga el
// contenido cuando no puede observar. Si el navegador no trae
// IntersectionObserver, o el usuario pidió menos movimiento, la gráfica tiene
// que estar ahí de todos modos. Un adorno no puede ser la razón de que alguien
// no vea sus ventas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import EnVista from '@/components/ui/EnVista'

const original = globalThis.IntersectionObserver
let observados: Array<(e: { isIntersecting: boolean }[]) => void> = []

function observadorFalso() {
  observados = []
  globalThis.IntersectionObserver = class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { observados.push(cb) }
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
    root = null; rootMargin = ''; thresholds = []
  } as unknown as typeof IntersectionObserver
}

beforeEach(() => { observadorFalso() })
afterEach(() => { globalThis.IntersectionObserver = original; cleanup() })

describe('EnVista', () => {
  it('no monta al principio, y reserva el espacio para que la página no brinque', () => {
    const { container } = render(<EnVista minAlto={300}><p>gráfica</p></EnVista>)
    expect(screen.queryByText('gráfica')).toBeNull()
    expect((container.firstChild as HTMLElement).style.minHeight).toBe('300px')
  })

  it('monta cuando el elemento se asoma', () => {
    render(<EnVista><p>gráfica</p></EnVista>)
    expect(screen.queryByText('gráfica')).toBeNull()
    act(() => { observados.forEach(cb => cb([{ isIntersecting: true }])) })
    expect(screen.getByText('gráfica')).toBeTruthy()
  })

  it('ya montado, NO se desmonta al salir de vista', () => {
    // Animar cada vez que subes y bajas marea, y Recharts recalcularía todo.
    render(<EnVista><p>gráfica</p></EnVista>)
    act(() => { observados.forEach(cb => cb([{ isIntersecting: true }])) })
    act(() => { observados.forEach(cb => cb([{ isIntersecting: false }])) })
    expect(screen.getByText('gráfica')).toBeTruthy()
  })

  it('sin IntersectionObserver monta de inmediato — el dato no depende del adorno', () => {
    // @ts-expect-error se retira a propósito para simular un navegador viejo
    delete globalThis.IntersectionObserver
    render(<EnVista><p>gráfica</p></EnVista>)
    expect(screen.getByText('gráfica')).toBeTruthy()
  })

  it('con prefers-reduced-motion monta de inmediato', () => {
    const mm = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q, addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    render(<EnVista><p>gráfica</p></EnVista>)
    expect(screen.getByText('gráfica')).toBeTruthy()
    window.matchMedia = mm
  })

  it('una vez montado deja de reservar alto: no deja un hueco debajo', () => {
    const { container } = render(<EnVista minAlto={300}><p>gráfica</p></EnVista>)
    act(() => { observados.forEach(cb => cb([{ isIntersecting: true }])) })
    expect((container.firstChild as HTMLElement).style.minHeight).toBe('')
  })
})
