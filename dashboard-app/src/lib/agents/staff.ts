/**
 * Staff Agent
 *
 * Analiza: productividad por mesero, tiempos muertos REALES (solo en hora pico),
 * desempeño relativo, ratio mesas/mesero.
 *
 * Inputs:  pos_orders (today)
 */
import type { AgentEvent } from './types'
import { esVenta, leerContextoDia, type ContextoDia } from './dia-negocio'
import { deriveActiveStaff } from '@/lib/attendance'

interface PosOrder {
  mesa: number | null
  mesero: string | null
  total: number
  status: string
  payment_status?: string | null
  created_at: string
}

interface AttendanceRow {
  staff_id: string
  staff_name: string
  type: 'entrada' | 'salida'
  registered_at: string
}

// Horas de servicio activo — fuera de estos rangos no aplica "idle" detection
// porque en horas valle no tener órdenes es completamente normal.
function isTruePeakHour(h: number): boolean {
  return (h >= 12 && h <= 14) || (h >= 19 && h <= 21)
}

/** Nombre comparable entre pos_orders.mesero y pos_attendance.staff_name. */
function normNombre(n: string): string {
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Minimo en turno antes de reclamarle a alguien que no tiene órdenes: recién llegó. */
const MIN_EN_TURNO_MIN = 60

/**
 * Quién está en turno AHORA según el reloj checador (`pos_attendance`).
 * `null` = no se pudo saber (la lectura falló o el restaurante no usa el checador):
 * en ese caso el agente NO puede afirmar que alguien "debería estar atendiendo".
 */
async function enTurno(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
  ahoraMs: number,
): Promise<Map<string, { desde: string | null; activo: boolean }> | null> {
  try {
    // 18h hacia atrás = la misma ventana que attendance.ts usa para declarar una entrada vieja.
    const desde = new Date(ahoraMs - 18 * 60 * 60 * 1000).toISOString()
    const rows = await sbGet<AttendanceRow>(
      'pos_attendance',
      `client_id=eq.${encodeURIComponent(clientId)}&registered_at=gte.${desde}` +
        `&select=staff_id,staff_name,type,registered_at&order=registered_at.asc&limit=1000`,
    )
    if (!Array.isArray(rows) || rows.length === 0) return null
    const m = new Map<string, { desde: string | null; activo: boolean }>()
    for (const s of deriveActiveStaff(rows, undefined, ahoraMs)) {
      m.set(normNombre(s.staff_name), { desde: s.active_since, activo: s.attendance_status === 'ACTIVE_ON_SHIFT' })
    }
    return m
  } catch {
    return null
  }
}

export async function runStaffAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
  ctxDado?: ContextoDia,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const ctx = ctxDado ?? await leerContextoDia(clientId, sbGet)
  const now = ctx.ahoraMs
  const currentHour = ctx.horaLocal
  // Inicio REAL del dia de venta. Antes `nowMX().setHours(0).toISOString()` = 18:00 de ayer.
  const todayCutoff = ctx.inicioHoyISO
  const twoHAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

  const orders = await sbGet<PosOrder>(
    'pos_orders',
    `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${todayCutoff}&status=neq.cancelada&select=mesa,mesero,total,status,payment_status,created_at&order=created_at.desc&limit=1000`,
  )

  // Ventas = regla única (pagada, o cerrada sin payment_status). 'lista' es una cuenta
  // sin cobrar: contarla como venta inflaba ingresos y tickets por mesero.
  const closedOrders = orders.filter(esVenta)
  if (closedOrders.length < 3) return events // No hay suficiente data

  // Actividad reciente ≠ venta: un mesero con tres mesas abiertas SÍ está trabajando.
  const activosRecientes = new Map<string, number>()
  for (const o of orders) {
    const n = (o.mesero ?? '').trim()
    if (n && o.created_at >= twoHAgo) activosRecientes.set(n, (activosRecientes.get(n) ?? 0) + 1)
  }

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
  }

  if (meseroMap.size === 0) return events

  const meseroStats: MeseroStats[] = Array.from(meseroMap.entries()).map(([name, { orders: ords, recent }]) => {
    const totalRevenue = ords.reduce((s, o) => s + (o.total || 0), 0)
    return {
      name,
      orderCount: ords.length,
      totalRevenue,
      avgTicket: ords.length > 0 ? totalRevenue / ords.length : 0,
      recentOrders: activosRecientes.get(name) ?? recent.length,
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
  //
  // "Sin órdenes" no es "sin trabajar": alguien cuyo turno ya terminó no tiene por qué
  // tener órdenes. Se cruza con el reloj checador. Sólo es `warning` para quien está
  // CONFIRMADO en turno desde hace ≥ MIN_EN_TURNO_MIN; si no hay checador, se dice como
  // `info` y con la redacción de lo que de verdad se sabe.
  if (isTruePeakHour(currentHour) && meseroStats.length >= 3) {
    const activeCount = meseroStats.filter(m => m.recentOrders > 0).length
    const idleStaff = meseroStats.filter(m => m.recentOrders === 0)

    // Solo es una alerta si la mayoría del equipo SÍ está activa
    if (idleStaff.length > 0 && activeCount >= idleStaff.length) {
      const turno = await enTurno(clientId, sbGet, now)
      const confirmados = turno
        ? idleStaff.filter(m => {
            const t = turno.get(normNombre(m.name))
            return !!t && t.activo && !!t.desde && (now - Date.parse(t.desde)) / 60_000 >= MIN_EN_TURNO_MIN
          })
        : []
      const base = {
        client_id: clientId,
        agent_id: 'staff' as const,
        type: 'idle_during_peak',
        status: 'new' as const,
        estimated_value: null,
        expires_at: new Date(now + 90 * 60 * 1000).toISOString(),
      }
      if (confirmados.length > 0) {
        const nombres = confirmados.map(m => m.name)
        events.push({
          ...base,
          severity: 'warning',
          title: `${nombres.join(', ')} en turno y sin órdenes durante hora pico`,
          explanation: `Son las ${currentHour}:00 — hora de alta demanda. ${nombres.join(' y ')} ${nombres.length > 1 ? 'tienen' : 'tiene'} entrada registrada en el checador y no ha${nombres.length > 1 ? 'n' : ''} abierto órdenes en las últimas 2 horas, mientras ${activeCount} compañeros sí están atendiendo.`,
          evidence: {
            idle: confirmados.map(m => ({ name: m.name, orders_today: m.orderCount })),
            active: meseroStats.filter(m => m.recentOrders > 0).map(m => ({ name: m.name, recent: m.recentOrders })),
            peak_hour: currentHour,
            fuente_turno: 'pos_attendance',
          },
          suggested_action: `Pregúntale a ${nombres[0]} si está en break o si tiene algún problema. Si no, asígnale mesas en sección activa.`,
          confidence: 0.78,
        })
      } else if (!turno) {
        const nombres = idleStaff.map(m => m.name)
        events.push({
          ...base,
          severity: 'info',
          title: `${nombres.join(', ')}: sin órdenes registradas en la hora pico`,
          explanation: `Son las ${currentHour}:00. ${nombres.join(' y ')} vendi${nombres.length > 1 ? 'eron' : 'ó'} hoy pero no ${nombres.length > 1 ? 'tienen' : 'tiene'} órdenes en las últimas 2 horas. No hay registro de checador para saber si su turno ya terminó, así que esto no afirma que estén sin trabajar.`,
          evidence: {
            idle: idleStaff.map(m => ({ name: m.name, orders_today: m.orderCount })),
            active: meseroStats.filter(m => m.recentOrders > 0).map(m => ({ name: m.name, recent: m.recentOrders })),
            peak_hour: currentHour,
            fuente_turno: null,
          },
          suggested_action: 'Si siguen en piso, confirma que tengan sección asignada. Registrar entrada/salida en el checador permite distinguir "terminó su turno" de "está sin mesas".',
          confidence: 0.55,
        })
      }
      // turno conocido y nadie confirmado en turno → se fueron o no han llegado: no hay hallazgo.
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
  const openTables = orders.filter(o => o.status === 'lista' && o.payment_status !== 'pagada').length
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
