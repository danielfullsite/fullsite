// F-01 (P0) — /api/pos/pin emitía shift token para cualquier `fingerprint_id`.
//
// Auditoría 2026-09-23 (output/dashboard-audit-20260923-200545, DASHBOARD-GAPS-BY-PRIORITY.md
// §F-01). El servidor nunca verificó una firma de huella: el `fingerprint_id` era el UUID del
// empleado, una afirmación del cliente. Conocer el UUID de un gerente (GET /api/pos/staff, o
// `pos_fingerprint_staff` / `pos_staff_cache` en el localStorage de cualquier terminal) bastaba
// para obtener un token de gerente firmado, sin huella y sin PIN.
//
// CONTRATO NUEVO (contención): un id NO es prueba de identidad. Si llega `fingerprint_id`, con
// o sin PIN, la respuesta es 401 `biometria_no_verificada` y no se emite token (no cuenta en el
// throttle: revisión N-1). Sólo un PIN válido del restaurante del body, activo, que cumpla min_role/manager,
// emite token. La huella vuelve únicamente con WebAuthn verificado en servidor.
//
// Todos los ids, PINs y tenants son inventados. `fetch` está simulado: nada sale a la red.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const throttle: { key: string; ok: boolean }[] = []
vi.mock('@/lib/pin-throttle', () => ({
  pinGate: async () => ({ allowed: true }),
  pinRecord: async (key: string, ok: boolean) => { throttle.push({ key, ok }) },
}))

type Fila = { id: string; client_id: string; name: string; role: string; pin: string; active: boolean; template: string }

// Filas "completas" a propósito: traen pin y plantilla de huella para probar que la ruta no
// los reenvía aunque la base los devolviera.
const STAFF: Fila[] = [
  { id: 'a-mesero', client_id: 'tenant-a', name: 'Mesero A', role: 'mesero', pin: '1111', active: true, template: 'TPL-A-MESERO' },
  { id: 'a-gerente', client_id: 'tenant-a', name: 'Gerente A', role: 'gerente', pin: '2222', active: true, template: 'TPL-A-GERENTE' },
  { id: 'a-baja', client_id: 'tenant-a', name: 'Baja A', role: 'gerente', pin: '4444', active: false, template: 'TPL-A-BAJA' },
  { id: 'b-mesero', client_id: 'tenant-b', name: 'Mesero B', role: 'mesero', pin: '3333', active: true, template: 'TPL-B-MESERO' },
]

let urls: string[] = []

/** PostgREST de mentira: aplica los filtros eq./in. que la ruta manda a pos_staff. */
function stubSupabase() {
  urls = []
  vi.stubGlobal('fetch', async (input: string) => {
    const u = String(input)
    urls.push(u)
    if (u.includes('/auth/v1/user')) return new Response('{}', { status: 401 })
    if (u.includes('/rest/v1/clients')) return new Response(JSON.stringify([{ pos_settings: {} }]), { status: 200 })
    if (u.includes('/rest/v1/pos_staff')) {
      const q = new URL(u).searchParams
      const rows = STAFF.filter((r) => {
        for (const [k, v] of q.entries()) {
          if (k === 'select' || k === 'limit') continue
          const val = String((r as unknown as Record<string, unknown>)[k])
          if (v.startsWith('eq.') && val !== v.slice(3)) return false
          if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(val)) return false
        }
        return true
      })
      return new Response(JSON.stringify(rows.slice(0, 1)), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  })
}

const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/pos/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
    body: JSON.stringify(body),
  }) as never

const consultasDeStaff = () => urls.filter((u) => u.includes('/rest/v1/pos_staff'))

const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/pos/pin/route')
  const res = await POST(req(body))
  const json = await res.json()
  return { status: res.status, json }
}

