/**
 * Staff Agent
 *
 * Analiza: productividad por mesero, tiempos muertos REALES (solo en hora pico),
 * desempeño relativo, ratio mesas/mesero.
 *
 * Inputs:  pos_orders (today)
 */
import type { AgentEvent } from './types'

interface PosOrder {
  mesa: number | null
  mesero: string | null
  total: number
  status: string
  created_at: string
}

function nowMX(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
}

// Horas de servicio activo — fuera de estos rangos no aplica "idle" detection
// porque en horas valle no tener órdenes es completamente normal.
function isTruePeakHour(h: number): boolean {
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21)
}

export async function runStaffAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const now = Date.now()
  const currentHour = nowMX().getHours()
  const todayMX = nowMX()
  todayMX.setHours(0, 0, 0, 0)
  const todayCutoff = todayMX.toISOString()
  const twoHAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

  const orders = await sbGet<PosOrder>(
    'pos_orders',
    `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${todayCutoff}&status=neq.cancelada&select=mesa,mesero,total,status,created_at&limit=500`,
  )

  const closedOrders = orders.filter(o => ['cerrada', 'pagada', 'lista'].includes(o.status))
  if (closedOrders.length < 3) return events // No hay suficiente data

  // ── Build per-mesero stats ───────────────────────────────────────────────
  interface MeseroStats {
    name: string
    orderCount: number
    totalRevenue: number
    avgTicket: number
    recentOrders: number
  }

  const meseroMap = new Map<string, { orders: PosOrder[]; recent: PosOrder[] }>()
  for (const o of closedOrders) {
    const n = o.mesero || 'Sin asignar'
    if (n === 'Sin asignar') continue
    if (!meseroMap.has(n)) meseroMap.set(n, { orders: [], recent: [] })
    meseroMap.get(n)!.orders.push(o)
    if (o.created_at >= twoHAgo) meseroMap.get(n)!.recent.push(o)
  }

  if (meseroMap.size === 0) return events

  const meseroStats: MeseroStats[] = Array.from(meseroMap.entries()).map(([name, { orders: ords, recent }]) => {
    const totalRevenue = ords.reduce((s, o) => s + (o.total || 0), 0)
    return {
      name,
      orderCount: ords.length,
      totalRevenue,
      avgTicket: ords.length > 0 ? totalRevenue / ords.length : 0,
      recentOrders: recent.length,
    }
  })

  const teamAvgTicket = meseroStats.reduce((s, m) => s + m.avgTicket, 0) / meseroStats.length
  const teamTotal     = meseroStats.reduce((s, m) => s + m.totalRevenue, 0)

  // ── 1. Top performer ──────────────────────────────────────────────────────
  const topByRevenue = [...meseroStats].sort((a, b) => b.totalRevenue - a.totalRevenue)[0]
  if (topByRevenue && topByRevenue.totalRevenue > teamTotal * 0.38 && meseroStats.length >= 3) {
    const pct = Math.round((topByRevenue.totalRevenue / teamTotal) * 100)
    events.push({
      client_id: clientId,
      agent_id: 'staff',
      type: 'top_performer',
      severity: 'info',
      title: `${topByRevenue.name} lleva el ${pct}% de las ventas de hoy`,
      explanation: `${topByRevenue.name} generó $${topByRevenue.totalRevenue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN en ${topByRevenue.orderCount} órdenes. Ticket promedio: $${Math.round(topByRevenue.avgTicket).toLocaleString('es-MX')}.`,
      evidence: {
        mesero: topByRevenue.name,
        revenue: topByRevenue.totalRevenue,
        order_count: topByRevenue.orderCount,
        avg_ticket: Math.round(topByRevenue.avgTicket),
        team_pct: pct,
        team_total: teamTotal,
      },
      suggested_action: `Reconoce a ${topByRevenue.name} hoy — públicamente, frente al equipo. El reconocimiento inmediato refuerza el comportamiento.`,
      confidence: 0.92,
      status: 'new',
      estimated_value: null,
      expires_at: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 2. Mesero sin actividad en HORA PICO — no en horario general ──────────
  // Solo aplica durante 12-2pm y 7-9pm. Fuera de eso, 0 órdenes en 2h es normal.
  if (isTruePeakHour(currentHour) && meseroStats.length >= 3) {
    const activeCount = meseroStats.filter(m => m.recentOrders > 0).length
    const idleStaff = meseroStats.filter(m => m.recentOrders === 0)

    // Solo es una alerta si la mayoría del equipo SÍ está activa
    if (idleStaff.length > 0 && activeCount >= idleStaff.length) {
      events.push({
        client_id: clientId,
        agent_id: 'staff',
        type: 'idle_during_peak',
        severity: 'warning',
        title: `${idleStaff.map(m => m.name).join(', ')} sin órdenes durante hora pico`,
        explanation: `Son las ${currentHour}:00 — hora de alta demanda. ${idleStaff.map(m => m.name).join(' y ')} no han registrado actividad en las últimas 2 horas mientras ${activeCount} compañeros sí están atendiendo.`,
        evidence: {
          idle: idleStaff.map(m => ({ name: m.name, orders_today: m.orderCount })),
          active: meseroStats.filter(m => m.recentOrders > 0).map(m => ({ name: m.name, recent: m.recentOrders })),
          peak_hour: currentHour,
        },
        suggested_action: `Pregúntale a ${idleStaff[0].name} si está en break o si tiene algún problema. Si no, asígnale mesas en sección activa.`,
        confidence: 0.78,
        status: 'new',
        estimated_value: null,
        expires_at: new Date(now + 90 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 3. Ticket muy bajo vs equipo (requiere ≥6 órdenes para ser significativo) ─
  const lowPerformers = meseroStats
    .filter(m => m.orderCount >= 6 && m.avgTicket < teamAvgTicket * 0.62)
    .sort((a, b) => a.avgTicket - b.avgTicket)

  if (lowPerformers.length > 0 && meseroStats.length >= 3) {
    const lp = lowPerformers[0]
    const gap = Math.round(teamAvgTicket - lp.avgTicket)
    const gapWeekly = Math.round(gap * lp.orderCount) // impacto en las órdenes de hoy

    events.push({
      client_id: clientId,
      agent_id: 'staff',
      type: 'low_ticket',
      severity: 'info',
      title: `${lp.name} tiene ticket $${gap} bajo el promedio del equipo`,
      explanation: `Ticket promedio de ${lp.name}: $${Math.round(lp.avgTicket).toLocaleString('es-MX')} vs $${Math.round(teamAvgTicket).toLocaleString('es-MX')} del equipo (${lp.orderCount} órdenes de hoy). Diferencia acumulada hoy: $${gapWeekly.toLocaleString('es-MX')}.`,
      evidence: {
        mesero: lp.name,
        avg_ticket: Math.round(lp.avgTicket),
        team_avg: Math.round(teamAvgTicket),
        gap_mxn: gap,
        order_count: lp.orderCount,
        gap_today: gapWeekly,
        all_meseros: meseroStats.map(m => ({ name: m.name, avg_ticket: Math.round(m.avgTicket), orders: m.orderCount })),
      },
      suggested_action: `Antes del siguiente turno, habla con ${lp.name} sobre ofrecer bebidas y postres. Muéstrale el número — $${gap} de diferencia por mesa es concreto y motivante.`,
      confidence: 0.76,
      status: 'new',
      estimated_value: gapWeekly,
      expires_at: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 4. Sobrecarga de mesas por mesero activo ─────────────────────────────
  const activeMeseros = meseroStats.filter(m => m.recentOrders > 0).length
  const openTables = orders.filter(o => o.status === 'lista').length
  const ratio = activeMeseros > 0 ? openTables / activeMeseros : 0

  // Threshold: >5 mesas por mesero es donde la calidad empieza a sufrir
  if (ratio > 5 && activeMeseros >= 2 && openTables >= 8) {
    events.push({
      client_id: clientId,
      agent_id: 'staff',
      type: 'understaffed',
      severity: 'warning',
      title: `${Math.round(ratio)} mesas por mesero activo — equipo saturado`,
      explanation: `${openTables} mesas abiertas con ${activeMeseros} mesero${activeMeseros > 1 ? 's' : ''} activo${activeMeseros > 1 ? 's' : ''}. El estándar recomendado es máximo 4-5 mesas. Con ${Math.round(ratio)} el servicio empieza a sufrir.`,
      evidence: { open_tables: openTables, active_meseros: activeMeseros, ratio: Math.round(ratio * 10) / 10 },
      suggested_action: 'Llama a refuerzo o redistribuye mesas ahora. Si no hay staff disponible, considera apoyar personalmente con las cuentas pendientes.',
      confidence: 0.82,
      status: 'new',
      estimated_value: null,
      expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
    })
  }

  return events
}
