import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'a' }))
vi.mock('@/lib/inventory', () => ({ recordMovement: send, confirmarMovimientoInventario: vi.fn() }))
import PendingMovementRecovery from '@/components/inventory/PendingMovementRecovery'
import { freezeInventoryMovement } from '@/lib/inventory-pending'
const saved = { client_id: 'a', actor: 'original', movement_type: 'adjustment' as const, idempotency_key: 'before-reload',
  lines: [{ ingredient_id: 'ingredient', quantity: -2, notes: 'sistema=10 conteo=8' }] }
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); send.mockReset() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('shows saved physical-count quantities after remount and retries those exact quantities', async () => {
  await freezeInventoryMovement(saved, '/inventario-real/toma-fisica')
  const initial = render(React.createElement(PendingMovementRecovery))
  await screen.findByRole('button', { name: 'Recuperar guardado pendiente' })
  initial.unmount()
  render(React.createElement(PendingMovementRecovery))
  const recover = await screen.findByRole('button', { name: 'Recuperar guardado pendiente' })
  expect(screen.getByText('ingredient: -2 — sistema=10 conteo=8')).toBeTruthy()
  send.mockResolvedValue({ success: false, errors: ['Sin conexión'] })
  fireEvent.click(recover)
  await screen.findByRole('alert')
  expect(send).toHaveBeenCalledWith(saved)
  expect(screen.getByRole('button', { name: 'Recuperar guardado pendiente' })).toBeTruthy()
})
