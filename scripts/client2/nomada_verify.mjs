import { createClient } from '@supabase/supabase-js'
const URL='https://jkcnxfbbuyyfhwfjizgw.supabase.co'
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY254ZmJidXl5Zmh3Zmppemd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTM4NDUsImV4cCI6MjEwMDc4OTg0NX0.knHVqpjSG_IY0aqrYp7mU-FQD6frWn5xpSlzH5xOjws'
const c=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}})
const {data:l,error}=await c.auth.signInWithPassword({email:'owner@nomada.staging',password:'CafeNomada#2026'})
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
