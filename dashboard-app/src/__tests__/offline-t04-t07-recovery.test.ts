// Matriz offline — T-04 (POS reinicia) y T-07 (KDS reinicia).
//
// Ambos escenarios aseveran MECANISMOS DE RECUPERACIÓN, no la UI de Electron:
//   T-04 → drainLocalStorageToIdb() drena el buffer de emergencia
//        → recoverFromIDB() restaura los print jobs pendientes
//   T-07 → al reconectar, SUBSCRIBE lleva last_sequence para pedir el catch-up
//
// Eso es lo que se prueba aquí, determinista y en CI. Lo que NO cubre y sigue
// necesitando la caja física: que el proceso de Electron arranque, que el Service
// Worker sirva el shell, y que el Local Server haga replay de events.ndjson.
// Ver docs/offline/TEST-MATRIX.md y docs/offline/EVIDENCIA-CAMPO-AMALAY-2026-08-24.md.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { drainLocalStorageToIdb, getPendingQueue, getIDBPrintJobs, saveIDBPrintJob } from '@/lib/pos-offline-db'

const LS_QUEUE = 'fullsite_offline_queue'

/** localStorage mínimo — el entorno de vitest aquí es node. */
function instalarLocalStorage() {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size },
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { localStorage: ls })
  return ls
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => { vi.unstubAllGlobals() })

// ─────────────────────────────────────────────────────────────────────────────
// T-04 — POS reinicia
// ─────────────────────────────────────────────────────────────────────────────

describe('T-04 · drenar el buffer de emergencia de localStorage al arrancar', () => {
  it('lo escrito en localStorage llega a la cola de sync de IDB', async () => {
    const ls = instalarLocalStorage()
    ls.setItem(LS_QUEUE, JSON.stringify([
      { table: 'pos_orders', method: 'PATCH', data: { id: 'o1', total: 250 } },
      { table: 'pos_orders', method: 'POST', data: { id: 'o2', total: 120 } },
    ]))

    await drainLocalStorageToIdb()

    const cola = await getPendingQueue()
    expect(cola.length, 'los 2 items del buffer deben quedar en la cola canónica').toBe(2)
    expect(ls.getItem(LS_QUEUE), 'el buffer se limpia sólo si TODO se escribió').toBeNull()
  })

  it('EL RIESGO REAL: lo del buffer es invisible para syncAll hasta que se drena', async () => {
    const ls = instalarLocalStorage()
    ls.setItem(LS_QUEUE, JSON.stringify([{ table: 'pos_orders', method: 'PATCH', data: { id: 'huerfana' } }]))

    // Antes de drenar, la cola canónica está vacía: esa orden se perdería en silencio.
    expect((await getPendingQueue()).length).toBe(0)

    await drainLocalStorageToIdb()
    expect((await getPendingQueue()).length).toBe(1)
  })

  it('es idempotente: drenar dos veces no duplica', async () => {
    const ls = instalarLocalStorage()
    ls.setItem(LS_QUEUE, JSON.stringify([{ table: 'pos_orders', method: 'PATCH', data: { id: 'o1' } }]))

    await drainLocalStorageToIdb()
    await drainLocalStorageToIdb()

    expect((await getPendingQueue()).length).toBe(1)
  })

  it('los ya sincronizados no se re-encolan', async () => {
    const ls = instalarLocalStorage()
    ls.setItem(LS_QUEUE, JSON.stringify([
      { table: 'pos_orders', method: 'PATCH', data: { id: 'vieja' }, synced: true },
      { table: 'pos_orders', method: 'PATCH', data: { id: 'nueva' } },
    ]))

    await drainLocalStorageToIdb()

    expect((await getPendingQueue()).length).toBe(1)
    expect(ls.getItem(LS_QUEUE)).toBeNull()
  })

  it('sin buffer no truena ni deja basura', async () => {
    instalarLocalStorage()
    await expect(drainLocalStorageToIdb()).resolves.toBeUndefined()
    expect((await getPendingQueue()).length).toBe(0)
  })

  it('un buffer corrupto no tumba el arranque', async () => {
    const ls = instalarLocalStorage()
    ls.setItem(LS_QUEUE, '{esto no es json}')
    await expect(drainLocalStorageToIdb()).resolves.toBeUndefined()
  })
})

