// Agentes — "hoy" es el DÍA DE VENTA, las comparaciones son a la MISMA HORA, y el dedupe
// distingue de quién habla cada hallazgo.
//
// LOS TRES FALSOS AVISOS QUE ESTO FIJA
// ------------------------------------
// 1. operations/staff armaban "hoy" con `nowMX().setHours(0).toISOString()`. `nowMX()`
//    trae la hora de PARED de México reinterpretada en UTC, así que ese ISO es
//    `YYYY-MM-DDT00:00Z` = 18:00 de AYER en Monterrey. Una cuenta de anoche que se quedó
//    en 'lista' entraba a "hoy" y salía "mesa lleva 900 min esperando cobro" — crítico.
// 2. finance comparaba las ventas PARCIALES de hoy contra días COMPLETOS: a mediodía
//    siempre "ibas 70% abajo". Crítico, todos los días.
// 3. El dedupe usaba `type:severity`: la alerta de fraude de un segundo mesero se
//    tragaba 12 horas porque ya había una abierta — de otro mesero.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { contextoDia, inicioDiaDeVentaISO, leerPaginado } from '@/lib/agents/dia-negocio'
import { runOperationsAgent } from '@/lib/agents/operations'
import { runStaffAgent } from '@/lib/agents/staff'
import { runFinanceAgent, lectorCorteFullsite, type CorteMismaHora } from '@/lib/agents/finance'
import { runFraudAgent } from '@/lib/agents/fraud'
import { llaveDedupe, sujetoDeHallazgo } from '@/lib/agents/engine'

// 2026-09-28 (lunes) 13:30 en Monterrey = 19:30Z. Inicio del día de venta: 05:00 = 11:00Z.
const AHORA = Date.parse('2026-09-28T19:30:00Z')
const CTX = contextoDia(AHORA, 'America/Mexico_City', '05:00:00')
const min = (m: number) => new Date(AHORA - m * 60_000).toISOString()

/**
 * `sbGet` falso que APLICA los filtros de fecha, orden y paginación de la consulta —
 * como PostgREST — sobre un fixture. Así la prueba ve el efecto del corte, no sólo el
 * texto de la URL.
 */
function fakeSb(tablas: Record<string, Array<Record<string, unknown>>>) {
  const consultas: Array<{ table: string; query: string }> = []
  const sbGet = async <T,>(table: string, query: string): Promise<T[]> => {
    consultas.push({ table, query })
    let rows = [...(tablas[table] ?? [])]
    const params = new URLSearchParams(query)
    for (const [k, v] of params) {
      if (k === 'created_at' || k === 'registered_at') {
        const [op, ...rest] = v.split('.')
        const val = rest.join('.')
        rows = rows.filter(r => op === 'gte' ? String(r[k]) >= val : op === 'lt' ? String(r[k]) < val : true)
      }
      if (k === 'status' && v.startsWith('neq.')) rows = rows.filter(r => r.status !== v.slice(4))
    }
    if (params.get('or')?.includes('payment_status.eq.pagada')) {
      rows = rows.filter(r => r.payment_status === 'pagada' || (r.payment_status == null && r.status === 'cerrada'))
    }
    const off = Number(params.get('offset') ?? 0)
    const lim = Number(params.get('limit') ?? 100000)
    return rows.slice(off, off + lim) as T[]
  }
  return { sbGet, consultas }
}

