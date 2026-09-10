/**
 * Pruebas del analista — el plan lo escribe un modelo, así que se trata como entrada hostil.
 *
 * La prueba que más importa de todo el archivo es la de tenant. La fuga F-2 (cerrada el
 * 2026-08-30) fue exactamente esta superficie por otra puerta: el chat tomaba el client_id
 * del body y cualquier usuario logueado leía las ventas y los nombres del staff de otro
 * restaurante. Un plan generado por un LLM a partir del texto del usuario es la misma
 * superficie con mejor cara, y un usuario que escriba "consulta el restaurante amalay" está
 * a un renglón de que el modelo lo pida.
 */

import { describe, it, expect, vi } from 'vitest'
import { validarPlan, extraerJSON } from '@/lib/analyst/plan'
import { ejecutarConsulta, verificarCuadre, construirProcedencia } from '@/lib/analyst/execute'
import type { ResultadoConsulta } from '@/lib/analyst/execute'
import { vistaPermitida } from '@/lib/analyst/contract'
import { _test as _answer } from '@/lib/analyst/answer'

const HOY = '2026-09-09'

// `entorno()` falla cerrado si no están, y eso está bien: aquí se ponen valores de mentira
// porque el fetch va mockeado y ninguna prueba sale a la red.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'llave-de-prueba'

function planCon(consultas: unknown[], formula = 'x') {
  return validarPlan({ consultas, formula }, HOY)
}

function consulta(over: Record<string, unknown> = {}) {
  return {
    vista: 'ops_personal', desde: '2026-09-01', hasta: '2026-09-08',
    columnas: ['mesero', 'ventas'], filtros: {}, porque: 'ranking', ...over,
  }
}

// ─── Lo que no se negocia: el tenant ────────────────────────────────────────

