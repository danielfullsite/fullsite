/**
 * TELEMETRÍA — oráculos del lado del cliente (F, G, I, J, K) y la mutación.
 *
 * Corren sobre IndexedDB de verdad (`fake-indexeddb`), no sobre un mock de la
 * cola: el punto entero de F es QUÉ pasa alrededor de `tx.oncomplete`, y un
 * doble de la cola no tiene transacciones que commitear.
 *
 * La regla que vigilan todas:
 *
 *     LA TELEMETRÍA NO PUEDE FALLAR, DEMORAR NI CAMBIAR UNA OPERACIÓN DE NEGOCIO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

/** Lo que la terminal mandó al endpoint de telemetría durante la prueba. */
let enviados: Array<{ event_type: string; payload: Record<string, unknown>; terminal_id: string | null }>
let almacen: Record<string, string>

function montarEntorno(opciones: { terminalProvisionada?: string | null; telemetriaTruena?: boolean } = {}) {
  enviados = []
  almacen = {}
  if (opciones.terminalProvisionada) almacen['FULLSITE_TERMINAL_ID'] = opciones.terminalProvisionada
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}` })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in almacen ? almacen[k] : null),
    setItem: (k: string, v: string) => { almacen[k] = v },
    removeItem: (k: string) => { delete almacen[k] },
    get length() { return Object.keys(almacen).length },
    key: (i: number) => Object.keys(almacen)[i] ?? null,
  })
  vi.stubGlobal('window', { location: { pathname: '/pos' }, dispatchEvent: vi.fn(), addEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes('/api/pos/telemetry')) {
      if (opciones.telemetriaTruena) throw new TypeError('telemetría caída')
      const b = JSON.parse(init.body as string)
      enviados.push({ event_type: b.event_type, payload: b.payload, terminal_id: b.terminal_id })
      return Response.json({ ok: true })
    }
    return Response.json({}, { status: 500 })
  }))
}

const esperarTelemetria = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)) }

beforeEach(() => { vi.resetModules() })
afterEach(() => vi.unstubAllGlobals())

// ─────────────────────────────────────────────────────────────────────────────
describe('F · command_queued sólo DESPUÉS del commit de IndexedDB', () => {
  // ESTE es el guardián del orden de commit, y está probado como tal: con la
  // mutación prohibida (emitir antes de `tx.oncomplete`) `queue_depth_after_commit`
  // vale 0 en vez de 1 y esta prueba falla. Verificado el 2026-09-19 aplicando la
  // mutación al archivo y restaurándolo: 2 fallas → 14/14.
  it('se emite tras encolar, con el id del item y la profundidad', async () => {
    montarEntorno()
    const { queueOperation } = await import('@/lib/pos-offline-db')
    const id = await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    await esperarTelemetria()
    const ev = enviados.filter(e => e.event_type === 'command_queued')
    expect(ev).toHaveLength(1)
    expect(ev[0].payload.queue_item_id).toBe(id)
    expect(ev[0].payload.table).toBe('pos_orders')
    expect(ev[0].payload.queue_depth_after_commit).toBe(1)
  })

  // La prueba de mutación NO es una aserción: es un procedimiento. Se mueve la
  // emisión antes de `tx.oncomplete` en el archivo real, se corre esta suite y
  // debe fallar. Hecho el 2026-09-19: 2 fallas con la mutación, 14/14 al
  // restaurar. Una aserción que "simula" la mutación no probaría nada, porque el
  // fallo depende del orden real de los microtasks.
})

describe('G · onLine=true con la nube caída SIGUE produciendo racha', () => {
  it('la racha nace del encolado, no de navigator.onLine', async () => {
    montarEntorno()
    vi.stubGlobal('navigator', { onLine: true }) // el navegador jura que hay red
    const { queueOperation } = await import('@/lib/pos-offline-db')
    await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    await esperarTelemetria()
    const ev = enviados.find(e => e.event_type === 'command_queued')
    expect(ev?.payload.streak_id).toBeTruthy()
    expect(ev?.payload.streak_start).toBeTruthy()
  })

  it('ninguna función de observación consulta navigator.onLine', async () => {
    const fuente = (await import('node:fs')).readFileSync(
      new URL('../lib/pos-offline-db.ts', import.meta.url), 'utf8')
    // Se acota a LO QUE AGREGA ESTE PR. `registerAutoSync` usa `navigator.onLine`
    // como compuerta de su polling desde antes: es maquinaria de negocio, no una
    // señal de telemetría, y este PR no la toca.
    for (const fn of ['observarEncolado', 'observarDrenadoTerminado', 'idRacha']) {
      const i = fuente.indexOf(`function ${fn}`)
      expect(i, `no se encontró ${fn}`).toBeGreaterThan(-1)
      // Sin comentarios: la aserción es sobre CÓDIGO. Un comentario que explica
      // por qué no se usa `navigator.onLine` no es usarlo — y la primera versión
      // de esta prueba falló justamente contra su propia prosa.
      const cuerpo = fuente.slice(i, fuente.indexOf('\n}', i)).replace(/\/\/[^\n]*/g, '')
      expect(cuerpo, `${fn} no debe mirar navigator.onLine`).not.toContain('navigator.onLine')
    }
  })
})

describe('D · identidad de terminal en el cliente', () => {
  it('usa FULLSITE_TERMINAL_ID cuando existe', async () => {
    montarEntorno({ terminalProvisionada: 'pos2-caja' })
    const { queueOperation } = await import('@/lib/pos-offline-db')
    await queueOperation('pos_orders', 'POST', {}, 'pos_orders')
    await esperarTelemetria()
    expect(enviados[0].terminal_id).toBe('pos2-caja')
  })

  it('NUNCA cae a pos_terminal_id ni al device id aleatorio', async () => {
    montarEntorno()
    almacen['pos_terminal_id'] = 'term_inventado_por_el_navegador'
    almacen['fullsite_device_id'] = 'POS-ABCD'
    const { queueOperation } = await import('@/lib/pos-offline-db')
    await queueOperation('pos_orders', 'POST', {}, 'pos_orders')
    await esperarTelemetria()
    expect(enviados[0].terminal_id).toBeNull()
  })
})

describe('D+ · una racha contigua da UN solo offline_entered derivado', () => {
  it('tres encolados comparten streak_id — el primero es el offline_entered', async () => {
    montarEntorno()
    const { queueOperation } = await import('@/lib/pos-offline-db')
    for (let i = 0; i < 3; i++) await queueOperation('pos_orders', 'POST', { i }, 'pos_orders')
    await esperarTelemetria()
    const ev = enviados.filter(e => e.event_type === 'command_queued')
    expect(ev).toHaveLength(3)
    const rachas = new Set(ev.map(e => e.payload.streak_id))
    expect(rachas.size).toBe(1)
    expect(new Set(ev.map(e => e.payload.streak_start)).size).toBe(1)
  })
})

describe('K · la telemetría caída NO afecta al negocio', () => {
  it('con el endpoint de telemetría tronando, encolar sigue devolviendo su id', async () => {
    montarEntorno({ telemetriaTruena: true })
    const { queueOperation, getPendingQueue } = await import('@/lib/pos-offline-db')
    const id = await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    await esperarTelemetria()
    expect(id).toBeTruthy()
    expect((await getPendingQueue()).length).toBe(1)   // la operación de negocio quedó
    expect(enviados).toHaveLength(0)                    // y la observación se perdió sin ruido
  })

  it('sin localStorage, encolar sigue funcionando', async () => {
    montarEntorno()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqueado') },
                                    setItem: () => { throw new Error('bloqueado') } })
    const { queueOperation, getPendingQueue } = await import('@/lib/pos-offline-db')
    const id = await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    expect(id).toBeTruthy()
    expect((await getPendingQueue()).length).toBe(1)
  })
})

describe('J · saltado ≠ fallado ≠ sincronizado', () => {
  it('los tres van en campos distintos y con su fórmula declarada', async () => {
    montarEntorno()
    const { syncAll } = await import('@/lib/pos-offline-db')
    await syncAll()
    await esperarTelemetria()
    const fin = enviados.find(e => e.event_type === 'queue_drain_completed')
    expect(fin).toBeTruthy()
    for (const campo of ['depth_before', 'depth_after', 'synced', 'failed', 'skipped']) {
      expect(fin!.payload).toHaveProperty(campo)
    }
    expect(fin!.payload.skipped_formula).toBe('depth_before - synced - failed')
  })
})

describe('I · el drenado abre y cierra una sola vez, con profundidades', () => {
  it('un drenado con la cola vacía emite start y completed con depth 0', async () => {
    montarEntorno()
    const { syncAll } = await import('@/lib/pos-offline-db')
    await syncAll()
    await esperarTelemetria()
    const inicios = enviados.filter(e => e.event_type === 'queue_drain_started')
    const fines = enviados.filter(e => e.event_type === 'queue_drain_completed')
    expect(inicios).toHaveLength(1)
    expect(fines).toHaveLength(1)
    expect(inicios[0].payload.depth_before).toBe(0)
    expect(fines[0].payload.depth_before).toBe(0)
    expect(fines[0].payload.depth_after).toBe(0)
  })

  it('depth_before de start y de completed son EL MISMO número', async () => {
    montarEntorno()
    const { queueOperation, syncAll } = await import('@/lib/pos-offline-db')
    await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    enviados.length = 0
    await syncAll()
    await esperarTelemetria()
    const ini = enviados.find(e => e.event_type === 'queue_drain_started')
    const fin = enviados.find(e => e.event_type === 'queue_drain_completed')
    expect(ini!.payload.depth_before).toBe(fin!.payload.depth_before)
  })
})

describe('H · reconnect_detected sólo con prueba de nube utilizable', () => {
  it('un drenado que no sincronizó NADA no declara reconexión', async () => {
    montarEntorno()
    const { queueOperation, syncAll } = await import('@/lib/pos-offline-db')
    await queueOperation('pos_orders', 'POST', { x: 1 }, 'pos_orders')
    await syncAll()
    await esperarTelemetria()
    expect(enviados.filter(e => e.event_type === 'reconnect_detected')).toHaveLength(0)
  })
  // Que un `synced > 0` SÍ lo declare se prueba en runtime contra el laboratorio:
  // necesita que la nube acepte de verdad, y un doble que devuelva 200 probaría
  // el doble, no el camino.
})