describe('día de venta — el inicio de "hoy" es el correcto', () => {
  it('a las 13:30 de Monterrey, hoy arrancó a las 05:00 locales (11:00Z), no a las 18:00 de ayer', () => {
    expect(CTX.hoy).toBe('2026-09-28')
    expect(CTX.inicioHoyISO).toBe('2026-09-28T11:00:00.000Z')
    expect(CTX.horaLocal).toBe(13)
    expect(CTX.dow).toBe(1)
    expect(CTX.minutosDesdeInicio).toBe(8 * 60 + 30)
  })

  it('a las 02:00 de Monterrey sigue siendo el día de venta de AYER', () => {
    const c = contextoDia(Date.parse('2026-09-29T08:00:00Z'), 'America/Mexico_City', '05:00:00')
    expect(c.hoy).toBe('2026-09-28')
    expect(c.inicioHoyISO).toBe('2026-09-28T11:00:00.000Z')
  })

  it('respeta la zona del restaurante (Tijuana en horario de verano = UTC-7)', () => {
    expect(inicioDiaDeVentaISO('2026-07-15', 'America/Tijuana', 5)).toBe('2026-07-15T12:00:00.000Z')
  })
})

describe('operations — una cuenta vieja no dispara "mesa esperando cobro"', () => {
  const orden = (id: string, created: string, updated: string, extra: Record<string, unknown> = {}) => ({
    id, mesa: Number(id.replace(/\D/g, '')) || 1, mesero: 'Ana', total: 450, status: 'lista',
    payment_status: null, created_at: created, updated_at: updated, descuento: 0, ...extra,
  })

  it('la consulta de "hoy" arranca en el inicio del día de venta', async () => {
    const { sbGet, consultas } = fakeSb({ pos_orders: [] })
    await runOperationsAgent('amalay', sbGet, CTX)
    const q = consultas.find(c => c.table === 'pos_orders')!.query
    expect(q).toContain(`created_at=gte.${CTX.inicioHoyISO}`)
  })

  it('EL BUG: tres cuentas de anoche (19:00-21:00) en "lista" NO producen slow_payment crítico', async () => {
    // Antes el corte era 2026-09-28T00:00Z = 18:00 del 27 en Monterrey: estas entraban.
    const ayer = ['2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', '2026-09-28T03:00:00Z']
    const { sbGet } = fakeSb({ pos_orders: ayer.map((t, i) => orden(`m${i + 1}`, t, t)) })
    const evs = await runOperationsAgent('amalay', sbGet, CTX)
    expect(evs.find(e => e.type === 'slow_payment')).toBeUndefined()
    expect(evs.some(e => e.severity === 'critical')).toBe(false)
  })

  it('una cuenta de hoy olvidada 5 h en "lista" es higiene de datos (info), no un cliente esperando', async () => {
    const { sbGet } = fakeSb({ pos_orders: [orden('m4', min(320), min(300))] })
    const evs = await runOperationsAgent('amalay', sbGet, CTX)
    expect(evs.find(e => e.type === 'slow_payment')).toBeUndefined()
    const olvidada = evs.find(e => e.type === 'orden_sin_cerrar')
    expect(olvidada?.severity).toBe('info')
  })

  it('tres mesas de verdad esperando 30 min sí son críticas', async () => {
    const { sbGet } = fakeSb({ pos_orders: [1, 2, 3].map(i => orden(`m${i}`, min(90), min(30))) })
    const evs = await runOperationsAgent('amalay', sbGet, CTX)
    const e = evs.find(x => x.type === 'slow_payment')
    expect(e?.severity).toBe('critical')
  })

  it('una cuenta en "lista" ya pagada no espera a nadie', async () => {
    const { sbGet } = fakeSb({ pos_orders: [1, 2, 3].map(i => orden(`m${i}`, min(90), min(30), { payment_status: 'pagada' })) })
    const evs = await runOperationsAgent('amalay', sbGet, CTX)
    expect(evs.find(x => x.type === 'slow_payment')).toBeUndefined()
  })

  it('sin historial de ventas propio no inventa valor (ya no usa el ticket de AMALAY)', async () => {
    const { sbGet } = fakeSb({ pos_orders: [1, 2, 3].map(i => orden(`m${i}`, min(90), min(30))) })
    const e = (await runOperationsAgent('boruca', sbGet, CTX)).find(x => x.type === 'slow_payment')!
    expect(e.estimated_value).toBeNull()
  })

  it('con historial propio, el valor sale del ticket promedio del restaurante', async () => {
    const ventas = Array.from({ length: 25 }, (_, i) => ({
      id: `v${i}`, mesa: 9, mesero: 'Ana', total: 200, status: 'cerrada', payment_status: 'pagada',
      created_at: new Date(AHORA - (i + 2) * 86_400_000).toISOString(), updated_at: min(0), descuento: 0,
    }))
    const esperando = [1, 2, 3].map(i => orden(`m${i}`, min(90), min(30)))
    const { sbGet } = fakeSb({ pos_orders: [...esperando, ...ventas] })
    const e = (await runOperationsAgent('boruca', sbGet, CTX)).find(x => x.type === 'slow_payment')!
    // 3 mesas × $200 × 0.5 — con el ticket de ESTE restaurante, no $383.
    expect(e.estimated_value).toBe(300)
  })
})