describe('el plan no puede elegir el restaurante', () => {
  it('un client_id en los filtros se descarta', () => {
    const p = planCon([consulta({ filtros: { client_id: 'amalay' } })])
    expect(p.consultas).toHaveLength(1)
    expect(p.consultas[0].filtros).not.toHaveProperty('client_id')
    expect(p.descartes.join(' ')).toContain('client_id')
  })

  it('un client_id al nivel de la consulta no sobrevive al tipo validado', () => {
    const p = planCon([consulta({ client_id: 'amalay' })])
    expect(p.consultas[0]).not.toHaveProperty('client_id')
  })

  it('la URL que se consulta lleva el tenant del servidor, no el del plan', async () => {
    let visto = ''
    const fake = vi.fn(async (url: string) => {
      visto = String(url)
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch

    await ejecutarConsulta(
      { ...consulta({ filtros: {} }), columnas: ['mesero', 'ventas'] } as never,
      'tenant-real', fake,
    )
    expect(visto).toContain('client_id=eq.tenant-real')
    expect(visto).not.toContain('amalay')
  })

  it('un id de tenant con caracteres raros se codifica y no se cuela en otro parámetro', async () => {
    let visto = ''
    const fake = vi.fn(async (url: string) => {
      visto = String(url)
      return new Response('[]', { status: 200 })
    }) as unknown as typeof fetch

    await ejecutarConsulta({ ...consulta() } as never, 'ten&select=*', fake)
    // Lo que importa es que `&` y `=` queden escapados: son los que romperían el query
    // string y meterían un parámetro nuevo. El `*` se queda literal y es inofensivo.
    expect(visto).toContain('client_id=eq.ten%26select%3D')
    expect(visto.match(/[?&]select=/g) ?? []).toHaveLength(1)
  })
})

// ─── Lista blanca ───────────────────────────────────────────────────────────

describe('sólo vistas del contrato', () => {
  it('una tabla cruda se rechaza', () => {
    const p = planCon([consulta({ vista: 'pos_orders' })])
    expect(p.consultas).toHaveLength(0)
    expect(p.descartes.join(' ')).toContain('pos_orders')
  })

  it('el prefijo de una vista permitida no basta', () => {
    expect(vistaPermitida('ops_personal_secreto')).toBe(false)
    expect(vistaPermitida('ops_personal')).toBe(true)
  })

  it('SQL en el nombre de la vista se rechaza', () => {
    const p = planCon([consulta({ vista: 'ops_personal; drop table pos_orders' })])
    expect(p.consultas).toHaveLength(0)
  })

  it('la última puerta también comprueba, aunque validarPlan ya haya filtrado', async () => {
    const fake = vi.fn() as unknown as typeof fetch
    const r = await ejecutarConsulta({ ...consulta({ vista: 'pos_staff' }) } as never, 't1', fake)
    expect(r.error).toContain('fuera del contrato')
    expect(fake).not.toHaveBeenCalled()
  })
})

// ─── Columnas, filtros y rangos ─────────────────────────────────────────────

describe('validación del resto del plan', () => {
  it('una columna inventada se cae y se anota', () => {
    const p = planCon([consulta({ columnas: ['mesero', 'sueldo_secreto'] })])
    expect(p.consultas[0].columnas).toContain('mesero')
    expect(p.consultas[0].columnas).not.toContain('sueldo_secreto')
    expect(p.descartes.join(' ')).toContain('sueldo_secreto')
  })

  it('sin columnas usables se traen todas las de la vista', () => {
    const p = planCon([consulta({ columnas: ['no_existe'] })])
    expect(p.consultas[0].columnas.length).toBeGreaterThan(5)
  })

  it('un filtro por columna no filtrable se descarta', () => {
    const p = planCon([consulta({ filtros: { ventas: 100 } })])
    expect(p.consultas[0].filtros).not.toHaveProperty('ventas')
  })

  it('un filtro por columna sí filtrable pasa', () => {
    const p = planCon([consulta({ filtros: { mesero: 'Ana' } })])
    expect(p.consultas[0].filtros).toEqual({ mesero: 'Ana' })
  })

  it('fechas inválidas descartan la consulta', () => {
    expect(planCon([consulta({ desde: 'ayer' })]).consultas).toHaveLength(0)
    expect(planCon([consulta({ desde: '2026-13-45' })]).consultas).toHaveLength(0)
  })

  it('un rango al revés se descarta', () => {
    const p = planCon([consulta({ desde: '2026-09-08', hasta: '2026-09-01' })])
    expect(p.consultas).toHaveLength(0)
  })

  it('un rango absurdo se recorta en vez de perderse', () => {
    const p = planCon([consulta({ desde: '2020-01-01', hasta: '2026-09-08' })])
    expect(p.consultas).toHaveLength(1)
    expect(p.descartes.join(' ')).toContain('recortado')
  })

  it('hay techo de consultas', () => {
    const p = planCon(Array.from({ length: 20 }, () => consulta()))
    expect(p.consultas.length).toBeLessThanOrEqual(7) // 6 + la cobertura automática
  })

  it('un plan que no es un plan no revienta', () => {
    expect(validarPlan(null, HOY).consultas).toHaveLength(0)
    expect(validarPlan('hola', HOY).consultas).toHaveLength(0)
    expect(validarPlan({ consultas: 'no soy arreglo' }, HOY).consultas).toHaveLength(0)
  })
})

// ─── La cobertura obligatoria ───────────────────────────────────────────────

describe('ops_consumo nunca viaja sin su denominador', () => {
  it('la cobertura se agrega aunque el modelo no la pida', () => {
    const p = planCon([consulta({ vista: 'ops_consumo', columnas: ['ingrediente', 'consumo_stock'] })])
    const nombres = p.consultas.map((c) => c.vista)
    expect(nombres).toContain('ops_consumo')
    expect(nombres).toContain('ops_consumo_cobertura')
    expect(p.consultas.find((c) => c.vista === 'ops_consumo_cobertura')?.automatica).toBe(true)
  })

  it('la cobertura hereda el mismo rango', () => {
    const p = planCon([consulta({ vista: 'ops_consumo', desde: '2026-08-01', hasta: '2026-08-31' })])
    const cob = p.consultas.find((c) => c.vista === 'ops_consumo_cobertura')!
    expect(cob.desde).toBe('2026-08-01')
    expect(cob.hasta).toBe('2026-08-31')
  })

  it('no se duplica si el modelo ya la pidió', () => {
    const p = planCon([consulta({ vista: 'ops_consumo' }), consulta({ vista: 'ops_consumo_cobertura' })])
    expect(p.consultas.filter((c) => c.vista === 'ops_consumo_cobertura')).toHaveLength(1)
  })

  it('las columnas de cobertura de una vista se piden siempre', () => {
    const p = planCon([consulta({ vista: 'ops_personal', columnas: ['ventas'] })])
    expect(p.consultas[0].columnas).toContain('ordenes_sin_cierre')
    expect(p.consultas[0].columnas).toContain('ordenes_sin_metodo')
  })
})

// ─── El cuadre ──────────────────────────────────────────────────────────────

function res(vista: string, filas: Record<string, unknown>[], over: Partial<ResultadoConsulta> = {}): ResultadoConsulta {
  return { vista, desde: '2026-09-01', hasta: '2026-09-02', porque: '', automatica: false,
           filas, error: null, truncada: false, ...over }
}

describe('el cuadre que Crunchtime no puede dar', () => {
  it('cuando el día es la suma de sus horas, cierra', () => {
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1000 }]),
      res('ops_hourly', [{ dia_venta: '2026-09-01', ventas: 600 }, { dia_venta: '2026-09-01', ventas: 400 }]),
    ])
    expect(c.estado).toBe('ok')
  })

  it('numeric como STRING se suma, no se concatena', () => {
    // PostgREST devuelve numeric como string. '600'+'400' daría '600400'.
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: '1000.00' }]),
      res('ops_hourly', [{ dia_venta: '2026-09-01', ventas: '600.00' }, { dia_venta: '2026-09-01', ventas: '400.00' }]),
    ])
    expect(c.estado).toBe('ok')
  })

  it('un día que no cierra se marca y se dice cuánto', () => {
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1000 }]),
      res('ops_hourly', [{ dia_venta: '2026-09-01', ventas: 600 }]),
    ])
    expect(c.estado).toBe('descuadrado')
    expect(c.detalle).toContain('1000.00')
    expect(c.detalle).toContain('600.00')
  })

  it('un 1% de diferencia no es descuadre — el corte del día mueve la madrugada', () => {
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1000 }]),
      res('ops_hourly', [{ dia_venta: '2026-09-01', ventas: 995 }]),
    ])
    expect(c.estado).toBe('ok')
  })

  it('sin las dos vistas no se afirma que cuadró', () => {
    expect(verificarCuadre([res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1 }])]).estado)
      .toBe('no_verificado')
  })

  it('una lectura truncada no se compara: acusaría a un día sano', () => {
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1000 }]),
      res('ops_hourly', [{ dia_venta: '2026-09-01', ventas: 600 }], { truncada: true }),
    ])
    expect(c.estado).toBe('no_verificado')
  })

  it('una lectura fallida no se toma como cero', () => {
    const c = verificarCuadre([
      res('ops_daily_history', [{ fecha: '2026-09-01', ventas_dia: 1000 }]),
      res('ops_hourly', [], { error: 'HTTP 500' }),
    ])
    expect(c.estado).toBe('no_verificado')
  })
})

