// PAGINAR NO PUEDE ESCONDER NADA.
//
// El mapa de mesas, el catálogo y el tablero de cocina crecían hacia abajo
// dentro de un `overflow-y-auto`. En una caja sin ratón eso esconde lo que no
// cabe: medido el 2026-09-12 en 1024×768, la lista de la comanda mostraba 297px
// de 724. La rejilla paginada cambia el scroll por páginas.
//
// El riesgo del cambio es perder elementos: una mesa que no aparece en ninguna
// página es una mesa que el mesero no puede abrir. Esta prueba recorre TODAS las
// páginas y exige que el conjunto de lo pintado sea exactamente el de entrada.
import { createElement } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import RejillaPaginada from '@/components/pos/RejillaPaginada'

// jsdom no hace layout: `clientHeight` siempre es 0 y la rejilla creería que
// cabe una sola fila. Se le da un alto real, que es lo que mide el componente.
let altoDeLaCaja = 0
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => altoDeLaCaja })
  // El observador de tamaño no existe en jsdom; sin él la medición inicial basta.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})
afterEach(() => { if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original) })

const mesas = (n: number) => Array.from({ length: n }, (_, i) => ({ numero: i + 1 }))
const rejilla = (elementos: { numero: number }[]) => createElement(RejillaPaginada<{ numero: number }>, {
  elementos,
  claveDe: m => String(m.numero),
  pintar: m => createElement('button', null, `Mesa ${m.numero}`),
  altoDeCelda: 140,
  separacion: 10,
  nombreDeElementos: 'mesas',
  clasesDeRejilla: 'grid',
})

it('REGRESION: ninguna mesa se pierde entre páginas — el recorrido completo las devuelve todas', () => {
  altoDeLaCaja = 450 // tres filas de 140 + separación
  render(rejilla(mesas(40)))
  const vistas = new Set<string>()
  const recoger = () => screen.getAllByRole('button')
    .map(b => b.textContent || '')
    .filter(t => t.startsWith('Mesa '))
    .forEach(t => vistas.add(t))

  recoger()
  const siguiente = screen.getByRole('button', { name: 'Página siguiente de mesas' })
  // Un salón grande no puede necesitar veinte toques: se recorre hasta el final.
  for (let i = 0; i < 50 && !(siguiente as HTMLButtonElement).disabled; i++) {
    fireEvent.click(siguiente)
    recoger()
  }
  expect(vistas.size, 'las 40 mesas tienen que ser alcanzables').toBe(40)
  for (let n = 1; n <= 40; n++) expect(vistas.has(`Mesa ${n}`)).toBe(true)
})

it('con pocas mesas no aparece ningún control: la pantalla se ve como siempre', () => {
  altoDeLaCaja = 900
  render(rejilla(mesas(6)))
  expect(screen.queryByRole('group', { name: /Páginas/ })).toBeNull()
  expect(screen.getAllByRole('button').length).toBe(6)
})

it('el indicador dice en qué página está y cuántas mesas hay en total', () => {
  altoDeLaCaja = 300 // dos filas
  render(rejilla(mesas(7)))
  expect(screen.getByText(/1 \/ 4/)).toBeTruthy()
  expect(screen.getByText(/7 mesas/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente de mesas' }))
  expect(screen.getByText(/2 \/ 4/)).toBeTruthy()
})

it('los dos controles de página miden 56px de alto, que es el mínimo de un dedo', () => {
  altoDeLaCaja = 300
  render(rejilla(mesas(20)))
  for (const nombre of ['Página anterior de mesas', 'Página siguiente de mesas']) {
    expect(screen.getByRole('button', { name: nombre }).className).toMatch(/\bh-14\b/)
  }
})

it('si la lista se encoge por debajo de la página actual, se retrocede en vez de quedar en blanco', () => {
  altoDeLaCaja = 300
  const { rerender } = render(rejilla(mesas(7)))
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente de mesas' }))
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente de mesas' }))
  expect(screen.getByText(/3 \/ 4/)).toBeTruthy()
  rerender(rejilla(mesas(2)))
  // Dos mesas caben en una página: no queda ninguna página 3 que mostrar.
  expect(screen.queryByRole('group', { name: /Páginas/ })).toBeNull()
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Mesa 1', 'Mesa 2'])
})