beforeEach(() => {
  throttle.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fixture.local'
  process.env.SUPABASE_SERVICE_KEY = 'fixture-service'
  process.env.SHIFT_TOKEN_SECRET = 'fixture-secret-0123456789abcdef0123456789abcdef'
  delete process.env.POS_FALLBACK_CLIENT_ID
  delete process.env.MANAGER_PINS_CLIENT_ID
  stubSupabase()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('F-01 · un fingerprint_id NO es credencial', () => {
  it('(a) mesero con el fingerprint_id de un gerente pidiendo rol de gerente → 401 sin token', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', fingerprint_id: 'a-gerente', manager: true })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
    expect(json.staff).toBeUndefined()
    expect(json.code).toBe('biometria_no_verificada')
    expect(json.error).toBe('La huella no está disponible por seguridad; entra con tu PIN')
  })

  // Revisión N-1: el rechazo por huella NO cuenta en el throttle compartido por IP
  // (bloqueaba el PIN de todo el restaurante). Ver pos-auth-revision-adversarial-pr1.test.ts.
  it('(b) id conocido sin PIN → 401, sin consultar pos_staff por id y sin gastar el throttle', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', fingerprint_id: 'a-gerente' })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
    expect(json.code).toBe('biometria_no_verificada')
    expect(consultasDeStaff().some((u) => u.includes('id=eq.a-gerente')), 'el id no se usa para buscar al empleado').toBe(false)
    expect(throttle).toEqual([])
  })

  it('fingerprint_id junto con un PIN válido tampoco emite token (el cliente viejo mandaba pin="___fingerprint___")', async () => {
    const conPinValido = await post({ client_id: 'tenant-a', fingerprint_id: 'a-gerente', pin: '2222' })
    expect(conPinValido.status).toBe(401)
    expect(conPinValido.json.shiftToken).toBeUndefined()
    const legado = await post({ client_id: 'tenant-a', fingerprint_id: 'a-mesero', pin: '___fingerprint___' })
    expect(legado.status).toBe(401)
    expect(legado.json.code).toBe('biometria_no_verificada')
  })
})

describe('Sólo un PIN válido del restaurante emite token', () => {
  it('(c) PIN válido del restaurante A enviado con client_id del restaurante B → 401', async () => {
    const { status, json } = await post({ client_id: 'tenant-b', pin: '2222' })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
    expect(consultasDeStaff().every((u) => u.includes('client_id=eq.tenant-b'))).toBe(true)
  })

  it('(d) PIN incorrecto → 401 y se registra el fallo en el throttle', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', pin: '9999' })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
    expect(throttle).toEqual([{ key: 'tenant-a:10.0.0.9', ok: false }])
  })

  it('(e) sin huella y sin PIN → 400', async () => {
    const { status, json } = await post({ client_id: 'tenant-a' })
    expect(status).toBe(400)
    expect(json.shiftToken).toBeUndefined()
  })

  it('(f) min_role gerente con PIN de mesero → 401', async () => {
    const minRole = await post({ client_id: 'tenant-a', pin: '1111', min_role: 'gerente' })
    expect(minRole.status).toBe(401)
    expect(minRole.json.shiftToken).toBeUndefined()
    const manager = await post({ client_id: 'tenant-a', pin: '1111', manager: true })
    expect(manager.status).toBe(401)
    expect(manager.json.shiftToken).toBeUndefined()
  })

  it('min_role desconocido falla cerrado: no se trata como "sin filtro de rol"', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', pin: '1111', min_role: 'superusuario' })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
    expect(consultasDeStaff()).toHaveLength(0)
  })

  it('empleado desactivado → 401 aunque el PIN sea el suyo', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', pin: '4444' })
    expect(status).toBe(401)
    expect(json.shiftToken).toBeUndefined()
  })

  it('CONTROL POSITIVO: PIN válido → 200 con token firmado que lleva cid, rol y exp de 8 h', async () => {
    const antes = Date.now()
    const { status, json } = await post({ client_id: 'tenant-a', pin: '2222', manager: true })
    expect(status).toBe(200)
    // (3) La respuesta del login sólo trae {staff:{id,name,role}, shiftToken}: nada de PIN,
    // plantilla de huella ni llaves, aunque la base los hubiera devuelto.
    // Desde 2026-09-24 una petición de APROBACIÓN (manager:true) trae además su propio
    // `approvalToken` (15 min, jti, terminal). El shiftToken sigue viajando mientras no esté
    // POS_APROBACION_V2_ESTRICTA. Nada de PIN ni plantillas: lo cuida `crudo` abajo.
    expect(Object.keys(json).sort()).toEqual(['approvalToken', 'shiftToken', 'staff'])
    expect(json.staff).toEqual({ id: 'a-gerente', name: 'Gerente A', role: 'gerente' })
    const crudo = JSON.stringify(json)
    for (const secreto of ['2222', 'TPL-A-GERENTE', 'fixture-service', 'fixture-secret']) {
      expect(crudo).not.toContain(secreto)
    }
    const p = decode(json.shiftToken)
    expect(p.cid).toBe('tenant-a')
    expect(p.rol).toBe('gerente')
    expect(p.sub).toBe('a-gerente')
    expect(p.exp - p.iat).toBe(8 * 60 * 60 * 1000)
    expect(p.iat).toBeGreaterThanOrEqual(antes)
    const { verifyShiftToken } = await import('@/lib/shift-token')
    expect(await verifyShiftToken(json.shiftToken)).toMatchObject({ cid: 'tenant-a', rol: 'gerente' })
    // Una aprobación (manager:true) tiene además su presupuesto por terminal (2026-09-24);
    // sin device_id cae en la llave `sin-terminal`. El éxito limpia las dos.
    expect(throttle).toEqual([{ key: 'tenant-a:10.0.0.9', ok: true }, { key: 'aprob:tenant-a:sin-terminal', ok: true }])
  })

  it('el rol del token sale de pos_staff, nunca del body', async () => {
    const { status, json } = await post({ client_id: 'tenant-a', pin: '1111', role: 'admin', rol: 'admin' })
    expect(status).toBe(200)
    expect(json.staff.role).toBe('mesero')
    expect(decode(json.shiftToken).rol).toBe('mesero')
  })
})

