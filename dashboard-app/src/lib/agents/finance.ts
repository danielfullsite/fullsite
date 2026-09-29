/**
 * Finance Agent
 *
 * Analiza: ventas vs promedio histórico (mismo DOW), ticket promedio,
 * tendencias semanales, proyección del día.
 *
 * Inputs:  ventas por día de venta del propio restaurante (ventasFullsitePrimero) y,
 *          para "hoy vs mismo día", pos_orders con hora para cortar a la MISMA HORA.
 */
import type { AgentEvent } from './types'
import { ventasFullsitePrimero } from '@/lib/pos-daily'
import { FILTRO_VENTA, dowDeFecha, inicioDiaDeVentaISO, leerContextoDia, leerPaginado, type ContextoDia } from './dia-negocio'
import { sumarDias } from '@/lib/date-mx'

interface WansoftDay {
  fecha: string
  ventas_dia: number | null
  tickets_count: number | null
  ticket_promedio_restaurant: number | null
}

interface WansoftKpis {
  ventas_dia: number | null
  tickets_count: number | null
  ticket_promedio_restaurant: number | null
  ordenes_abiertas: number | null
}

function dayOfWeek(iso: string): number {
  return dowDeFecha(iso)
}

const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Lo que el agente necesita leer: días de venta (DESC, incluye hoy si hay) y órdenes abiertas. */
export interface LecturaFinanzas { dias: Record<string, unknown>[]; abiertas: number }
export type LectorFinanzas = (clientId: string) => Promise<LecturaFinanzas>

/**
 * FULLSITE PRIMERO y SIEMPRE POR RESTAURANTE. Antes el agente leía wansoft_daily/
 * wansoft_kpis SIN filtro de cliente (tablas "globales de AMALAY"), por eso sólo podía
 * correr para el dueño del histórico de Wansoft — y llevaba desde el 2026-07-20 ciego
 * porque esa fuente murió. Ahora: días = ventasFullsitePrimero (POS de Fullsite; el
 * histórico importado sólo cubre hasta su último día, filtrado por client_slug) y
 * órdenes abiertas del POS. Inyectable para pruebas.
 */
