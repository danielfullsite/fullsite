// CONTENCIÓN PR5 · TENANT_AND_ROLE_ENFORCEMENT (auditoría 2026-09-23)
//
// Pruebas cruzadas con DOS restaurantes sintéticos (tenant-a, tenant-b). Todo es
// inventado y `fetch` está simulado con una mini-PostgREST en memoria: nada sale a
// la red. Cubre:
//   F-06  Mission Control / ROI sólo para admin de plataforma (servidor, no menú)
//   F-03  import: un id externo nunca sobrescribe otro restaurante
//   F-05  act-as: caducidad, tenant explícito, revocación y auditoría de escrituras
//   F-04  flags: toggle sin rollout conserva la cohorte; el copiloto dice el alcance real
//   F-09  /api/labor exige gerente o superior
//   V-C03 (parcial) refund de /api/mp-point exige gerente o superior
// Cada bloque trae su control positivo: el camino legítimo sigue funcionando.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fixture.local'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-fixture'
  process.env.SUPABASE_SERVICE_KEY = 'svc-fixture'
  process.env.SHIFT_TOKEN_SECRET = 'fixture-secret-0123456789abcdef0123456789abcdef'
  process.env.MP_ACCESS_TOKEN = 'mp-fixture'
  process.env.BACKUP_ADMIN_EMAILS = 'admin@fixture.test,admin2@fixture.test'
})

import { issueShiftToken } from '@/lib/shift-token'
import { withPOSAuth } from '@/lib/api-auth'

// ── Mini-PostgREST en memoria ────────────────────────────────────────────────
type Row = Record<string, unknown>
const PK: Record<string, string> = { feature_flags: 'key' }
let db: Record<string, Row[]> = {}
let calls: { method: string; url: string; body?: unknown }[] = []
const fail = { audit: false, flagsRead: false, lookup: false, auth: false }

const USERS: Record<string, { id: string; email: string; role: string }> = {
  'jwt-dueno-a': { id: '00000000-0000-4000-8000-00000000000a', email: 'dueno-a@fixture.test', role: 'dueño' },
  'jwt-gerente-a': { id: '00000000-0000-4000-8000-00000000000b', email: 'gerente-a@fixture.test', role: 'gerente' },
  'jwt-admin': { id: '00000000-0000-4000-8000-0000000000ad', email: 'admin@fixture.test', role: 'dueño' },
  'jwt-admin2': { id: '00000000-0000-4000-8000-0000000000a2', email: 'admin2@fixture.test', role: 'dueño' },
}
const ADMIN_IDS = new Set([USERS['jwt-admin'].id, USERS['jwt-admin2'].id])
const U = (t: string) => USERS[t].id

function minutesAgo(m: number): string { return new Date(Date.now() - m * 60_000).toISOString() }

function matches(row: Row, sp: URLSearchParams): boolean {
  for (const [col, raw] of sp.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(col)) continue
    const v = String(row[col] ?? '')
    if (raw.startsWith('eq.')) { if (v !== raw.slice(3)) return false }
    else if (raw.startsWith('neq.')) { if (v === raw.slice(4)) return false }
    else if (raw.startsWith('in.(')) {
      const list = raw.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, ''))
      if (!list.includes(v)) return false
    } else if (raw.startsWith('gte.')) { if (v < raw.slice(4)) return false }
  }
  return true
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input))
  const method = (init.method || 'GET').toUpperCase()
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ method, url: url.toString(), body })
  const hdr = new Headers(init.headers)

  if (url.hostname.includes('mercadopago')) return json({ id: 'refund-fixture-1' }, 201)

  if (url.pathname === '/auth/v1/user') {
    if (fail.auth) throw new TypeError('Failed to fetch')
    const tok = (hdr.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = USERS[tok]
    if (!u) return json({ msg: 'invalid' }, 401)
    return json({ id: u.id, email: u.email, app_metadata: { role: u.role } })
  }
  if (url.pathname === '/rest/v1/rpc/is_platform_admin') {
    return json(ADMIN_IDS.has(String(body?.p_user_id)))
  }
  if (!url.pathname.startsWith('/rest/v1/')) return json([])
  const table = url.pathname.slice('/rest/v1/'.length)
  const sp = url.searchParams
  const rows = (db[table] ||= [])

  if (method === 'GET') {
    if (table === 'feature_flags' && fail.flagsRead) return json({ message: 'boom' }, 500)
    if (fail.lookup && sp.get('id')?.startsWith('in.')) return json({ message: 'boom' }, 500)
    return json(rows.filter(r => matches(r, sp)))
  }
  if (method === 'DELETE') {
    const gone = rows.filter(r => matches(r, sp))
    db[table] = rows.filter(r => !matches(r, sp))
    return (hdr.get('prefer') || '').includes('return=representation') ? json(gone) : new Response(null, { status: 204 })
  }
  if (method === 'POST') {
    if (table === 'platform_audit_log' && fail.audit) return json({ message: 'audit down' }, 500)
    const list: Row[] = Array.isArray(body) ? body : [body]
    const merge = (hdr.get('prefer') || '').includes('merge-duplicates')
    const pk = sp.get('on_conflict') || PK[table] || 'id'
    for (const r of list) {
      const existing = merge ? rows.find(x => x[pk] === r[pk]) : undefined
      if (existing) Object.assign(existing, r)
      else rows.push({ created_at: new Date().toISOString(), ...r })
    }
    return new Response(null, { status: 201 })
  }
  return json([])
}

