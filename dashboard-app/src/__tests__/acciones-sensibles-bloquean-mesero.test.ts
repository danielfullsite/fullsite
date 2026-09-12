import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => ({
    clientId: 'amalay', staffId: 'mesero-1', staffName: 'Mesero', role: 'mesero',
  })),
  unauthorized: vi.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
}))
vi.mock('@/lib/shift-token', () => ({ verifyShiftToken: vi.fn(async () => null) }))

import { POST as cancelarItem } from '@/app/api/pos/cancel-item/route'
import { POST as reabrirOrden } from '@/app/api/pos/reopen-order/route'

const request = (path: string, body: Record<string, unknown>) => new Request(`http://test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}) as never

describe('un mesero no puede autoaprobar acciones sensibles', () => {
  it('offline_approved no cancela un artículo', async () => {
    const outbound = vi.fn()
    vi.stubGlobal('fetch', outbound)

    const response = await cancelarItem(request('/api/pos/cancel-item', {
      order_id: 'order-1', item_id: 'item-1', offline_approved: true, manager: 'Gerente',
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'MANAGER_APPROVAL_REQUIRED' })
    expect(outbound).not.toHaveBeenCalled()
  })

  it('offline_approved no reabre una cuenta pagada', async () => {
    const outbound = vi.fn()
    vi.stubGlobal('fetch', outbound)

    const response = await reabrirOrden(request('/api/pos/reopen-order', {
      order_id: 'order-1', offline_approved: true, manager: 'Gerente',
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'MANAGER_APPROVAL_REQUIRED' })
    expect(outbound).not.toHaveBeenCalled()
  })
})
