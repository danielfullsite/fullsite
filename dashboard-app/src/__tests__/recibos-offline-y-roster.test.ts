/**
 * Bloque POS, PR 03 — recibos de aprobación offline, llave por terminal, roster y el cliente
 * que aprueba por la Caja.
 *
 * El cruce que importa: el recibo lo FIRMA Pedro (electron-app, CommonJS) y lo VERIFICA el
 * servidor (recibo-offline.ts). Son dos archivos que nadie edita juntos; si divergen, cada
 * cancelación aprobada sin internet muere al drenar. Aquí se firma con el módulo real de
 * Pedro y se verifica con el del servidor.
 *
 * Todo sintético: raíz de relleno, fetch interceptado.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createRequire } from 'module'
import path from 'path'

const requerir = createRequire(import.meta.url)
const pedro = requerir(path.resolve(__dirname, '../../../electron-app/local-server/core/recibo-offline.js')) as {
  firmarRecibo: (llave: string, c: Record<string, unknown>) => string
}
const RAIZ = '5a'.repeat(32)

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  process.env.OFFLINE_RECEIPT_ROOT = RAIZ
  process.env.SHIFT_TOKEN_SECRET = 'secreto-sintetico-de-prueba-de-al-menos-32-caracteres'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.fixture.test'
  process.env.SUPABASE_SERVICE_KEY = 'service-fixture'
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

async function llave(cid = 'tenant-a', tid = 'POS-CAJA') {
  return (await import('@/lib/recibo-offline')).derivarLlaveDeTerminal(cid, tid)!
}
async function recibo(o: Partial<{ cid: string; tid: string; req: string; rol: string; sub: string; now: number; llave: string }> = {}) {
  const k = o.llave ?? await llave(o.cid ?? 'tenant-a', o.tid ?? 'POS-CAJA')
  return pedro.firmarRecibo(k, { cid: 'tenant-a', tid: 'POS-CAJA', req: 'POS-ENTRADA', sub: 'g1', nam: 'Gerente', rol: 'gerente', ...o })
}

describe('A · el recibo que firma Pedro lo verifica el servidor', () => {
  const verificar = async (t: string, o: Partial<{ clientId: string; minLevel: number; terminalSolicitante: string; now: number }> = {}) =>
    (await import('@/lib/recibo-offline')).verificarRecibo(t, { clientId: 'tenant-a', minLevel: 4, terminalSolicitante: 'POS-ENTRADA', ...o })

  it('válido: tenant, terminal, aprobador y rol salen del recibo firmado', async () => {
    const r = await verificar(await recibo())
    expect(r).toMatchObject({ ok: true, claims: { cid: 'tenant-a', tid: 'POS-CAJA', req: 'POS-ENTRADA', sub: 'g1', rol: 'gerente' } })
  })
  it('FORJADO: firmado con otra llave (otra terminal / adivinada) → inválido', async () => {
    expect(await verificar(await recibo({ llave: 'ff'.repeat(32) }))).toMatchObject({ ok: false, error: 'RECIBO_INVALIDO' })
    expect(await verificar(await recibo({ llave: await llave('tenant-a', 'POS-OTRA') }))).toMatchObject({ ok: false, error: 'RECIBO_INVALIDO' })
  })
  it('ALTERADO: cambiar el rol en el payload rompe la firma', async () => {
    const [pre, payload, firma] = (await recibo({ rol: 'mesero' })).split('.')
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString())
    c.rol = 'admin'
    const alterado = [pre, Buffer.from(JSON.stringify(c)).toString('base64url'), firma].join('.')
    expect(await verificar(alterado)).toMatchObject({ ok: false, error: 'RECIBO_INVALIDO' })
  })
  it('DOS TENANTS: un recibo de A no aprueba en B', async () => {
    expect(await verificar(await recibo(), { clientId: 'tenant-b' })).toMatchObject({ ok: false })
  })
  it('rol insuficiente → inválido', async () => {
    expect(await verificar(await recibo({ rol: 'capitan' }))).toMatchObject({ ok: false, error: 'RECIBO_INVALIDO' })
    expect((await verificar(await recibo({ rol: 'capitan' }), { minLevel: 3 })).ok).toBe(true)
  })
  it('vencido (más de 7 días en la cola) → RECIBO_VENCIDO', async () => {
    const t = await recibo({ now: Date.now() - 8 * 86400000 })
    expect(await verificar(t)).toMatchObject({ ok: false, error: 'RECIBO_VENCIDO' })
  })
  it('otra terminal lo presenta → TERMINAL_DISTINTA', async () => {
    expect(await verificar(await recibo(), { terminalSolicitante: 'POS-ESCONDITE' })).toMatchObject({ ok: false, error: 'TERMINAL_DISTINTA' })
  })
  it('sin raíz en el servidor → NO VERIFICABLE (falla cerrado, no «válido»)', async () => {
    const t = await recibo()
    delete process.env.OFFLINE_RECEIPT_ROOT
    expect(await verificar(t)).toMatchObject({ ok: false, error: 'RECIBO_NO_VERIFICABLE' })
    process.env.OFFLINE_RECEIPT_ROOT = 'corta'
    expect(await verificar(t)).toMatchObject({ ok: false, error: 'RECIBO_NO_VERIFICABLE' })
  })
})

describe('B · el recibo en la verificación central', () => {
  let usos: Map<string, { client_id: string; operacion: string }>
  beforeEach(() => {
    usos = new Map()
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u)
      if (url.includes('/pos_aprobaciones_usadas') && init?.method === 'POST') {
        const b = JSON.parse(String(init.body))
        if (usos.has(b.jti)) return new Response('{}', { status: 409 })
        usos.set(b.jti, b); return new Response(null, { status: 201 })
      }
      if (url.includes('/pos_aprobaciones_usadas?')) {
        const jti = decodeURIComponent(new URL(url).searchParams.get('jti')!.slice(3))
        return Response.json(usos.has(jti) ? [usos.get(jti)] : [])
      }
      return Response.json([])
    }))
  })
  const base = { clientId: 'tenant-a', minLevel: 4, solicitanteRol: 'mesero', terminalSolicitante: 'POS-ENTRADA' }

  it('recibo válido → aprobación offline_recibo, registrada como `recibo:<nonce>`', async () => {
    const { verificarTokenDeAprobacion } = await import('@/lib/manager-approval')
    const r = await verificarTokenDeAprobacion(await recibo(), { ...base, operacion: 'cancel:op-1' })
    expect(r).toMatchObject({ ok: true, mode: 'offline_recibo:gerente', actor: 'Gerente' })
    expect([...usos.keys()][0]).toMatch(/^recibo:/)
  })
  it('REPLAY: el mismo recibo para otra operación → rechazado; para la misma → reintento', async () => {
    const { verificarTokenDeAprobacion } = await import('@/lib/manager-approval')
    const t = await recibo()
    await verificarTokenDeAprobacion(t, { ...base, operacion: 'cancel:op-1' })
    expect(await verificarTokenDeAprobacion(t, { ...base, operacion: 'cancel:op-2' })).toMatchObject({ ok: false, error: 'APROBACION_REUSADA' })
    expect(await verificarTokenDeAprobacion(t, { ...base, operacion: 'cancel:op-1' })).toMatchObject({ ok: true, mode: 'offline_recibo:gerente:reintento' })
  })
  it('POS_APPROVAL_STRICT: el recibo SÍ pasa (es prueba); `offline_approved` sin recibo NO', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    expect((await verifyManagerApproval({ ...base, approvalToken: await recibo(), operacion: 'reopen:o1' })).ok).toBe(true)
    expect((await verifyManagerApproval({ ...base, offlineApproved: true, operacion: 'reopen:o2' })).ok).toBe(false)
  })
  it('un recibo forjado NO se convierte en aprobación (cae a las banderas de rollout, no a "ok")', async () => {
    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const { verifyManagerApproval } = await import('@/lib/manager-approval')
    const forjado = await recibo({ llave: 'ff'.repeat(32) })
    expect((await verifyManagerApproval({ ...base, approvalToken: forjado, operacion: 'reopen:o3' })).ok).toBe(false)
  })
})

describe('C · /api/pos/terminal-receipt-key', () => {
  let bitacora: unknown[] = []
  let exigeEnrolada = false
  let enroladas: string[] = []
  beforeEach(() => {
    bitacora = []; exigeEnrolada = false; enroladas = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u)
      if (url.includes('/clients?')) return Response.json([{ pos_settings: exigeEnrolada ? { 'pos.require_enrolled_terminal': true } : {} }])
      if (url.includes('/pos_terminals?')) {
        const dev = decodeURIComponent(new URL(url).searchParams.get('device_id')!.slice(3))
        return Response.json(enroladas.includes(dev) ? [{ device_id: dev }] : [])
      }
      if (url.includes('/pos_audit_log')) { bitacora.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }) }
      return Response.json([])
    }))
  })
  async function pedir(rol: string, body: unknown, cid = 'tenant-a') {
    const { issueShiftToken } = await import('@/lib/shift-token')
    const t = await issueShiftToken('s1', cid, rol, 'Persona', 'POS-CAJA')
    const { POST } = await import('@/app/api/pos/terminal-receipt-key/route')
    const r = await POST(new NextRequest('https://app.test/api/pos/terminal-receipt-key', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify(body) }))
    return { status: r.status, json: await r.json() }
  }

  it('gerente: recibe la llave derivada de SU restaurante y terminal; la bitácora no la guarda', async () => {
    const r = await pedir('gerente', { device_id: 'POS-CAJA' })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ kid: 'v1', key: await llave('tenant-a', 'POS-CAJA'), device_id: 'POS-CAJA' })
    expect(JSON.stringify(bitacora)).not.toContain(r.json.key)
    expect(bitacora[0]).toMatchObject({ action: 'llave_recibos_entregada', details: { terminal_id: 'POS-CAJA' } })
  })
  it('mesero, cajero y capitán NO la obtienen', async () => {
    for (const rol of ['mesero', 'cajero', 'capitan']) expect((await pedir(rol, { device_id: 'POS-CAJA' })).status).toBe(403)
  })
  it('device_id mal formado → 400', async () => {
    expect((await pedir('gerente', { device_id: 'a b' })).status).toBe(400)
  })
  it('restaurante que exige terminales enroladas: sólo la enrolada', async () => {
    exigeEnrolada = true; enroladas = ['POS-CAJA']
    expect((await pedir('gerente', { device_id: 'POS-CAJA' })).status).toBe(200)
    expect((await pedir('gerente', { device_id: 'POS-EXTRA' })).json).toMatchObject({ code: 'terminal_not_enrolled' })
  })
  it('sin raíz configurada → 503 (no inventa llaves)', async () => {
    delete process.env.OFFLINE_RECEIPT_ROOT
    expect((await pedir('gerente', { device_id: 'POS-CAJA' })).status).toBe(503)
  })
  it('dos tenants: la llave de A y la de B para la misma terminal son distintas', async () => {
    const a = await pedir('gerente', { device_id: 'POS-CAJA' }, 'tenant-a')
    const b = await pedir('gerente', { device_id: 'POS-CAJA' }, 'tenant-b')
    expect(a.json.key).not.toBe(b.json.key)
  })
})

describe('D · /api/pos/staff-roster', () => {
  it('sólo ids y roles del tenant del token; nada de nombres ni PIN', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(String(u))
      return Response.json([{ id: 'g1', role: 'gerente', name: 'NO', pin: '4102' }, { id: 'm1', role: 'mesero' }])
    }))
    const { issueShiftToken } = await import('@/lib/shift-token')
    const t = await issueShiftToken('s1', 'tenant-a', 'gerente', 'G')
    const { GET } = await import('@/app/api/pos/staff-roster/route')
    const r = await GET(new NextRequest('https://app.test/api/pos/staff-roster?client_id=tenant-b', { headers: { authorization: `Bearer ${t}` } }))
    const j = await r.json()
    expect(j.client_id).toBe('tenant-a')
    expect(j.staff).toEqual([{ id: 'g1', role: 'gerente' }, { id: 'm1', role: 'mesero' }])
    expect(urls[0]).toContain('client_id=eq.tenant-a')
    expect(urls[0]).toContain('active=eq.true')
    expect(JSON.stringify(j)).not.toMatch(/4102|"NO"/)
  })
  it('base caída → 503 (la Caja no revoca con un roster que no leyó)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const { issueShiftToken } = await import('@/lib/shift-token')
    const { GET } = await import('@/app/api/pos/staff-roster/route')
    const r = await GET(new NextRequest('https://app.test/api/pos/staff-roster', { headers: { authorization: `Bearer ${await issueShiftToken('s1', 'tenant-a', 'mesero', 'M')}` } }))
    expect(r.status).toBe(503)
  })
  it('sin token → 401', async () => {
    const { GET } = await import('@/app/api/pos/staff-roster/route')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    expect((await GET(new NextRequest('https://app.test/api/pos/staff-roster'))).status).toBe(401)
  })
})

describe('E · en una terminal con Caja, la aprobación la resuelve la Caja', () => {
  const store = new Map<string, string>()
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  let llamadas: Array<{ url: string; body: Record<string, unknown> }> = []
  function caja(r: { status: number; body?: unknown } | 'caida') {
    llamadas = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      llamadas.push({ url: String(u), body: JSON.parse(String(init?.body || '{}')) })
      if (r === 'caida') throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
    }))
  }
  beforeEach(() => {
    store.clear()
    store.set('fullsite_client_id', 'tenant-a')
    store.set('FULLSITE_BRIDGE_URL', 'http://127.0.0.1:7717')
    store.set('FULLSITE_LAN_SECRET', 'secreto-lan-sintetico')
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('window', { localStorage: ls, location: { origin: 'https://app.fullsite.mx' }, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'Mozilla/5.0 Electron/33' })
  })

  it('pide a la Caja con `aprobacion` y el rol; NUNCA a la nube directo', async () => {
    const pd = await import('@/lib/pos-data')
    caja({ status: 200, body: { staff: { id: 'g1', name: 'G', role: 'gerente' }, offline: false, approvalToken: 'aprob-nube' } })
    expect(await pd.verifyManagerPin('4102')).toBe('G')
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toContain('127.0.0.1:7717/auth/pin')
    expect(llamadas[0].body).toMatchObject({ pin: '4102', min_role: 'gerente', aprobacion: true })
    expect(pd.consumeManagerApproval('G')).toBe('aprob-nube')
  })
  it('sin red: el RECIBO de la Caja viaja como la aprobación', async () => {
    const pd = await import('@/lib/pos-data')
    caja({ status: 200, body: { staff: { id: 'g1', name: 'G', role: 'gerente' }, offline: true, recibo: 'rcb1.x.y' } })
    expect(await pd.verifyPinWithMinRole('4102', 'gerente')).toEqual({ name: 'G', role: 'gerente', approvalToken: 'rcb1.x.y' })
  })
  it('la Caja rechaza (401 / permiso insuficiente) → cuenta como intento', async () => {
    const pd = await import('@/lib/pos-data')
    caja({ status: 401, body: { code: 'OFFLINE_USER_NOT_PREPARED' } })
    for (let i = 0; i < 5; i++) await pd.verifyManagerPin('0000')
    expect(pd.bloqueoDeAprobacionRestante()).toBeGreaterThan(0)
  })
  it('Caja sin protección del SO (503) o caída → «no disponible», no cuenta', async () => {
    const pd = await import('@/lib/pos-data')
    caja({ status: 503, body: { code: 'OFFLINE_SIN_PROTECCION' } })
    expect(await pd.verifyManagerPin('4102')).toBeNull()
    expect(pd.motivoUltimaAprobacionFallida()).toBe('autoridad-no-disponible')
    caja('caida')
    expect(await pd.verifyManagerPin('4102')).toBeNull()
    expect(pd.bloqueoDeAprobacionRestante()).toBe(0)
  })
  it('Caja con presupuesto agotado (429) → bloqueado', async () => {
    const pd = await import('@/lib/pos-data')
    caja({ status: 429, body: { code: 'PIN_RATE_LIMITED' } })
    await pd.verifyManagerPin('4102')
    expect(pd.motivoUltimaAprobacionFallida()).toBe('bloqueado-local')
  })
})

describe('F · /api/pos/pin con `aprobacion` (la pide la Caja)', () => {
  it('emite token de aprobación SIN filtrar rol: la Caja revisa el mínimo', async () => {
    vi.mock('@/lib/pin-throttle', () => ({ pinGate: vi.fn(async () => ({ allowed: true })), pinRecord: vi.fn(async () => {}) }))
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const url = String(u); urls.push(url)
      if (url.includes('/clients?')) return Response.json([{ pos_settings: {} }])
      if (url.includes('/pos_staff?')) return Response.json([{ id: 'm1', name: 'Mesero', role: 'mesero' }])
      return new Response(null, { status: 201 })
    }))
    const { POST } = await import('@/app/api/pos/pin/route')
    const r = await POST(new NextRequest('https://app.test/api/pos/pin', { method: 'POST', body: JSON.stringify({ pin: '4101', client_id: 'tenant-a', device_id: 'POS-ENTRADA', aprobacion: true }) }))
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.approvalToken).toBeTruthy()
    expect(urls.find(u => u.includes('/pos_staff?'))).not.toContain('role=in.')
  })
})
