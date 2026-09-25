/**
 * C6: lo que quedaba después de 2ed3c1d5 (#410).
 *
 * #410 arregló el login por PIN: 429, 5xx y timeout caen al respaldo local en vez de contar
 * como «PIN incorrecto». El barrido del patrón (CLAUDE.md §6) sobre las demás superficies que
 * preguntan a `/api/pos/pin` encontró tres cosas:
 *
 *   1. Login por HUELLA (`pos/layout.tsx`), el defecto INVERSO. Caía al mapa local ante
 *      cualquier no-2xx, incluido el 401 de «empleado desactivado». Con red, un empleado dado
 *      de baja entraba con su huella.
 *   2. Servidor, rama de huella (`api/pos/pin/route.ts`). Si no podía leer `pos_staff`
 *      respondía 401 y cobraba un intento del throttle, cuando la rama del PIN responde
 *      503 `authority_unavailable`. Sin arreglar esto, el punto 1 dejaría fuera a gente
 *      durante una caída.
 *   3. Aprobaciones de gerente (`verifyManagerPin*`, `verifyManagerHuella`). No tenían timeout:
 *      con la LAN degradada, 30–90 s congelados antes del respaldo local.
 *
 * Todas las pruebas son offline y sintéticas: `fetch` está interceptado, no hay red.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decidirHuellaTrasAutoridad, TIMEOUT_AUTORIDAD_PIN_MS } from '@/lib/veredicto-de-la-autoridad'

// ── 1. La decisión del login por huella ───────────────────────────────────────
describe('login por huella: sólo lo que NO es veredicto cae al mapa local', () => {
  it('sin respuesta (sin red, timeout, fetch que lanzó) → respaldo local', () => {
    expect(decidirHuellaTrasAutoridad(null)).toBe('usar-respaldo-local')
  })
  it('200 con empleado → entra con el servidor', () => {
    expect(decidirHuellaTrasAutoridad(200, undefined, true)).toBe('entrar-con-servidor')
  })
  it('200 SIN empleado no es una negación → respaldo local', () => {
    expect(decidirHuellaTrasAutoridad(200, undefined, false)).toBe('usar-respaldo-local')
  })
  it('EL BUG — 401 (empleado desactivado) RECHAZA: ya no se entra por el caché', () => {
    expect(decidirHuellaTrasAutoridad(401)).toBe('rechazar')
    expect(decidirHuellaTrasAutoridad(401, undefined, true)).toBe('rechazar')
  })
  it('403 terminal_not_enrolled es la terminal', () => {
    expect(decidirHuellaTrasAutoridad(403, 'terminal_not_enrolled')).toBe('terminal-no-enrolada')
  })
  it('400 es la terminal sin restaurante', () => {
    expect(decidirHuellaTrasAutoridad(400)).toBe('sin-tenant')
  })
  it('429, 5xx, 403 sin código y lo desconocido → respaldo local (no acusan al empleado)', () => {
    for (const s of [429, 500, 502, 503, 504, 403, 418, 302]) {
      expect(decidirHuellaTrasAutoridad(s), `status ${s}`).toBe('usar-respaldo-local')
    }
  })
})

describe('cableado: layout.tsx usa la decisión en la rama de huella', () => {
  const layout = readFileSync(path.resolve(__dirname, '../app/pos/layout.tsx'), 'utf8')
  const inicio = layout.indexOf('const handleBiometricLogin')
  const fin = layout.indexOf('const handleSubmit')
  const huella = layout.slice(inicio, fin)

  it('la rama de huella decide con decidirHuellaTrasAutoridad', () => {
    expect(inicio).toBeGreaterThan(-1)
    expect(huella).toContain('decidirHuellaTrasAutoridad(')
  })
  it('el rechazo corta ANTES de consultar el mapa local', () => {
    const rechazo = huella.indexOf("decision === 'rechazar'")
    const mapaLocal = huella.indexOf("if (!member) {")
    expect(rechazo).toBeGreaterThan(-1)
    expect(rechazo).toBeLessThan(mapaLocal)
  })
  it('ya no existe el patrón viejo: «si no fue ok, al caché»', () => {
    expect(huella).not.toMatch(/if \(staffRes\?\.ok\)/)
  })
  it('usa el mismo timeout que el PIN', () => {
    expect(huella).toContain('AbortSignal.timeout(TIMEOUT_AUTORIDAD_PIN_MS)')
  })
})

// ── 2. Servidor, rama de huella ───────────────────────────────────────────────
vi.mock('@/lib/shift-token', () => ({ issueShiftToken: vi.fn(async () => 'token-sintetico') }))
vi.mock('@/lib/pin-throttle', () => ({ pinGate: vi.fn(async () => ({ allowed: true })), pinRecord: vi.fn(async () => {}) }))

describe('servidor: la rama de huella no llama «rechazo» a una caída', () => {
  const pedir = () => ({
    headers: new Headers(),
    json: async () => ({ pin: '___fingerprint___', client_id: 'lab', fingerprint_id: 'lab-staff-1', device_id: 'POS-A' }),
  }) as unknown as import('next/server').NextRequest

  function base(personal: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/clients?') ? Response.json([{ pos_settings: {} }]) : personal()))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sintetico.invalid'
    process.env.SUPABASE_SERVICE_KEY = 'llave-sintetica'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('pos_staff ilegible (503) → 503 authority_unavailable, sin cobrar intento ni emitir token', async () => {
    base(() => Response.json({}, { status: 503 }))
    const { POST } = await import('@/app/api/pos/pin/route')
    const { pinRecord } = await import('@/lib/pin-throttle')
    const { issueShiftToken } = await import('@/lib/shift-token')
    const r = await POST(pedir())
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ code: 'authority_unavailable' })
    expect(pinRecord).not.toHaveBeenCalledWith(expect.anything(), false)
    expect(issueShiftToken).not.toHaveBeenCalled()
  })

  it('respuesta que no es lista → 503, no 401', async () => {
    base(() => new Response('<html>portal</html>', { status: 200 }))
    const { POST } = await import('@/app/api/pos/pin/route')
    expect((await POST(pedir())).status).toBe(503)
  })

  it('empleado inexistente o desactivado (lista vacía) → 401 y SÍ cobra el intento', async () => {
    base(() => Response.json([]))
    const { POST } = await import('@/app/api/pos/pin/route')
    const { pinRecord } = await import('@/lib/pin-throttle')
    expect((await POST(pedir())).status).toBe(401)
    expect(pinRecord).toHaveBeenCalledWith('lab:unknown', false)
  })

  it('empleado activo → 200 con token', async () => {
    base(() => Response.json([{ id: 'lab-staff-1', name: 'Sintético', role: 'mesero' }]))
    const { POST } = await import('@/app/api/pos/pin/route')
    const r = await POST(pedir())
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ staff: { id: 'lab-staff-1' }, shiftToken: 'token-sintetico' })
  })
})

// ── 3. Aprobaciones de gerente: timeout y respaldo ────────────────────────────
describe('aprobación de gerente: un timeout cae al respaldo, un 401 no', () => {
  const store = new Map<string, string>()
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  let senales: Array<AbortSignal | null | undefined> = []

  function servidor(r: { status: number; body?: unknown } | 'timeout' | 'sin-red') {
    senales = []
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      senales.push(init?.signal)
      if (r === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      if (r === 'sin-red') throw new TypeError('Failed to fetch')
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} } as unknown as Response
    })
  }

  beforeEach(() => {
    vi.resetModules()
    store.clear()
    store.set('fullsite_client_id', 'lab')
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('window', { localStorage: ls, location: { origin: 'https://pos.local' } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  async function gerenteCacheado() {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 200, body: { staff: { name: 'Gte', role: 'gerente' } } })
    expect(await pd.verifyManagerPin('7777')).toBe('Gte')
    return pd
  }

  it('verifyManagerHuella también lleva tope (estático: exige WebAuthn, no se puede ejercitar aquí)', () => {
    const src = readFileSync(path.resolve(__dirname, '../lib/pos-data.ts'), 'utf8')
    const i = src.indexOf('export async function verifyManagerHuella')
    const cuerpo = src.slice(i, src.indexOf('export async function hayHuellasDadasDeAlta'))
    expect(cuerpo).toContain('signal: AbortSignal.timeout(TIMEOUT_AUTORIDAD_PIN_MS)')
  })

  it('las tres verificaciones por PIN mandan un AbortSignal (antes: sin tope)', async () => {
    const pd = await import('@/lib/pos-data')
    servidor({ status: 401 })
    await pd.verifyManagerPin('1111')
    await pd.verifyManagerPinWithRole('1111')
    await pd.verifyPinWithMinRole('1111', 'capitan')
    expect(senales).toHaveLength(3)
    for (const s of senales) expect(s).toBeInstanceOf(AbortSignal)
    expect(TIMEOUT_AUTORIDAD_PIN_MS).toBeLessThanOrEqual(5000)
  })

  it('TIMEOUT → respaldo local: el gerente cacheado sí autoriza (no se le dice «PIN incorrecto»)', async () => {
    const pd = await gerenteCacheado()
    servidor('timeout')
    expect(await pd.verifyManagerPin('7777')).toBe('Gte')
    expect((await pd.verifyManagerPinWithRole('7777'))?.name).toBe('Gte')
    expect((await pd.verifyPinWithMinRole('7777', 'gerente'))?.name).toBe('Gte')
  })

  it('429 y 5xx → respaldo local', async () => {
    const pd = await gerenteCacheado()
    for (const status of [429, 500, 503]) {
      servidor({ status, body: { code: 'authority_unavailable' } })
      expect(await pd.verifyManagerPin('7777'), `status ${status}`).toBe('Gte')
    }
  })

  it('sin red → respaldo local', async () => {
    const pd = await gerenteCacheado()
    servidor('sin-red')
    expect(await pd.verifyManagerPin('7777')).toBe('Gte')
  })

  it('401 es veredicto: NO usa el caché aunque el PIN esté cacheado (p. ej. gerente dado de baja)', async () => {
    const pd = await gerenteCacheado()
    servidor({ status: 401 })
    expect(await pd.verifyManagerPin('7777')).toBeNull()
    expect(await pd.verifyManagerPinWithRole('7777')).toBeNull()
    expect(await pd.verifyPinWithMinRole('7777', 'gerente')).toBeNull()
  })

  it('timeout sin nada cacheado → null (no inventa una aprobación)', async () => {
    const pd = await import('@/lib/pos-data')
    servidor('timeout')
    expect(await pd.verifyManagerPin('9999')).toBeNull()
  })
})