function seed() {
  db = {
    client_users: [
      { user_id: U('jwt-dueno-a'), client_id: 'tenant-a', role: 'dueño', created_at: minutesAgo(99999) },
      { user_id: U('jwt-gerente-a'), client_id: 'tenant-a', role: 'gerente', created_at: minutesAgo(99999) },
      { user_id: U('jwt-admin'), client_id: 'tenant-a', role: 'dueño', created_at: minutesAgo(99999) },
    ],
    clients: [{ id: 'tenant-a', display_name: 'Tenant A' }, { id: 'tenant-b', display_name: 'Tenant B' }, { id: 'tenant', display_name: 'Tenant' }],
    pos_menu_items: [
      { id: 'tenant-a-latte', client_id: 'tenant-a', name: 'Latte', price: 60 },
      { id: 'tenant-b-cafe', client_id: 'tenant-b', name: 'Cafe', price: 30 },
      { id: 'tenant-b-legacy-9', client_id: 'tenant-a', name: 'Legado', price: 10 },
    ],
    feature_flags: [
      { key: 'beta-cohorte', enabled: false, rollout: { client_ids: ['tenant-a'] } },
      { key: 'beta-global', enabled: true, rollout: {} },
    ],
    platform_audit_log: [],
    pos_staff: [
      { id: 'st-1', client_id: 'tenant-a', name: 'Mesero Uno', role: 'mesero', pin: '1111', hourly_rate: 55, weekly_salary: 2640 },
      { id: 'st-2', client_id: 'tenant-a', name: 'Gerente Dos', role: 'gerente', pin: '2222', hourly_rate: 120, weekly_salary: 5760 },
    ],
    agent_runs: [{ id: 1, agent_id: 'anomaly-detector', status: 'ok', output_summary: 'ok', created_at: minutesAgo(5) }],
  }
}

