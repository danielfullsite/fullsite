// Regresión: `agent_results.data` tiene que leerse igual venga como objeto o como
// string.
//
// Qué pasaba (hasta 2026-08-26): la columna es jsonb, pero los 19 agentes de
// .github/scripts mandaban `json.dumps({...})` — un STRING de Python. PostgREST lo
// guardaba como escalar JSON de tipo string, no como objeto. El dashboard nunca se
// enteró porque `parseJsonb` desenvuelve el string; lo que quedó roto fue la consulta
// desde SQL: `data->>'sin_stock'` devolvía NULL en las 1,034 filas del histórico.
//
// El escritor ya está arreglado. Este archivo fija la otra mitad del trato: que el
// LECTOR siga tolerando las dos formas. Ahora que los agentes mandan objetos, la
// tentación es "simplificar" parseJsonb — y ese día las 1,034 filas históricas, que
// siguen guardadas como string, dejan de pintarse sin que nada truene.
//
// Se prueba `getDeepTable` (la puerta pública) y no una copia de parseJsonb, para que
// lo que se verifique sea el código que se despliega.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder'
process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID = 'amalay'

import { getDeepTable } from '@/lib/data'

const CARGA = { sin_stock: 225, critico: 0, almacenes_afectados: ['cocina', 'barra'] }

/** Devuelve las filas dadas en la PRIMERA consulta y nada después. */
function fetchQueDevuelve(filas: unknown[]) {
  let servido = false
  return vi.fn(async () => {
    const cuerpo = servido ? [] : filas
    servido = true
    return { ok: true, status: 200, json: async () => cuerpo } as unknown as Response
  })
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('agent_results.data — el lector tolera las dos formas', () => {

  it('la fila NUEVA (objeto jsonb) llega intacta', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { agent_id: 'stock-alert', fecha: '2026-08-26', data: CARGA },
    ]))
    const filas = await getDeepTable('agent_results', 1)
    expect(filas[0].data).toEqual(CARGA)
  })

  it('la fila HISTÓRICA (escalar string) se desenvuelve a objeto', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { agent_id: 'stock-alert', fecha: '2026-06-11', data: JSON.stringify(CARGA) },
    ]))
    const filas = await getDeepTable('agent_results', 1)
    expect(filas[0].data).toEqual(CARGA)
  })

  it('la fila DOBLE-ESCAPADA también se desenvuelve', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { agent_id: 'stock-alert', fecha: '2026-06-11', data: JSON.stringify(JSON.stringify(CARGA)) },
    ]))
    const filas = await getDeepTable('agent_results', 1)
    expect(filas[0].data).toEqual(CARGA)
  })

  it('las dos formas producen EXACTAMENTE el mismo resultado', async () => {
    // Es la propiedad que importa: durante la transición conviven filas viejas y
    // nuevas en la misma consulta, y la pantalla no puede distinguirlas.
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { agent_id: 'nuevo', fecha: '2026-08-26', data: CARGA },
      { agent_id: 'viejo', fecha: '2026-06-11', data: JSON.stringify(CARGA) },
    ]))
    const filas = await getDeepTable('agent_results', 2)
    expect(filas[0].data).toEqual(filas[1].data)
  })

  it('un string que no es JSON se queda como está, sin reventar', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { agent_id: 'raro', fecha: '2026-08-26', data: 'no soy json' },
    ]))
    const filas = await getDeepTable('agent_results', 1)
    expect(filas[0].data).toBe('no soy json')
  })
})
