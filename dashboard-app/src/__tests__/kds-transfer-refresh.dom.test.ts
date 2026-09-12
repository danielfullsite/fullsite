import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  listener: null as null | ((message: any) => void),
  sent: [] as Array<{ commandType: string; payload: Record<string, unknown> }>,
}))
vi.mock('@/lib/local-network-fetch', () => ({ localNetworkFetch: mocks.read }))
vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://caja.test' }))
vi.mock('@/lib/bridge-client', () => ({ BridgeClient: class {
  connected = true
  on(listener: (message: any) => void) { mocks.listener = listener; return () => { mocks.listener = null } }
  connect() {} disconnect() {}
  sendCommand(commandType: string, payload: Record<string, unknown>) {
    mocks.sent.push({ commandType, payload })
    return String(payload.command_id || '') || null
  }
} }))
import { useKdsWsClient } from '@/hooks/useKdsWsClient'
afterEach(() => { cleanup(); localStorage.clear(); mocks.sent = []; vi.clearAllMocks(); vi.useRealTimers() })
it('replaces both transferred kitchen accounts from Caja and retries a failed read without hiding work', async () => {
  localStorage.setItem('pos_bridge_host', 'caja.test')
  const source = { id: 'source', mesa: 1, items: JSON.stringify([{ id: 'coffee' }]), status: 'enviada' }
  const target = { id: 'target', mesa: 2, items: JSON.stringify([{ id: 'coffee', preparation_status: 'lista' }]), status: 'enviada' }
  mocks.read.mockRejectedValueOnce(new Error('LAN unavailable'))
    .mockResolvedValueOnce(Response.json({ authoritative: true, kds_orders: [target] }))
  vi.useFakeTimers()
  const { result } = renderHook(() => useKdsWsClient('lab'))
  act(() => mocks.listener?.({ type: 'SNAPSHOT', sequence: 1, payload: { state: { kds_orders: [source] } } }))
  expect(result.current.orders[0].id).toBe('source')
  await act(async () => { mocks.listener?.({ type: 'DELTA', sequence: 2, payload: { event: { type: 'ORDER_ITEMS_TRANSFERRED', payload: {} } } }) })
  expect(result.current.orders[0].id).toBe('source')
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  vi.useRealTimers()
  await waitFor(() => expect(result.current.orders.map(o => o.id)).toEqual(['target']))
  expect(result.current.orders[0].mesa).toBe(2)
  expect(mocks.read).toHaveBeenCalledTimes(2)
})

it('confirma comandos LAN sólo con el ACK durable de Caja', async () => {
  localStorage.setItem('pos_bridge_host', 'caja.test')
  const { result } = renderHook(() => useKdsWsClient('lab'))

  const confirmation = result.current.sendCommandConfirmed('KDS_ITEM_STATUS', {
    order_id: 'order-1',
    kds_item_delta: { item_index: 0, done: true },
  })
  const commandId = String(mocks.sent[0].payload.command_id)
  expect(commandId).not.toBe('')
  expect(mocks.sent[0].payload).toMatchObject({
    order_id: 'order-1',
    kds_item_delta: { item_index: 0, done: true },
  })

  act(() => mocks.listener?.({ type: 'ACK', payload: { command_id: commandId } }))
  await expect(confirmation).resolves.toBe(true)
})

it('un REJECT de Caja nunca cuenta como avance persistido', async () => {
  localStorage.setItem('pos_bridge_host', 'caja.test')
  const { result } = renderHook(() => useKdsWsClient('lab'))

  const confirmation = result.current.sendCommandConfirmed('KDS_ITEM_STATUS', {
    order_id: 'order-1',
    kds_item_delta: { item_index: 0, done: true },
  })
  const commandId = String(mocks.sent[0].payload.command_id)
  act(() => mocks.listener?.({ type: 'REJECT', payload: { command_id: commandId, reason: 'Permiso rechazado' } }))

  await expect(confirmation).resolves.toBe(false)
})

it('un ACK perdido vence y queda sin confirmar', async () => {
  vi.useFakeTimers()
  localStorage.setItem('pos_bridge_host', 'caja.test')
  const { result } = renderHook(() => useKdsWsClient('lab'))

  const confirmation = result.current.sendCommandConfirmed('KDS_ITEM_STATUS', {
    order_id: 'order-1',
    kds_item_delta: { item_index: 0, done: true },
  }, 25)
  await act(async () => { await vi.advanceTimersByTimeAsync(25) })

  await expect(confirmation).resolves.toBe(false)
})
