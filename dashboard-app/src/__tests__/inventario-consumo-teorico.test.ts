/**
 * El consumo teórico que lee el dashboard. Sin red.
 *
 * LO QUE FIJAN ESTAS PRUEBAS
 * `loadConsumoDelDia` es el lado izquierdo del cruce consumo × venta: qué DEBIÓ gastarse
 * según lo vendido. Tres cosas se pueden romper en silencio y las tres se leen como un
 * número plausible:
 *
 *   1. PostgREST devuelve `numeric` como STRING. Sumar sin convertir concatena:
 *      "1.5" + "2.5" = "1.52.5" → NaN, o peor, un total absurdo que nadie audita.
 *   2. `consumo_stock` en NULL significa "no se pudo convertir a unidad de stock", NO
 *      "no se consumió". Contarlo como cero baja el consumo teórico y el faltante
 *      resultante parece merma.
 *   3. Sin ventas o sin recetas la respuesta correcta es `null`, no un cero: "no se
 *      puede calcular" no es "no se consumió".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SUPABASE_URL = 'https://proyecto.supabase.co'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-de-prueba')

const { loadConsumoDelDia } = await import('@/lib/inventory')

/** Responde a las dos consultas que hace la función, en orden. */
function servidor(cobertura: unknown[], consumo: unknown[], opts?: { covOk?: boolean; consOk?: boolean }) {
  return vi.fn(async (url: string) => {
    const ok = url.includes('ops_consumo_cobertura') ? (opts?.covOk ?? true) : (opts?.consOk ?? true)
    const body = url.includes('ops_consumo_cobertura') ? cobertura : consumo
    return { ok, json: async () => body } as unknown as Response
  })
}

const COBERTURA_OK = [{
  dia_venta: '2026-09-09',
  lineas_vendidas: 129, lineas_con_receta: 129, pct_lineas_con_receta: '100.0',
  importe_vendido: '6790', pct_importe_con_receta: '100.0', platillos_sin_receta: 0,
}]

beforeEach(() => { vi.stubGlobal('fetch', servidor(COBERTURA_OK, [])) })
afterEach(() => { vi.unstubAllGlobals() })

describe('loadConsumoDelDia — los numeros llegan como texto', () => {
  it('convierte `numeric` string a numero en vez de concatenar', async () => {
    vi.stubGlobal('fetch', servidor(COBERTURA_OK, [
      { ingredient_id: 'demo-cafe', consumo_stock: '1.5', lineas_no_convertibles: 0 },
      { ingredient_id: 'demo-cafe', consumo_stock: '2.5', lineas_no_convertibles: 0 },
    ]))
    const r = await loadConsumoDelDia('demo')
    expect(r!.porIngrediente.get('demo-cafe')).toBe(4)
  })

  it('el importe vendido no se queda como texto', async () => {
    const r = await loadConsumoDelDia('demo')
    expect(r!.cobertura!.importeVendido).toBe(6790)
    expect(typeof r!.cobertura!.importeVendido).toBe('number')
  })

  it('los porcentajes llegan como numero', async () => {
    const r = await loadConsumoDelDia('demo')
    expect(r!.cobertura!.pctImporteConReceta).toBe(100)
    expect(r!.cobertura!.pctLineasConReceta).toBe(100)
  })
})

describe('loadConsumoDelDia — null no es cero', () => {
  it('un consumo que no se pudo convertir NO se cuenta como cero', async () => {
    vi.stubGlobal('fetch', servidor(COBERTURA_OK, [
      { ingredient_id: 'demo-cafe', consumo_stock: '3', lineas_no_convertibles: 0 },
      { ingredient_id: 'demo-raro', consumo_stock: null, lineas_no_convertibles: 2 },
    ]))
    const r = await loadConsumoDelDia('demo')
    expect(r!.porIngrediente.has('demo-raro')).toBe(false)
    expect(r!.porIngrediente.get('demo-cafe')).toBe(3)
  })

  it('cuenta aparte los renglones que no se pudieron convertir', async () => {
    vi.stubGlobal('fetch', servidor(COBERTURA_OK, [
      { ingredient_id: 'a', consumo_stock: '1', lineas_no_convertibles: 2 },
      { ingredient_id: 'b', consumo_stock: '1', lineas_no_convertibles: 3 },
    ]))
    const r = await loadConsumoDelDia('demo')
    expect(r!.lineasNoConvertibles).toBe(5)
  })

  it('un porcentaje ausente queda en null, no en cero', async () => {
    vi.stubGlobal('fetch', servidor(
      [{ ...COBERTURA_OK[0], pct_importe_con_receta: null }], []))
    const r = await loadConsumoDelDia('demo')
    expect(r!.cobertura!.pctImporteConReceta).toBeNull()
  })
})

describe('loadConsumoDelDia — cuando no hay nada que cruzar', () => {
  it('sin ventas devuelve null, no un cero', async () => {
    vi.stubGlobal('fetch', servidor([], []))
    expect(await loadConsumoDelDia('demo')).toBeNull()
  })

  it('si la vista no existe devuelve null en vez de tronar la pagina', async () => {
    vi.stubGlobal('fetch', servidor(COBERTURA_OK, [], { covOk: false }))
    expect(await loadConsumoDelDia('demo')).toBeNull()
  })

  it('si falla la segunda consulta tampoco inventa datos', async () => {
    vi.stubGlobal('fetch', servidor(COBERTURA_OK, [], { consOk: false }))
    expect(await loadConsumoDelDia('demo')).toBeNull()
  })
})

describe('loadConsumoDelDia — el dia lo pone la base, no el cliente', () => {
  it('usa el dia_venta que devuelve la vista', async () => {
    vi.stubGlobal('fetch', servidor([{ ...COBERTURA_OK[0], dia_venta: '2026-08-31' }], []))
    const r = await loadConsumoDelDia('demo')
    expect(r!.diaVenta).toBe('2026-08-31')
  })

  it('pide el consumo del MISMO dia que dijo la cobertura', async () => {
    // Recalcular el dia de venta en el cliente reintroduciria el bug de zona horaria
    // que costo un PR entero. Se pregunta una vez y se reusa.
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return {
        ok: true,
        json: async () => (url.includes('cobertura') ? [{ ...COBERTURA_OK[0], dia_venta: '2026-08-31' }] : []),
      } as unknown as Response
    }))
    await loadConsumoDelDia('demo')
    const consultaConsumo = urls.find(u => u.includes('ops_consumo?'))
    expect(consultaConsumo).toContain('dia_venta=eq.2026-08-31')
  })

  it('filtra por el tenant activo', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => (url.includes('cobertura') ? COBERTURA_OK : []) } as unknown as Response
    }))
    await loadConsumoDelDia('otro-tenant')
    for (const u of urls) expect(u).toContain('client_id=eq.otro-tenant')
  })
})
