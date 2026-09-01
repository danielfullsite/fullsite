// Insistir en "Abrir turno" no puede crear un turno por cada toque.
//
// INCIDENTE 2026-08-31, AMALAY. Quedaron ONCE turnos abiertos en 25 minutos, varios
// con `closed_at` anterior a `opened_at`. Daniel, en vivo: "abri turno y me dice que
// abra turno otra vez".
//
// CAUSA. `openTurno` generaba el id con `Date.now() + Math.random()` en CADA llamada.
// El comentario del codigo decia "id client-side = idempotente, sin duplicar" — cierto
// solo para los reintentos de UNA llamada. Cada toque nuevo = id nuevo = fila nueva.
//
// El guard `getActiveTurno()` que corre antes solo protege cuando ALCANZA A VER el
// turno existente. En una terminal lenta (Entrada, la P0 #1 del pipeline) el fetch se
// pasa del limite y el cache puede estar vacio: el guard no ve nada y se crea otro.
//
// LO QUE SE FIJA AQUI: dentro de una ventana corta, N toques colapsan en UNA fila.
// Y —igual de importante— abrir el turno NUNCA se bloquea por red (regla dura #3 de
// OFFLINE-LAN-FIELD-PROVEN §4): el arreglo evita filas basura, no impide operar.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'amalay' }))
vi.mock('@/lib/offline-sync', () => ({ addToQueue: vi.fn() }))

class AlmacenFalso {
  private datos = new Map<string, string>()
  get length() { return this.datos.size }
  key(i: number) { return [...this.datos.keys()][i] ?? null }
  getItem(k: string) { return this.datos.get(k) ?? null }
  setItem(k: string, v: string) { this.datos.set(k, String(v)) }
  removeItem(k: string) { this.datos.delete(k) }
  clear() { this.datos.clear() }
}

type Post = { url: string; body: Record<string, unknown>; prefer: string | null }
let posts: Post[] = []

/**
 * `turnosActivos` es lo que la consulta GET de turnos abiertos devuelve.
 * Vacio = el guard no ve ninguno, que es la condicion del incidente.
 */
function stubFetch(turnosActivos: unknown[] = []) {
  posts = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST') {
      const headers = new Headers(init.headers as HeadersInit)
      const body = JSON.parse(String(init.body))
      posts.push({ url: u, body, prefer: headers.get('prefer') })
      return { ok: true, json: async () => [body] } as unknown as Response
    }
    return { ok: true, json: async () => turnosActivos } as unknown as Response
  })
}

let openTurno: typeof import('@/lib/pos-data')['openTurno']
let olvidarTurnoPendiente: typeof import('@/lib/pos-data')['olvidarTurnoPendiente']

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new AlmacenFalso())
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('navigator', { onLine: true })
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 1, 10, 43, 0))
  ;({ openTurno, olvidarTurnoPendiente } = await import('@/lib/pos-data'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Toques repetidos = UN turno', () => {
  it('REGRESION AMALAY: tres toques seguidos crean UNA sola fila', async () => {
    // El guard nunca ve el turno (lista vacia), que es exactamente lo que pasaba con
    // la terminal lenta y el cache limpio. Aun asi, el id debe repetirse.
    stubFetch([])

    const a = await openTurno(1000, 'Daniel')
    const b = await openTurno(1000, 'Daniel')
    const c = await openTurno(1000, 'Daniel')

    expect(posts).toHaveLength(3) // se intenta 3 veces...
    const ids = posts.map(p => p.body.id)
    expect(new Set(ids).size, `tres ids distintos = tres turnos: ${ids.join(', ')}`).toBe(1)
    expect(a?.id).toBe(b?.id)
    expect(b?.id).toBe(c?.id)
  })

  it('el POST usa merge-duplicates: el segundo toque reescribe, no choca', async () => {
    // Sin esto, el segundo POST con el mismo id daria 409 y caeria al camino de
    // "abrir local + encolar" — que es donde se multiplicaban los turnos.
    stubFetch([])
    await openTurno(1000, 'Daniel')
    expect(posts[0].prefer).toContain('resolution=merge-duplicates')
  })

  it('si el servidor SI ve un turno abierto, no se crea ninguno', async () => {
    stubFetch([{ id: 'ya-existe', fondo_inicial: 500, opened_by: 'Ana', opened_at: '2026-09-01T15:00:00Z' }])

    const t = await openTurno(1000, 'Daniel')

    expect(t?.id).toBe('ya-existe')
    expect(posts, 'no debe intentar crear nada').toHaveLength(0)
  })
})

describe('Un turno legitimo nuevo SI obtiene su propio id', () => {
  it('despues de cerrar, el siguiente toque genera otro id', async () => {
    stubFetch([])
    const primero = await openTurno(1000, 'Daniel')

    olvidarTurnoPendiente() // esto es lo que hace el cierre de caja

    const segundo = await openTurno(2000, 'Eduardo')
    expect(segundo?.id).not.toBe(primero?.id)
  })

  it('pasada la ventana, el cambio de turno del dia genera otro id', async () => {
    stubFetch([])
    const matutino = await openTurno(1000, 'Daniel')

    vi.setSystemTime(new Date(2026, 8, 1, 18, 0, 0)) // horas despues
    const vespertino = await openTurno(2000, 'Eduardo')

    expect(vespertino?.id).not.toBe(matutino?.id)
  })
})

describe('Abrir el turno NUNCA se bloquea por red (regla dura #3)', () => {
  it('sin conexion abre local y encola, sin tocar la red', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    stubFetch([])

    const t = await openTurno(1000, 'Daniel')

    expect(t?.id, 'el dia tiene que poder arrancar sin internet').toBeTruthy()
    expect(t?.fondo_inicial).toBe(1000)
    expect(posts, 'offline no debe intentar el POST').toHaveLength(0)
  })

  it('offline, dos toques tampoco duplican', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    stubFetch([])

    const a = await openTurno(1000, 'Daniel')
    const b = await openTurno(1000, 'Daniel')
    expect(a?.id).toBe(b?.id)
  })

  it('si el POST truena, abre local — y el reintento conserva el id', async () => {
    vi.stubGlobal('fetch', async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new TypeError('Failed to fetch')
      return { ok: true, json: async () => [] } as unknown as Response
    })

    const a = await openTurno(1000, 'Daniel')
    const b = await openTurno(1000, 'Daniel')

    expect(a?.id, 'no se bloquea el dia por un POST fallido').toBeTruthy()
    expect(b?.id).toBe(a?.id)
  })
})

describe('El almacenamiento roto no rompe abrir turno', () => {
  it('sin localStorage sigue abriendo (aunque sin proteccion de duplicado)', async () => {
    vi.stubGlobal('localStorage', undefined)
    vi.resetModules()
    const m = await import('@/lib/pos-data')
    stubFetch([])

    const t = await m.openTurno(1000, 'Daniel')
    expect(t?.id).toBeTruthy()
  })

  it('un valor corrupto en el cache no truena: genera id nuevo', async () => {
    localStorage.setItem('pos_turno_id_pendiente', 'esto no es json')
    stubFetch([])

    const t = await openTurno(1000, 'Daniel')
    expect(t?.id).toBeTruthy()
  })
})
