import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/pos-data', () => ({ getPOSAuthHeaders: () => ({ Authorization: 'Bearer fixture' }) }))
import PendingOrderInventory from '@/components/pos/PendingOrderInventory'
import { setOrderInventoryPending, readPendingOrderInventory, clearOrderInventoryIfUnchanged } from '@/lib/order-inventory-pending'
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
it('pending inventory survives navigation and BLOCKED retries; only a complete canonical reply clears it', async () => {
  setOrderInventoryPending('lab', 'order', true, 4)
  const bodies: any[] = []
  let complete = false
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return Response.json({ inventory_pending: !complete, inventory_status: complete ? 'COMPLETE' : 'BLOCKED' })
  }))
  const first = render(React.createElement(PendingOrderInventory, { clientId: 'lab' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar conciliación' }))
  await screen.findByRole('alert')
  expect(readPendingOrderInventory('lab')).toHaveLength(1)
  first.unmount()
  complete = true
  render(React.createElement(PendingOrderInventory, { clientId: 'lab' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar conciliación' }))
  await waitFor(() => expect(readPendingOrderInventory('lab')).toHaveLength(0))
  expect(bodies).toEqual([{ order_id: 'order' }, { order_id: 'order' }])
})
it('a delayed completion cannot erase a newer pending mutation of the same order', () => {
  setOrderInventoryPending('lab', 'order', true, 4)
  const previous = readPendingOrderInventory('lab')[0]
  setOrderInventoryPending('lab', 'order', true, 4)
  clearOrderInventoryIfUnchanged('lab', 'order', previous.revision)
  expect(readPendingOrderInventory('lab')).toHaveLength(1)
  expect(readPendingOrderInventory('other')).toHaveLength(0)
})
