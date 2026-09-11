import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { MovementRequest } from '@/lib/inventory'
const original: MovementRequest = {client_id:'a',actor:'dashboard',movement_type:'adjustment',idempotency_key:'count-original',
  lines:[{ingredient_id:'ingredient',quantity:-2,notes:'sistema=10 conteo=8'}],metadata:{reason:'physical count'}}
beforeEach(()=>{
  vi.stubGlobal('indexedDB',new IDBFactory())
  vi.stubGlobal('window',{location:{pathname:'/inventario-real/toma-fisica'},dispatchEvent:vi.fn()})
  vi.stubGlobal('localStorage',{getItem:()=>null})
})
afterEach(()=>vi.unstubAllGlobals())
describe('durable manual inventory intent',()=>{
  it('recovers lost ACK across reload with original delta and permits a subsequent identical intentional movement',async()=>{
    let stock=10
    const receipts=new Map<string,unknown>()
    const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{
      const req=JSON.parse(options.body as string) as MovementRequest
      if(receipts.has(req.idempotency_key)) return Response.json({...receipts.get(req.idempotency_key) as object,was_duplicate:true})
      const before=stock;stock+=req.lines[0].quantity
      const result={success:true,movements_created:1,stock_updates:1,cost_updates:0,was_duplicate:false,errors:[],
        details:[{ingredient_id:'ingredient',stock_before:before,stock_after:stock,cost_before:1,cost_after:1}]}
      receipts.set(req.idempotency_key,result)
      if(receipts.size===1) throw new TypeError('ACK lost after commit')
      return Response.json(result)
    })
    vi.stubGlobal('fetch',fetcher)
    let {recordMovement}=await import('@/lib/inventory')
    expect((await recordMovement(original)).success).toBe(false);expect(stock).toBe(8)
    vi.resetModules() // no in-memory form/key survives the reload
    ;({recordMovement}=await import('@/lib/inventory'))
    const {readPendingMovement}=await import('@/lib/inventory-pending')
    const pending=await readPendingMovement('a')
    expect(pending?.request).toEqual(original)
    const changed={...original,idempotency_key:'new-mount-key',lines:[{ingredient_id:'ingredient',quantity:-1}]}
    expect((await recordMovement(changed)).errors[0]).toContain('INVENTORY_PENDING')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await recordMovement(pending!.request)).was_duplicate).toBe(true)
    expect(stock).toBe(8)
    // A crash after HTTP acknowledgement still leaves recovery available.
    vi.resetModules()
    expect((await readPendingMovement('a'))?.request).toEqual(original)
    const { confirmarMovimientoInventario } = await import('@/lib/inventory')
    await confirmarMovimientoInventario('a', 'unrelated-key')
    expect(await readPendingMovement('a')).not.toBeNull()
    await confirmarMovimientoInventario('a', original.idempotency_key)
    expect(await readPendingMovement('a')).toBeNull()
    expect((await recordMovement({...original,idempotency_key:'intentional-second-count'})).success).toBe(true)
    expect(stock).toBe(6)
  })
  it('serializes competing tabs and shares pending recovery across manual pages while separating tenants',async()=>{
    const {freezeInventoryMovement,readPendingMovement}=await import('@/lib/inventory-pending')
    const raced=await Promise.allSettled([freezeInventoryMovement(original,'/page-a'),freezeInventoryMovement({...original,idempotency_key:'competing'},'/page-b')])
    expect(raced.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(raced.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect((await readPendingMovement('a'))?.request.idempotency_key).toBe('count-original')
    await freezeInventoryMovement({...original,client_id:'b'},'/page-b')
    expect((await readPendingMovement('b'))?.request.client_id).toBe('b')
  })
  it('never sends when durable intent storage is unavailable',async()=>{
    vi.stubGlobal('indexedDB',{open(){throw new Error('storage unavailable')}})
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    const {recordMovement}=await import('@/lib/inventory')
    expect((await recordMovement(original)).success).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('a confirmed rollback permits correction; auth/unknown outcomes retain the exact intent',async()=>{
    const {recordMovement}=await import('@/lib/inventory')
    const {readPendingMovement}=await import('@/lib/inventory-pending')
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'MANAGER_REQUIRED'},{status:403})))
    await recordMovement(original)
    expect((await readPendingMovement('a'))?.request).toEqual(original)
    for (const error of ['MOVEMENT_KEY_REUSED', 'LEGACY_MOVEMENT_REQUIRES_RECONCILIATION']) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({error}, {status:409})))
      await recordMovement(original)
      expect((await readPendingMovement('a'))?.request).toEqual(original)
    }
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'INSUFFICIENT_STOCK'},{status:409})))
    await recordMovement(original)
    expect(await readPendingMovement('a')).toBeNull()
  })
})
