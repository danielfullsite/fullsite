// Client #2 (lacosta) — real GoTrue login + tenant isolation over PostgREST with the authenticated JWT.
import { createClient } from '@supabase/supabase-js'
const URL = 'https://jkcnxfbbuyyfhwfjizgw.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprY254ZmJidXl5Zmh3Zmppemd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMTM4NDUsImV4cCI6MjEwMDc4OTg0NX0.knHVqpjSG_IY0aqrYp7mU-FQD6frWn5xpSlzH5xOjws'
const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: login, error } = await c.auth.signInWithPassword({ email: 'owner@lacosta.sandbox', password: 'Costa#Verde2026' })
if (error || !login?.session) { console.log('LOGIN FAIL:', error?.message); process.exit(1) }
const role = JSON.parse(Buffer.from(login.session.access_token.split('.')[1], 'base64').toString()).role
console.log(`LOGIN ok — user=${login.user.email} role=${role}`)

const uniq = (rows) => [...new Set((rows || []).map(r => r.client_id))]
const menu = await c.from('pos_menu_items').select('client_id')
console.log(`menu_items visible: n=${menu.data?.length ?? 0} clientids=${JSON.stringify(uniq(menu.data))} err=${menu.error?.message || 'none'}`)
const mesas = await c.from('pos_mesas').select('client_id')
console.log(`mesas visible: n=${mesas.data?.length ?? 0} clientids=${JSON.stringify(uniq(mesas.data))}`)
const orders = await c.from('pos_orders').select('client_id')
console.log(`orders visible: n=${orders.data?.length ?? 0} clientids=${JSON.stringify(uniq(orders.data))}`)

const turnos = await c.from('pos_turnos').select('id')
const cierres = await c.from('pos_cierres').select('id')
console.log(`turnos visible: n=${turnos.data?.length ?? 0}; cierres visible: n=${cierres.data?.length ?? 0}`)

// Explicit cross-tenant probes (must be 0)
const crossV = await c.from('pos_menu_items').select('id').eq('client_id', 'vantara')
const crossD = await c.from('pos_orders').select('id').eq('client_id', 'demo')
console.log(`CROSS vantara menu n=${crossV.data?.length ?? 0} (want 0); CROSS demo orders n=${crossD.data?.length ?? 0} (want 0)`)

// Cross-tenant WRITE probe: try to insert an order into 'demo' (must be blocked by RLS)
const crossIns = await c.from('pos_orders').insert({ id: 'lacosta-attack-1', client_id: 'demo', status: 'abierta', turno_id: 't-x' }).select()
console.log(`CROSS-INSERT into demo: rows=${crossIns.data?.length ?? 0} err=${crossIns.error?.message || 'none'} (want blocked)`)

const onlyLacosta = uniq(menu.data).every(x => x === 'lacosta') && (menu.data?.length ?? 0) > 0
const isolated = (crossV.data?.length ?? 0) === 0 && (crossD.data?.length ?? 0) === 0 && (crossIns.data?.length ?? 0) === 0
console.log(`\nRESULT: login=${!!login.session} own_only=${onlyLacosta} isolated=${isolated}`)
process.exit(login.session && onlyLacosta && isolated ? 0 : 1)