describe('staff — día de venta y regla única de venta', () => {
  it('la consulta de "hoy" arranca en el inicio del día de venta', async () => {
    const { sbGet, consultas } = fakeSb({ pos_orders: [] })
    await runStaffAgent('amalay', sbGet, CTX)
    expect(consultas.find(c => c.table === 'pos_orders')!.query).toContain(`created_at=gte.${CTX.inicioHoyISO}`)
  })

  it('una cuenta en "lista" no es venta: no cuenta para el ranking del mesero', async () => {
    const o = (mesero: string, total: number, status: string, payment_status: string | null = null) =>
      ({ mesa: 1, mesero, total, status, payment_status, created_at: min(200) })
    const { sbGet } = fakeSb({
      pos_orders: [
        o('Ana', 100, 'cerrada'), o('Beto', 100, 'cerrada'), o('Caro', 100, 'cerrada'),
        // 5 cuentas sin cobrar de Ana: antes sumaban y la hacían "top performer" con 75%.
        ...Array.from({ length: 5 }, () => o('Ana', 100, 'lista')),
      ],
    })
    const evs = await runStaffAgent('amalay', sbGet, { ...CTX, horaLocal: 16 })
    expect(evs.find(e => e.type === 'top_performer')).toBeUndefined()
  })

  it('sin checador, "sin órdenes en hora pico" es info y no afirma que estén sin trabajar', async () => {
    const o = (mesero: string, t: string) => ({ mesa: 1, mesero, total: 300, status: 'cerrada', payment_status: null, created_at: t })
    const { sbGet } = fakeSb({
      pos_orders: [o('Ana', min(30)), o('Beto', min(40)), o('Caro', min(50)), o('Dani', min(300))],
      pos_attendance: [],
    })
    const e = (await runStaffAgent('amalay', sbGet, CTX)).find(x => x.type === 'idle_during_peak')!
    expect(e.severity).toBe('info')
    expect(e.title).toMatch(/sin órdenes registradas en la hora pico/)
  })

  it('con checador: quien ya checó salida NO se reporta; quien sigue en turno sí (warning)', async () => {
    const o = (mesero: string, t: string) => ({ mesa: 1, mesero, total: 300, status: 'cerrada', payment_status: null, created_at: t })
    const { sbGet } = fakeSb({
      pos_orders: [o('Ana', min(30)), o('Beto', min(40)), o('Caro', min(50)), o('Dani', min(300)), o('Eli', min(300))],
      pos_attendance: [
        { staff_id: 'd', staff_name: 'Dani', type: 'entrada', registered_at: min(420) },
        { staff_id: 'd', staff_name: 'Dani', type: 'salida', registered_at: min(240) },
        { staff_id: 'e', staff_name: 'Eli', type: 'entrada', registered_at: min(420) },
      ],
    })
    const e = (await runStaffAgent('amalay', sbGet, CTX)).find(x => x.type === 'idle_during_peak')!
    expect(e.severity).toBe('warning')
    expect(e.title).toContain('Eli')
    expect(e.title).not.toContain('Dani')
  })
})

