/**
 * Finance Agent
 *
 * Analiza: ventas vs promedio histórico (mismo DOW), ticket promedio,
 * tendencias semanales, proyección del día.
 *
 * Inputs:  wansoft_daily (last 28 days), wansoft_kpis
 *
 * NOTA: wansoft_daily y wansoft_kpis son tablas globales sin client_id.
 * No filtrar por cliente — son exclusivas de AMALAY.
 */
import type { AgentEvent } from './types'

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
  return new Date(iso + 'T12:00:00').getDay()
}

function nowMX(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
}

function todayStr(): string {
  const d = nowMX()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export async function runFinanceAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const now = Date.now()
  const today = todayStr()
  const todayDOW = dayOfWeek(today)
  const cutoff28 = new Date(now - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // wansoft_daily y wansoft_kpis no tienen client_id — son tablas globales de AMALAY
  const [history, kpisArr] = await Promise.all([
    sbGet<WansoftDay>(
      'wansoft_daily',
      `fecha=gte.${cutoff28}&fecha=neq.${today}&ventas_dia=gt.0&select=fecha,ventas_dia,tickets_count,ticket_promedio_restaurant&order=fecha.desc&limit=60`,
    ).catch(() => [] as WansoftDay[]),
    sbGet<WansoftKpis>(
      'wansoft_kpis',
      `select=ventas_dia,tickets_count,ticket_promedio_restaurant,ordenes_abiertas&limit=1`,
    ).catch(() => [] as WansoftKpis[]),
  ])

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
    const ultima = history[0]?.fecha ?? null
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
        fuente: 'wansoft_daily',
      },
      suggested_action: 'Revisar el pipeline que alimenta la fuente histórica. Sin eso, el agente de finanzas queda ciego.',
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

  // ── 1. Ventas de hoy vs mismo DOW ────────────────────────────────────────
  const sameDOW = history.filter(d => dayOfWeek(d.fecha) === todayDOW)
  if (sameDOW.length >= 2 && kpis?.ventas_dia != null && kpis.ventas_dia > 0) {
    const avgDOW = sameDOW.reduce((s, d) => s + (d.ventas_dia ?? 0), 0) / sameDOW.length
    const todaySales = kpis.ventas_dia
    const pct = avgDOW > 0 ? ((todaySales - avgDOW) / avgDOW) * 100 : 0
    const dowName = DOW_NAMES[todayDOW]
    const gapMXN = Math.round(Math.abs(todaySales - avgDOW))

    if (Math.abs(pct) > 15) {
      const isPositive = pct > 0
      events.push({
        client_id: clientId,
        agent_id: 'finance',
        type: 'sales_vs_dow',
        severity: isPositive ? 'info' : (pct < -30 ? 'critical' : 'warning'),
        title: isPositive
          ? `Hoy vas $${gapMXN.toLocaleString('es-MX')} arriba del ${dowName} promedio`
          : `Hoy vas $${gapMXN.toLocaleString('es-MX')} abajo del ${dowName} promedio`,
        explanation: isPositive
          ? `Ventas actuales: $${todaySales.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN. El ${dowName} promedia $${Math.round(avgDOW).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN (${sameDOW.length} semanas). Vas ${Math.round(pct)}% arriba.`
          : `Ventas actuales: $${todaySales.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN. El ${dowName} promedia $${Math.round(avgDOW).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN. Te faltan $${gapMXN.toLocaleString('es-MX')} para llegar al promedio histórico.`,
        evidence: {
          today_sales: todaySales,
          dow_avg: Math.round(avgDOW),
          gap_pct: Math.round(pct),
          gap_mxn: gapMXN,
          dow: dowName,
          sample_weeks: sameDOW.length,
        },
        suggested_action: isPositive
          ? 'Ritmo excelente. Verifica que cocina tiene insumos para sostenerlo y activa upselling de postres y bebidas especiales.'
          : `Ventas bajas para un ${dowName}. Revisa si hay causa externa (clima, evento, feriado). Si no, activa promoción o envía un mesero a captar clientes de paso.`,
        confidence: Math.min(0.65 + sameDOW.length * 0.05, 0.90),
        status: 'new',
        estimated_value: isPositive ? null : gapMXN, // brecha que se puede cerrar
        expires_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
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
  const currentDOW = nowMX().getDay()
  if (history.length >= 14 && (currentDOW === 1 || true)) {
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
