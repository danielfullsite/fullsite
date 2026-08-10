// BUG-019 · Suite full-stack sobre el STACK LOCAL OFICIAL: Auth/JWT/PostgREST reales, 2 tenants.
// Firma a los 2 usuarios en GoTrue (JWT real) y ejerce las policies vía PostgREST real.
const API = process.env.API_URL, ANON = process.env.ANON, SERVICE = process.env.SERVICE
const REST = `${API}/rest/v1`
let pass = 0, fail = 0
const ok = (n, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${n}${extra ? '  — ' + extra : ''}`); cond ? pass++ : fail++ }

async function signIn(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!2345' }),
  })
  const b = await r.json()
  if (!b.access_token) throw new Error(`signIn ${email} failed: ${JSON.stringify(b)}`)
  return b.access_token
}
// PostgREST helpers per auth context
const hdr = (jwt, key = ANON) => ({ apikey: key, Authorization: `Bearer ${jwt}` })
async function get(path, jwt, key) {
  const r = await fetch(`${REST}/${path}`, { headers: hdr(jwt, key) })
  const body = await r.json().catch(() => null)
  return { status: r.status, body }
}
async function post(path, jwt, row, key, prefer) {
  const h = { ...hdr(jwt, key), 'Content-Type': 'application/json' }
  if (prefer) h.Prefer = prefer
  const r = await fetch(`${REST}/${path}`, { method: 'POST', headers: h, body: JSON.stringify(row) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function patch(path, jwt, row, key) {
  const r = await fetch(`${REST}/${path}`, { method: 'PATCH', headers: { ...hdr(jwt, key), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const rows = (x) => Array.isArray(x.body) ? x.body : []

const A = await signIn('a@amalay.test')   // tenant amalay
const B = await signIn('b@nomada.test')   // tenant nomada

// ── 1. Aislamiento: A ve solo lo suyo ──
{ const r = await get('pos_orders?select=client_id', A); ok('01 A-orders-own (2 amalay)', rows(r).length === 2 && rows(r).every(x => x.client_id === 'amalay'), `n=${rows(r).length}`) }
// ── 2. Cross-tenant read = 0 ──
{ const r = await get('pos_orders?client_id=eq.nomada&select=id', A); ok('02 A-orders-cross (0)', rows(r).length === 0) }
// ── 3. Cross-tenant INSERT denegado ──
{ const r = await post('pos_orders', A, { id: 'x-cross', client_id: 'nomada', status: 'abierta', turno_id: 't-nomada' }, ANON, 'return=representation'); ok('03 A-insert-cross denegado', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }
// ── 4. Hijas vía padre (§7b): A ve 1; A no puede insertar bajo padre de B ──
{ const r = await get('pos_purchase_order_items?select=id', A); ok('04a A-child-own (1)', rows(r).length === 1, `n=${rows(r).length}`) }
{ const r = await post('pos_purchase_order_items', A, { order_id: 2, ingrediente: 'robo', cantidad: 1 }, ANON, 'return=representation'); ok('04b A-child-insert-cross denegado', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }
// ── 5. anon: sin acceso a tablas tenant ──
{ const r = await get('pos_orders?select=id', ANON, ANON); ok('05 anon-orders denegado', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }
// ── 6. service_role: ve los 4 ──
{ const r = await get('pos_orders?select=id', SERVICE, SERVICE); ok('06 svc-sees-all (4)', rows(r).length === 4, `n=${rows(r).length}`) }
// ── 9. Procedencia del turno ──
{ const r = await post('pos_orders', SERVICE, { id: 'normal-null', client_id: 'amalay', status: 'abierta' }, SERVICE, 'return=representation'); ok('09a normal null-turno rechazado (CHECK)', r.status >= 400, `status=${r.status}`) }
{ const r = await post('pos_orders', A, { id: 'qr-forged', client_id: 'amalay', status: 'abierta' }, ANON, 'return=representation'); ok('09b QR forjada por authenticated rechazada (RLS)', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }
{ const r = await post('pos_orders', SERVICE, { id: 'qr-real', client_id: 'amalay', status: 'abierta', total: 116 }, SERVICE, 'return=representation'); ok('09c borrador QR auténtico permitido (svc)', r.status < 300 && rows(r).length === 1, `status=${r.status}`) }
// ── 10. Adopción del staff / enviar sin turno ──
{ const r = await patch("pos_orders?id=eq.qr-real", SERVICE, { status: 'enviada' }, SERVICE); ok('10a enviar SIN turno rechazado (CHECK)', r.status >= 400, `status=${r.status}`) }
{ const r = await patch("pos_orders?id=eq.qr-real", SERVICE, { status: 'enviada', turno_id: 't-amalay' }, SERVICE); ok('10b aceptación asigna turno + transiciona', r.status < 300 && rows(r)[0]?.turno_id === 't-amalay' && rows(r)[0]?.status === 'enviada', `status=${r.status}`) }
// ── 11. Replay exactly-once: mismo id, ignore-duplicates → no dup, no sobrescribe ──
{ await post('pos_orders', SERVICE, { id: 'qr-real', client_id: 'amalay', status: 'abierta', total: 999 }, SERVICE, 'resolution=ignore-duplicates,return=minimal')
  const r = await get('pos_orders?id=eq.qr-real&select=status,total', SERVICE, SERVICE)
  ok('11 replay no duplica ni sobrescribe', rows(r).length === 1 && rows(r)[0].status === 'enviada', `n=${rows(r).length} status=${rows(r)[0]?.status}`) }
// ── 12. Legacy §7a wansoft_daily: authenticated read-only, anon denegado, insert denegado ──
{ const r = await get('wansoft_daily?select=fecha', A); ok('12a A lee wansoft_daily (read-only)', rows(r).length === 1, `n=${rows(r).length}`) }
{ const r = await get('wansoft_daily?select=fecha', ANON, ANON); ok('12b anon wansoft_daily denegado', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }
{ const r = await post('wansoft_daily', A, { fecha: '2026-01-01', ventas_dia: 1 }, ANON, 'return=representation'); ok('12c A insert wansoft_daily denegado', r.status >= 400 || rows(r).length === 0, `status=${r.status}`) }

console.log(`\n---- ${pass} PASS / ${fail} FAIL ----`)
process.exit(fail === 0 ? 0 : 1)
