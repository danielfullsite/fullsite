import { createClient } from '@supabase/supabase-js'
const URL=process.env.SUPABASE_URL
const ANON=process.env.SUPABASE_ANON_KEY
const EMAIL=process.env.OWNER_EMAIL
const PASSWORD=process.env.OWNER_PASSWORD
if(!URL||!ANON||!EMAIL||!PASSWORD){
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL and OWNER_PASSWORD are required')
  process.exit(1)
}
if(URL.includes('qjiomlvudfmzuvqvhwpk')){
  console.error('Refusing to run Client #2 isolation probes against AMALAY production')
  process.exit(1)
}
const c=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}})
const {data:l,error}=await c.auth.signInWithPassword({email:EMAIL,password:PASSWORD})
if(error||!l?.session){console.log('LOGIN FAIL',error?.message);process.exit(1)}
const role=JSON.parse(Buffer.from(l.session.access_token.split('.')[1],'base64').toString()).role
console.log('LOGIN ok role='+role+' user='+l.user.email)
const uniq=r=>[...new Set((r||[]).map(x=>x.client_id))]
for(const t of ['pos_orders','pos_cierres','pos_turnos','pos_menu_items']){
  const q=await c.from(t).select('client_id')
  console.log(`${t}: n=${q.data?.length??0} tenants=${JSON.stringify(uniq(q.data))} err=${q.error?.message||'none'}`)
}
// cross-tenant read must be 0
const x1=await c.from('pos_orders').select('id').eq('client_id','amalay')
const x2=await c.from('pos_orders').select('id').eq('client_id','demo')
console.log(`CROSS amalay orders=${x1.data?.length??0} | CROSS demo orders=${x2.data?.length??0} (want 0/0)`)
// cross-tenant write must be blocked
const w=await c.from('pos_orders').insert({id:'nomada-attack',client_id:'demo',status:'abierta',turno_id:'t-x'}).select()
console.log(`CROSS-INSERT into demo: rows=${w.data?.length??0} err=${w.error?.message||'none'} (want blocked)`)
process.exit(0)
