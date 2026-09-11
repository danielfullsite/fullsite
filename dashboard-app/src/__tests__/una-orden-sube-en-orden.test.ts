// UNA ORDEN SE SUBE EN ORDEN, O NO SE SUBE.
//
// P0 del barrido 2026-09-10 (offline-queue LENTE-3). La cola traía
// [POST A rev 0 (envío), POST A rev 1 cerrada (cobro)]. El envío recibía un 502
// transitorio y el bucle SEGUÍA: el cobro llegaba a un backend sano, la orden A
// no existía → ORDER_NOT_FOUND → TERMINAL, saltado para siempre. Al siguiente
// tick el envío creaba A (enviada): cobro en cajón, orden abierta en la nube.
//
// Ejerce el CÓDIGO REAL de pos-offline-db (queueOperation + syncAll) con
// fake-indexeddb y un servidor simulado que aplica OCC de verdad.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staging.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ANON_KEY_SENTINEL'

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { getSession } }) }))

function stubTerminalWithPin() {
  vi.stubGlobal('window', { location: { origin: 'https://pos.local' }, dispatchEvent: () => true })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => k === 'fullsite_client_id' ? 'tenantA' : k === 'pos_shift_token' ? 'SHIFT' : null,
    setItem: () => {}, removeItem: () => {},
  })
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  getSession.mockResolvedValue({ data: { session: null }, error: null })
}

/** Servidor OCC de juguete: los primeros `fallasIniciales` POST fallan con 502. */
function servidorOCC(fallasIniciales: number) {
  const ordenes = new Map<string, number>()
  const llamadas: { order_id: string; expected_revision: number; status: string }[] = []
  let fallas = fallasIniciales
  const respuesta = (ok: boolean, status: number, body: unknown) =>
    ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    llamadas.push({ order_id: body.order_id, expected_revision: body.expected_revision, status: body.status })
    if (fallas > 0) { fallas--; return respuesta(false, 502, { error: 'Bad Gateway' }) }
    const actual = ordenes.get(body.order_id)
    if (actual === undefined && body.expected_revision !== 0) return respuesta(true, 200, { ok: false, error: 'ORDER_NOT_FOUND' })
    if (actual !== undefined && actual !== body.expected_revision) {
      return respuesta(true, 200, { ok: false, conflict: true, expected_revision: body.expected_revision, current_revision: actual })
    }
    ordenes.set(body.order_id, body.expected_revision + 1)
    return respuesta(true, 200, { ok: true, revision: body.expected_revision + 1 })
  })
  return { ordenes, llamadas }
}

const flush = () => new Promise((r) => setTimeout(r, 60))

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
  stubTerminalWithPin()
})

describe('el cobro espera a que suba el envío de su misma orden', () => {
  it('REGRESION: un 502 en el envío no deja que el cobro llegue antes y muera como ORDER_NOT_FOUND', async () => {
    const srv = servidorOCC(1)
    const db = await import('@/lib/pos-offline-db')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'A', expected_revision: 0, status: 'enviada', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'A', expected_revision: 1, status: 'cerrada', pagos: [{ metodo: 'Efectivo', monto: 100 }], client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')
    // Una orden distinta detrás sí debe subir en el mismo pase.
    await db.queueOperation('pos_orders', 'POST', { order_id: 'B', expected_revision: 0, status: 'enviada', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    const pase1 = await db.syncAll()
    await flush()
    expect(srv.llamadas.map(l => l.order_id), 'el cobro de A NO se intentó; B sí').toEqual(['A', 'B'])
    expect(pase1.synced).toBe(1)
    const trasPase1 = await db.getPendingQueue()
    const cobro = trasPase1.find(i => (i.data as Record<string, unknown>).status === 'cerrada')!
    expect(cobro.retries, 'el cobro no consumió reintentos').toBe(0)
    expect(cobro.error_class, 'ni se clasificó').toBeUndefined()

    const pase2 = await db.syncAll()
    await flush()
    expect(pase2.synced).toBe(2)
    expect(await db.getPendingQueue()).toHaveLength(0)
    expect(srv.ordenes.get('A'), 'A quedó en revisión 2: enviada y luego cerrada').toBe(2)
  })

  it('REGRESION: la creación re-encolada al FINAL (buffer de localStorage) no vuelve terminal al cobro', async () => {
    const srv = servidorOCC(0)
    const db = await import('@/lib/pos-offline-db')
    // Orden de llegada invertido: primero el cobro, después la creación.
    await db.queueOperation('pos_orders', 'POST', { order_id: 'C', expected_revision: 1, status: 'cerrada', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')
    await db.queueOperation('pos_orders', 'POST', { order_id: 'C', expected_revision: 0, status: 'enviada', client_id: 'tenantA' }, '/api/pos/save-order', undefined, 'APP_API')

    await db.syncAll(); await flush()
    const cola = await db.getPendingQueue()
    const cobro = cola.find(i => (i.data as Record<string, unknown>).status === 'cerrada')!
    expect(cobro.error_class, 'ORDER_NOT_FOUND con la creación en cola NO es terminal').not.toBe('TERMINAL_NON_RETRYABLE')
    expect(cobro.retries).toBe(1)

    // La creación (detrás) SÍ subió en el mismo pase: la orden no se detiene
    // cuando lo que falta viene después. El cobro sube en el pase 2.
    expect(cola).toHaveLength(1)
    expect(srv.ordenes.get('C')).toBe(1)
    await db.syncAll(); await flush()
    expect(await db.getPendingQueue()).toHaveLength(0)
    expect(srv.ordenes.get('C')).toBe(2)
  })

  it('helpers: ordenDelItem y creacionPendienteEnCola', async () => {
    const { ordenDelItem, creacionPendienteEnCola } = await import('@/lib/pos-offline-db')
    expect(ordenDelItem({ data: { order_id: 'X' }, table: 'pos_orders' })).toBe('X')
    expect(ordenDelItem({ data: { id: 'Y' }, table: 'pos_orders' })).toBe('Y')
    expect(ordenDelItem({ data: { id: 'cm' }, table: 'pos_cash_movements' })).toBeNull()
    const cola = [
      { id: '1', synced: false, table: 'pos_orders', data: { order_id: 'X', expected_revision: 1 } },
      { id: '2', synced: false, table: 'pos_orders', data: { order_id: 'X', expected_revision: 0 } },
    ]
    expect(creacionPendienteEnCola('X', cola, '1')).toBe(true)
    expect(creacionPendienteEnCola('X', cola, '2')).toBe(false)
    expect(creacionPendienteEnCola('Z', cola, '1')).toBe(false)
  })
})

describe('la cola conserva el orden de encolado', () => {
  it('REGRESION: 50 operaciones encoladas en el mismo milisegundo se reproducen en el orden en que se encolaron', async () => {
    const db = await import('@/lib/pos-offline-db')
    for (let i = 0; i < 50; i++) {
      await db.queueOperation('pos_orders', 'POST', { order_id: `O${i}`, expected_revision: 0, n: i }, '/api/pos/save-order', undefined, 'APP_API')
    }
    const cola = await db.getPendingQueue()
    expect(cola.map(i => (i.data as { n: number }).n)).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })
})
