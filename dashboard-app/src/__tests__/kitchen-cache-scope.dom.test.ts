import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { currentKitchenScope, readScopedKitchenCache } from '@/lib/kitchen-read-scope'
import { cacheKitchenBridgeOrder } from '@/lib/kitchen-bridge-cache'
import { useBridgeClient } from '@/lib/bridge-client'
const mocks = vi.hoisted(() => ({ cache: vi.fn(), write: vi.fn(), discover: vi.fn() }))
vi.mock('@/lib/pos-offline-db', () => ({ getCachedOrders: mocks.cache, cacheOrder: mocks.write }))
vi.mock('@/lib/server-discovery', () => ({ buildDiscoveryConfig: vi.fn(), ServerDiscovery: class { discover = mocks.discover } }))
class Socket {
  static OPEN = 1; static CONNECTING = 0; static instances: Socket[] = []
  readyState = 1
  onopen?: () => void; onmessage?: (e: {data: string}) => void; onclose?: () => void
  send = vi.fn(); close = vi.fn()
  constructor() { Socket.instances.push(this) }
  message(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}
beforeEach(() => {
  localStorage.clear(); Socket.instances = []
  localStorage.setItem('fullsite_client_id', 'a')
  localStorage.setItem('FULLSITE_LOCATION_ID', 'north')
  localStorage.setItem('FULLSITE_LAN_SECRET', 'paired')
  localStorage.setItem('pos_bridge_host', '127.0.0.1')
  vi.stubGlobal('WebSocket', Socket)
  mocks.discover.mockResolvedValue({ state: 'found', endpoint: 'http://127.0.0.1:7717', identity: { restaurant_id: 'a', branch_id: 'north' } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('reads LAN cache without WAN, excludes foreign branches and legacy unscoped rows', async () => {
  mocks.cache.mockImplementation(async (status: string) => status === 'enviada' ? [
    { id:'lan', client_id:'a', location_id:'north', created_at:new Date().toISOString(), _bridge_unsynced:true },
    { id:'other', client_id:'b', location_id:'north', created_at:new Date().toISOString() },
    { id:'branch', client_id:'a', location_id:'south', created_at:new Date().toISOString() },
    { id:'legacy', created_at:new Date().toISOString() },
  ] : [])
  expect((await readScopedKitchenCache()).map(row => row.id)).toEqual(['lan'])
})
it('discards pending IndexedDB result after branch changes', async () => {
  let resolve!: (rows: unknown[]) => void
  mocks.cache.mockReturnValue(new Promise(r => { resolve = r }))
  const pending = readScopedKitchenCache(currentKitchenScope())
  await waitFor(() => expect(mocks.cache).toHaveBeenCalled())
  localStorage.setItem('FULLSITE_LOCATION_ID', 'south')
  resolve([{ id:'old', client_id:'a', location_id:'north', created_at:new Date().toISOString() }])
  expect(await pending).toEqual([])
})
it('delivers authenticated DELTA before SNAPSHOT with captured discovery scope and ignores old connection after tenant/branch change', async () => {
  const receive = vi.fn()
  renderHook(() => useBridgeClient(receive, 'kds'))
  await waitFor(() => expect(Socket.instances.length).toBeGreaterThan(0))
  const socket = Socket.instances.at(-1)!
  socket.onopen?.()
  const event = {type:'ORDER_SENT',payload:{order_id:'one',items:[]}}
  socket.message({type:'DELTA',sequence:2,payload:{event}})
  expect(receive).toHaveBeenCalledWith(event, {clientId:'a',locationId:'north'})
  localStorage.setItem('FULLSITE_LOCATION_ID','south')
  socket.message({type:'DELTA',sequence:3,payload:{event}})
  expect(receive).toHaveBeenCalledTimes(1)
  localStorage.setItem('fullsite_client_id','b')
  socket.message({type:'DELTA',sequence:4,payload:{event}})
  expect(receive).toHaveBeenCalledTimes(1)
})

it('caches a LAN command with captured provenance, rejects explicit foreign event and delayed old callback', async () => {
  mocks.write.mockResolvedValue(undefined)
  const scope = currentKitchenScope()
  expect(await cacheKitchenBridgeOrder({order_id:'sent',items:[]}, scope)).toBe(true)
  expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({id:'sent',client_id:'a',location_id:'north',_bridge_unsynced:true}))
  expect(await cacheKitchenBridgeOrder({order_id:'foreign',client_id:'b'}, scope)).toBe(false)
  localStorage.setItem('FULLSITE_LOCATION_ID','south')
  expect(await cacheKitchenBridgeOrder({order_id:'late'}, scope)).toBe(false)
  expect(mocks.write).toHaveBeenCalledTimes(1)
})
it('never attests discovery from another branch even if a discovery adapter says found', async () => {
  mocks.discover.mockResolvedValue({state:'found',endpoint:'http://127.0.0.1:7717',identity:{restaurant_id:'a',branch_id:'south'}})
  const receive = vi.fn(); renderHook(() => useBridgeClient(receive,'kds'))
  await waitFor(() => expect(Socket.instances.length).toBeGreaterThan(0))
  Socket.instances.at(-1)!.message({type:'DELTA',sequence:2,payload:{event:{type:'ORDER_SENT',payload:{}}}})
  expect(receive).toHaveBeenCalled()
  expect(receive.mock.calls[0][1]).toBeUndefined()
})
it('does not connect discovery completed after scope changed', async () => {
  let resolve!: (result: unknown) => void
  mocks.discover.mockReturnValue(new Promise(r => { resolve = r }))
  renderHook(() => useBridgeClient(vi.fn(),'kds'))
  await waitFor(() => expect(mocks.discover).toHaveBeenCalled())
  localStorage.setItem('fullsite_client_id','b')
  resolve({state:'found',endpoint:'http://127.0.0.1:7717',identity:{restaurant_id:'a',branch_id:'north'}})
  await new Promise(r => setTimeout(r, 20))
  expect(Socket.instances).toHaveLength(0)
})