describe('(g) replay y manipulación del shift token', () => {
  async function tokenDe(cid: string, rol = 'mesero') {
    const { issueShiftToken } = await import('@/lib/shift-token')
    return issueShiftToken(`${cid}-staff`, cid, rol, 'Fixture')
  }
  const posReq = (token: string, tenantHint?: string) => ({
    headers: new Headers({ authorization: `Bearer ${token}`, ...(tenantHint ? { 'x-fullsite-tenant': tenantHint } : {}) }),
    cookies: { get: () => undefined },
  }) as never

  it('token de A presentado para B → withPOSAuth lo rechaza', async () => {
    const { withPOSAuth } = await import('@/lib/api-auth')
    const token = await tokenDe('tenant-a')
    expect(await withPOSAuth(posReq(token, 'tenant-b'))).toBeNull()
    // Control: el mismo token para su propio restaurante sí entra, con cid del token.
    expect(await withPOSAuth(posReq(token, 'tenant-a'))).toMatchObject({ clientId: 'tenant-a', authType: 'shift_token' })
  })

  it('token vencido → rechazado', async () => {
    const { verifyShiftToken } = await import('@/lib/shift-token')
    const ahora = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(ahora - 9 * 60 * 60 * 1000)
    const token = await tokenDe('tenant-a')
    spy.mockReturnValue(ahora)
    expect(await verifyShiftToken(token)).toBeNull()
    const { withPOSAuth } = await import('@/lib/api-auth')
    expect(await withPOSAuth(posReq(token))).toBeNull()
  })

  it('payload alterado (mesero → admin) con la firma original → rechazado', async () => {
    const { verifyShiftToken } = await import('@/lib/shift-token')
    const token = await tokenDe('tenant-a', 'mesero')
    const [data, sig] = token.split('.')
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    payload.rol = 'admin'
    const falso = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(await verifyShiftToken(falso)).toBeNull()
  })

  it('firma alterada → rechazado', async () => {
    const { verifyShiftToken } = await import('@/lib/shift-token')
    const token = await tokenDe('tenant-a')
    const [data, sig] = token.split('.')
    const otra = Buffer.from(sig, 'base64url')
    otra[0] ^= 0xff
    expect(await verifyShiftToken(`${data}.${otra.toString('base64url')}`)).toBeNull()
    expect(await verifyShiftToken(`${data}.`)).toBeNull()
  })

  it('token firmado con otro secreto → rechazado', async () => {
    const token = await tokenDe('tenant-a')
    process.env.SHIFT_TOKEN_SECRET = 'otro-secreto-0123456789abcdef0123456789abcdef'
    const { verifyShiftToken } = await import('@/lib/shift-token')
    expect(await verifyShiftToken(token)).toBeNull()
  })
})

