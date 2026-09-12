import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  writeItem: vi.fn(),
  writeOrder: vi.fn(),
  audit: vi.fn(),
  sendCommand: vi.fn(),
  confirmCommand: vi.fn(),
  setFallbackOrders: vi.fn(),
  client: {
    orders: [] as Array<Record<string, unknown>>,
    mode: 'FALLBACK' as 'FALLBACK' | 'LAN_PRIMARY',
    connected: false,
    lastSequence: 1,
    sendCommand: vi.fn(),
    sendCommandConfirmed: vi.fn(),
    setFallbackOrders: vi.fn(),
  },
}))

vi.mock('@/lib/pos-data', () => ({
  getKitchenOrders: mocks.read,
  updateKitchenItemStatus: mocks.writeItem,
  updateOrderStatus: mocks.writeOrder,
  logAudit: mocks.audit,
}))
vi.mock('@/hooks/useKdsWsClient', () => ({
  useKdsWsClient: () => mocks.client,
}))
vi.mock('@/lib/printer', () => ({ reprintByStation: vi.fn() }))
vi.mock('@/lib/use-visible-interval', () => ({ useVisibleInterval: vi.fn() }))
vi.mock('@/lib/bridge-client', () => ({ setPosServerHost: vi.fn() }))

import StandaloneKds from '@/app/kds/page'
import PosKds from '@/app/pos/kds/page'

const order = {
  id: 'order-1',
  mesa: 4,
  mesero: 'Mesero prueba',
  status: 'preparando',
  items: JSON.stringify([{ nombre: 'Latte pendiente', cantidad: 1, station: 'cocina' }]),
  kds_item_status: null,
  comanda_batches: null,
  created_at: new Date().toISOString(),
  notas: null,
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('fullsite_client_id', 'test')
  localStorage.setItem('FULLSITE_LOCATION_ID', 'north')
  localStorage.setItem('kds_station', 'cocina')
  mocks.client.orders = [order]
  mocks.client.mode = 'FALLBACK'
  mocks.client.connected = false
  mocks.client.sendCommand = mocks.sendCommand
  mocks.client.sendCommandConfirmed = mocks.confirmCommand
  mocks.client.setFallbackOrders = mocks.setFallbackOrders
  mocks.read.mockResolvedValue([order])
  mocks.writeOrder.mockResolvedValue(true)
  mocks.sendCommand.mockReturnValue(null)
  mocks.confirmCommand.mockResolvedValue(false)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

for (const [name, Page] of [['standalone', StandaloneKds], ['POS', PosKds]] as const) {
  describe(`${name} KDS`, () => {
    it('revierte el checkbox y no auto-avanza cuando el PATCH cloud es rechazado', async () => {
      mocks.writeItem.mockResolvedValue(false)
      render(React.createElement(Page))

      const item = await screen.findByRole('button', { name: /Latte pendiente/ })
      fireEvent.click(item)

      await screen.findByText('No se guardó el avance · toca para reintentar')
      expect(item.className).not.toContain('opacity-60')
      expect(mocks.writeOrder).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    })

    it('mantiene el optimista mientras espera, pero revierte tras timeout', async () => {
      let finish!: (ok: boolean) => void
      mocks.writeItem.mockReturnValue(new Promise(resolve => { finish = resolve }))
      render(React.createElement(Page))

      const item = await screen.findByRole('button', { name: /Latte pendiente/ })
      fireEvent.click(item)
      await waitFor(() => expect(item.className).toContain('opacity-60'))
      expect(mocks.writeOrder).not.toHaveBeenCalled()

      finish(false)
      await screen.findByText('No se guardó el avance · toca para reintentar')
      expect(item.className).not.toContain('opacity-60')
      expect(mocks.writeOrder).not.toHaveBeenCalled()
    })

    it('conserva el avance aceptado por Caja LAN aunque el respaldo cloud falle', async () => {
      mocks.client.mode = 'LAN_PRIMARY'
      mocks.client.connected = true
      mocks.confirmCommand.mockResolvedValue(true)
      mocks.writeItem.mockResolvedValue(false)
      render(React.createElement(Page))

      const item = await screen.findByRole('button', { name: /Latte pendiente/ })
      fireEvent.click(item)

      await waitFor(() => expect(mocks.writeItem).toHaveBeenCalled())
      expect(item.className).toContain('opacity-60')
      expect(screen.queryByText('No se guardó el avance · toca para reintentar')).toBeNull()
      expect(mocks.confirmCommand).toHaveBeenCalledWith('KDS_ITEM_STATUS', {
        order_id: 'order-1',
        kds_item_delta: { item_index: 0, done: true },
      })
      await waitFor(() => expect(mocks.writeOrder).toHaveBeenCalledWith('order-1', 'lista'))
    })

    it('auto-avanza después de que el RPC cloud confirma el último producto', async () => {
      mocks.writeItem.mockResolvedValue(true)
      render(React.createElement(Page))

      fireEvent.click(await screen.findByRole('button', { name: /Latte pendiente/ }))

      await waitFor(() => expect(mocks.writeOrder).toHaveBeenCalledWith('order-1', 'lista'))
      expect(mocks.confirmCommand).not.toHaveBeenCalled()
      expect(mocks.audit).toHaveBeenCalled()
    })
  })
}
