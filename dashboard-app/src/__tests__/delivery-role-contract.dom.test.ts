import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import DeliveryPage from '@/app/pos/delivery/page'

vi.mock('@/lib/pos-data', () => ({
  formatMXN: (value: number) => `$${value.toFixed(2)}`,
  getPOSAuthHeaders: () => ({ Authorization: 'Bearer shift-fixture' }),
  logAudit: vi.fn(),
}))

const orders = [
  {
    id: 'delivery-new', client_id: 'tenant-server', status: 'nueva', platform: 'rappi',
    platform_order_id: 'RAPPI-1', customer_name: 'Pedido nuevo', address: null, phone: null,
    total: 120, payment_method: null, items: [], created_at: '2026-09-12T12:00:00Z',
    en_route_at: null, delivered_at: null, closed_at: null,
  },
  {
    id: 'delivery-preparing', client_id: 'tenant-server', status: 'preparando', platform: 'rappi',
    platform_order_id: 'RAPPI-2', customer_name: 'Pedido preparando', address: null, phone: null,
    total: 180, payment_method: null, items: [], created_at: '2026-09-12T12:05:00Z',
    en_route_at: null, delivered_at: null, closed_at: null,
  },
]

function renderAs(role: string) {
  sessionStorage.setItem('pos_staff', JSON.stringify({ id: role, name: role, role }))
  render(React.createElement(DeliveryPage))
}

describe('/pos/delivery respeta el contrato granular de roles', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(orders)))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it.each(['admin', 'gerente', 'capitan'])(
    '%s puede avanzar nueva→preparando y preparando→lista',
    async role => {
      renderAs(role)

      await screen.findByText(/Pedido nuevo/)
      expect(screen.getByRole('button', { name: 'Preparando' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Lista para recoger' })).toBeTruthy()
      expect(screen.queryByText(/Solo lectura/)).toBeNull()
    },
  )

  it.each(['cajero', 'mesero'])(
    '%s ve las órdenes sin controles para cambiar cocina o cancelar',
    async role => {
      renderAs(role)

      await screen.findByText(/Pedido nuevo/)
      await waitFor(() => expect(screen.getAllByText(/Solo lectura/)).toHaveLength(2))
      expect(screen.queryByRole('button', { name: 'Preparando' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Lista para recoger' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Cancelar orden' })).toBeNull()
    },
  )

  it('sólo admin conserva el control crítico de cancelación', async () => {
    renderAs('admin')

    await screen.findByText(/Pedido nuevo/)
    expect(screen.getAllByRole('button', { name: 'Cancelar orden' })).toHaveLength(2)
  })
})