describe('finance — hoy contra el mismo día de la semana A LA MISMA HORA', () => {
  // Lunes 28-sep a las 13:30. Los lunes anteriores: 21, 14, 7 de septiembre.
  const lunes = ['2026-09-21', '2026-09-14', '2026-09-07']

  it('lectorCorteFullsite suma sólo lo vendido hasta la misma hora de cada día', async () => {
    const venta = (iso: string, total: number) => ({ id: iso, created_at: iso, total, status: 'cerrada', payment_status: 'pagada' })
    const { sbGet } = fakeSb({
      pos_orders: [
        // Hoy: $1,000 en la mañana.
        venta('2026-09-28T15:00:00Z', 1000),
        // 21-sep: $1,200 antes de las 13:30 locales (19:30Z) y $9,000 después (la cena).
        venta('2026-09-21T16:00:00Z', 1200), venta('2026-09-22T02:00:00Z', 9000),
        // 14-sep: $800 antes, $7,000 después.
        venta('2026-09-14T18:00:00Z', 800), venta('2026-09-15T01:00:00Z', 7000),
        // 7-sep: sin órdenes en el POS (histórico importado, sin hora).
      ],
    })
    const r = await lectorCorteFullsite('amalay', lunes, CTX, sbGet)
    expect(r.hoy).toBe(1000)
    expect(r.dias).toEqual([
      { fecha: '2026-09-21', ventas: 1200 },
      { fecha: '2026-09-14', ventas: 800 },
      { fecha: '2026-09-07', ventas: null }, // no sé ≠ cero
    ])
  })

  /** 28 días de historia plana a $10,000, en orden desc, fechas de día de venta. */
  function historia() {
    const out: Record<string, unknown>[] = []
    for (let i = 1; i <= 28; i++) {
      const d = new Date(Date.UTC(2026, 8, 28 - i, 12)).toISOString().slice(0, 10)
      out.push({ fecha: d, ventas_dia: 10_000, tickets_count: 100, ticket_promedio_restaurant: 100 })
    }
    return out
  }
  const lector = (ventasHoy: number) => async () => ({
    dias: [{ fecha: '2026-09-28', ventas_dia: ventasHoy, tickets_count: 10, ticket_promedio_restaurant: 100 }, ...historia()],
    abiertas: 0,
  })
  const sbVacio = async <T,>(): Promise<T[]> => [] as T[]

  it('EL BUG: a mediodía, $4,000 contra días completos de $10,000 ya NO es "-60% crítico"', async () => {
    // A las 13:30 los lunes anteriores llevaban ~$4,000 también.
    const corte = async (_: string, fechas: string[]): Promise<CorteMismaHora> =>
      ({ hoy: 4000, dias: fechas.map(fecha => ({ fecha, ventas: 4000 })) })
    const evs = await runFinanceAgent('amalay', sbVacio, lector(4000), corte, CTX)
    expect(evs.find(e => e.type === 'sales_vs_dow')).toBeUndefined()
    expect(evs.some(e => e.severity === 'critical')).toBe(false)
  })

  it('sin ventas con hora para comparar: sólo una nota informativa, nunca crítico', async () => {
    const corte = async (_: string, fechas: string[]): Promise<CorteMismaHora> =>
      ({ hoy: 4000, dias: fechas.map(fecha => ({ fecha, ventas: null })) })
    const evs = await runFinanceAgent('amalay', sbVacio, lector(4000), corte, CTX)
    expect(evs.find(e => e.type === 'sales_vs_dow')).toBeUndefined()
    const nota = evs.find(e => e.type === 'sales_vs_dow_sin_corte')
    expect(nota?.severity).toBe('info')
    expect(evs.some(e => e.severity === 'critical')).toBe(false)
  })

  it('si la lectura a la misma hora FALLA, no se inventa la comparación', async () => {
    const corte = async (): Promise<CorteMismaHora> => { throw new Error('500') }
    const evs = await runFinanceAgent('amalay', sbVacio, lector(4000), corte, CTX)
    expect(evs.find(e => e.type === 'sales_vs_dow')).toBeUndefined()
    expect(evs.some(e => e.severity === 'critical')).toBe(false)
  })

  it('una caída real a la misma hora sí se reporta, con los números del corte', async () => {
    const corte = async (_: string, fechas: string[]): Promise<CorteMismaHora> =>
      ({ hoy: 2000, dias: fechas.map(fecha => ({ fecha, ventas: 5000 })) })
    const e = (await runFinanceAgent('amalay', sbVacio, lector(2000), corte, CTX)).find(x => x.type === 'sales_vs_dow')!
    expect(e.evidence.gap_pct).toBe(-60)
    expect(e.evidence.dow_avg).toBe(5000)
    expect(e.evidence.corte).toBe('misma_hora')
    expect(e.severity).toBe('critical') // ≥3 semanas y 8.5 h de servicio
  })

  it('con menos de 3 h de servicio la misma caída es warning, no crítico', async () => {
    const temprano = contextoDia(Date.parse('2026-09-28T13:00:00Z'), 'America/Mexico_City', '05:00:00') // 07:00 local
    const corte = async (_: string, fechas: string[]): Promise<CorteMismaHora> =>
      ({ hoy: 200, dias: fechas.map(fecha => ({ fecha, ventas: 500 })) })
    const e = (await runFinanceAgent('amalay', sbVacio, lector(200), corte, temprano)).find(x => x.type === 'sales_vs_dow')!
    expect(e.severity).toBe('warning')
  })

  it('dow_insight sólo sale los lunes o el día más flojo — no todos los días', async () => {
    const corte = async (_: string, fechas: string[]): Promise<CorteMismaHora> =>
      ({ hoy: 4000, dias: fechas.map(fecha => ({ fecha, ventas: 4000 })) })
    // Martes 29-sep 13:30, historia plana: el "peor día" es el primero que ordena el sort (domingo).
    const martes = contextoDia(Date.parse('2026-09-29T19:30:00Z'), 'America/Mexico_City', '05:00:00')
    const dias = async () => ({ dias: [{ fecha: '2026-09-29', ventas_dia: 4000, tickets_count: 10, ticket_promedio_restaurant: 100 }, ...historia().map(d => ({ ...d }))], abiertas: 0 })
    const evs = await runFinanceAgent('amalay', sbVacio, dias, corte, martes)
    expect(evs.find(e => e.type === 'dow_insight')).toBeUndefined()
    const lunesEvs = await runFinanceAgent('amalay', sbVacio, lector(4000), corte, CTX)
    expect(lunesEvs.find(e => e.type === 'dow_insight')).toBeDefined()
  })
})

