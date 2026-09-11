import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
function backend(){
 const tables:Record<string,Record<string,any>[]>={},calls:Array<{table:string,method:string,body:any}>=[]
 let fail:(table:string,method:string)=>Response|undefined=()=>undefined,loseAck=false
 const request=vi.fn(async(url:string,init:RequestInit={})=>{
  const parsed=new URL(url),table=parsed.pathname.split('/').at(-1)!,method=init.method||'GET',body=init.body?JSON.parse(init.body as string):null
  calls.push({table,method,body});const failure=fail(table,method);if(failure)return failure
  if(parsed.pathname.includes('/rpc/'))return Response.json(table==='pos_mark_tenant_provisioned'?{ready:true}:{activated:true,provisioning_state:'complete',active:true,staff_setup_required:true})
  const rows=tables[table]||=[]
  if(method==='GET'){
   let result=rows;const cid=parsed.searchParams.get('client_id');if(cid)result=result.filter(r=>r.client_id===cid.slice(3))
   const id=parsed.searchParams.get('id');if(id?.startsWith('eq.'))result=result.filter(r=>r.id===id.slice(3))
   if(id?.startsWith('in.')){const ids=JSON.parse('['+id.slice(4,-1)+']');result=result.filter(r=>ids.includes(r.id))}
   return Response.json(clone(result),new Headers(init.headers).has('Range')?{headers:{'content-range':`0-0/${result.length}`}}:undefined)
  }
  expect(new Headers(init.headers).get('Prefer')).toContain('ignore-duplicates')
  const inserted=[]
  for(const row of body){const keys=parsed.searchParams.get('on_conflict')?.split(',')||(table==='pos_mutation_authority'?['client_id']:['id'])
   if(!rows.some(existing=>keys.every(key=>existing[key]===row[key]))){rows.push(clone(row));inserted.push(row)}}
  if(table==='pos_staff'&&loseAck){loseAck=false;throw new Error('ACK lost after insert')}
  return Response.json(clone(inserted))
 })
 return {tables,calls,request,setFailure:(fn:typeof fail)=>{fail=fn},loseStaffAck:()=>{loseAck=true}}
}
beforeEach(()=>{vi.resetModules();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.invalid');vi.stubEnv('SUPABASE_SERVICE_KEY','fixture-service')})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('retry preserves suspended settings, menu prices, recipes, authority and inactive random staff',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 const first=await provisionTenant({clientId:'fixture',mesas:2});expect(first.staffPins.length).toBeGreaterThan(0)
 expect(db.tables.clients[0]).toMatchObject({active:false,provisioning_state:'pending'})
 expect(db.tables.pos_staff.every(r=>r.active===false&&/^[1-9][0-9]{9}$/.test(r.pin))).toBe(true)
 Object.assign(db.tables.clients[0],{active:false,provisioning_state:'complete',timezone:'Custom',iva_rate:.08,features:'custom'})
 db.tables.pos_menu_items[0].price=987;db.tables.pos_item_inventory_policy[0].inventory_mode='recipe';db.tables.pos_mutation_authority[0].sale_authority='legacy'
 const before=clone(db.tables),retry=await provisionTenant({clientId:'fixture',mesas:2})
 expect(db.tables).toEqual(before);expect(retry.staffPins).toEqual([]);expect(Object.values(retry.created).every(n=>n===0)).toBe(true)
})
it('late failure remains inactive and resumes without replacing earlier edits',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 db.setFailure((t,m)=>t==='pos_payment_methods'&&m==='POST'?new Response('',{status:503}):undefined)
 await expect(provisionTenant({clientId:'fixture',mesas:1})).rejects.toThrow('503')
 expect(db.tables.clients[0].active).toBe(false);expect(db.calls.some(c=>c.table==='pos_mark_tenant_provisioned')).toBe(false)
 db.tables.pos_menu_items[0].price=555;db.setFailure(()=>undefined);await provisionTenant({clientId:'fixture',mesas:1})
 expect(db.tables.pos_menu_items[0].price).toBe(555);expect(db.calls.at(-1)?.table).toBe('pos_mark_tenant_provisioned');expect(db.tables.clients[0].active).toBe(false)
})
it('failed/malformed existence and counts never imply empty data',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 db.setFailure((t,m)=>t==='clients'&&m==='GET'?new Response('',{status:503}):undefined)
 await expect(provisionTenant({clientId:'fixture'})).rejects.toThrow('503');expect(db.calls.every(c=>c.method==='GET')).toBe(true)
 db.setFailure((t,m)=>t==='pos_staff'&&m==='GET'?Response.json([]):undefined)
 await expect(provisionTenant({clientId:'fixture'})).rejects.toThrow('invalid count');expect(db.calls.some(c=>c.table==='pos_staff'&&c.method==='POST')).toBe(false)
 db.setFailure((t,m)=>t==='pos_staff'&&m==='GET'?new Response('',{status:502}):undefined)
 await expect(provisionTenant({clientId:'fixture'})).rejects.toThrow('502')
})
it('foreign location ID cannot change tenant and prevents readiness',async()=>{
 const db=backend();db.tables.client_locations=[{id:'foreign',client_id:'other',name:'Other',active:true}]
 vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 await expect(provisionTenant({clientId:'fixture',locations:[{id:'foreign',name:'Overwrite'}]})).rejects.toThrow('SCOPE_CONFLICT')
 expect(db.tables.client_locations).toEqual([{id:'foreign',client_id:'other',name:'Other',active:true}]);expect(db.calls.some(c=>c.table==='pos_mark_tenant_provisioned')).toBe(false)
})
it('lost staff ACK and concurrent retries preserve stored credentials; discarded PINs never returned',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 db.loseStaffAck();await expect(provisionTenant({clientId:'fixture',mesas:1})).rejects.toThrow('ACK lost')
 const original=clone(db.tables.pos_staff);const retries=await Promise.all([provisionTenant({clientId:'fixture',mesas:1}),provisionTenant({clientId:'fixture',mesas:1})])
 expect(db.tables.pos_staff).toEqual(original);expect(retries.every(r=>r.staffPins.length===0)).toBe(true)
 expect(new Set(db.tables.pos_mesas.map(r=>r.number)).size).toBe(db.tables.pos_mesas.length)
})
it('activation calls fixed RPC with identities and requires its receipt',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {activateProvisionedTenant}=await import('@/lib/provision-tenant')
 expect(await activateProvisionedTenant('fixture','owner',{serviceUserId:'service'})).toMatchObject({activated:true})
 expect(db.calls[0]).toMatchObject({table:'pos_activate_provisioned_tenant',body:{p_client_id:'fixture',p_owner_user_id:'owner',p_service_user_id:'service'}})
 db.setFailure(()=>Response.json({ok:true}));await expect(activateProvisionedTenant('fixture','owner')).rejects.toThrow('invalid activation receipt')
})

