import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ withPOSAuth: authenticate, unauthorized: () => Response.json({error:'unauthorized'}, {status:401}) }))
import { POST } from '@/app/api/pos/inventory/movement/route'
const body = { client_id:'a', actor:'forged-actor', movement_type:'entry', idempotency_key:'exact-key', lines:[{ingredient_id:'ing',quantity:2,unit_cost:4}] }
const request = (extra={}) => new NextRequest('http://localhost/api/pos/inventory/movement',{method:'POST',body:JSON.stringify({...body,...extra})})
beforeEach(()=>{
  authenticate.mockResolvedValue({clientId:'a',staffId:'verified-manager',role:'gerente'})
  vi.stubEnv('SUPABASE_SERVICE_KEY','synthetic-service-key');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://synthetic.invalid')
})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
describe('inventory manager transaction route',()=>{
  it('stamps verified employee and tenant into the fixed RPC',async()=>{
    const receipt={success:true,was_duplicate:false}
    const fetcher=vi.fn(async(_url:string,_options:RequestInit)=>Response.json(receipt));vi.stubGlobal('fetch',fetcher)
    expect((await POST(request())).status).toBe(200)
    const [url, options]=fetcher.mock.calls[0]
    expect(url).toBe('http://synthetic.invalid/rest/v1/rpc/pos_record_inventory_movement')
    expect(JSON.parse(options.body as string)).toEqual({p_client_id:'a',p_actor:'verified-manager',p_movement_type:'entry',p_lines:body.lines,p_idempotency_key:'exact-key',p_metadata:{}})
  })
  it('rejects waiter writes and foreign requested tenants before database mutation',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    authenticate.mockResolvedValueOnce({clientId:'a',staffId:'waiter',role:'mesero'})
    expect((await POST(request())).status).toBe(403)
    expect((await POST(request({client_id:'b'}))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('requires authentication and a service key without anon fallback',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    authenticate.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    vi.stubEnv('SUPABASE_SERVICE_KEY','')
    expect((await POST(request())).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves rejected intent and insufficient stock as explicit conflicts',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({message:'MOVEMENT_KEY_REUSED'},{status:400})))
    const result=await POST(request())
    expect(result.status).toBe(409);expect(await result.json()).toEqual({error:'MOVEMENT_KEY_REUSED'})
  })
  it('lost RPC response remains unconfirmed and safe to replay',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('lost reply')}))
    const result=await POST(request())
    expect(result.status).toBe(503);expect(await result.json()).toEqual({error:'INVENTORY_UNCONFIRMED'})
  })
})
