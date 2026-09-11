import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { reconciliarInventarioConfirmado } from '@/lib/inventory-reconcile-server'
import { POST } from '@/app/api/pos/inventory/reconcile/route'
const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: auth, unauthorized: () => Response.json({}, { status: 401 }) }))
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'server-test-key')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  auth.mockResolvedValue({ clientId: 'tenant-a', staffId: 'waiter', role: 'mesero' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('reconcile committed inventory', () => {
  it('only sends tenant from verified auth and committed order identity', async () => {
    fetchMock.mockResolvedValue(Response.json([{ r_result: 'RECONCILED' }]))
    const response = await POST(new NextRequest('https://pos.example/api/pos/inventory/reconcile', {
      method: 'POST', body: JSON.stringify({ order_id: 'order-a' }),
    }))
    expect(await response.json()).toEqual({ inventory_pending: false, inventory_status: 'COMPLETE' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ p_client_id: 'tenant-a', p_order_id: 'order-a' })
  })
  it('rejects caller-provided consumption or authority', async () => {
    const response = await POST(new NextRequest('https://pos.example/api/pos/inventory/reconcile', {
      method: 'POST', body: JSON.stringify({ order_id: 'order-a', p_desired: 999, client_id: 'tenant-b' }),
    }))
    expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled()
  })
  it('requires a session before attempting reconciliation', async () => {
    auth.mockResolvedValue(null)
    expect((await POST(new NextRequest('https://pos.example/api/pos/inventory/reconcile', { method: 'POST' }))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps blocked classification visible', async () => {
    fetchMock.mockResolvedValue(Response.json([{ r_result: 'BLOCKED_UNCLASSIFIED' }]))
    expect(await reconciliarInventarioConfirmado('a', 'order')).toEqual({ inventory_pending: true, inventory_status: 'BLOCKED' })
  })
  it.each(['network', 'http', 'malformed'])('does not confirm %s failure', async failure => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('lost ACK'))
    else fetchMock.mockResolvedValue(Response.json(failure === 'malformed' ? {} : { error: 'missing RPC' }, { status: failure === 'http' ? 503 : 200 }))
    expect(await reconciliarInventarioConfirmado('a', 'order')).toEqual({ inventory_pending: true, inventory_status: 'PENDING' })
  })
})
