import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ role: 'mesero' }))

vi.mock('@/lib/api-auth', () => ({
  withPOSAuth: vi.fn(async () => ({
    clientId: 'tenant-a', staffId: 'staff-1', staffName: 'Operador',
    role: state.role, authType: 'shift_token',
  })),
  unauthorized: vi.fn(() => Response.json({ error: 'No autorizado' }, { status: 401 })),
}))

describe('/api/pos/merge-orders por rol', () => {
  beforeEach(() => {
    state.role = 'mesero'
    vi.clearAllMocks()
  })

  it('un mesero no puede fusionar dos mesas por llamada directa', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/pos/merge-orders/route')

    const response = await POST(new NextRequest('https://app.test/api/pos/merge-orders', {
      method: 'POST',
      body: JSON.stringify({
        target_order_id: 'target', source_order_id: 'source', merged_items: [], total: 1,
      }),
    }))
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
