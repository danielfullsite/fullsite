// Create two REAL GoTrue users via the admin API. Prints their UUIDs for seeding.
const API = process.env.API_URL, SERVICE = process.env.SERVICE
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }
const USERS = [
  { key: 'UA', email: 'a@amalay.test', password: 'Passw0rd!2345' },
  { key: 'UB', email: 'b@nomada.test', password: 'Passw0rd!2345' },
]
for (const u of USERS) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
  })
  const body = await res.json()
  if (res.ok && body.id) { console.log(`${u.key}=${body.id}`); continue }
  // Idempotente: si ya existe, búscalo por email en el admin list.
  const list = await fetch(`${API}/auth/v1/admin/users?per_page=200`, { headers: H })
  const lb = await list.json()
  const found = (lb.users || []).find(x => x.email === u.email)
  if (found?.id) { console.log(`${u.key}=${found.id}`); continue }
  console.error(`FAIL create ${u.email}:`, res.status, JSON.stringify(body)); process.exit(1)
}
