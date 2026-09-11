// Un 401 con la sesion de Supabase se reintenta con el shift token.
//
// Barrido 2026-09-10 (offline-queue LENTE-5): en la maquina de la caja alguien
// entro al dashboard (sesion de Supabase con refresh de semanas) y la terminal
// opera con PIN (shift token del tenant). El replay prefiere la sesion (BUG-019)
// y si ese usuario no tiene membresia en el tenant, /api/pos/save-order responde
// 401 en cada drenado → AUTH_EXPIRED → deslogueo en bucle cada 20 s, aunque el
// shift token —el mismo con el que se guarda online— es valido.
//
// Ejerce el codigo real (queueOperation + syncAll) con fake-indexeddb.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON_KEY_SENTINEL'

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { getSession } }) }))

const dispatched: string[] = []
const auths: string[] = []

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  dispatched.length = 0; auths.length = 0
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('window', { location: { origin: 'https://pos.local' }, dispatchEvent: (e: Event) => { dispatched.push(e.type); return true } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => k === 'fullsite_client_id' ? 'amalay' : k === 'pos_shift_token' ? 'SHIFT_AMALAY' : null,
    setItem: () => {}, removeItem: () => {},
  })
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  // Sesion de dashboard viva en la maquina, de un usuario SIN membresia en amalay.
  getSession.mockResolvedValue({ data: { session: { access_token: 'JWT_DE_OTRO', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null })
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
    auths.push(auth)
    if (auth === 'Bearer SHIFT_AMALAY') return { ok: true, status: 200, json: async () => ({ ok: true, revision: 1 }), text: async () => '' } as unknown as Response
    return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }), text: async () => 'unauthorized' } as unknown as Response
  })
})

describe('replay APP_API con sesion ajena y shift token valido', () => {
  it('REGRESION: el 401 de la sesion se reintenta con el shift token, sube, y NO se desloguea la caja', async () => {
    const db = await import('@/lib/pos-offline-db')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'A', expected_revision: 0, client_id: 'amalay' }, '/api/pos/save-order', undefined, 'APP_API')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'B', expected_revision: 0, client_id: 'amalay' }, '/api/pos/save-order', undefined, 'APP_API')
    const res = await db.syncAll()
    await new Promise(r => setTimeout(r, 60))
    expect(res.synced).toBe(2)
    expect(auths.slice(0, 2)).toEqual(['Bearer JWT_DE_OTRO', 'Bearer SHIFT_AMALAY'])
    expect(auths[2], 'el resto del pase sigue con el shift token').toBe('Bearer SHIFT_AMALAY')
    expect(dispatched).not.toContain('pos-sync-auth-required')
    expect(await db.getPendingQueue()).toHaveLength(0)
  })

  it('si el shift token TAMBIEN da 401, se pide re-PIN como antes y la cola se conserva', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' }) as unknown as Response)
    const db = await import('@/lib/pos-offline-db')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'A', expected_revision: 0, client_id: 'amalay' }, '/api/pos/save-order', undefined, 'APP_API')
    await db.syncAll()
    await new Promise(r => setTimeout(r, 60))
    expect(dispatched).toContain('pos-sync-auth-required')
    const cola = await db.getPendingQueue()
    expect(cola).toHaveLength(1)
    expect(cola[0].retries).toBe(0)
  })
})
