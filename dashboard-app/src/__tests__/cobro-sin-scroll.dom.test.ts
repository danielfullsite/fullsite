// EN LA CAJA NO HAY RATÓN.
//
// El modal de cobro era una columna: totales, cuentas, división, efectivo,
// terminal bancaria, cobros por confirmar y cobros confirmados, uno debajo del
// otro dentro de un `overflow-auto` de 92vh. En la tablet de AMALAY eso obliga a
// arrastrar con el dedo sobre una barra de pocos píxeles, y el encabezado se
// pierde (captura de campo del 2026-09-11). Ahora es una pantalla con pestañas.
//
// Lo que esta prueba protege NO es el aspecto: es que al repartir en pestañas
// no se haya perdido ni un dato ni un botón, y que la pestaña con dinero
// apartado se abra sola.
import { createElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CobroDeCaja from '@/components/pos/CobroDeCaja'
import { localNetworkFetch } from '@/lib/local-network-fetch'

vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
const network = vi.mocked(localNetworkFetch)

const order = { id: 'order', turno_id: 'turn', order_revision: 3, total_cents: 11600, items: [{ id: 'line', cantidad: 2, sent_quantity: 2 }] }
const cuenta = (id: string, saldo: number) => ({ account_id: id, total_cents: saldo, paid_cents: 0, reserved_cents: 0, balance_cents: saldo })
const finanzas = (extra: Record<string, unknown> = {}) => ({
  order_id: 'order', turno_id: 'turn', currency: 'MXN', revision: 1, order_revision: 3, status: 'open',
  total_cents: 11600, paid_cents: 0, reserved_cents: 0, balance_cents: 11600,
  accounts: [cuenta('order:full', 11600)], payments: [], ...extra,
})
const estado = (financial_orders: unknown[]) => Response.json({ authoritative: true, write_authority: 'caja', financial_orders, salon_orders: [order], print_documents: [] })

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ staff: { id: 'cashier', name: 'Caja', role: 'cajero' }, actor_token: 'synthetic', expires_at: Date.now() + 60000, offline: true }))
  network.mockImplementation(async () => estado([finanzas()]))
})

it('las cuatro formas de cobro caben en una pantalla: cada una es una pestaña, ninguna desaparece', async () => {
  render(createElement(CobroDeCaja, { order, onClose: () => {}, onChanged: () => {} }))
  for (const nombre of [/Efectivo/, /Tarjeta/, /Por confirmar/, /Cobrados/]) {
    expect(await screen.findByRole('tab', { name: nombre })).toBeTruthy()
  }
  // Efectivo es la pestaña de entrada: el importe y su botón están a un toque.
  expect(screen.getByLabelText('Importe a cobrar')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Preparar cobro en efectivo' })).toBeTruthy()

  // La tarjeta conserva TODO lo que tenía: importe, nombre de la terminal, botón y aviso.
  fireEvent.click(screen.getByRole('tab', { name: /Tarjeta/ }))
  expect(screen.getByLabelText('Importe a cobrar con tarjeta')).toBeTruthy()
  expect((screen.getByLabelText('Terminal bancaria') as HTMLInputElement).value).toBe('Terminal bancaria')
  expect(screen.getByRole('button', { name: 'Cobrar con terminal bancaria' })).toBeTruthy()
  expect(screen.getByText(/El importe queda apartado mientras pasas la tarjeta/)).toBeTruthy()

  // Y las pestañas vacías lo dicen en vez de quedarse en blanco.
  fireEvent.click(screen.getByRole('tab', { name: /Por confirmar/ }))
  expect(screen.getByText('No hay cobros apartados esperando decisión.')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: /Cobrados/ }))
  expect(screen.getByText('Todavía no hay cobros confirmados en esta cuenta.')).toBeTruthy()
})

it('REGRESION: un cobro apartado sin resolver abre su pestaña solo y se anuncia en el resto', async () => {
  const pendiente = { payment_id: 'p1', account_id: 'order:full', amount_cents: 1000, method: 'cash', status: 'pending' }
  const conPendiente = finanzas({ reserved_cents: 1000, accounts: [{ ...cuenta('order:full', 11600), reserved_cents: 1000 }], payments: [pendiente] })
  network.mockImplementation(async () => estado([conPendiente]))
  render(createElement(CobroDeCaja, { order, onClose: () => {}, onChanged: () => {} }))

  // Sin tocar nada: el dinero apartado manda.
  await screen.findByText('Cobro por confirmar · $10.00')
  expect(screen.getByRole('tab', { name: 'Por confirmar (1)' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('button', { name: /Confirmar efectivo recibido/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'No se recibió efectivo' })).toBeTruthy()

  // Y si el cajero se va a otra pestaña, el pendiente no se esconde en silencio.
  fireEvent.click(screen.getByRole('tab', { name: /Efectivo/ }))
  expect(screen.getByText(/Hay 1 cobro\(s\) apartado\(s\) sin resolver/)).toBeTruthy()
  // Elegida a mano, la pestaña ya no se mueve sola debajo de los dedos.
  expect(screen.getByRole('tab', { name: /Efectivo/ }).getAttribute('aria-selected')).toBe('true')
})

it('el contenedor del modal ya no es una columna con scroll', async () => {
  const { container } = render(createElement(CobroDeCaja, { order, onClose: () => {}, onChanged: () => {} }))
  await screen.findByRole('tab', { name: /Efectivo/ })
  const panel = container.querySelector('[role="dialog"] > div') as HTMLElement
  expect(panel.className).not.toContain('overflow-auto')
  expect(panel.className).toContain('flex-col')
})
