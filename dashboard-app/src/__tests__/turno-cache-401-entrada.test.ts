// El cache de turno servia datos viejos ante CUALQUIER error.
//
// INCIDENTE 2026-08-31, terminal Entrada de AMALAY. Al poner el PIN salia
// "Turno del dia anterior - Ir a realizar Corte Z" sobre el turno mtgl6c29pkyt,
// abierto el 30-ago 19:55, que en el servidor estaba CERRADO desde las 20:07.
// El Corte Z no tenia nada que cerrar, la sesion seguia vencida, y la pantalla
// regresaba al PIN. En bucle.
//
// Cadena real:
//   401 (sesion vencida) -> `if (!res.ok) return fromCache()` -> turno de anoche
//   -> hoursSinceOpen > 18 -> isStale -> pantalla de Corte Z -> vuelta al PIN.
//
// Dos reglas quedan fijadas aqui:
//   1. Solo un fallo SIN ALCANCE (503 del Service Worker, timeout, 5xx) puede
//      servir cache. Un 400/401/403 sube como error.
//   2. El cache vence por DIA DE VENTA, no por un TTL de 24 h.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { diaDeVenta, mismoDiaDeVenta } from '@/lib/dia-de-venta'

vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'amalay' }))

const TURNO_ANOCHE = { id: 'mtgl6c29pkyt', fondo_inicial: 1, opened_by: 'Daniel', opened_at: '' }

function guardarCache(openedAt: Date, ts: number) {
  const turno = { ...TURNO_ANOCHE, opened_at: openedAt.toISOString() }
  localStorage.setItem('pos_turno_cache', JSON.stringify({ turno, turnos: [turno], ts }))
}

const resp = (status: number, body: unknown = []) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// El config de node no trae localStorage. Se monta uno minimo (misma convencion
// que plano-por-restaurante.test.ts).
class AlmacenFalso {
  private datos = new Map<string, string>()
  get length() { return this.datos.size }
  key(i: number) { return [...this.datos.keys()][i] ?? null }
  getItem(k: string) { return this.datos.get(k) ?? null }
  setItem(k: string, v: string) { this.datos.set(k, String(v)) }
  removeItem(k: string) { this.datos.delete(k) }
  clear() { this.datos.clear() }
}

let getActiveTurnos: typeof import('@/lib/pos-data')['getActiveTurnos']
// Las clases se importan por la MISMA via dinamica que el modulo bajo prueba:
// con `resetModules()`, un import estatico daria otra copia de la clase y
// `toBeInstanceOf` fallaria aunque el codigo este bien.
let ErrorDeSesion: typeof import('@/lib/clasificar-fallo')['ErrorDeSesion']
let ErrorDeContrato: typeof import('@/lib/clasificar-fallo')['ErrorDeContrato']

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new AlmacenFalso())
  vi.stubGlobal('window', globalThis)
  vi.useFakeTimers()
  ;({ getActiveTurnos } = await import('@/lib/pos-data'))
  ;({ ErrorDeSesion, ErrorDeContrato } = await import('@/lib/clasificar-fallo'))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Un fallo de sesion NO se disfraza de "sin conexion"', () => {
  it('REGRESION Entrada: 401 lanza ErrorDeSesion en vez de servir el turno de anoche', async () => {
    // Son las 22:00 del 31-ago. El turno de anoche (30-ago 19:55) se cacheo hace 2 h,
    // asi que el TTL de 24 h lo daba por bueno.
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    guardarCache(new Date(2026, 7, 30, 19, 55, 0), Date.now() - 2 * 3600 * 1000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(401, { message: 'JWT expired' })))

    await expect(getActiveTurnos()).rejects.toBeInstanceOf(ErrorDeSesion)
  })

  it('403 tambien sube — no alcanzan permisos, no es falta de red', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    guardarCache(new Date(2026, 7, 31, 19, 0, 0), Date.now())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(403)))
    await expect(getActiveTurnos()).rejects.toBeInstanceOf(ErrorDeSesion)
  })

  it('400 por columna inexistente sube — es el bug de save-order, otra vez', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    guardarCache(new Date(2026, 7, 31, 19, 0, 0), Date.now())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(400, { message: 'column does not exist' })))
    await expect(getActiveTurnos()).rejects.toBeInstanceOf(ErrorDeContrato)
  })
})

describe('Sin red, el cache SIGUE funcionando — no se rompio el offline', () => {
  it('503 del Service Worker devuelve el turno de HOY', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    guardarCache(new Date(2026, 7, 31, 19, 0, 0), Date.now())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(503)))

    const r = await getActiveTurnos()
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('mtgl6c29pkyt')
  })

  it('fetch que LANZA (timeout/red caida) tambien usa cache', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    guardarCache(new Date(2026, 7, 31, 19, 0, 0), Date.now())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await getActiveTurnos()).toHaveLength(1)
  })
})

describe('El cache vence por DIA DE VENTA, no por 24 horas', () => {
  it('REGRESION: a las 22:00 ya no sirve el turno de anoche, aunque el TTL lo permita', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 22, 0, 0))
    // Guardado hace 2 h: el TTL de 24 h lo aceptaba. El dia de venta no.
    guardarCache(new Date(2026, 7, 30, 19, 55, 0), Date.now() - 2 * 3600 * 1000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(503)))

    expect(await getActiveTurnos()).toEqual([])
  })

  it('a las 02:00 SI sirve el turno abierto a las 19:00 de ayer — sigue siendo el mismo dia de venta', async () => {
    // La madrugada pertenece al dia anterior. Si esto fallara, el POS bloquearia
    // al restaurante justo en su hora de cierre.
    vi.setSystemTime(new Date(2026, 7, 31, 2, 0, 0))
    guardarCache(new Date(2026, 7, 30, 19, 0, 0), Date.now() - 7 * 3600 * 1000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(503)))

    expect(await getActiveTurnos()).toHaveLength(1)
  })

  it('a las 06:00 ya NO lo sirve — el dia de venta arranco a las 05:00', async () => {
    vi.setSystemTime(new Date(2026, 7, 31, 6, 0, 0))
    guardarCache(new Date(2026, 7, 30, 19, 0, 0), Date.now() - 11 * 3600 * 1000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(503)))

    expect(await getActiveTurnos()).toEqual([])
  })
})

describe('El helper de dia de venta', () => {
  it('la madrugada pertenece al dia anterior', () => {
    expect(diaDeVenta(new Date(2026, 7, 31, 2, 30))).toBe('2026-08-30')
    expect(diaDeVenta(new Date(2026, 7, 31, 5, 0))).toBe('2026-08-31')
    expect(diaDeVenta(new Date(2026, 7, 31, 23, 59))).toBe('2026-08-31')
  })
  it('respeta un inicio distinto — no esta hardcodeado a AMALAY', () => {
    expect(diaDeVenta(new Date(2026, 7, 31, 5, 30), '07:00')).toBe('2026-08-30')
    expect(mismoDiaDeVenta(new Date(2026, 7, 31, 5, 30), new Date(2026, 7, 30, 23, 0), '07:00')).toBe(true)
  })
})
