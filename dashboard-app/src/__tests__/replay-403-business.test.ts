// P0-1 — El replay debe distinguir un 403 DE NEGOCIO de un 401 de autenticación.
//
// Ejercen el CÓDIGO REAL de src/lib/pos-offline-db.ts vía su API pública
// (queueOperation + syncAll). Solo se moquean las fronteras: IndexedDB
// (fake-indexeddb), window/localStorage, getSession y fetch.
//
// El contrato, alineado con la semántica HTTP y con lo que el servidor emite:
//   • 401 = NO autenticado (shift token vencido). Re-PIN LO ARREGLA.
//     → detener el drenado, preservar la cola sin quemar reintentos, pedir re-PIN.
//   • 403 = autenticado PERO sin permiso (regla de negocio). Re-PIN con el MISMO
//     staff NO lo arregla. → aislar ESE item como TERMINAL_NON_RETRYABLE y SEGUIR
//     drenando el resto.
//
// Los 403 realmente alcanzables (verificados en el server):
//   /api/pos/db      → 'manager required'  (pos_cash_movements / pos_cierres escritos
//                       por staff no-gerente: el shift token lleva el rol del staff
//                       LOGUEADO, no el del gerente que autorizó con su PIN)
//                    → 'table not allowed'
//   /api/pos/save-order → 'MANAGER_APPROVAL_REQUIRED'
// Los fallos de auth de ambos son 401, nunca 403.
//
// La regresión que esto blinda: tratar el 403 como sesión expirada hacía `break`
// (todo lo encolado DESPUÉS nunca subía) + emitAuthRequired (deslogueo en bucle
// cada ~20s, porque al re-teclear el PIN syncAll volvía a chocar con el mismo 403).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

const ANON = 'ANON_KEY_SENTINEL'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { getSession } }) }))

const dispatched: string[] = []
const fetchCalls: { url: string; method: string }[] = []

// Terminal POS real: PIN → shift token, SIN sesión de Supabase.
function stubTerminalWithPin() {
  vi.stubGlobal('window', {
    location: { origin: 'https://pos.local' },
    dispatchEvent: (e: Event) => { dispatched.push(e.type); return true },
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) =>
      k === 'fullsite_client_id' ? 'tenantA' :
      k === 'pos_shift_token' ? 'SHIFT_TOKEN_CAJERO' : null,
    setItem: () => {}, removeItem: () => {},
  })
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  getSession.mockResolvedValue({ data: { session: null }, error: null })
}

function installFetch(responder: (url: string) => { ok: boolean; status: number; body?: unknown }) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: init?.method || 'GET' })
    const r = responder(String(url))
    return {
      ok: r.ok, status: r.status,
      json: async () => (r.body ?? { ok: r.ok }),
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
    } as unknown as Response
  })
}

const flush = () => new Promise((r) => setTimeout(r, 60))
const loadModule = async () => await import('@/lib/pos-offline-db')

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  dispatched.length = 0; fetchCalls.length = 0
  vi.stubGlobal('indexedDB', new IDBFactory())
  stubTerminalWithPin()
})