describe('Cliente: el POS ya no manda fingerprint_id', () => {
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  const layout = sinComentarios(readFileSync(join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8'))
  const posData = sinComentarios(readFileSync(join(process.cwd(), 'src/lib/pos-data.ts'), 'utf8'))

  it('ni el login del POS ni la aprobación de gerente envían fingerprint_id', () => {
    expect(layout).not.toContain('fingerprint_id')
    expect(layout).not.toContain('___fingerprint___')
    expect(posData).not.toContain('fingerprint_id')
  })

  it('el botón de huella muestra el aviso y deja el teclado de PIN', () => {
    expect(layout).toContain('La huella no está disponible por seguridad; entra con tu PIN')
  })

  it('verifyManagerHuella no llama a la red y devuelve null (la pantalla cae al PIN)', async () => {
    const llamadas: string[] = []
    vi.stubGlobal('fetch', async (u: string) => { llamadas.push(String(u)); return new Response('{}', { status: 200 }) })
    const store: Record<string, string> = { pos_biometric_credentials: JSON.stringify({ "Y3JlZA==": { id: 'a-gerente' } }) }
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: () => {}, removeItem: () => {} })
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {}, location: { hostname: 'pos.fixture' } })
    vi.stubGlobal('navigator', { credentials: { get: async () => ({ rawId: new Uint8Array([99, 114, 101, 100]).buffer }) } })
    const { verifyManagerHuella, hayHuellasDadasDeAlta } = await import('@/lib/pos-data')
    expect(await verifyManagerHuella('gerente')).toBeNull()
    expect(llamadas.filter((u) => u.includes('/api/pos/pin'))).toHaveLength(0)
    expect(await hayHuellasDadasDeAlta()).toBe(false)
  })
})

// ── Caché offline: copiarla no es entrar sin PIN ──────────────────────────────
//
// Requisito de Daniel (2026-09-23): retirar la huella del servidor no debe convertir la
// caché offline en otra credencial reutilizable. Lo que hay en el navegador:
//   · pos_staff_cache            {id,name,role,exp,pin_hash=SHA-256(pin:id)} — una persona.
//   · pos_manager_credentials_v2 [{staff_id,name,role,pin_hash=PBKDF2(pin,sal)}] + pos_pin_device_salt.
//   · pos_fingerprint_staff      {id→{id,name,role}} — ya no abre nada (el botón sólo avisa).
//   · pos_shift_token            el token firmado (bearer, 8 h) — ver informe, riesgo residual.
describe('Copiar la caché offline a otra terminal no permite entrar sin PIN', () => {
  function terminal() {
    const m = new Map<string, string>()
    return {
      m,
      ls: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => { m.set(k, v) },
        removeItem: (k: string) => { m.delete(k) },
      },
    }
  }

  // B-2 (bloque POS, 2026-09-24): `pos-manager-auth` y `pos_staff_cache` se RETIRARON del
  // navegador — eran verificadores de PIN en localStorage, así que «copiar la caché» ya no
  // tiene nada que copiar. Lo que se prueba ahora es que no quede nada y que no vuelva.
  it('los almacenes de verificadores del navegador se purgan al cargar pos-data', async () => {
    const a = terminal()
    for (const k of ['pos_staff_cache', 'pos_manager_credentials_v2', 'pos_pin_device_salt', 'pos_manager_pin_cache']) a.m.set(k, 'x')
    a.m.set('pos_shift_token', 'sesion')
    vi.resetModules()
    vi.stubGlobal('localStorage', a.ls)
    vi.stubGlobal('window', { localStorage: a.ls })
    await import('@/lib/pos-data')
    expect([...a.m.keys()]).toEqual(['pos_shift_token'])
  })

  it('el login ya no lee ni escribe verificadores locales (layout.tsx)', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8')
    expect(fuente).not.toContain("from '@/lib/pos-manager-auth'")
    expect(fuente).not.toMatch(/localStorage\.(getItem|setItem)\('pos_staff_cache'/)
    expect(fuente).not.toContain('coincideCacheSimple')
  })

  it('el mapa pos_fingerprint_staff ya no abre el POS: el botón de huella no desbloquea', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/app/pos/layout.tsx'), 'utf8')
    const fn = fuente.slice(fuente.indexOf('const handleBiometricLogin'))
    const cuerpo = fn.slice(0, fn.indexOf('\n  }\n'))
    expect(cuerpo).not.toContain('setUnlocked')
    expect(cuerpo).not.toContain('pos_fingerprint_staff')
    expect(cuerpo).not.toContain('fetch(')
    expect(cuerpo).toContain('setSessionError(HUELLA_SUSPENDIDA)')
  })
})
