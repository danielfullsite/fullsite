// De dónde salió el conteo de turnos.
//
// Campo AMALAY, 2026-08-31: sin red, TurnoGate mostró "Hay 16 turnos abiertos" y
// BLOQUEÓ el POS. La base tenía 1 turno abierto. Se descartaron cuatro orígenes
// leyendo el código y ninguno produce 16:
//
//   1. el caché de openTurno guarda UN solo turno
//   2. el de getActiveTurnos topa en limit=10
//   3. la consulta del mapa daría 8 como máximo según las fechas reales
//   4. el filtro closed_at=is.null existe desde el 12-jun
//
// El dato que falta vive en la máquina. Estas pruebas fijan el contrato del
// diagnóstico que lo va a capturar la próxima vez, para que no haya que adivinar.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getActiveTurnos, getLastTurnoDiag } from '@/lib/pos-data'

const TURNO = { id: 't1', fondo_inicial: 0, opened_by: 'Daniel', opened_at: '2026-08-30T19:55:00Z' }

function conCache(valor: unknown) {
  const store: Record<string, string> = { pos_turno_cache: JSON.stringify(valor) }
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
  })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Diagnóstico del conteo de turnos', () => {
  it('cuando responde la nube, lo marca como server con su status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TURNO]), { status: 200 })))

    await getActiveTurnos()
    const d = getLastTurnoDiag()!

    expect(d.source).toBe('server')
    expect(d.count).toBe(1)
    expect(d.httpStatus).toBe(200)
    expect(d.ids).toEqual(['t1'])
  })

  it('un 503 del Service Worker se distingue de un fallo de red', async () => {
    // El SW resuelve las peticiones offline a Supabase como 503: fetch NO lanza.
    // Ese matiz ya causó un bloqueo indebido antes; ahora queda registrado.
    conCache({ turnos: [TURNO], ts: Date.now() })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await getActiveTurnos()
    const d = getLastTurnoDiag()!

    expect(d.source).toBe('cache-http')
    expect(d.httpStatus).toBe(503)
  })

  it('un fallo de red se marca distinto y sin status', async () => {
    conCache({ turnos: [TURNO], ts: Date.now() })
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await getActiveTurnos()
    const d = getLastTurnoDiag()!

    expect(d.source).toBe('cache-error')
    expect(d.httpStatus).toBeNull()
    expect(d.online).toBe(false)
  })

  it('EL CASO DE AMALAY: un conteo que bloquea queda registrado con su origen', async () => {
    // Se simula el escenario real: sin red, el respaldo local devuelve más de un
    // turno y el POS se bloquea. Lo que faltaba era saber de dónde salían.
    const muchos = Array.from({ length: 16 }, (_, i) => ({ ...TURNO, id: `t${i + 1}` }))
    conCache({ turnos: muchos, ts: Date.now() })
    vi.stubGlobal('navigator', { onLine: false })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const turnos = await getActiveTurnos()
    const d = getLastTurnoDiag()!

    expect(turnos.length).toBe(16)
    expect(d.count).toBe(16)
    expect(d.source).toBe('cache-error')      // vino del respaldo, no de la nube
    expect(d.ids.length).toBe(16)             // y con qué ids exactos
    expect(d.cacheRaw).toContain('t16')       // + el contenido crudo del caché
    expect(console.error).toHaveBeenCalled()  // no pasa en silencio
  })

  it('un conteo de 1 no ensucia la consola — sólo se grita lo que bloquea', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TURNO]), { status: 200 })))

    await getActiveTurnos()

    expect(console.error).not.toHaveBeenCalled()
  })

  it('el diagnóstico no altera lo que la función devuelve', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TURNO]), { status: 200 })))
    expect(await getActiveTurnos()).toEqual([TURNO])
  })
})