it('partial failure retries captured plan despite changed inputs',async()=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 db.setFailure((t,m)=>t==='pos_payment_methods'&&m==='POST'?new Response('',{status:503}):undefined)
 await expect(provisionTenant({clientId:'planned',mesas:20,locations:[{name:'Original branch'}]})).rejects.toThrow('503')
 const plan=clone(db.tables.clients[0].provisioning_plan)
 expect(plan.locations[0].id).toMatch(/^[0-9a-f-]{36}$/)
 expect(JSON.stringify(plan)).not.toMatch(/"(pin|password)":/)
 db.setFailure(()=>undefined)
 await provisionTenant({clientId:'planned',mesas:1,locations:[{name:'Changed branch'}],template:{menu:[],roles:[],paymentMethods:[]}})
 expect(db.tables.clients[0].provisioning_plan).toEqual(plan)
 expect(db.tables.pos_mesas).toHaveLength(20);expect(db.tables.client_locations).toHaveLength(1)
 expect(db.tables.client_locations[0].name).toBe('Original branch')
 expect(db.tables.pos_menu_items.length).toBeGreaterThan(0)
})
it.each(['complete',null])('completed or legacy (%s) cannot resurrect deleted template data',async(state)=>{
 const db=backend();vi.stubGlobal('fetch',db.request);const {provisionTenant}=await import('@/lib/provision-tenant')
 await provisionTenant({clientId:'fixture'});db.tables.clients[0].provisioning_state=state
 db.tables.pos_menu_items.splice(0,1);const before=clone(db.tables);db.calls.length=0
 const result=await provisionTenant({clientId:'fixture',mesas:50,locations:[{name:'New branch'}]})
 expect(db.tables).toEqual(before);expect(result.staffPins).toEqual([])
 expect(db.calls.filter(c=>c.method==='POST').map(c=>c.table)).toEqual(['pos_mark_tenant_provisioned'])
 db.setFailure(t=>t==='pos_mark_tenant_provisioned'?new Response('',{status:409}):undefined)
 await expect(provisionTenant({clientId:'fixture'})).rejects.toThrow('409');expect(db.tables).toEqual(before)
})
it('foreign location is rejected before freezing plan and can be corrected',async()=>{
 const db=backend();db.tables.client_locations=[{id:'foreign',client_id:'other'}];vi.stubGlobal('fetch',db.request)
 const {provisionTenant}=await import('@/lib/provision-tenant')
 await expect(provisionTenant({clientId:'fixture',locations:[{id:'foreign',name:'Bad'}]})).rejects.toThrow('SCOPE_CONFLICT')
 expect(db.tables.clients).toEqual([])
 await provisionTenant({clientId:'fixture',locations:[{name:'Corrected'}]})
 expect(db.tables.clients[0].provisioning_plan.locations[0].name).toBe('Corrected')
})