describe('fraud — lectura completa y "sin mesero" no es una persona', () => {
  it('pagina en orden estable en vez de tomar 500 filas cualesquiera', async () => {
    const { sbGet, consultas } = fakeSb({ pos_orders: [] })
    await runFraudAgent('amalay', sbGet)
    const q = consultas.find(c => c.table === 'pos_orders')!.query
    expect(q).toContain('order=created_at.desc')
    expect(q).toContain('offset=0')
  })

  it('si llega al tope de lectura, lo dice', async () => {
    const sbGet = async <T,>(): Promise<T[]> => Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}` })) as T[]
    const r = await leerPaginado(sbGet, 'pos_orders', 'order=id.asc', { maxPaginas: 2 })
    expect(r.truncado).toBe(true)
    expect(r.filas.length).toBe(2000)
  })

  it('cancelaciones sin mesero no generan una alerta contra "Desconocido"; se reportan como calidad de datos', async () => {
    const cancel = (i: number) => ({ id: `c${i}`, mesa: i, mesero: null, total: 300, subtotal: 300, descuento: 0, status: 'cancelada', payment_status: null, created_at: min(60 + i) })
    const { sbGet } = fakeSb({ pos_orders: Array.from({ length: 8 }, (_, i) => cancel(i)) })
    const evs = await runFraudAgent('amalay', sbGet)
    expect(evs.find(e => e.type === 'cancel_concentration')).toBeUndefined()
    expect(evs.some(e => /Desconocido/.test(e.title))).toBe(false)
    expect(evs.find(e => e.type === 'mesero_faltante')?.severity).toBe('info')
  })

  it('un descuento en una cuenta "lista" (sin cobrar) no cuenta como descuento de venta', async () => {
    const o = (i: number, status: string) => ({ id: `d${i}`, mesa: i, mesero: 'Ana', total: 100, subtotal: 400, descuento: 300, status, payment_status: null, created_at: min(60 + i) })
    const { sbGet } = fakeSb({ pos_orders: [0, 1, 2, 3, 4].map(i => o(i, 'lista')) })
    const evs = await runFraudAgent('amalay', sbGet)
    expect(evs.find(e => e.type === 'large_discounts' || e.type === 'discount_concentration')).toBeUndefined()
  })
})

describe('dedupe — la llave incluye de quién habla el hallazgo', () => {
  it('el sujeto sale de la evidencia (mesero, insumo, orden)', () => {
    expect(sujetoDeHallazgo({ mesero: 'Ana' })).toBe('mesero=ana')
    expect(sujetoDeHallazgo({ insumo: 'Aguacate' })).toBe('insumo=aguacate')
    expect(sujetoDeHallazgo({ order_id: 'o-9' })).toBe('order_id=o-9')
    expect(sujetoDeHallazgo({ count: 3 })).toBe('')
  })

  it('dos meseros distintos → dos llaves distintas', () => {
    const a = llaveDedupe({ type: 'cancel_concentration', severity: 'warning', evidence: { mesero: 'Ana' } })
    const b = llaveDedupe({ type: 'cancel_concentration', severity: 'warning', evidence: { mesero: 'Luis' } })
    expect(a).not.toBe(b)
  })
})

describe('engine — el segundo mesero no se suprime, y lo crítico queda marcado para avisar', () => {
  const inserts: Array<Record<string, unknown>> = []
  beforeEach(() => {
    inserts.length = 0
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
    process.env.SUPABASE_SERVICE_KEY = 'k'
    vi.resetModules()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@/lib/agents/fraud') })

  it('ya hay una alerta abierta de Ana; la de Luis SÍ se inserta y la de Ana no se repite', async () => {
    const hallazgo = (mesero: string, severity: 'warning' | 'critical') => ({
      client_id: 'amalay', agent_id: 'fraud' as const, type: 'cancel_concentration', severity,
      title: mesero, explanation: 'e', evidence: { mesero }, suggested_action: 'a',
      confidence: 0.8, status: 'new' as const, expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    vi.doMock('@/lib/agents/fraud', () => ({
      runFraudAgent: async () => [hallazgo('Ana', 'warning'), hallazgo('Luis', 'warning'), hallazgo('Mar', 'critical')],
    }))
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      if (init?.method === 'POST' && u.includes('/agent_events')) inserts.push(JSON.parse(String(init.body)))
      if ((init?.method ?? 'GET') === 'GET' && u.includes('/agent_events') && u.includes('status=eq.new')) {
        return new Response(JSON.stringify([
          { type: 'cancel_concentration', severity: 'warning', evidence: { mesero: 'Ana' }, expires_at: null, created_at: new Date().toISOString() },
        ]), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    }))
    const { runAgent } = await import('@/lib/agents/engine')
    const r = await runAgent('fraud', 'amalay', 'cron')

    expect(inserts.map(i => i.title).sort()).toEqual(['Luis', 'Mar'])
    const mar = inserts.find(i => i.title === 'Mar')!
    expect((mar.evidence as Record<string, unknown>).notificar).toEqual({ pendiente: true, motivo: 'critical' })
    const luis = inserts.find(i => i.title === 'Luis')!
    expect((luis.evidence as Record<string, unknown>).notificar).toBeUndefined()
    expect(r.events.find(e => e.title === 'Mar')?.notify).toBe(true)
  })
})
