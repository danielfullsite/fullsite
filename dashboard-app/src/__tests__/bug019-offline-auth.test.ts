// BUG-019 — Aislamiento de tenant / replay offline autenticado.
//
// Estos tests ejercen el CÓDIGO REAL de src/lib/pos-offline-db.ts a través de su
// API pública (queueOperation + syncAll), NO reproducen la lógica en mocks. Solo
// se moquean las FRONTERAS del sistema:
//   - IndexedDB  → fake-indexeddb (implementación real de IDB en memoria)
//   - window/localStorage → stubs mínimos
//   - @/lib/supabase getSession() → controla el resultado de refresh de sesión
//   - fetch → captura los headers reales que emite el replay y simula el server
//
// Propiedades de seguridad verificadas (BUG-019):
//   1. Sesión fresca válida → replay usa Bearer <access_token de sesión>.
//   2. Access token expirado + refresh válido → se usa el token refrescado.
//   3. Refresh falla (revocado) → la cola NO se drena (fail closed).
//   4. Sin sesión → fail closed.
//   5. Nunca hay fallback a la anon key.
//   6. Membership revocada (server 401/403) → la cola se preserva (no se pierde).
//   7. El replay tiene éxito tras recuperar la sesión (re-auth).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const ANON = 'ANON_KEY_SENTINEL'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON

// getSession controlado por cada test.
const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { getSession } }),
}))

const dispatched: string[] = []
const fetchCalls: { url: string; authorization: string | null; apikey: string | null }[] = []

function stubEnvironment() {
  vi.stubGlobal('window', {
    location: { origin: 'https://pos.local' },
    dispatchEvent: (e: Event) => { dispatched.push(e.type); return true },
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k === 'fullsite_client_id' ? 'tenantA' : null),
    setItem: () => {},
    removeItem: () => {},
  })
}

// fetch de prueba: registra Authorization/apikey reales y responde según el test.
function installFetch(responder: (url: string) => { ok: boolean; status: number; body?: unknown }) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    fetchCalls.push({
      url: String(url),
      authorization: headers.get('authorization'),
      apikey: headers.get('apikey'),
    })
    const r = responder(String(url))
    return {
      ok: r.ok,
      status: r.status,
      json: async () => (r.body ?? { ok: r.ok }),
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response
  })
}

// Import dinámico DESPUÉS de fijar env, para que los const de módulo lean el env.
async function loadModule() {
  return await import('@/lib/pos-offline-db')
}

const flush = () => new Promise((r) => setTimeout(r, 60))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  dispatched.length = 0
  fetchCalls.length = 0
  // IDB limpio por test.
  vi.stubGlobal('indexedDB', new IDBFactory())
  stubEnvironment()
})

describe('BUG-019 — replay offline autenticado (código real)', () => {
  it('1. sesión fresca válida → APP_API replay usa Bearer <access_token de sesión>', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'FRESH_TOKEN', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })
    installFetch(() => ({ ok: true, status: 200, body: { ok: true } }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o1', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    const res = await db.syncAll()
    await flush()

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].authorization).toBe('Bearer FRESH_TOKEN')
    expect(res.synced).toBe(1)
    expect(await db.getPendingQueue()).toHaveLength(0)
  })

  it('2. access token expirado pero refresh válido → se usa el token REFRESCADO que devuelve getSession', async () => {
    // getSession() de Supabase refresca automáticamente y devuelve el token nuevo.
    getSession.mockResolvedValue({
      data: { session: { access_token: 'REFRESHED_TOKEN', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })
    installFetch(() => ({ ok: true, status: 200, body: { ok: true } }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o2', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    await db.syncAll()
    await flush()

    expect(fetchCalls[0].authorization).toBe('Bearer REFRESHED_TOKEN')
  })

  it('3. refresh falla (token revocado) → cola NO se drena, fetch NO se llama, se emite pos-sync-auth-required', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } })
    installFetch(() => ({ ok: true, status: 200 }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o3', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    const res = await db.syncAll()
    await flush()

    expect(fetchCalls).toHaveLength(0)              // no se intentó ningún replay
    expect(res).toEqual({ synced: 0, failed: 1 })   // fail closed
    expect(dispatched).toContain('pos-sync-auth-required')
    const pending = await db.getPendingQueue()
    expect(pending).toHaveLength(1)                 // cola preservada intacta
    expect(pending[0].synced).toBe(false)
  })

  it('4. sin sesión (access_token ausente) → fail closed, cola preservada', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: null } }, error: null })
    installFetch(() => ({ ok: true, status: 200 }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o4', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    const res = await db.syncAll()
    await flush()

    expect(fetchCalls).toHaveLength(0)
    expect(res.synced).toBe(0)
    expect(await db.getPendingQueue()).toHaveLength(1)
  })

  it('5. NUNCA hay fallback a anon key — ni en APP_API ni en SUPABASE_REST', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'FRESH_TOKEN', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })
    installFetch(() => ({ ok: true, status: 200, body: { ok: true } }))
    const db = await loadModule()
    // Un item SUPABASE_REST (PostgREST directo) — el más sensible: antes iba con anon.
    await db.queueOperation('pos_cash_movements', 'POST', { id: 'c1', client_id: 'tenantA', amount: 100 })

    await db.syncAll()
    await flush()

    expect(fetchCalls).toHaveLength(1)
    // Authorization = token de sesión, NO la anon key.
    expect(fetchCalls[0].authorization).toBe('Bearer FRESH_TOKEN')
    expect(fetchCalls[0].authorization).not.toBe(`Bearer ${ANON}`)
    // apikey sigue siendo la anon (requisito de PostgREST), pero NO es la autorización.
    expect(fetchCalls[0].apikey).toBe(ANON)
  })

  it('6. auth rechazada (server 401) → item preservado sin quemar retries y pide re-auth', async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'FRESH_TOKEN', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })
    // El device aún tiene sesión, pero el server rechaza (RLS: membership revocada).
    installFetch(() => ({ ok: false, status: 401, body: { ok: false } }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o6', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    const res = await db.syncAll()
    await flush()

    expect(fetchCalls).toHaveLength(1)                 // se intentó autenticado
    expect(res.synced).toBe(0)
    const pending = await db.getPendingQueue()
    expect(pending).toHaveLength(1)                    // NO se perdió el dato
    expect(pending[0].synced).toBe(false)
    expect(pending[0].retries).toBe(0)                 // auth no consume presupuesto de red
    expect(dispatched).toContain('pos-sync-auth-required')
  })

  it('7. replay tiene éxito tras recuperar sesión (re-auth) — la cola preservada se drena', async () => {
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { id: 'o7', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    // Primer intento: sin sesión → fail closed, preservado.
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'no session' } })
    installFetch(() => ({ ok: true, status: 200, body: { ok: true } }))
    await db.syncAll()
    await flush()
    expect(await db.getPendingQueue()).toHaveLength(1)

    // Re-auth: ahora hay sesión válida → drena.
    getSession.mockResolvedValue({
      data: { session: { access_token: 'REAUTH_TOKEN', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    })
    const res = await db.syncAll()
    await flush()

    expect(res.synced).toBe(1)
    expect(fetchCalls.at(-1)?.authorization).toBe('Bearer REAUTH_TOKEN')
    expect(await db.getPendingQueue()).toHaveLength(0)
  })
})
