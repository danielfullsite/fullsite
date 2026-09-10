import React from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import CocinaPage from '@/app/pos/cocina/page'
import BarraPage from '@/app/pos/barra/page'
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), audit: vi.fn(), poll: vi.fn() }))
vi.mock('@/lib/pos-data', async importOriginal => ({ ...await importOriginal<object>(), getKitchenOrders: mocks.read, updateOrderStatus: mocks.write, logAudit: mocks.audit }))
vi.mock('@/lib/bridge-client', () => ({ useBridgeClient: vi.fn(), setPosServerHost: vi.fn() }))
vi.mock('@/lib/use-visible-interval', () => ({ useVisibleInterval: mocks.poll }))
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('fullsite_client_id', 'test')
  localStorage.setItem('FULLSITE_LOCATION_ID', 'north')
  localStorage.setItem('kds_station', 'todo')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  mocks.read.mockResolvedValue([{
    id: 'old-pending', client_id: 'test', location_id: 'north', turno_id: 'turn',
    mesa: 7, mesero: 'Mesero prueba', status: 'enviada',
    items: [{ id: 'item', nombre: 'Latte pendiente', cantidad: 1, station: 'barra' }],
    created_at: new Date(Date.now() - 20 * 3600000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  }])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
for (const [name, Page] of [['cocina', CocinaPage], ['barra', BarraPage]] as const) {
  it(`${name}: refresh preserves an old pending order without writing a delivery`, async () => {
    render(React.createElement(Page))
    await waitFor(() => expect(screen.getAllByText('Latte pendiente').length).toBeGreaterThan(0))
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.read).toHaveBeenCalled()
  })
}

it('barra: a rejected status update restores the pending state and writes no success audit', async () => {
  mocks.write.mockResolvedValue(false)
  render(React.createElement(BarraPage))
  await screen.findByText('Latte pendiente')
  fireEvent.click(screen.getByRole('button', { name: 'Preparando' }))
  await screen.findByText('Error al cambiar estado. Intenta de nuevo.')
  expect(screen.getByRole('button', { name: 'Preparando' })).toBeTruthy()
  expect(mocks.write).toHaveBeenCalledWith('old-pending', 'preparando')
  expect(mocks.audit).not.toHaveBeenCalled()
})
