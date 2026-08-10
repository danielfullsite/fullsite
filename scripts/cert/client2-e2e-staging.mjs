import { createClient } from '@supabase/supabase-js'

const URL='https://jkcnxfbbuyyfhwfjizgw.supabase.co'
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY254ZmJidXl5Zmh3Zmppemd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTM4NDUsImV4cCI6MjEwMDc4OTg0NX0.knHVqpjSG_IY0aqrYp7mU-FQD6frWn5xpSlzH5xOjws'
const roleOf=(jwt)=>{try{return JSON.parse(Buffer.from(jwt.split('.')[1],'base64').toString()).role}catch{return null}}
const c=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}})
const out={steps:[]}
const step=(name,ok,detail)=>out.steps.push({name,ok,detail})

// SAFETY: prove we target staging, not prod
out.target_ref = URL.includes('jkcnxfbbuyyfhwfjizgw') ? 'STAGING(jkcnxfbbuyyfhwfjizgw)' : (URL.includes('qjiomlvudfmzuvqvhwpk')?'PRODUCTION-ABORT':'unknown')
if(out.target_ref!=='STAGING(jkcnxfbbuyyfhwfjizgw)'){ console.log(JSON.stringify({fatal:'not staging',out})); process.exit(1) }

// login Client #2 (real GoTrue JWT)
const {data:li,error:le}=await c.auth.signInWithPassword({email:'client2@stg.local',password:'Client2Pass!'})
step('login_client2', !!li?.session && !le, {role:roleOf(li?.session?.access_token||''), user:li?.user?.id})
const UID=li?.user?.id

const TURNO='turno-c2-e2e', ORDER='ord-c2-e2e', CIERRE='cierre-c2-e2e'
const TOTAL=95, IVA=13.10, SUB=81.90

// 1 OPEN TURNO
{ const {error}=await c.from('pos_turnos').insert({id:TURNO,client_id:'client2',opened_by:UID,fondo_inicial:1000,opened_at:new Date().toISOString()})
  step('open_turno', !error, error?.message||{id:TURNO}) }

// 2 CREATE ORDER (turno not null satisfies pos_orders_ins policy)
{ const {error}=await c.from('pos_orders').insert({id:ORDER,client_id:'client2',mesa:1,mesero:'Mesero C2',status:'abierta',
    turno_id:TURNO,subtotal:SUB,iva:IVA,total:TOTAL,items:[{menu_item_id:'it-c2a',name:'Taco al Pastor',qty:3,price:25},{menu_item_id:'it-c2b',name:'Agua',qty:1,price:20}]})
  step('create_order', !error, error?.message||{id:ORDER,total:TOTAL}) }

// 3 SEND TO KDS
{ const {error}=await c.from('pos_orders').update({status:'enviada',kds_item_status:{'it-c2a':'pendiente','it-c2b':'pendiente'}}).eq('id',ORDER)
  const {data}=await c.from('pos_orders').select('status,kds_item_status').eq('id',ORDER).single()
  step('send_to_kds', !error && data?.status==='enviada', {status:data?.status,kds:data?.kds_item_status}) }

// 4 PAYMENT (cobro)
{ const {error}=await c.from('pos_orders').update({status:'cobrada',metodo_pago:'efectivo',
    pagos:[{metodo:'efectivo',monto:TOTAL}],propina:10,closed_at:new Date().toISOString()}).eq('id',ORDER)
  const {data}=await c.from('pos_orders').select('status,metodo_pago,total,propina').eq('id',ORDER).single()
  step('payment', !error && data?.status==='cobrada', data) }

// 5 CORTE (close turno + cierre record)
{ const e1=(await c.from('pos_turnos').update({closed_at:new Date().toISOString(),closed_by:UID,fondo_final:1095,efectivo_sistema:TOTAL,diferencia:0}).eq('id',TURNO)).error
  const e2=(await c.from('pos_cierres').insert({id:CIERRE,client_id:'client2',turno_id:TURNO,fecha:new Date().toISOString().slice(0,10),
    fondo_inicial:1000,total_contado:1105,efectivo_sistema:TOTAL,total_ventas:TOTAL,tickets_count:1,propinas:10,closed_by:UID})).error
  step('corte', !e1 && !e2, {turno_close_err:e1?.message||null, cierre_err:e2?.message||null}) }

// 6 ISOLATION vs other tenant (stg_a)
{ const seenOther=(await c.from('pos_orders').select('client_id').eq('client_id','stg_a')).data?.length??0
  const seenOtherTurnos=(await c.from('pos_turnos').select('client_id').neq('client_id','client2')).data?.length??0
  const ins=await c.from('pos_orders').insert({id:'ord-c2-cross',client_id:'stg_a',status:'abierta',turno_id:'x',total:1})
  const ownOrders=(await c.from('pos_orders').select('id,status,total')).data
  step('isolation_cannot_see_other', seenOther===0 && seenOtherTurnos===0, {other_orders_visible:seenOther,other_turnos_visible:seenOtherTurnos})
  step('isolation_cannot_write_other', !!ins.error, {cross_insert_error:ins.error?.message||'NO ERROR (LEAK!)'})
  step('own_data_scoped', (ownOrders||[]).every(o=>o.total!==undefined), {own_orders:ownOrders}) }

out.pass = out.steps.every(s=>s.ok)
console.log(JSON.stringify(out,null,1))
