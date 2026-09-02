// Hasta un tercio de las ventas caian en el DIA EQUIVOCADO.
//
// `pos-daily.ts` alimenta el chat de IA, el coach y la voz. Agrupaba asi:
//
//   const fecha = new Date(ts.getTime() - MX_OFFSET_MS).toISOString().slice(0, 10)
//
// Un desfase fijo de UTC-6, SIN corrimiento de dia de venta. Resultado: toda venta
// entre medianoche y las 5 a.m. se le atribuia al DIA SIGUIENTE — y eso es justo el
// cierre de un restaurante.
//
// MEDIDO EN PRODUCCION el 2026-09-01, ordenes en el dia equivocado:
//
//   scyf-demo   38,866 de 110,789   35.1%
//   boruca          62 de     240   25.8%
//   lab-resto      486 de   4,402   11.0%
//   amalay           1 de      24    4.2%
//
// (La hipotesis inicial fue la zona horaria de `tekila-rg`, que corre en
// America/Chicago. Los datos la descartaron: tekila-rg NO aparece en la lista. El
// problema era el dia de venta, no la zona — y afectaba a mas clientes.)
//
// EL ARREGLO ES LEER, NO RECALCULAR. La columna `dia_venta` la calcula la base por
// tenant, con SU zona y SU `business_day_start_local`. Una sola definicion de "que
// dia es" para todo el sistema.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildDailyConEstado } from '@/lib/pos-daily'

const SB = 'https://x.supabase.co'
const H = { apikey: 'k', Authorization: 'Bearer k' }

/** Una orden de la 1 a.m. del 2 de septiembre: pertenece al dia de venta del 1. */
const MADRUGADA = {
  created_at: '2026-09-02T07:00:00Z',   // 01:00 en Monterrey (UTC-6)
  dia_venta: '2026-09-01',
  total: 500, subtotal: 431, descuento: 0, propina: 0,
  mesero: 'Ana', metodo_pago: 'efectivo', personas: 2, items: '[]',
}

/** La misma orden pero sin dia_venta (fila anterior al backfill). */
const SIN_DIA_VENTA = { ...MADRUGADA, dia_venta: null }

function stub(filas: unknown[]) {
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => filas }) as unknown as Response)
}

beforeEach(() => vi.unstubAllGlobals())

describe('Las ventas de madrugada pertenecen al dia anterior', () => {
  it('REGRESION: una orden de la 1 a.m. se agrupa en el dia de venta, no en el de calendario', async () => {
    stub([MADRUGADA])
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado).toBe(true)
    expect(r.dias).toHaveLength(1)
    expect(r.dias[0].fecha, 'la venta de la 1 a.m. es del dia anterior').toBe('2026-09-01')
  })

  it('dos ventas del mismo dia de venta se suman en UNA fila, aunque crucen medianoche', async () => {
    // Es el caso real: un restaurante que cierra a las 2 a.m. Antes salian como dos
    // dias distintos y el "como vamos hoy" quedaba partido a la mitad.
    const antesDeMedianoche = { ...MADRUGADA, created_at: '2026-09-02T04:00:00Z', total: 300 } // 22:00 del 1
    stub([antesDeMedianoche, MADRUGADA])

    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.dias).toHaveLength(1)
    expect(r.dias[0].fecha).toBe('2026-09-01')
    expect(Number(r.dias[0].ventas_dia)).toBeCloseTo(800, 2)
    expect(Number(r.dias[0].tickets_count)).toBe(2)
  })

  it('dias de venta DISTINTOS siguen separandose', () => {
    // Si esto fallara, todo se apilaria en un solo dia y el reporte no serviria.
    return (async () => {
      stub([MADRUGADA, { ...MADRUGADA, dia_venta: '2026-08-31', created_at: '2026-09-01T07:00:00Z' }])
      const r = await buildDailyConEstado(SB, H, 'amalay', 14)
      expect(r.dias).toHaveLength(2)
      expect(r.dias.map(d => d.fecha).sort()).toEqual(['2026-08-31', '2026-09-01'])
    })()
  })
})

describe('El respaldo para filas sin dia_venta', () => {
  it('una fila anterior al backfill no truena: cae al calculo viejo', async () => {
    // Mal agrupada, pero es lo que habia. No se inventa un dato que no existe.
    stub([SIN_DIA_VENTA])
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)

    expect(r.determinado).toBe(true)
    expect(r.dias).toHaveLength(1)
    expect(r.dias[0].fecha).toBe('2026-09-02')   // el comportamiento viejo
  })

  it('mezclar filas con y sin dia_venta no rompe la agregacion', async () => {
    stub([MADRUGADA, SIN_DIA_VENTA])
    const r = await buildDailyConEstado(SB, H, 'amalay', 14)
    expect(r.dias.length).toBeGreaterThan(0)
  })
})

describe('La consulta pide la columna', () => {
  it('REGRESION: el select incluye dia_venta', async () => {
    // Sin esto la columna llega undefined y TODO cae al respaldo viejo en silencio:
    // el arreglo existiria en el codigo y no cambiaria nada. Es la forma exacta de
    // los fallos del 2026-08-31.
    let url = ''
    vi.stubGlobal('fetch', async (u: string) => {
      url = String(u)
      return { ok: true, json: async () => [] } as unknown as Response
    })
    await buildDailyConEstado(SB, H, 'amalay', 14)
    expect(url).toContain('dia_venta')
  })
})
