import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/pos/caja/materialize/route'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { OperationalDomain } = require('../../../electron-app/local-server/core/operational-domain.js')
const { RestaurantState } = require('../../../electron-app/local-server/core/state.js')
const input = { p_stream_id:'00000000-0000-4000-8000-000000000001', p_credential:'synthetic-credential-32-characters-long',
  p_previous_history_hash:'0'.repeat(64),p_history_hash:'a'.repeat(64),p_event:{sequence:1,type:'TURN_OPEN'} }
const req = (extra={}) => new NextRequest('http://localhost/api/pos/caja/materialize',{method:'POST',body:JSON.stringify({...input,...extra})})
beforeEach(()=>{process.env.SUPABASE_SERVICE_KEY='server-test-sentinel';process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9999'})
afterEach(()=>vi.unstubAllGlobals())
describe('gateway exclusivo de recibos Caja',()=>{
  it('entrega una comanda válida mayor de 2 MB sin bloquear los eventos siguientes',async()=>{
    const domain = new OperationalDomain()
    const state = new RestaurantState({ localAuthorityEnabled: true })
    state.apply({ type: 'TURN_OPEN', result: { turno: { id: 'turn', opening_cash_cents: 0 } } })
    const actor = { id: 'employee', permissions: ['pos.orders.write', 'abrir_cuentas_restaurante', 'pos.orders.send'], expires_at: Date.now() + 60_000 }
    const catalogEnvelope = { ready: true, revision: 'catalog', catalog: {
      categories: [{ id: 'food', name: 'Food', items: [{ id: 'product', name: 'Product', price: 1 }] }],
      config: { mesas: 10, iva_rate: 0.16 }, settings: { 'pos.station_routing': { cocina: ['food'] } },
      modifiers: { item_links: [], category_links: [], mods: [], groups: [] },
    } }
    const payload = { command_id: 'save', command_type: 'ORDER_SAVE', order_id: 'order', turno_id: 'turn',
      expected_revision: 0, catalog_revision: 'catalog', mesa: 1,
      items: Array.from({ length: 750 }, (_, i) => ({ line_id: `line-${i}`, product_id: 'product', quantity: 1, notes: 'a'.repeat(1000) })) }
    state.apply({ type: 'ORDER_SAVE', result: domain.prepare(payload, { state, catalogEnvelope, actor }) })
    const send = { command_id: 'send', command_type: 'ORDER_SEND', order_id: 'order', turno_id: 'turn', expected_revision: 1 }
    const event = { id: 'send', sequence: 2, type: 'ORDER_SEND', restaurant_id: 'lab', payload: send,
      result: domain.prepare(send, { state, catalogEnvelope, actor }) }
    expect(Buffer.byteLength(JSON.stringify(event))).toBeGreaterThan(2_000_000)
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(4 * 1024 * 1024)
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string)
      return Response.json({ sequence: sent.p_event.sequence, event_id: sent.p_event.id, materialized: true })
    })
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(req({ p_event: event }))).status).toBe(200)
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).p_event).toEqual(event)
    expect((await POST(req({ p_event: { id: 'next', sequence: 3, type: 'FINANCIAL_OPEN' } }))).status).toBe(200)
  })
  it('limita bytes UTF-8 excesivos antes de llamar al materializador',async()=>{
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const result = await POST(req({ p_event: { notes: 'é'.repeat(2_100_000) } }))
    expect(result.status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reserva espacio para credencial y hashes además del presupuesto SQL del evento',async()=>{
    const event = { notes: 'a'.repeat(4 * 1024 * 1024 - 100) }
    const request = req({ p_event: event })
    expect(Buffer.byteLength(await request.clone().text())).toBeGreaterThan(4 * 1024 * 1024)
    const fetcher = vi.fn(async () => Response.json({ materialized: true }))
    vi.stubGlobal('fetch', fetcher)
    expect((await POST(request)).status).toBe(200)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('sólo llama al materializador fijo y no devuelve la clave de servicio',async()=>{
    const response={stream_id:input.p_stream_id,sequence:1,materialized:true,duplicate:false}
    const fetcher=vi.fn(async(_url:string,_init:RequestInit)=>Response.json(response));vi.stubGlobal('fetch',fetcher)
    const result=await POST(req({rpc:'arbitrary',p_client_id:'otro'}))
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual(response)
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:9999/rest/v1/rpc/apply_pos_caja_event')
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual(input)
  })
  it('rechaza payload inválido antes de llegar a la base',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    expect((await POST(req({p_credential:'corta'}))).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('la credencial de stream rechazada no se presenta como recibo',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({message:'SYNC_UNAUTHORIZED'},{status:400})))
    const response=await POST(req());expect(response.status).toBe(403)
    expect(await response.json()).toEqual({error:'SYNC_UNAUTHORIZED'})
  })
  it('una respuesta perdida conserva la incertidumbre para el reintento',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('lost reply')}))
    const response=await POST(req());expect(response.status).toBe(503)
    expect(await response.json()).toEqual({error:'SYNC_UNCONFIRMED'})
  })
})
