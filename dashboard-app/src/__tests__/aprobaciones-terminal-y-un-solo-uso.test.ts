/**
 * Bloque POS, PR 02 — aprobaciones de gerente: terminal, un solo uso, límites y bitácora.
 *
 * Lo que se cierra, con su forma de ataque:
 *   · Un shiftToken de gerente (8 h) capturado en una terminal aprobaba cancelaciones en
 *     CUALQUIER terminal, las veces que quisiera, toda la noche.
 *   · Teclear el PIN del gerente en la terminal de un mesero le dejaba una SESIÓN de gerente.
 *   · Sin red, el respaldo local aceptaba intentos sin fin; con red lenta, 30–90 s colgado.
 *   · La pantalla decía «PIN incorrecto» cuando la nube no contestó.
 *
 * Todo es offline y sintético: `fetch` interceptado, secretos de relleno, dos restaurantes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const SECRETO = 'secreto-sintetico-de-prueba-de-al-menos-32-caracteres'

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  process.env.SHIFT_TOKEN_SECRET = SECRETO
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-fixture'
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.unstubAllEnvs() })

function decode(t: string) {
  return JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString())
}

// ── A. Tokens ─────────────────────────────────────────────────────────────────
describe('A · el token de aprobación no es una sesión', () => {
  it('lleva propósito, jti, terminal y vive 15 min', async () => {
    const st = await import('@/lib/shift-token')
    const t = await st.issueApprovalToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-A')
    const p = decode(t)
    expect(p).toMatchObject({ pur: 'aprobacion', tid: 'POS-A', cid: 'tenant-a', rol: 'gerente' })
    expect(typeof p.jti).toBe('string')
    expect(p.exp - p.iat).toBe(15 * 60 * 1000)
  })

  it('verifyShiftToken lo RECHAZA: una aprobación no sirve de login', async () => {
    const st = await import('@/lib/shift-token')
    const t = await st.issueApprovalToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-A')
    expect(await st.verifyShiftToken(t)).toBeNull()
    expect(await st.verifyApprovalCredential(t)).toMatchObject({ pur: 'aprobacion' })
  })

  it('withPOSAuth no acepta un token de aprobación como Bearer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const st = await import('@/lib/shift-token')
    const { withPOSAuth } = await import('@/lib/api-auth')
    const t = await st.issueApprovalToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-A')
    const r = await withPOSAuth(new NextRequest('https://app.test/api/pos/x', { headers: { authorization: `Bearer ${t}` } }))
    expect(r).toBeNull()
  })

  it('la sesión lleva tid sólo si el device_id tiene formato válido', async () => {
    const st = await import('@/lib/shift-token')
    expect(decode(await st.issueShiftToken('m1', 'tenant-a', 'mesero', 'M', 'POS-A')).tid).toBe('POS-A')
    for (const malo of ['con espacio', 'x'.repeat(65), '', 'a/b']) {
      expect(decode(await st.issueShiftToken('m1', 'tenant-a', 'mesero', 'M', malo)).tid, malo).toBeUndefined()
    }
  })

  it('un token vencido (16 min) ya no aprueba', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-24T20:00:00Z') })
    const st = await import('@/lib/shift-token')
    const t = await st.issueApprovalToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-A')
    vi.setSystemTime(new Date('2026-09-24T20:16:00Z'))
    expect(await st.verifyApprovalCredential(t)).toBeNull()
  })
})

// ── B. /api/pos/pin ───────────────────────────────────────────────────────────
const throttle = vi.hoisted(() => ({ bloqueadas: new Set<string>(), llamadas: [] as Array<{ key: string; ok?: boolean; gate?: true }> }))
vi.mock('@/lib/pin-throttle', () => ({
  pinGate: vi.fn(async (key: string) => { throttle.llamadas.push({ key, gate: true }); return throttle.bloqueadas.has(key) ? { allowed: false, retryAfter: 60 } : { allowed: true } }),
  pinRecord: vi.fn(async (key: string, ok: boolean) => { throttle.llamadas.push({ key, ok }) }),
}))

describe('B · /api/pos/pin emite aprobación amarrada, con presupuesto y bitácora', () => {
  const STAFF: Record<string, Array<{ id: string; name: string; role: string; pin: string }>> = {
    'tenant-a': [{ id: 'a-g', name: 'Gerente A', role: 'gerente', pin: '4102' }, { id: 'a-m', name: 'Mesero A', role: 'mesero', pin: '4101' }],
    'tenant-b': [{ id: 'b-g', name: 'Gerente B', role: 'gerente', pin: '4102' }],
  }
  let bitacora: Array<Record<string, unknown>> = []
  let consultasStaff = 0

  function stub() {
    bitacora = []
    consultasStaff = 0
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u)
      if (url.includes('/clients?')) return Response.json([{ pos_settings: {} }])
      if (url.includes('/pos_audit_log')) { bitacora.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }) }
      if (url.includes('/pos_staff?')) {
        consultasStaff++
        const q = new URL(url).searchParams
        const cid = q.get('client_id')!.slice(3)
        const pin = q.get('pin')!.slice(3)
        const roles = q.get('role')?.replace(/^in\.\(|\)$/g, '').split(',')
        const rows = (STAFF[cid] || []).filter(s => s.pin === pin && (!roles || roles.includes(s.role)))
        return Response.json(rows.map(({ id, name, role }) => ({ id, name, role })))
      }
      return Response.json([])
    }))
  }
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/pos/pin/route')
    const r = await POST(new NextRequest('https://app.test/api/pos/pin', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.9' }, body: JSON.stringify(body) }))
    return { status: r.status, json: await r.json() }
  }
  beforeEach(() => { throttle.bloqueadas.clear(); throttle.llamadas = []; stub() })

  it('aprobación: approvalToken con tid; shiftToken sólo fuera del modo estricto', async () => {
    const { json } = await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-A' })
    expect(decode(json.approvalToken)).toMatchObject({ pur: 'aprobacion', tid: 'POS-A', cid: 'tenant-a' })
    expect(json.shiftToken).toBeTruthy()
    vi.stubEnv('POS_APROBACION_V2_ESTRICTA', 'true')
    const estricto = await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-A' })
    expect(estricto.json.approvalToken).toBeTruthy()
    expect(estricto.json.shiftToken, 'una aprobación ya no entrega sesión de gerente').toBeUndefined()
  })

  it('login normal: sin approvalToken, y la sesión queda amarrada a la terminal', async () => {
    const { json } = await post({ client_id: 'tenant-a', pin: '4101', device_id: 'POS-B' })
    expect(json.approvalToken).toBeUndefined()
    expect(decode(json.shiftToken).tid).toBe('POS-B')
  })

  it('presupuesto por terminal: bloqueada → 429 sin consultar pos_staff', async () => {
    throttle.bloqueadas.add('aprob:tenant-a:POS-A')
    const { status } = await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-A' })
    expect(status).toBe(429)
    expect(consultasStaff).toBe(0)
    // Otra terminal del mismo restaurante sigue pudiendo aprobar.
    expect((await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-C' })).status).toBe(200)
  })

  it('un rechazo cuenta en las DOS llaves (IP y terminal)', async () => {
    await post({ client_id: 'tenant-a', pin: '9999', manager: true, device_id: 'POS-A' })
    expect(throttle.llamadas.filter(l => l.ok === false).map(l => l.key).sort()).toEqual(['aprob:tenant-a:POS-A', 'tenant-a:10.0.0.9'])
  })

  it('bitácora de cada aprobación, sin PIN', async () => {
    await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-A' })
    await post({ client_id: 'tenant-a', pin: '9999', min_role: 'capitan', device_id: 'POS-A' })
    expect(bitacora.map(b => (b.details as { resultado: string }).resultado)).toEqual(['aprobado', 'rechazado'])
    expect(bitacora[0]).toMatchObject({ client_id: 'tenant-a', action: 'aprobacion_pin', approved_by: 'a-g', details: { terminal_id: 'POS-A', min_role: 'gerente' } })
    expect(JSON.stringify(bitacora)).not.toMatch(/4102|9999/)
  })

  it('un login normal NO escribe bitácora de aprobación', async () => {
    await post({ client_id: 'tenant-a', pin: '4101', device_id: 'POS-A' })
    expect(bitacora).toHaveLength(0)
  })

  it('dos restaurantes: el mismo PIN aprueba en cada uno con SU tenant', async () => {
    const a = await post({ client_id: 'tenant-a', pin: '4102', manager: true, device_id: 'POS-A' })
    const b = await post({ client_id: 'tenant-b', pin: '4102', manager: true, device_id: 'POS-A' })
    expect(decode(a.json.approvalToken).cid).toBe('tenant-a')
    expect(decode(b.json.approvalToken).cid).toBe('tenant-b')
  })

  it('un mesero pidiendo aprobación de gerente → 401 y sin token', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', pin: '4101', manager: true, device_id: 'POS-A' })
    expect(status).toBe(401)
    expect(json.approvalToken).toBeUndefined()
  })
})

// ── C. Verificación central ───────────────────────────────────────────────────
describe('C · verificarTokenDeAprobacion: terminal, replay y modo estricto', () => {
  // Tabla de usos en memoria con la semántica de PostgREST: primer insert 201, repetido 409.
  let usos: Map<string, { client_id: string; operacion: string }>
  let tablaCaida = false
  beforeEach(() => {
    usos = new Map()
    tablaCaida = false
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (tablaCaida) return new Response('{}', { status: 404 })
      const url = String(u)
      if (url.includes('/pos_aprobaciones_usadas') && init?.method === 'POST') {
        const b = JSON.parse(String(init.body))
        if (usos.has(b.jti)) return new Response('{}', { status: 409 })
        usos.set(b.jti, { client_id: b.client_id, operacion: b.operacion })
        return new Response(null, { status: 201 })
      }
      if (url.includes('/pos_aprobaciones_usadas?')) {
        const jti = decodeURIComponent(new URL(url).searchParams.get('jti')!.slice(3))
        const r = usos.get(jti)
        return Response.json(r ? [r] : [])
      }
      return Response.json([])
    }))
  })
  // `null` = sin terminal. (Con `undefined` el valor por defecto lo convertiría en 'POS-A'.)
  const aprobacion = async (rol = 'gerente', tid: string | null = 'POS-A', cid = 'tenant-a') =>
    (await import('@/lib/shift-token')).issueApprovalToken('g1', cid, rol, 'Gerente', tid ?? undefined)
  const verificar = async (t: string, o: Partial<{ terminalSolicitante: string; operacion: string; minLevel: number; clientId: string }> = {}) =>
    (await import('@/lib/manager-approval')).verificarTokenDeAprobacion(t, { clientId: 'tenant-a', minLevel: 4, terminalSolicitante: 'POS-A', operacion: 'cancel:op-1', ...o })

  it('misma terminal, primera vez → ok', async () => {
    expect(await verificar(await aprobacion())).toMatchObject({ ok: true, mode: 'online:gerente' })
  })
  it('otra terminal → TERMINAL_DISTINTA', async () => {
    expect(await verificar(await aprobacion(), { terminalSolicitante: 'POS-B' })).toMatchObject({ ok: false, error: 'TERMINAL_DISTINTA' })
  })
  it('REPLAY: el mismo token para OTRA operación → APROBACION_REUSADA', async () => {
    const t = await aprobacion()
    expect((await verificar(t)).ok).toBe(true)
    expect(await verificar(t, { operacion: 'cancel:op-2' })).toMatchObject({ ok: false, error: 'APROBACION_REUSADA' })
  })
  it('reintento de la MISMA operación (respuesta perdida) → ok, marcado reintento', async () => {
    const t = await aprobacion()
    await verificar(t)
    expect(await verificar(t)).toMatchObject({ ok: true, mode: 'online:gerente:reintento' })
  })
  it('CONCURRENCIA: dos operaciones distintas a la vez con el mismo token → exactamente una pasa', async () => {
    const t = await aprobacion()
    const rs = await Promise.all([verificar(t, { operacion: 'cancel:x' }), verificar(t, { operacion: 'cancel:y' })])
    expect(rs.filter(r => r.ok)).toHaveLength(1)
    expect(rs.find(r => !r.ok)).toMatchObject({ error: 'APROBACION_REUSADA' })
  })
  it('otro restaurante → TOKEN_INVALIDO', async () => {
    expect(await verificar(await aprobacion('gerente', 'POS-A', 'tenant-b'))).toMatchObject({ ok: false, error: 'TOKEN_INVALIDO' })
  })
  it('rol insuficiente → TOKEN_INVALIDO; capitán sí alcanza nivel 3 (transferir)', async () => {
    expect(await verificar(await aprobacion('mesero'))).toMatchObject({ ok: false, error: 'TOKEN_INVALIDO' })
    expect((await verificar(await aprobacion('capitan'), { minLevel: 3, operacion: 'transfer:1' })).ok).toBe(true)
  })
  it('tabla de usos caída: fuera del modo estricto pasa marcada; en estricto se rechaza', async () => {
    tablaCaida = true
    expect(await verificar(await aprobacion())).toMatchObject({ ok: true, mode: 'online:gerente:sin_registro' })
    vi.stubEnv('POS_APROBACION_V2_ESTRICTA', 'true')
    expect(await verificar(await aprobacion())).toMatchObject({ ok: false, error: 'APROBACION_NO_REGISTRADA' })
  })
  it('DOWNGRADE: en modo estricto un shiftToken viejo (sin propósito) ya no aprueba', async () => {
    const st = await import('@/lib/shift-token')
    const viejo = await st.issueShiftToken('g1', 'tenant-a', 'gerente', 'Gerente', 'POS-A')
    expect((await verificar(viejo)).ok).toBe(true)
    vi.stubEnv('POS_APROBACION_V2_ESTRICTA', 'true')
    expect(await verificar(viejo)).toMatchObject({ ok: false, error: 'APROBACION_V1_NO_ADMITIDA' })
  })
  it('en modo estricto una aprobación sin terminal se rechaza', async () => {
    vi.stubEnv('POS_APROBACION_V2_ESTRICTA', 'true')
    expect(await verificar(await aprobacion('gerente', null))).toMatchObject({ ok: false, error: 'TERMINAL_DISTINTA' })
    expect(await verificar(await aprobacion(), { terminalSolicitante: undefined })).toMatchObject({ ok: false, error: 'TERMINAL_DISTINTA' })
  })
  it('verifyManagerApproval: un token presente que es replay NO cae a «offline» ni a «legacy»', async () => {
    const t = await aprobacion()
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const base = { clientId: 'tenant-a', minLevel: 4, solicitanteRol: 'mesero', terminalSolicitante: 'POS-A' }
    expect((await verifyManagerApproval({ ...base, approvalToken: t, operacion: 'reopen:o1' })).ok).toBe(true)
    const replay = await verifyManagerApproval({ ...base, approvalToken: t, offlineApproved: true, operacion: 'reopen:o2' })
    expect(replay).toMatchObject({ ok: false, error: 'APROBACION_REUSADA' })
  })
})

// ── D. Cliente (pos-data) ─────────────────────────────────────────────────────
describe('D · pos-data: timeout, terminal, límite local y motivo', () => {
  const store = new Map<string, string>()
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  let cuerpos: Array<Record<string, unknown>> = []
  let senales: Array<AbortSignal | null | undefined> = []
  let eventos: string[] = []

  function servidor(r: { status: number; body?: unknown } | 'timeout' | 'sin-red') {
    cuerpos = []; senales = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      cuerpos.push(JSON.parse(String(init?.body)))
      senales.push(init?.signal)
      if (r === 'timeout') throw new DOMException('timeout', 'TimeoutError')
      if (r === 'sin-red') throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
    }))
  }
  beforeEach(() => {
    store.clear()
    eventos = []
    store.set('fullsite_client_id', 'tenant-a')
    store.set('pos_terminal_id', 'POS-A')
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('window', { localStorage: ls, location: { origin: 'https://pos.local' }, dispatchEvent: (e: CustomEvent) => { eventos.push(e.detail?.motivo); return true } })
    vi.stubGlobal('navigator', { onLine: true })
  })

  it('manda device_id y un AbortSignal', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 200, body: { staff: { name: 'G', role: 'gerente' }, approvalToken: 'aprob-tok', shiftToken: 'sesion-tok' } })
    expect(await pd.verifyManagerPin('4102')).toBe('G')
    expect(cuerpos[0]).toMatchObject({ device_id: 'POS-A', manager: true, client_id: 'tenant-a' })
    expect(senales[0]).toBeInstanceOf(AbortSignal)
    // Prefiere el token de APROBACIÓN sobre la sesión del gerente.
    expect(pd.consumeManagerApproval('G')).toBe('aprob-tok')
  })

  it('5 rechazos reales → bloqueo local: el 6.º ni sale a la red', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 401 })
    for (let i = 0; i < 5; i++) expect(await pd.verifyManagerPin('0000')).toBeNull()
    servidor({ status: 200, body: { staff: { name: 'G', role: 'gerente' } } })
    expect(await pd.verifyManagerPin('4102')).toBeNull()
    expect(cuerpos).toHaveLength(0)
    expect(pd.motivoUltimaAprobacionFallida()).toBe('bloqueado-local')
    expect(eventos).toContain('bloqueado-local')
    expect(pd.bloqueoDeAprobacionRestante()).toBeGreaterThan(0)
  })

  it('429, 5xx y timeout NO cuentan como intento fallido', async () => {
    const pd = await import('@/lib/pos-data')
    for (let i = 0; i < 8; i++) {
      servidor(i % 3 === 0 ? { status: 429 } : i % 3 === 1 ? { status: 503, body: { code: 'authority_unavailable' } } : 'timeout')
      await pd.verifyManagerPin('4102')
    }
    expect(pd.bloqueoDeAprobacionRestante()).toBe(0)
    expect(pd.motivoUltimaAprobacionFallida()).toBe('autoridad-no-disponible')
    expect(eventos.every(e => e === 'autoridad-no-disponible')).toBe(true)
  })

  it('sin red y SIN credencial local: «no disponible», no «PIN incorrecto»', async () => {
    const pd = await import('@/lib/pos-data')
    servidor('sin-red')
    expect(await pd.verifyManagerPinWithRole('4102')).toBeNull()
    expect(pd.motivoUltimaAprobacionFallida()).toBe('autoridad-no-disponible')
  })

  it('sin red CON credencial local: el PIN equivocado sí cuenta (no hay bypass)', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 200, body: { staff: { name: 'G', role: 'gerente' } } })
    await pd.verifyManagerPin('4102')
    servidor('sin-red')
    expect(await pd.verifyManagerPin('4102')).toBe('G')
    for (let i = 0; i < 5; i++) expect(await pd.verifyManagerPin('0000')).toBeNull()
    expect(pd.motivoUltimaAprobacionFallida()).toBe('pin-rechazado')
    expect(pd.bloqueoDeAprobacionRestante()).toBeGreaterThan(0)
    // Bloqueado: ni el PIN correcto entra hasta que pase el tiempo.
    expect(await pd.verifyManagerPin('4102')).toBeNull()
  })

  it('401 no usa el caché aunque el PIN esté cacheado', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 200, body: { staff: { name: 'G', role: 'gerente' } } })
    await pd.verifyManagerPin('4102')
    servidor({ status: 401 })
    expect(await pd.verifyManagerPin('4102')).toBeNull()
  })

  it('min_role viaja y el token de aprobación vuelve al llamador', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 200, body: { staff: { name: 'C', role: 'capitan' }, approvalToken: 'aprob-cap' } })
    expect(await pd.verifyPinWithMinRole('4103', 'capitan')).toEqual({ name: 'C', role: 'capitan', approvalToken: 'aprob-cap' })
    expect(cuerpos[0]).toMatchObject({ min_role: 'capitan', device_id: 'POS-A' })
    expect(cuerpos[0].manager).toBeUndefined()
  })
})