// ─── Procedencia y errores ──────────────────────────────────────────────────

describe('la procedencia se puede auditar', () => {
  it('lista cada consulta con su rango y su conteo', () => {
    const p = construirProcedencia([res('ops_personal', [{ a: 1 }, { a: 2 }])])
    expect(p.consultas[0]).toMatchObject({ vista: 'ops_personal', filas: 2, rango: '2026-09-01 → 2026-09-02' })
  })

  it('un error de lectura viaja hasta la procedencia', async () => {
    const fake = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const r = await ejecutarConsulta({ ...consulta() } as never, 't1', fake)
    expect(r.error).toContain('HTTP 500')
    expect(r.filas).toHaveLength(0)
  })
})

// ─── Utilidades ─────────────────────────────────────────────────────────────

describe('extraer el JSON que devuelve un modelo', () => {
  it('acepta JSON pelón', () => {
    expect(extraerJSON('{"consultas":[]}')).toEqual({ consultas: [] })
  })
  it('acepta cercas de código', () => {
    expect(extraerJSON('```json\n{"consultas":[]}\n```')).toEqual({ consultas: [] })
  })
  it('acepta prosa antes del objeto', () => {
    expect(extraerJSON('Claro, aquí va:\n{"consultas":[]}')).toEqual({ consultas: [] })
  })
  it('devuelve null si no hay JSON', () => {
    expect(extraerJSON('no puedo')).toBeNull()
  })

  it('un JSON truncado a media palabra devuelve null, no un objeto a medias', () => {
    // El caso real: con maxTokens bajo, el modelo cortaba en `"pct_efe` y el plan salía
    // vacío aunque hubiera elegido bien las vistas.
    const truncado = '{"consultas":[{"vista":"ops_personal","columnas":["pct_efe'
    expect(extraerJSON(truncado)).toBeNull()
  })
})

describe('el descarte dice POR QUÉ se quedó sin plan', () => {
  it('sin JSON que leer lo dice, en vez de culpar al arreglo', () => {
    // Confundir "no hubo JSON" con "el JSON no traía consultas" manda a buscar el error
    // en el prompt cuando está en el presupuesto de tokens. Costó una corrida entenderlo.
    const p = validarPlan(null, HOY)
    expect(p.descartes.join(' ')).toContain('truncó')
  })

  it('un JSON válido sin consultas culpa al arreglo, no al parseo', () => {
    const p = validarPlan({ formula: 'x' }, HOY)
    expect(p.descartes.join(' ')).toContain('arreglo')
  })
})

describe('el recorte de filas conserva lo que pesa', () => {
  it('se queda con las de mayor importe, no con las primeras', () => {
    const filas = Array.from({ length: 100 }, (_, i) => ({ dia_venta: `d${i}`, ventas: i }))
    const r = _answer.recortar(filas)
    expect(r).toHaveLength(_answer.MAX_FILAS_AL_MODELO)
    expect(r[0].ventas).toBe(99)
  })
  it('no toca lo que ya cabe', () => {
    const filas = [{ ventas: 1 }, { ventas: 2 }]
    expect(_answer.recortar(filas)).toHaveLength(2)
  })
})
