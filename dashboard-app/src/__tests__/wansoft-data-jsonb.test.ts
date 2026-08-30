// Regresión: `wansoft_data.data` tiene que leerse igual venga como objeto, como
// arreglo o como string.
//
// Qué pasaba (hasta 2026-08-26): la columna es jsonb, pero los scrapers de
// .github/scripts mandaban `json.dumps([...])` — un STRING de Python. PostgREST lo
// guardaba como escalar JSON de tipo string. El dashboard nunca se enteró porque
// `parseJsonb` desenvuelve el string; lo que quedó roto fue la consulta desde SQL:
// 670 de 702 filas eran escalares string, así que `data->>'campo'` devolvía NULL y
// `jsonb_array_elements(data)` reventaba.
//
// El escritor ya está arreglado. Este archivo fija la otra mitad del trato: que el
// LECTOR siga tolerando las tres formas. Ahora que los scrapers mandan objetos y
// arreglos, la tentación es "simplificar" parseJsonb — y ese día las 670 filas
// históricas, que siguen guardadas como string hasta que corra la migración, dejan
// de pintarse sin que nada truene.
//
// OJO con el arreglo: a diferencia de agent_results, aquí el arreglo es una forma
// LEGÍTIMA (497 de las 670 string desenvuelven a arreglo, y `platillos_full` ya son
// 32 arreglos nativos). Un lector que asuma objeto rompe la mitad de la tabla.
//
// Se prueban las funciones públicas de lib/data y no una copia de parseJsonb, para
// que lo que se verifique sea el código que se despliega.

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

import { getWansoftData, getWansoftDataRange, getWansoftDataLatest } from '@/lib/data'

// Forma real de `platillos_full` / `food_cost_browser`: un arreglo de renglones.
const ARREGLO = [
  { nombre: 'Chilaquiles Verdes', cantidad: 12, total: 2400 },
  { nombre: 'Smarty Chips', cantidad: 1, total: 35 },
]
// Forma real de `endpoint_map` / `cash_closing`: un objeto.
const OBJETO = { total: 1250.5, items: 47, almacenes: ['cocina', 'barra'] }

function fetchQueDevuelve(filas: unknown[]) {
  return vi.fn(async () => (
    { ok: true, status: 200, json: async () => filas } as unknown as Response
  ))
}

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('wansoft_data.data — el lector tolera las tres formas', () => {

  it('la fila NUEVA en forma de arreglo llega intacta y sigue siendo arreglo', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([{ fecha: '2026-08-26', data: ARREGLO }]))
    const fila = await getWansoftData('platillos_full')
    expect(Array.isArray(fila!.data)).toBe(true)
    expect(fila!.data).toEqual(ARREGLO)
  })

  it('la fila NUEVA en forma de objeto llega intacta', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([{ fecha: '2026-08-26', data: OBJETO }]))
    const fila = await getWansoftData('endpoint_map')
    expect(fila!.data).toEqual(OBJETO)
  })

  it('la fila HISTÓRICA que envuelve un arreglo se desenvuelve a arreglo', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { fecha: '2026-06-11', data: JSON.stringify(ARREGLO) },
    ]))
    const fila = await getWansoftData('platillos_full')
    expect(Array.isArray(fila!.data)).toBe(true)
    expect(fila!.data).toEqual(ARREGLO)
  })

  it('la fila HISTÓRICA que envuelve un objeto se desenvuelve a objeto', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { fecha: '2026-06-11', data: JSON.stringify(OBJETO) },
    ]))
    const fila = await getWansoftData('endpoint_map')
    expect(fila!.data).toEqual(OBJETO)
  })

  it('la fila DOBLE-ESCAPADA también se desenvuelve', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { fecha: '2026-06-11', data: JSON.stringify(JSON.stringify(ARREGLO)) },
    ]))
    const fila = await getWansoftData('platillos_full')
    expect(fila!.data).toEqual(ARREGLO)
  })

  it('un string que no es JSON se queda como está, sin reventar', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([{ fecha: '2026-08-26', data: 'no soy json' }]))
    const fila = await getWansoftData('raro')
    expect(fila!.data).toBe('no soy json')
  })

  it('sin filas devuelve null, no revienta', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([]))
    expect(await getWansoftData('no_existe')).toBeNull()
  })
})

describe('wansoft_data.data — viejas y nuevas conviven en la misma consulta', () => {

  it('getWansoftDataRange devuelve EXACTAMENTE lo mismo para las dos formas', async () => {
    // Es la propiedad que importa: mientras no corra la migración, una consulta de
    // 30 días trae filas string (hasta 2026-06-29) y filas arreglo (desde entonces),
    // y la pantalla no puede distinguirlas.
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { fecha: '2026-08-26', data: ARREGLO },                  // nueva
      { fecha: '2026-06-11', data: JSON.stringify(ARREGLO) },  // histórica
    ]))
    const filas = await getWansoftDataRange('platillos_full', 2)
    expect(filas).toHaveLength(2)
    expect(filas[0].data).toEqual(filas[1].data)
    expect(filas.every(f => Array.isArray(f.data))).toBe(true)
  })

  it('getWansoftDataLatest desenvuelve igual que getWansoftData', async () => {
    vi.stubGlobal('fetch', fetchQueDevuelve([
      { fecha: '2026-06-11', data: JSON.stringify(OBJETO) },
    ]))
    const fila = await getWansoftDataLatest('cash_closing')
    expect(fila!.data).toEqual(OBJETO)
  })
})