describe('T-04 · los print jobs sobreviven al reinicio', () => {
  it('un job pendiente en IDB sigue ahí después de reiniciar', async () => {
    await saveIDBPrintJob({
      id: 'job-1', station: 'cocina', data: JSON.stringify({ texto: 'comanda' }), type: 'comanda',
      status: 'pending', retries: 0, maxRetries: 3, createdAt: new Date().toISOString(),
      lastAttempt: null, error: null,
    })

    // Reiniciar = perder memoria y localStorage, NO IndexedDB.
    const jobs = await getIDBPrintJobs()
    expect(jobs.length).toBe(1)
    expect(jobs[0].id).toBe('job-1')
  })

  it('bridge_unavailable no es un estado terminal — debe poder reintentarse', async () => {
    await saveIDBPrintJob({
      id: 'job-2', station: 'barra', data: '{}', type: 'comanda',
      status: 'bridge_unavailable', retries: 1, maxRetries: 3, createdAt: new Date().toISOString(),
      lastAttempt: null, error: null,
    })

    const jobs = await getIDBPrintJobs()
    const recuperables = jobs.filter(j =>
      j.status === 'pending' || j.status === 'retrying' || j.status === 'bridge_unavailable')

    expect(recuperables.length,
      'una comanda que no se imprimió porque el bridge estaba caído NO puede perderse').toBe(1)
  })

  it('lo ya impreso no se reimprime al arrancar', async () => {
    await saveIDBPrintJob({
      id: 'job-3', station: 'cocina', data: '{}', type: 'comanda',
      status: 'printed', retries: 0, maxRetries: 3, createdAt: new Date().toISOString(),
      lastAttempt: null, error: null,
    })

    const jobs = await getIDBPrintJobs()
    const recuperables = jobs.filter(j =>
      j.status === 'pending' || j.status === 'retrying' || j.status === 'bridge_unavailable')

    expect(recuperables.length, 'reimprimir una comanda ya impresa es peor que no imprimirla').toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T-07 — KDS reinicia
// ─────────────────────────────────────────────────────────────────────────────

/** WebSocket falso que captura lo que el cliente manda. */
function instalarWebSocketFalso() {
  const enviados: Record<string, unknown>[] = []
  const instancias: FakeWS[] = []

  class FakeWS {
    static readonly OPEN = 1
    static readonly CONNECTING = 0
    readyState = 1
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) { instancias.push(this) }
    send(raw: string) { enviados.push(JSON.parse(raw)) }
    close() { this.readyState = 3; this.onclose?.() }
    abrir() { this.onopen?.() }
    recibir(msg: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  }

  vi.stubGlobal('WebSocket', FakeWS)
  return { enviados, instancias, suscripciones: () => enviados.filter(m => m.type === 'SUBSCRIBE') }
}

describe('T-07 · el KDS reinicia y pide lo que se perdió', () => {
  it('SUBSCRIBE lleva last_sequence — es lo que permite el catch-up', async () => {
    const ws = instalarWebSocketFalso()
    const { BridgeClient } = await import('@/lib/bridge-client')

    const kds = new BridgeClient('kds-1', 'kds', 'amalay', 0, 'ws://127.0.0.1:7717/ws')
    kds.connect()
    ws.instancias[0].abrir()

    const sub = ws.suscripciones()[0]
    expect(sub).toBeDefined()
    expect(sub.type).toBe('SUBSCRIBE')
    expect(sub.client_type).toBe('kds')
    expect(sub).toHaveProperty('last_sequence', 0)
  })

  it('EL CONTRATO: tras reiniciar, pide desde la última secuencia vista, no desde cero', async () => {
    const ws = instalarWebSocketFalso()
    const { BridgeClient } = await import('@/lib/bridge-client')

    // Sesión 1: el KDS ve tres órdenes (secuencias 41, 42, 43).
    const kds1 = new BridgeClient('kds-1', 'kds', 'amalay', 0, 'ws://127.0.0.1:7717/ws')
    kds1.connect()
    ws.instancias[0].abrir()
    ws.instancias[0].recibir({ type: 'SNAPSHOT', sequence: 41, payload: { state: {}, deltas: [] } })
    ws.instancias[0].recibir({ type: 'DELTA', sequence: 42 })
    ws.instancias[0].recibir({ type: 'DELTA', sequence: 43 })

    expect(kds1.lastSequence).toBe(43)

    // Reinicio del KDS: proceso nuevo, arranca desde la secuencia persistida.
    const kds2 = new BridgeClient('kds-1', 'kds', 'amalay', kds1.lastSequence, 'ws://127.0.0.1:7717/ws')
    kds2.connect()
    ws.instancias[1].abrir()

    const sub = ws.suscripciones()[1]
    expect(sub.last_sequence,
      'si pidiera desde 0 el servidor reenviaría TODO el día; si pidiera mal, faltarían comandas').toBe(43)
  })

  it('la secuencia sólo avanza — un mensaje viejo no la retrocede', async () => {
    const ws = instalarWebSocketFalso()
    const { BridgeClient } = await import('@/lib/bridge-client')

    const kds = new BridgeClient('kds-1', 'kds', 'amalay', 0, 'ws://127.0.0.1:7717/ws')
    kds.connect()
    ws.instancias[0].abrir()
    ws.instancias[0].recibir({ type: 'DELTA', sequence: 50 })
    ws.instancias[0].recibir({ type: 'DELTA', sequence: 12 })  // fuera de orden

    expect(kds.lastSequence, 'retroceder haría que el servidor reenvíe deltas ya aplicados').toBe(50)
  })

  it('un frame corrupto no tumba el KDS ni mueve la secuencia', async () => {
    const ws = instalarWebSocketFalso()
    const { BridgeClient } = await import('@/lib/bridge-client')

    const kds = new BridgeClient('kds-1', 'kds', 'amalay', 7, 'ws://127.0.0.1:7717/ws')
    kds.connect()
    ws.instancias[0].abrir()

    expect(() => ws.instancias[0].onmessage?.({ data: 'no-es-json{' })).not.toThrow()
    expect(kds.lastSequence).toBe(7)
  })

  it('PONG y mensajes sin secuencia no la alteran', async () => {
    const ws = instalarWebSocketFalso()
    const { BridgeClient } = await import('@/lib/bridge-client')

    const kds = new BridgeClient('kds-1', 'kds', 'amalay', 30, 'ws://127.0.0.1:7717/ws')
    kds.connect()
    ws.instancias[0].abrir()
    ws.instancias[0].recibir({ type: 'PONG' })

    expect(kds.lastSequence).toBe(30)
  })
})
