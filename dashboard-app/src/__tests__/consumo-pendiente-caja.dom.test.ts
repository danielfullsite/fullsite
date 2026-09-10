import { createElement } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7718' }))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: vi.fn() }))
vi.mock('@/lib/pedro-catalogo', () => ({ leerCatalogoCaja: vi.fn(async () => ({ catalog_revision: 'catalog' })) }))
import { localNetworkFetch } from '@/lib/local-network-fetch'
import { enviarCuentaEnCaja, guardarCuentaEnCaja } from '@/lib/pedro-operaciones'
import ConsumoPendienteDeCaja from '@/components/pos/ConsumoPendienteDeCaja'
const network = vi.mocked(localNetworkFetch)
const item = { id: 'line', menuItemId: 'coffee', nombre: 'Café', cantidad: 1, precio: 50, precioExtra: 0, subtotal: 50, modificadores: [], notas: '' }
const order = { id: 'closed-by-peer', turno_id: 'turn', order_revision: 3, total_cents: 5800, items: [item] }
beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  sessionStorage.setItem('pos_actor_session', JSON.stringify({ staff: { id: 'cashier', role: 'admin' }, actor_token: 'synthetic', expires_at: Date.now() + 600000 }))
})
it.each(['save', 'send'])('recovers a lost %s receipt after a peer settled the account, without reopening or new command', async kind => {
  let original: Record<string, unknown> = {}
  network.mockImplementationOnce(async (_url, init) => { original = JSON.parse(String(init?.body)); throw new Error('ACK lost after durable commit') })
  const action = kind === 'save' ? guardarCuentaEnCaja({ id: order.id, turnoId: order.turno_id, revision: 3, mesa: 1, personas: 1, notas: '', discount: 0, items: [item] }) : enviarCuentaEnCaja(order)
  await expect(action).rejects.toMatchObject({ incierto: true })
  // The salon no longer contains this identity. Recovery must need neither an
  // open order nor the editor's discarded operational snapshot.
  network.mockImplementationOnce(async (url, init) => {
    expect(url).toBe('http://127.0.0.1:7718/events')
    expect(JSON.parse(String(init?.body))).toEqual(original)
    return Response.json({ results: [{ duplicate: true, receipt: { command_id: original.command_id, sequence: 8 }, result: { operational_order: { ...order, order_revision: 4 } } }] })
  })
  const onRecovered = vi.fn()
  render(createElement(ConsumoPendienteDeCaja, { onRecovered }))
  fireEvent.click(await screen.findByRole('button', { name: /^Recuperar/ }))
  await screen.findByText(/Resultado original recuperado/)
  expect(onRecovered).toHaveBeenCalledTimes(1)
  expect(network).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: /^Recuperar/ })).toBeNull()
  expect(Object.keys(localStorage)).toHaveLength(0)
})
it('a pending intent from another tenant is not exposed or recovered', async () => {
  localStorage.setItem('fullsite_client_id', 'tenant-a')
  network.mockRejectedValueOnce(new Error('lost'))
  await expect(enviarCuentaEnCaja(order)).rejects.toMatchObject({ incierto: true })
  localStorage.setItem('fullsite_client_id', 'tenant-b')
  render(createElement(ConsumoPendienteDeCaja, { onRecovered: vi.fn() }))
  expect(screen.queryByRole('button', { name: /^Recuperar/ })).toBeNull()
  expect(network).toHaveBeenCalledTimes(1)
})