export async function lectorFullsite(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<LecturaFinanzas> {
  const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  const [lectura, abiertas] = await Promise.all([
    ventasFullsitePrimero(SB_URL, H, clientId, 35, 'fecha,ventas_dia,tickets_count,ticket_promedio_restaurant'),
    sbGet<{ id: string }>('pos_orders', `client_id=eq.${encodeURIComponent(clientId)}&status=eq.abierta&select=id&limit=500`)
      .catch(() => [] as { id: string }[]),
  ])
  return { dias: lectura.dias, abiertas: abiertas.length }
}

/**
 * Ventas hasta la MISMA HORA del día de venta: hoy, y en cada fecha de comparación.
 *
 * Antes se comparaban las ventas PARCIALES de hoy (a las 13:00, digamos $4,000) contra
 * el TOTAL de los lunes anteriores ($18,000) — y salía "vas 78% abajo" como crítico
 * todos los días a mediodía. No era una caída: era medir medio día contra un día entero.
 *
 * `ventas: null` en una fecha = ese día no tiene órdenes en el POS con hora (p. ej. viene
 * del histórico importado, que sólo trae totales diarios). No es cero: es "no sé".
 */
export interface CorteMismaHora {
  hoy: number | null
  dias: { fecha: string; ventas: number | null }[]
}
export type LectorCorte = (clientId: string, fechas: string[], ctx: ContextoDia) => Promise<CorteMismaHora>

export async function lectorCorteFullsite(
  clientId: string,
  fechas: string[],
  ctx: ContextoDia,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<CorteMismaHora> {
  const transcurridoMs = ctx.minutosDesdeInicio * 60_000
  const sumaHasta = async (inicioISO: string, finISO: string, corteMs: number): Promise<number | null> => {
    try {
      const { filas, truncado } = await leerPaginado<{ created_at: string; total: number | null }>(
        sbGet, 'pos_orders',
        `client_id=eq.${encodeURIComponent(clientId)}&${FILTRO_VENTA}` +
          `&created_at=gte.${inicioISO}&created_at=lt.${finISO}&select=created_at,total&order=created_at.asc,id.asc`,
      )
      if (truncado || filas.length === 0) return null
      return filas
        .filter(o => Date.parse(o.created_at) < corteMs)
        .reduce((s, o) => s + (Number(o.total) || 0), 0)
    } catch {
      return null // falla de lectura ≠ cero ventas
    }
  }
  const hoy = await sumaHasta(ctx.inicioHoyISO, new Date(ctx.ahoraMs + 60_000).toISOString(), ctx.ahoraMs + 60_000)
  const dias = await Promise.all(fechas.map(async fecha => {
    const inicio = inicioDiaDeVentaISO(fecha, ctx.tz, ctx.inicioHoras)
    const inicioMs = Date.parse(inicio)
    // Se lee el día COMPLETO para saber si hay datos con hora; luego se corta.
    const fin = new Date(inicioMs + 24 * 60 * 60 * 1000).toISOString()
    return { fecha, ventas: await sumaHasta(inicio, fin, inicioMs + transcurridoMs) }
  }))
  return { hoy, dias }
}

/** Mínimo de horas de servicio antes de que una brecha pueda ser crítica: con 1 h de datos todo es ruido. */
const MIN_HORAS_PARA_CRITICO = 3

export async function runFinanceAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
  leer: LectorFinanzas = id => lectorFullsite(id, sbGet),
  leerCorte: LectorCorte = (id, fechas, c) => lectorCorteFullsite(id, fechas, c, sbGet),
  ctxDado?: ContextoDia,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const ctx = ctxDado ?? await leerContextoDia(clientId, sbGet)
  const now = ctx.ahoraMs
  // Día de VENTA, no de calendario: a la 1 a.m. sigue siendo "ayer" para el restaurante,
  // igual que `pos_orders.dia_venta`, que es como vienen agrupados los `dias`.
  const today = ctx.hoy
  const todayDOW = ctx.dow
  const cutoff28 = sumarDias(today, -28, ctx.tz)

  const lectura = await leer(clientId).catch(() => ({ dias: [] as Record<string, unknown>[], abiertas: 0 }))
  const aDia = (r: Record<string, unknown>): WansoftDay => ({
    fecha: String(r.fecha),
    ventas_dia: Number(r.ventas_dia) || 0,
    tickets_count: Number(r.tickets_count) || 0,
    ticket_promedio_restaurant: Number(r.ticket_promedio_restaurant) || 0,
  })
  const history: WansoftDay[] = lectura.dias.map(aDia)
    .filter(d => d.fecha >= cutoff28 && d.fecha !== today && (d.ventas_dia ?? 0) > 0)
  const hoy = lectura.dias.map(aDia).find(d => d.fecha === today)
  // Última venta aunque esté FUERA de la ventana de 28 días: es lo que permite decir
  // "llevo N días sin datos" en vez de sólo "no hay datos".
  const ultimaConVentas = lectura.dias.map(aDia)
    .filter(d => d.fecha !== today && (d.ventas_dia ?? 0) > 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0]?.fecha ?? null
  const kpisArr: WansoftKpis[] = hoy
    ? [{ ...hoy, ordenes_abiertas: lectura.abiertas }]
    : []

  const kpis = kpisArr[0] ?? null

  // ── Fuente insuficiente: se DICE, no se calla ────────────────────────────
  //
  // Antes esto era `if (history.length < 7) return events`, un return silencioso. El
  // problema no es el corte —hace falta una semana para comparar— sino que un agente que
  // devuelve [] porque su fuente está muerta se ve EXACTAMENTE igual que uno que devuelve
  // [] porque todo está bien. Nadie puede distinguirlos desde afuera.
  //
  // Medido el 2026-08-30: `wansoft_daily` no tiene una sola fila en los últimos 28 días
  // (última fecha 2026-07-20). O sea que este agente llevaba 41 días devolviendo vacío en
  // cada corrida, y en el tablero se leía como "sin hallazgos". Un agente mudo que parece
  // sano es peor que uno que falla: el que falla se arregla.
  //
  // Ahora emite un hallazgo que dice que no puede opinar y desde cuándo. Vale como
  // detector de fuente muerta para cualquier restaurante, no sólo para éste.
  if (history.length < 7) {
    const ultima = history[0]?.fecha ?? ultimaConVentas
    const diasSinDatos = ultima
      ? Math.floor((Date.parse(`${today}T12:00:00`) - Date.parse(`${ultima}T12:00:00`)) / 86_400_000)
      : null

    events.push({
      client_id: clientId,
      agent_id: 'finance',
      type: 'fuente_sin_datos',
      // warning y no critical: no hay evidencia de que el negocio esté mal — lo que está
      // mal es nuestra capacidad de verlo. Escalarlo a critical entrena a ignorar criticals.
      severity: 'warning',
      title: 'El agente de finanzas no tiene datos para analizar',
      explanation: ultima
        ? `La fuente histórica sólo trae ${history.length} día(s) en la ventana de 28, y el más reciente es del ${ultima}` +
          `${diasSinDatos != null ? ` (hace ${diasSinDatos} días)` : ''}. Se necesitan 7 días para comparar contra el mismo día de la semana. ` +
          `Mientras tanto este agente no puede afirmar nada: su silencio NO significa que las ventas estén bien.`
        : 'La fuente histórica no devolvió ninguna fila en los últimos 28 días. Este agente no puede afirmar nada, ' +
          'y su silencio NO significa que las ventas estén bien.',
      evidence: {
        dias_disponibles: history.length,
        dias_requeridos: 7,
        ventana_dias: 28,
        fecha_mas_reciente: ultima,
        dias_sin_datos: diasSinDatos,
        fuente: 'POS de Fullsite (histórico importado sólo hasta su último día)',
      },
      suggested_action: 'Revisar que el restaurante esté cobrando con el POS de Fullsite. Sin ventas registradas, el agente de finanzas queda ciego.',
      confidence: 1, // No es una inferencia: o hay filas o no las hay.
      status: 'new',
      estimated_value: null, // No hay nada que cuantificar: el problema es la ausencia de datos.
      // 12h: una fuente muerta no cambia de estado cada media hora. Sin esto el aviso se
      // repetía en cada corrida del cron — medido el 2026-08-31: 4 copias en 12 horas, y
      // con el cron completo serían ~34 al día del mismo texto. Un aviso correcto repetido
      // 34 veces deja de leerse, y entonces tampoco se lee el día que sí cambie algo.
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    })
    return events
  }

  // ── 1. Ventas de hoy vs mismo DOW, A LA MISMA HORA ─────────────────────────
  const sameDOW = history.filter(d => dayOfWeek(d.fecha) === todayDOW)
  if (sameDOW.length >= 2 && kpis?.ventas_dia != null && kpis.ventas_dia > 0) {
    const dowName = DOW_NAMES[todayDOW]
    const corte = await leerCorte(clientId, sameDOW.map(d => d.fecha), ctx)
      .catch(() => ({ hoy: null, dias: [] }) as CorteMismaHora)
    const comparables = corte.dias.filter((d): d is { fecha: string; ventas: number } => d.ventas != null)
    const todaySales = corte.hoy
    const horaCorte = `${String(ctx.horaLocal).padStart(2, '0')}:00`

    if (todaySales != null && todaySales > 0 && comparables.length >= 2) {
      const avgDOW = comparables.reduce((s, d) => s + d.ventas, 0) / comparables.length
      const pct = avgDOW > 0 ? ((todaySales - avgDOW) / avgDOW) * 100 : 0
      const gapMXN = Math.round(Math.abs(todaySales - avgDOW))
      const horasDeDatos = ctx.minutosDesdeInicio / 60

      if (avgDOW > 0 && Math.abs(pct) > 15) {
        const isPositive = pct > 0
        // Crítico sólo con evidencia suficiente: ≥3 semanas comparables y ≥3 h de servicio.
        // Con menos, la misma caída es un aviso — un crítico falso cuesta más que uno tardío.
        const puedeSerCritico = comparables.length >= 3 && horasDeDatos >= MIN_HORAS_PARA_CRITICO
        events.push({
          client_id: clientId,
          agent_id: 'finance',
          type: 'sales_vs_dow',
          severity: isPositive ? 'info' : (pct < -30 && puedeSerCritico ? 'critical' : 'warning'),
          title: isPositive
            ? `Hoy vas $${gapMXN.toLocaleString('es-MX')} arriba de un ${dowName} normal a esta hora`
            : `Hoy vas $${gapMXN.toLocaleString('es-MX')} abajo de un ${dowName} normal a esta hora`,
          explanation: `Ventas hasta ahora: $${todaySales.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN. A esta misma hora, el ${dowName} promedia $${Math.round(avgDOW).toLocaleString('es-MX')} MXN (${comparables.length} semanas). ` +
            (isPositive ? `Vas ${Math.round(pct)}% arriba.` : `Vas ${Math.abs(Math.round(pct))}% abajo.`),
          evidence: {
            today_sales: todaySales,
            dow_avg: Math.round(avgDOW),
            gap_pct: Math.round(pct),
            gap_mxn: gapMXN,
            dow: dowName,
            sample_weeks: comparables.length,
            corte: 'misma_hora',
            minutos_desde_inicio: ctx.minutosDesdeInicio,
            fechas_comparadas: comparables.map(d => d.fecha),
          },
          suggested_action: isPositive
            ? 'Ritmo excelente. Verifica que cocina tiene insumos para sostenerlo y activa upselling de postres y bebidas especiales.'
            : `Ventas bajas para un ${dowName} a esta hora. Revisa si hay causa externa (clima, evento, feriado). Si no, activa promoción o envía un mesero a captar clientes de paso.`,
          confidence: Math.min(0.65 + comparables.length * 0.05, 0.90),
          status: 'new',
          estimated_value: isPositive ? null : gapMXN, // brecha que se puede cerrar
          expires_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        })
      }
    } else if (todaySales == null || comparables.length < 2) {
      // No hay con qué comparar a la misma hora (histórico sin hora, o la lectura falló).
      // Comparar contra días completos era el falso crítico; aquí sólo se informa.
      events.push({
        client_id: clientId,
        agent_id: 'finance',
        type: 'sales_vs_dow_sin_corte',
        severity: 'info',
        title: `Aún no se puede comparar hoy contra otros ${dowName}s a la misma hora`,
        explanation: `Llevas $${kpis.ventas_dia.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN. Un ${dowName} completo promedia $${Math.round(sameDOW.reduce((s, d) => s + (d.ventas_dia ?? 0), 0) / sameDOW.length).toLocaleString('es-MX')} MXN, pero sólo ${comparables.length} de ${sameDOW.length} ${dowName}s tienen ventas con hora en el POS, así que no se sabe cuánto llevaban a las ${horaCorte}. Esto NO es una alerta.`,
        evidence: {
          ventas_hasta_ahora: kpis.ventas_dia,
          dow: dowName,
          dias_mismo_dow: sameDOW.length,
          dias_con_hora: comparables.length,
          lectura_hoy_ok: todaySales != null,
        },
        suggested_action: 'Nada que hacer ahora. La comparación a la misma hora se activa sola cuando haya al menos 2 semanas de ventas registradas en el POS de Fullsite.',
        confidence: 1,
        status: 'new',
        estimated_value: null,
        expires_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 2. Tendencia de ticket promedio (últimos 7 días vs 7 anteriores) ───────
  const last7 = history.slice(0, 7).filter(d => (d.ticket_promedio_restaurant ?? 0) > 0)
  const prev7  = history.slice(7, 14).filter(d => (d.ticket_promedio_restaurant ?? 0) > 0)

  if (last7.length >= 5 && prev7.length >= 4) {
    const avgLast7 = last7.reduce((s, d) => s + (d.ticket_promedio_restaurant ?? 0), 0) / last7.length
    const avgPrev7 = prev7.reduce((s, d) => s + (d.ticket_promedio_restaurant ?? 0), 0) / prev7.length
    const trend    = avgPrev7 > 0 ? ((avgLast7 - avgPrev7) / avgPrev7) * 100 : 0
    const gapPerTicket = Math.round(Math.abs(avgLast7 - avgPrev7))

    // Impacto semanal estimado = brecha por ticket × tickets de la semana
    const weekTickets = last7.reduce((s, d) => s + (d.tickets_count ?? 0), 0)
    const weeklyImpact = Math.round(gapPerTicket * weekTickets)

    if (trend < -12) {
      events.push({
        client_id: clientId,
        agent_id: 'finance',
        type: 'ticket_declining',
        severity: trend < -22 ? 'critical' : 'warning',
        title: `Ticket promedio cayó $${gapPerTicket} por persona esta semana`,
        explanation: `Esta semana: $${Math.round(avgLast7).toLocaleString('es-MX')} por persona. Semana anterior: $${Math.round(avgPrev7).toLocaleString('es-MX')}. Con ${weekTickets} tickets, eso representa $${weeklyImpact.toLocaleString('es-MX')} menos que la semana pasada.`,
        evidence: {
          avg_last7: Math.round(avgLast7),
          avg_prev7: Math.round(avgPrev7),
          trend_pct: Math.round(trend),
          gap_per_ticket: gapPerTicket,
          week_tickets: weekTickets,
          weekly_impact: weeklyImpact,
        },
        suggested_action: 'Revisa si los meseros están ofreciendo bebidas, postres y entradas, o si hay promociones que estén reduciendo el ticket. Habla con el equipo hoy antes del turno.',
        confidence: 0.82,
        status: 'new',
        estimated_value: weeklyImpact,
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      })
    } else if (trend > 12) {
      events.push({
        client_id: clientId,
        agent_id: 'finance',
        type: 'ticket_growing',
        severity: 'info',
        title: `Ticket promedio subió $${gapPerTicket} por persona esta semana`,
        explanation: `Esta semana promedia $${Math.round(avgLast7).toLocaleString('es-MX')} por persona vs $${Math.round(avgPrev7).toLocaleString('es-MX')} la semana pasada. $${weeklyImpact.toLocaleString('es-MX')} más en total esta semana.`,
        evidence: { avg_last7: Math.round(avgLast7), avg_prev7: Math.round(avgPrev7), trend_pct: Math.round(trend), weekly_impact: weeklyImpact },
        suggested_action: 'Identifica qué está impulsando el aumento (mesero específico, platillo nuevo, temporada) y replícalo.',
        confidence: 0.82,
        status: 'new',
        estimated_value: null,
        expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 3. Mejor y peor día de la semana (solo lunes o si es el peor día) ────
  // Cadencia: sólo los lunes, o el día que resulta ser el más flojo. Antes el `if`
  // de afuera traía `|| true` y el cálculo corría siempre; el de adentro ya filtraba.
  const currentDOW = todayDOW
  if (history.length >= 14) {
    const byDOW = Array.from({ length: 7 }, (_, i) =>
      history.filter(d => dayOfWeek(d.fecha) === i && (d.ventas_dia ?? 0) > 0),
    )
    const avgByDOW = byDOW
      .map((days, dow) => ({
        dow,
        avg: days.length >= 2 ? days.reduce((s, d) => s + (d.ventas_dia ?? 0), 0) / days.length : 0,
        n: days.length,
      }))
      .filter(d => d.n >= 2)

    if (avgByDOW.length >= 5) {
      const best  = [...avgByDOW].sort((a, b) => b.avg - a.avg)[0]
      const worst = [...avgByDOW].sort((a, b) => a.avg - b.avg)[0]

      if (currentDOW === 1 || currentDOW === worst.dow) {
        const gap = Math.round(best.avg - worst.avg)
        events.push({
          client_id: clientId,
          agent_id: 'finance',
          type: 'dow_insight',
          severity: 'info',
          title: `${DOW_NAMES[best.dow][0].toUpperCase() + DOW_NAMES[best.dow].slice(1)} es tu mejor día ($${Math.round(best.avg / 1000)}k prom). ${DOW_NAMES[worst.dow][0].toUpperCase() + DOW_NAMES[worst.dow].slice(1)} el más bajo.`,
          explanation: `Basado en ${Math.max(...avgByDOW.map(d => d.n))} semanas: ${DOW_NAMES[best.dow]} promedia $${Math.round(best.avg).toLocaleString('es-MX')} MXN y ${DOW_NAMES[worst.dow]} $${Math.round(worst.avg).toLocaleString('es-MX')} MXN. Diferencia de $${gap.toLocaleString('es-MX')} MXN.`,
          evidence: {
            best:  { dow: DOW_NAMES[best.dow],  avg: Math.round(best.avg) },
            worst: { dow: DOW_NAMES[worst.dow], avg: Math.round(worst.avg) },
            gap_mxn: gap,
            by_dow: avgByDOW.map(d => ({ dow: DOW_NAMES[d.dow], avg: Math.round(d.avg) })),
          },
          suggested_action: `Considera activar una promoción o evento especial los ${DOW_NAMES[worst.dow]} para cerrar la brecha de $${gap.toLocaleString('es-MX')} vs tu mejor día.`,
          confidence: 0.88,
          status: 'new',
          estimated_value: gap,
          expires_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
        })
      }
    }
  }

  return events
}