beforeEach(() => {
  seed()
  calls = []
  fail.audit = fail.flagsRead = fail.lookup = fail.auth = false
  delete process.env.ACTAS_TTL_MINUTES
  delete process.env.PLATFORM_2FA_ENFORCED
  process.env.SUPABASE_SERVICE_KEY = 'svc-fixture'
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => vi.unstubAllGlobals())

let ipSeq = 0
function req(path: string, opts: { token?: string; cookie?: string; method?: string; body?: unknown; tenant?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.0.0.${++ipSeq % 250}` }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.cookie) headers.cookie = `fs-at=${opts.cookie}`
  if (opts.tenant) headers['x-fullsite-tenant'] = opts.tenant
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return new NextRequest(`https://app.fullsite.mx${path}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}
const shift = (role: string, tenant = 'tenant-a') => issueShiftToken(`staff-${role}`, tenant, role, `${role} ficticio`)
const isNext = (r: Response) => r.headers.get('x-middleware-next') === '1'
const auditRows = () => db.platform_audit_log as Row[]

// ─────────────────────────────────────────────────────────────────────────────
describe('F-06 · Mission Control y ROI sólo para admin de plataforma (servidor)', () => {
  it('dueño y gerente de tenant-a → el proxy NO sirve /mission-control ni /roi', async () => {
    const { proxy } = await import('@/proxy')
    for (const tok of ['jwt-dueno-a', 'jwt-gerente-a']) {
      for (const path of ['/mission-control', '/roi']) {
        const res = await proxy(req(path, { cookie: tok }))
        expect(isNext(res), `${tok} en ${path}`).toBe(false)
        expect(res.status).toBe(307)
        expect(new URL(res.headers.get('location')!).pathname).not.toBe(path)
      }
    }
  })

  it('control: admin de plataforma SÍ entra; dueño sigue entrando a sus páginas', async () => {
    const { proxy } = await import('@/proxy')
    expect(isNext(await proxy(req('/mission-control', { cookie: 'jwt-admin' })))).toBe(true)
    expect(isNext(await proxy(req('/roi', { cookie: 'jwt-admin' })))).toBe(true)
    expect(isNext(await proxy(req('/', { cookie: 'jwt-dueno-a' })))).toBe(true)
    expect(isNext(await proxy(req('/ventas', { cookie: 'jwt-dueno-a' })))).toBe(true)
    expect(isNext(await proxy(req('/estado-resultados', { cookie: 'jwt-dueno-a' })))).toBe(true)
    expect(isNext(await proxy(req('/ventas', { cookie: 'jwt-gerente-a' })))).toBe(true)
  })

  it('falla cerrado: sin poder verificar (Supabase caído o sin service key) no se sirve la página de plataforma', async () => {
    const { proxy } = await import('@/proxy')
    fail.auth = true
    expect(isNext(await proxy(req('/mission-control', { cookie: 'jwt-admin' })))).toBe(false)
    // el resto del dashboard conserva su comportamiento de siempre (fail-open)
    expect(isNext(await proxy(req('/ventas', { cookie: 'jwt-dueno-a' })))).toBe(true)
    fail.auth = false
    delete process.env.SUPABASE_SERVICE_KEY
    expect(isNext(await proxy(req('/roi', { cookie: 'jwt-admin' })))).toBe(false)
  })

  it('la lectura de agent_runs pasa por una ruta de servidor gateada por admin de plataforma', async () => {
    const mod = await import('@/app/mission-control/telemetria/route')
    // POST y no GET: public/sw.js cachea todo GET fuera de /api (stale-while-revalidate)
    expect((mod as Record<string, unknown>).GET).toBeUndefined()
    const { POST } = mod
    const t = (cookie?: string) => POST(req('/mission-control/telemetria', { cookie, body: { limit: 50 } }))
    expect((await t('jwt-dueno-a')).status).toBe(403)
    expect((await t('jwt-gerente-a')).status).toBe(403)
    expect((await t()).status).toBe(401)
    const ok = await t('jwt-admin')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    const j = await ok.json()
    expect(j.runs).toHaveLength(1)
    delete process.env.SUPABASE_SERVICE_KEY
    expect((await t('jwt-admin')).status).toBe(503)
  })

  it('las páginas ya no leen agent_runs directo de PostgREST con el JWT del usuario', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/app/mission-control/page.tsx', 'src/app/roi/page.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/getDeepTable\(\s*['"]agent_runs['"]/)
      expect(src, f).toContain('/mission-control/telemetria')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('F-03 · import: un id externo nunca sobrescribe otro restaurante', () => {
  const imp = async (client_id: string, rows: Row[], mode: 'commit' | 'validate' = 'commit') => {
    const { POST } = await import('@/app/api/platform/import/route')
    return POST(req('/api/platform/import', { cookie: 'jwt-admin', body: { client_id, dataset: 'menu', mode, rows } }))
  }
  const menu = () => db.pos_menu_items as Row[]

  it('fila exportada de A (id tenant-a-latte) importada en B → id regenerado con prefijo de B; A intacta', async () => {
    const res = await imp('tenant-b', [{ id: 'tenant-a-latte', name: 'Latte', price: '65' }])
    expect(res.status).toBe(200)
    const a = menu().find(r => r.id === 'tenant-a-latte')!
    expect(a.client_id).toBe('tenant-a')
    expect(a.price).toBe(60)
    const b = menu().find(r => r.client_id === 'tenant-b' && r.name === 'Latte')!
    expect(b.id).toBe('tenant-b-latte')
  })

  it('id con prefijo de B que ya existe con client_id de A → 409 con detalle, sin escribir nada', async () => {
    const before = JSON.stringify(menu())
    const res = await imp('tenant-b', [{ id: 'tenant-b-legacy-9', name: 'Legado', price: '99' }, { name: 'Nuevo', price: '5' }])
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(JSON.stringify(j)).toContain('tenant-b-legacy-9')
    expect(JSON.stringify(menu())).toBe(before)
    expect(calls.some(c => c.method === 'POST' && c.url.includes('/pos_menu_items'))).toBe(false)
  })

  it('prefijo ambiguo (tenant vs tenant-b): el id de otro restaurante con prefijo compatible → 409', async () => {
    const res = await imp('tenant', [{ id: 'tenant-b-cafe', name: 'Cafe', price: '1' }])
    expect(res.status).toBe(409)
    expect(menu().find(r => r.id === 'tenant-b-cafe')!.client_id).toBe('tenant-b')
  })

  it('validate reporta el conflicto sin escribir', async () => {
    const res = await imp('tenant-b', [{ id: 'tenant-b-legacy-9', name: 'Legado', price: '99' }], 'validate')
    const j = await res.json()
    expect(JSON.stringify(j)).toContain('tenant-b-legacy-9')
    expect(calls.some(c => c.method === 'POST' && c.url.includes('/pos_menu_items'))).toBe(false)
  })

  it('falla cerrado: si no se puede verificar la propiedad de los ids, no escribe', async () => {
    fail.lookup = true
    const res = await imp('tenant-b', [{ name: 'Nuevo', price: '5' }])
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(menu().some(r => r.name === 'Nuevo')).toBe(false)
  })

  it('control: B re-importa SU propio id → actualiza; fila sin id → id generado', async () => {
    const res = await imp('tenant-b', [{ id: 'tenant-b-cafe', name: 'Cafe', price: '35' }, { name: 'Te Verde', price: '40' }])
    expect(res.status).toBe(200)
    expect(menu().find(r => r.id === 'tenant-b-cafe')!.price).toBe(35)
    expect(menu().find(r => r.id === 'tenant-b-te-verde')!.client_id).toBe('tenant-b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('F-05 · act-as: caducidad, tenant explícito, revocación y auditoría', () => {
  const addActas = (userTok: string, tenant: string, ageMin: number) =>
    (db.client_users as Row[]).push({ user_id: U(userTok), client_id: tenant, role: 'platform_actas', created_at: minutesAgo(ageMin) })

  it('membresía act-as vigente con tenant explícito → dueño de tenant-b (control)', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    const ctx = await withPOSAuth(req('/api/owner/staff', { token: 'jwt-admin', tenant: 'tenant-b' }))
    expect(ctx?.clientId).toBe('tenant-b')
    expect(ctx?.role).toBe('dueño')
  })

  it('membresía act-as VENCIDA (default 60 min) → no eleva: null (401)', async () => {
    addActas('jwt-admin', 'tenant-b', 61)
    expect(await withPOSAuth(req('/api/owner/staff', { token: 'jwt-admin', tenant: 'tenant-b' }))).toBeNull()
    const { GET } = await import('@/app/api/labor/route')
    expect((await GET(req('/api/labor', { token: 'jwt-admin', tenant: 'tenant-b' }))).status).toBe(401)
  })

  it('ACTAS_TTL_MINUTES acorta la ventana; sin created_at se trata como vencida', async () => {
    process.env.ACTAS_TTL_MINUTES = '10'
    addActas('jwt-admin', 'tenant-b', 30)
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin', tenant: 'tenant-b' }))).toBeNull()
    delete process.env.ACTAS_TTL_MINUTES
    ;(db.client_users as Row[]).push({ user_id: U('jwt-admin2'), client_id: 'tenant-b', role: 'platform_actas' })
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin2', tenant: 'tenant-b' }))).toBeNull()
  })

  it('act-as exige tenant EXPLÍCITO: sin x-fullsite-tenant la membresía act-as nunca se usa', async () => {
    addActas('jwt-admin2', 'tenant-b', 5)
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin2' }))).toBeNull()
  })

  it('escritura (POST) en act-as → registro de auditoría con actor real, tenant, método y ruta', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    const ctx = await withPOSAuth(req('/api/owner/staff', { token: 'jwt-admin', tenant: 'tenant-b', method: 'POST', body: {} }))
    expect(ctx?.clientId).toBe('tenant-b')
    const a = auditRows().find(r => r.action === 'actas.request')!
    expect(a).toBeDefined()
    expect(a.actor_user_id).toBe(U('jwt-admin'))
    expect(a.target_tenant).toBe('tenant-b')
    expect(JSON.stringify(a.detail)).toContain('POST')
    expect(JSON.stringify(a.detail)).toContain('/api/owner/staff')
  })

  it('falla cerrado: si la auditoría de una escritura en act-as falla → null (401)', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    fail.audit = true
    expect(await withPOSAuth(req('/api/owner/staff', { token: 'jwt-admin', tenant: 'tenant-b', method: 'DELETE' }))).toBeNull()
  })

  it('control: GET en act-as no audita; el dueño real no audita ni en escrituras', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin', tenant: 'tenant-b' }))).not.toBeNull()
    const d = await withPOSAuth(req('/x', { token: 'jwt-dueno-a', method: 'POST', body: {} }))
    expect(d?.clientId).toBe('tenant-a')
    expect(auditRows()).toHaveLength(0)
  })

  it('revocación por OTRO admin de plataforma: elimina la membresía y queda auditada con el tenant', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    const { POST } = await import('@/app/api/platform/act-as/route')
    const res = await POST(req('/api/platform/act-as', { cookie: 'jwt-admin2', body: { revoke_user_id: U('jwt-admin') } }))
    expect(res.status).toBe(200)
    expect((db.client_users as Row[]).some(r => r.role === 'platform_actas')).toBe(false)
    const a = auditRows().find(r => r.action === 'actas.revoke')!
    expect(a.actor_user_id).toBe(U('jwt-admin2'))
    expect(a.target_tenant).toBe('tenant-b')
    expect(JSON.stringify(a.detail)).toContain(U('jwt-admin'))
  })

  it('revoke_all elimina todas las membresías act-as (auditado); un dueño no puede revocar (403)', async () => {
    addActas('jwt-admin', 'tenant-b', 5)
    addActas('jwt-admin2', 'tenant', 5)
    const { POST } = await import('@/app/api/platform/act-as/route')
    expect((await POST(req('/api/platform/act-as', { cookie: 'jwt-dueno-a', body: { revoke_all: true } }))).status).toBe(403)
    expect((db.client_users as Row[]).filter(r => r.role === 'platform_actas')).toHaveLength(2)
    const res = await POST(req('/api/platform/act-as', { cookie: 'jwt-admin', body: { revoke_all: true } }))
    expect(res.status).toBe(200)
    expect((db.client_users as Row[]).filter(r => r.role === 'platform_actas')).toHaveLength(0)
    expect(auditRows().some(r => r.action === 'actas.revoke')).toBe(true)
    expect((await POST(req('/api/platform/act-as', { cookie: 'jwt-admin', body: { revoke_user_id: 'no-es-uuid' } }))).status).toBe(400)
  })

  it('control: enter/exit siguen funcionando y ambos auditan el tenant', async () => {
    const { POST } = await import('@/app/api/platform/act-as/route')
    const enter = await POST(req('/api/platform/act-as', { cookie: 'jwt-admin2', body: { client_id: 'tenant-b' } }))
    expect(enter.status).toBe(200)
    expect((db.client_users as Row[]).some(r => r.user_id === U('jwt-admin2') && r.role === 'platform_actas' && r.client_id === 'tenant-b')).toBe(true)
    const exit = await POST(req('/api/platform/act-as', { cookie: 'jwt-admin2', body: { exit: true } }))
    expect(exit.status).toBe(200)
    expect((db.client_users as Row[]).some(r => r.role === 'platform_actas')).toBe(false)
    expect(auditRows().find(r => r.action === 'actas.enter')!.target_tenant).toBe('tenant-b')
    expect(auditRows().find(r => r.action === 'actas.exit')!.target_tenant).toBe('tenant-b')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('F-04 · flags: sin rollout se conserva la cohorte', () => {
  const flag = (k: string) => (db.feature_flags as Row[]).find(r => r.key === k)!

  it('toggle del copiloto ({key,enabled}) conserva client_ids previos', async () => {
    const { ACTION_TOOLS } = await import('@/lib/copilot')
    const body = ACTION_TOOLS.toggle_flag.buildBody({ key: 'beta-cohorte', enabled: true })
    expect(body).not.toHaveProperty('rollout')
    const { POST } = await import('@/app/api/platform/flags/route')
    const res = await POST(req('/api/platform/flags', { cookie: 'jwt-admin', body }))
    expect(res.status).toBe(200)
    expect(flag('beta-cohorte').enabled).toBe(true)
    expect(flag('beta-cohorte').rollout).toEqual({ client_ids: ['tenant-a'] })
    const a = auditRows().find(r => r.action === 'flag.update')!
    expect(a.scope).toBe('tenant')
    expect(a.affected_count).toBe(1)
  })

  it('el texto de confirmación del copiloto muestra el alcance real (cohorte o todos)', async () => {
    const { describeAction } = await import('@/lib/copilot')
    const cohort = await describeAction('toggle_flag', { key: 'beta-cohorte', enabled: true })
    expect(cohort).toContain('tenant-a')
    expect(cohort).not.toContain('(global)')
    const global = await describeAction('toggle_flag', { key: 'beta-global', enabled: false })
    expect(global.toLowerCase()).toContain('todos')
  })

  it('falla cerrado: sin poder leer el rollout actual no se sobrescribe', async () => {
    fail.flagsRead = true
    const { POST } = await import('@/app/api/platform/flags/route')
    const res = await POST(req('/api/platform/flags', { cookie: 'jwt-admin', body: { key: 'beta-cohorte', enabled: true } }))
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(flag('beta-cohorte').enabled).toBe(false)
  })

  it('control: rollout explícito (desde /platform/flags) sigue reemplazando; flag nuevo sin rollout → {}', async () => {
    const { POST } = await import('@/app/api/platform/flags/route')
    await POST(req('/api/platform/flags', { cookie: 'jwt-admin', body: { key: 'beta-cohorte', enabled: true, rollout: { cohort: 'all' } } }))
    expect(flag('beta-cohorte').rollout).toEqual({ cohort: 'all' })
    await POST(req('/api/platform/flags', { cookie: 'jwt-admin', body: { key: 'flag-nuevo', enabled: true } }))
    expect(flag('flag-nuevo').rollout).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('F-09 · /api/labor exige gerente o superior', () => {
  it('mesero, cajero y capitán → 403 (y no se consultan sueldos)', async () => {
    const { GET } = await import('@/app/api/labor/route')
    for (const role of ['mesero', 'cajero', 'capitan']) {
      calls = []
      const res = await GET(req('/api/labor', { token: await shift(role) }))
      expect(res.status, role).toBe(403)
      expect(calls.some(c => c.url.includes('/pos_staff?'))).toBe(false)
    }
  })

  it('control: gerente (shift token), dueño y gerente (sesión) → 200', async () => {
    const { GET } = await import('@/app/api/labor/route')
    expect((await GET(req('/api/labor', { token: await shift('gerente') }))).status).toBe(200)
    expect((await GET(req('/api/labor', { token: 'jwt-dueno-a' }))).status).toBe(200)
    expect((await GET(req('/api/labor', { token: 'jwt-gerente-a' }))).status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('V-C03 parcial · refund de /api/mp-point exige gerente o superior', () => {
  const mp = async (token: string, body: Row) => {
    const { POST } = await import('@/app/api/mp-point/route')
    return POST(req('/api/mp-point', { token, body }))
  }

  it('cajero y mesero → 403 y NO se llama a Mercado Pago', async () => {
    for (const role of ['cajero', 'mesero']) {
      calls = []
      const res = await mp(await shift(role), { action: 'refund', paymentId: 'pay-fixture-1' })
      expect(res.status, role).toBe(403)
      expect(calls.some(c => c.url.includes('mercadopago'))).toBe(false)
    }
  })

  it('control: gerente sí reembolsa; cajero sigue cobrando (action=payment)', async () => {
    const r = await mp(await shift('gerente'), { action: 'refund', paymentId: 'pay-fixture-1' })
    expect(r.status).toBe(200)
    expect((await r.json()).success).toBe(true)
    const p = await mp(await shift('cajero'), { action: 'payment', deviceId: 'dev-fixture', amount: 100 })
    expect(p.status).toBe(200)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Revisión adversarial PR5-REVIEW.md (H1–H8)
// ═════════════════════════════════════════════════════════════════════════════
describe('H1 · F-09 por el proxy genérico: sueldos sólo para gerencia', () => {
  const viaDb = async (token: string, path: string) => {
    const { GET } = await import('@/app/api/pos/db/route')
    return GET(req(`/api/pos/db?path=${encodeURIComponent(path)}`, { token }))
  }
  const viaCatchAll = async (token: string, qs: string) => {
    const { GET } = await import('@/app/api/pos/db/[...path]/route')
    return GET(req(`/api/pos/db/rest/v1/pos_staff?${qs}`, { token }), { params: Promise.resolve({ path: ['rest', 'v1', 'pos_staff'] }) })
  }
  const sinSueldo = (t: string) => !/hourly_rate|weekly_salary/.test(t)

  it('mesero, cajero y capitán: select=* sin columnas de sueldo (ni PIN) en ambos proxies', async () => {
    for (const role of ['mesero', 'cajero', 'capitan']) {
      const tok = await shift(role)
      const a = await viaDb(tok, 'pos_staff?select=*')
      expect(a.status, role).toBe(200)
      const ta = await a.text()
      expect(sinSueldo(ta), `${role}: ${ta}`).toBe(true)
      expect(ta).toContain('Mesero Uno')
      expect(ta).not.toContain('"pin"')
      const b = await viaCatchAll(tok, 'select=*')
      expect(sinSueldo(await b.text()), role).toBe(true)
    }
  })

  it('mesero: pedir, filtrar u ordenar por sueldo → 403', async () => {
    const tok = await shift('mesero')
    for (const p of ['pos_staff?select=name,hourly_rate,weekly_salary', 'pos_staff?select=name&hourly_rate=gt.100', 'pos_staff?select=name&order=weekly_salary.desc']) {
      expect((await viaDb(tok, p)).status, p).toBe(403)
    }
    expect((await viaCatchAll(tok, 'select=name&hourly_rate=gt.100')).status).toBe(403)
  })

  it('control: gerente ve sueldos y puede filtrarlos', async () => {
    const tok = await shift('gerente')
    const a = await viaDb(tok, 'pos_staff?select=*')
    expect(await a.text()).toContain('hourly_rate')
    expect((await viaDb(tok, 'pos_staff?select=name,hourly_rate&hourly_rate=gt.0')).status).toBe(200)
    expect(await (await viaCatchAll(tok, 'select=*')).text()).toContain('weekly_salary')
  })

  it('la política falla cerrado: sin rol conocido redacta sueldos', async () => {
    const { redactResponse, consultaProxyValida } = await import('@/lib/pos-db-policy')
    const raw = JSON.stringify([{ name: 'x', hourly_rate: 1, weekly_salary: 2, pin: '1' }])
    expect(redactResponse('pos_staff', raw, 'application/json')).toBe(JSON.stringify([{ name: 'x' }]))
    expect(redactResponse('pos_staff', raw, 'application/json', 'gerente')).toBe(JSON.stringify([{ name: 'x', hourly_rate: 1, weekly_salary: 2 }]))
    expect(consultaProxyValida('pos_staff', new URLSearchParams('select=hourly_rate'))).toBe(false)
    expect(consultaProxyValida('pos_staff', new URLSearchParams('select=hourly_rate'), 'dueño')).toBe(true)
  })
})

describe('H3/H4/H5/H8 · act-as endurecido', () => {
  const addActas = (userTok: string, tenant: string, created_at: string) =>
    (db.client_users as Row[]).push({ user_id: U(userTok), client_id: tenant, role: 'platform_actas', created_at })

  it('enter con la auditoría caída → 503 y NO queda membresía', async () => {
    fail.audit = true
    const { POST } = await import('@/app/api/platform/act-as/route')
    const res = await POST(req('/api/platform/act-as', { cookie: 'jwt-admin2', body: { client_id: 'tenant-b' } }))
    expect(res.status).toBe(503)
    expect((db.client_users as Row[]).some(r => r.role === 'platform_actas')).toBe(false)
  })

  it('re-entrar renueva la ventana y queda auditado', async () => {
    addActas('jwt-admin2', 'tenant-b', minutesAgo(55))
    const { POST } = await import('@/app/api/platform/act-as/route')
    expect((await POST(req('/api/platform/act-as', { cookie: 'jwt-admin2', body: { client_id: 'tenant-b' } }))).status).toBe(200)
    const filas = (db.client_users as Row[]).filter(r => r.role === 'platform_actas')
    expect(filas).toHaveLength(1)
    expect(Date.now() - Date.parse(String(filas[0].created_at))).toBeLessThan(5_000)
    expect(auditRows().filter(r => r.action === 'actas.enter')).toHaveLength(1)
  })

  it('created_at en el futuro → vencida', async () => {
    addActas('jwt-admin2', 'tenant-b', new Date(Date.now() + 10 * 60_000).toISOString())
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin2', tenant: 'tenant-b' }))).toBeNull()
  })

  it('ACTAS_TTL_MINUTES tiene tope duro de 240 min', async () => {
    process.env.ACTAS_TTL_MINUTES = '1e12'
    addActas('jwt-admin2', 'tenant-b', minutesAgo(300))
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin2', tenant: 'tenant-b' }))).toBeNull()
    ;(db.client_users as Row[]).pop()
    addActas('jwt-admin2', 'tenant-b', minutesAgo(200))
    expect(await withPOSAuth(req('/x', { token: 'jwt-admin2', tenant: 'tenant-b' }))).not.toBeNull()
  })

  it('GET sensible en act-as (/api/labor, /api/owner/*, /api/pos/db) se audita con su query; si falla la auditoría → 401', async () => {
    addActas('jwt-admin2', 'tenant-b', minutesAgo(5))
    const { GET } = await import('@/app/api/labor/route')
    expect((await GET(req('/api/labor?days=7', { token: 'jwt-admin2', tenant: 'tenant-b' }))).status).toBe(200)
    const a = auditRows().find(r => r.action === 'actas.request')!
    expect(JSON.stringify(a.detail)).toContain('/api/labor')
    expect(JSON.stringify(a.detail)).toContain('days=7')
    fail.audit = true
    expect((await GET(req('/api/labor', { token: 'jwt-admin2', tenant: 'tenant-b' }))).status).toBe(401)
  })

  it('GET que escriben en act-as (OAuth Uber initiate/callback, deepgram-token) → actas.request con actor real; auditoría caída → null (401)', async () => {
    addActas('jwt-admin2', 'tenant-b', minutesAgo(5))
    const rutas = ['/api/integrations/uber-eats/auth/initiate', '/api/integrations/uber-eats/auth/callback?code=c&state=s', '/api/deepgram-token']
    for (const r of rutas) {
      expect(await withPOSAuth(req(r, { token: 'jwt-admin2', tenant: 'tenant-b' })), r).not.toBeNull()
    }
    const regs = auditRows().filter(x => x.action === 'actas.request')
    expect(regs).toHaveLength(3)
    for (const x of regs) {
      expect(x.actor_user_id).toBe(U('jwt-admin2'))
      expect(x.target_tenant).toBe('tenant-b')
      expect(JSON.stringify(x.detail)).toContain('"method":"GET"')
    }
    expect(JSON.stringify(regs.map(x => x.detail))).toContain('/api/integrations/uber-eats/auth/callback')
    fail.audit = true
    for (const r of rutas) {
      expect(await withPOSAuth(req(r, { token: 'jwt-admin2', tenant: 'tenant-b' })), r).toBeNull()
    }
  })

  it('control: GET no sensible en act-as no audita', async () => {
    addActas('jwt-admin2', 'tenant-b', minutesAgo(5))
    expect(await withPOSAuth(req('/api/agents/feedback', { token: 'jwt-admin2', tenant: 'tenant-b' }))).not.toBeNull()
    expect(auditRows()).toHaveLength(0)
  })

  it('/api/backup respeta la caducidad de act-as; la membresía real sigue funcionando', async () => {
    const { GET } = await import('@/app/api/backup/route')
    const bk = (tok: string, cid: string) => GET(req(`/api/backup?client_id=${cid}&table=pos_staff`, { token: tok }))
    addActas('jwt-admin2', 'tenant-b', minutesAgo(90))
    expect((await bk('jwt-admin2', 'tenant-b')).status).toBe(403)
    ;(db.client_users as Row[]).pop()
    addActas('jwt-admin2', 'tenant-b', minutesAgo(5))
    expect((await bk('jwt-admin2', 'tenant-b')).status).toBe(200)
    expect((await bk('jwt-admin', 'tenant-a')).status).toBe(200)
  })
})

describe('H6 · flags: rollout explícito validado', () => {
  const flag = (k: string) => (db.feature_flags as Row[]).find(r => r.key === k)!
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/platform/flags/route')
    return POST(req('/api/platform/flags', { cookie: 'jwt-admin', body }))
  }

  it('rollout {} explícito → 400 sin cambios; client_ids no-arreglo → 400', async () => {
    expect((await post({ key: 'beta-cohorte', enabled: true, rollout: {} })).status).toBe(400)
    expect((await post({ key: 'beta-cohorte', enabled: true, rollout: { client_ids: 'tenant-b' } })).status).toBe(400)
    expect(flag('beta-cohorte')).toMatchObject({ enabled: false, rollout: { client_ids: ['tenant-a'] } })
  })

  it('global exige forma explícita: {mode:"all"} o {cohort:"all"}', async () => {
    expect((await post({ key: 'beta-cohorte', enabled: true, rollout: { mode: 'all' } })).status).toBe(200)
    expect(flag('beta-cohorte').rollout).toEqual({ cohort: 'all' })
    expect((await post({ key: 'beta-global', enabled: true, rollout: { cohort: 'all' } })).status).toBe(200)
  })

  it('cohorte vacía se audita como tenant con 0 afectados', async () => {
    expect((await post({ key: 'beta-cohorte', enabled: true, rollout: { client_ids: [] } })).status).toBe(200)
    const a = auditRows().find(r => r.action === 'flag.update')!
    expect(a.scope).toBe('tenant')
    expect(a.affected_count).toBe(0)
  })

  it('la pantalla /platform/flags: el toggle no manda rollout (se conserva) y "todos" manda {cohort:"all"}', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/app/platform/flags/page.tsx', 'utf8')
    expect(src).toMatch(/postFlag\(next,[^\n]*\{ rollout: false \}\)/)
    expect(src).toContain("{ cohort: 'all' }")
  })
})
