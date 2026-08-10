import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const URL='https://jkcnxfbbuyyfhwfjizgw.supabase.co'
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY254ZmJidXl5Zmh3Zmppemd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTM4NDUsImV4cCI6MjEwMDc4OTg0NX0.knHVqpjSG_IY0aqrYp7mU-FQD6frWn5xpSlzH5xOjws'
const TOKFILE='/private/tmp/claude-501/-Users-danielrg-fullsite/18e45e76-a1a1-4f29-a489-12f522067032/scratchpad/bug019_stg/refreshA.txt'
const opts={auth:{persistSession:false,autoRefreshToken:false}}
const mk=()=>createClient(URL,ANON,opts)
const roleOf=(jwt)=>{try{return JSON.parse(Buffer.from(jwt.split('.')[1],'base64').toString()).role}catch{return null}}
const mode=process.argv[2]

if(mode==='login'){
  const out={}
  const a=mk()
  const {data:la,error:ea}=await a.auth.signInWithPassword({email:'user_a@stg.local',password:'StgPass123!'})
  out.loginA_ok=!!la?.session && !ea
  out.loginA_role=roleOf(la?.session?.access_token||'')
  const qa=await a.from('pos_orders').select('client_id')
  out.A_rows=qa.data?.length??null; out.A_clientids=[...new Set((qa.data||[]).map(r=>r.client_id))]; out.A_err=qa.error?.message||null

  const b=mk()
  const {data:lb}=await b.auth.signInWithPassword({email:'user_b@stg.local',password:'StgPass123!'})
  const qb=await b.from('pos_orders').select('client_id')
  out.B_rows=qb.data?.length??null; out.B_clientids=[...new Set((qb.data||[]).map(r=>r.client_id))]

  // anon (no session)
  const an=mk()
  const qan=await an.from('pos_orders').select('client_id')
  out.anon_rows=qan.data?.length??null; out.anon_err=qan.error?.message||null

  // fresh refresh (still a member) -> new token, still authenticated, still scoped (no silent anon fallback)
  const {data:ra,error:rea}=await a.auth.refreshSession()
  out.refresh_ok=!!ra?.session && !rea
  out.refresh_role=roleOf(ra?.session?.access_token||'')
  out.refresh_token_changed = ra?.session?.access_token && la?.session?.access_token && ra.session.access_token!==la.session.access_token
  const qa2=await a.from('pos_orders').select('client_id')
  out.A_after_refresh_rows=qa2.data?.length??null; out.A_after_refresh_clientids=[...new Set((qa2.data||[]).map(r=>r.client_id))]

  fs.writeFileSync(TOKFILE, ra?.session?.refresh_token||la?.session?.refresh_token||'')
  console.log(JSON.stringify(out))
}

if(mode==='refresh'){
  const out={}
  const rt=fs.readFileSync(TOKFILE,'utf8').trim()
  const a=mk()
  const {data,error}=await a.auth.refreshSession({refresh_token:rt})
  out.refresh_after_revoke_ok=!!data?.session && !error
  out.refreshed_role=roleOf(data?.session?.access_token||'')   // expect 'authenticated' (NOT silently 'anon')
  const q=await a.from('pos_orders').select('client_id')
  out.rows_after_revoke=q.data?.length??null                    // expect 0 (membership gone -> user_has_client_access false)
  out.clientids_after_revoke=[...new Set((q.data||[]).map(r=>r.client_id))]
  out.err=q.error?.message||null
  console.log(JSON.stringify(out))
}