describe('P0-1 — 403 de negocio vs 401 de auth en el replay', () => {
  it('REST: 403 "manager required" aísla el item y SIGUE drenando el resto de la cola', async () => {
    // El retiro de caja lo rechaza el proxy (cajero logueado); la orden siguiente NO.
    installFetch((url) =>
      url.includes('pos_cash_movements')
        ? { ok: false, status: 403, body: { error: 'manager required' } }
        : { ok: true, status: 200, body: { ok: true } })
    const db = await loadModule()
    await db.queueOperation('pos_cash_movements', 'POST', { id: 'cm1', client_id: 'tenantA', amount: 3000 }, undefined, undefined, 'SUPABASE_REST')
        // El PATCH lleva filtro a proposito. Antes este fixture iba SIN endpoint —
    // `queueOperation('pos_turnos','PATCH',{...}, undefined, undefined, ...)`— que es
    // exactamente la forma que el 2026-08-31 cerro los ONCE turnos de AMALAY de un
    // golpe: el replay arma `endpoint || table` y sin filtro el PATCH toca toda la
    // tabla. El replay ahora la bloquea, asi que el fixture tenia que dejar de usarla.
    // La afirmacion de esta prueba no cambia: un 403 aisla UN item y el drenado sigue.
    await db.queueOperation('pos_turnos', 'PATCH', { id: 't1', client_id: 'tenantA' }, `pos_turnos?id=eq.t1`, undefined, 'SUPABASE_REST')

    const res = await db.syncAll()
    await flush()

    // El item de después SÍ subió — el drenado no se abortó.
    expect(res.synced).toBe(1)
    expect(res.failed).toBe(1)
    expect(fetchCalls).toHaveLength(2)

    // NO se desloguea al operador: un 403 de negocio no es sesión expirada.
    expect(dispatched).not.toContain('pos-sync-auth-required')

    // El retiro queda aislado y preservado, con su clase de error correcta.
    const pending = await db.getPendingQueue()
    const cm = pending.find((i) => i.table === 'pos_cash_movements')
    expect(cm).toBeDefined()
    expect(cm!.synced).toBe(false)
    expect(cm!.error_class).toBe('TERMINAL_NON_RETRYABLE')
    expect(cm!.conflict).toBe(true)
    // El payload no se tocó — el dinero sigue ahí para resolverlo.
    expect((cm!.data as Record<string, unknown>).amount).toBe(3000)
  })

  it('REST: 401 real SÍ detiene el drenado, preserva la cola y pide re-PIN', async () => {
    installFetch(() => ({ ok: false, status: 401, body: { error: 'unauthorized' } }))
    const db = await loadModule()
    await db.queueOperation('pos_cash_movements', 'POST', { id: 'cm2', client_id: 'tenantA' }, undefined, undefined, 'SUPABASE_REST')
            await db.queueOperation('pos_turnos', 'PATCH', { id: 't2', client_id: 'tenantA' }, `pos_turnos?id=eq.t2`, undefined, 'SUPABASE_REST')

    await db.syncAll()
    await flush()

    // break: sólo se intentó el primero.
    expect(fetchCalls).toHaveLength(1)
    expect(dispatched).toContain('pos-sync-auth-required')

    const pending = await db.getPendingQueue()
    expect(pending).toHaveLength(2)                       // nada se perdió
    // Auth no consume presupuesto de red ni marca terminal: re-PIN lo arregla.
    expect(pending.every((i) => (i.retries ?? 0) === 0)).toBe(true)
    expect(pending.every((i) => !i.error_class)).toBe(true)
  })

  it('APP_API: 403 MANAGER_APPROVAL_REQUIRED es TERMINAL, no sesión expirada', async () => {
    installFetch(() => ({ ok: false, status: 403, body: { ok: false, error: 'MANAGER_APPROVAL_REQUIRED' } }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', { order_id: 'o9', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    await db.syncAll()
    await flush()

    expect(dispatched).not.toContain('pos-sync-auth-required')
    const item = (await db.getPendingQueue()).find((i) => i.table === 'pos_orders')
    expect(item!.error_class).toBe('TERMINAL_NON_RETRYABLE')
    expect(item!.conflict).toBe(true)
  })

  it('APP_API: 409 por turno cerrado preserva la orden como conflicto y no reintenta', async () => {
    installFetch(() => ({ ok: false, status: 409, body: { ok: false, error: 'TURN_CLOSED_NO_ACTIVE' } }))
    const db = await loadModule()
    await db.queueOperation('pos_orders', 'POST', {
      order_id: 'offline-turn', turno_id: 'closed-turn', total: 665.84,
    }, '/api/pos/save-order', undefined, 'APP_API')

    const result = await db.syncAll()
    await flush()

    expect(result).toEqual({ synced: 0, failed: 1 })
    const item = (await db.getPendingQueue()).find((i) => i.table === 'pos_orders')
    expect(item).toBeDefined()
    expect(item!.error_class).toBe('TERMINAL_NON_RETRYABLE')
    expect(item!.error_detail).toBe('TURN_CLOSED_NO_ACTIVE')
    expect(item!.conflict).toBe(true)
    expect((item!.data as Record<string, unknown>).total).toBe(665.84)
  })

  it('el bucle de deslogueo no reaparece: un segundo syncAll tras re-PIN no reintenta el item terminal', async () => {
    installFetch((url) =>
      url.includes('pos_cash_movements')
        ? { ok: false, status: 403, body: { error: 'manager required' } }
        : { ok: true, status: 200, body: { ok: true } })
    const db = await loadModule()
    await db.queueOperation('pos_cash_movements', 'POST', { id: 'cm3', client_id: 'tenantA' }, undefined, undefined, 'SUPABASE_REST')

    await db.syncAll()
    await flush()
    const afterFirst = fetchCalls.length

    // Esto es lo que hace pos/layout.tsx al re-teclear el PIN.
    await db.resetSyncQueueRetries()
    await db.syncAll({ retryExhausted: true })
    await flush()

    // El item terminal se salta: ni se re-intenta ni vuelve a desloguear.
    expect(fetchCalls.length).toBe(afterFirst)
    expect(dispatched).not.toContain('pos-sync-auth-required')
  })
})
