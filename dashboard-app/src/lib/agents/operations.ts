/**
 * Operations Agent
 *
 * Detecta: mesas esperando cobro, pico de cancelaciones, carga hora pico.
 * NO hace comparaciones históricas de velocidad — eso es responsabilidad de Finance.
 *
 * Inputs:  pos_orders (today)
 * Outputs: AgentEvent[]
 */
import type { AgentEvent } from './types'

interface PosOrder {
  id: string
  mesa: number | null
  mesero: string | null
  total: number
  status: string
  created_at: string
  updated_at: string
  descuento: number
}

const SERVICE_START = 8
const SERVICE_END   = 22

// AMALAY avg ticket from pos_orders last 30d — used for economic estimates.
// Update quarterly by querying: select avg(total) from pos_orders where status in ('cerrada','pagada')
const AVG_TICKET_MXN = 383

function nowMX(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
}

function isServiceHours(): boolean {
  const h = nowMX().getHours()
  return h >= SERVICE_START && h < SERVICE_END
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000
}

export async function runOperationsAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  if (!isServiceHours()) return events

  const todayMX = nowMX()
  todayMX.setHours(0, 0, 0, 0)
  const todayCutoff = todayMX.toISOString()
  const now = Date.now()
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

  const orders = await sbGet<PosOrder>(
    'pos_orders',
    `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${todayCutoff}&select=id,mesa,mesero,total,status,created_at,updated_at,descuento&order=created_at.desc&limit=500`,
  )

  if (orders.length === 0) return events

  // ── 1. Mesas esperando cobro (usa updated_at — cuando cambió a "lista") ──
  // updated_at refleja cuándo el mesero marcó la orden como lista para cobrar,
  // no cuándo se abrió la mesa. Este es el tiempo real de espera del cliente.
  const WAIT_THRESHOLD_MIN = 20   // minutos esperando la cuenta
  const MIN_TICKET_MXN     = 150  // ignorar órdenes pequeñas (cafés, bebidas rápidas)

  const listaOrders = orders.filter(o =>
    o.status === 'lista' &&
    (o.total ?? 0) >= MIN_TICKET_MXN &&
    minutesSince(o.updated_at) > WAIT_THRESHOLD_MIN,
  )

  if (listaOrders.length > 0) {
    const longest = Math.round(Math.max(...listaOrders.map(o => minutesSince(o.updated_at))))
    const tables = listaOrders.map(o => o.mesa ?? '?').join(', ')
    const topMesero = listaOrders[0].mesero ?? 'el mesero'
    // Valor estimado: cada mesa que tarda en salir retrasa la siguiente vuelta.
    // Estimamos 50% de probabilidad de que llegue otro grupo a esa mesa.
    const estimatedValue = Math.round(listaOrders.length * AVG_TICKET_MXN * 0.5)

    events.push({
      client_id: clientId,
      agent_id: 'operations',
      type: 'slow_payment',
      severity: listaOrders.length >= 3 ? 'critical' : 'warning',
      title: `${listaOrders.length} ${listaOrders.length === 1 ? 'mesa lleva' : 'mesas llevan'} +${WAIT_THRESHOLD_MIN} min esperando cobro`,
      explanation: `Las mesas ${tables} están marcadas como listas para cobrar hace ${longest} minutos. El cliente está esperando — esto retrasa la rotación de mesas.`,
      evidence: {
        tables: listaOrders.map(o => ({
          mesa: o.mesa,
          wait_min: Math.round(minutesSince(o.updated_at)),
          total: o.total,
          mesero: o.mesero,
        })),
        longest_min: longest,
        count: listaOrders.length,
      },
      suggested_action: `Ve ahora con ${topMesero} y asegúrate de que lleve la cuenta a la${listaOrders.length > 1 ? 's' : ''} mesa${listaOrders.length > 1 ? 's' : ''} ${tables}. Máximo 5 minutos.`,
      confidence: 0.93,
      status: 'new',
      estimated_value: estimatedValue,
      expires_at: new Date(now + 45 * 60 * 1000).toISOString(),
    })
  }

  // ── 2. Pico de cancelaciones en las últimas 2 horas ───────────────────────
  const recentOrders = orders.filter(o => o.created_at >= twoHoursAgo)
  const cancelledLast2h = recentOrders.filter(o => o.status === 'cancelada')
  const totalLast2h = recentOrders.length
  const cancelRate = totalLast2h > 5 ? cancelledLast2h.length / totalLast2h : 0

  if (cancelRate > 0.18 && cancelledLast2h.length >= 3) {
    const byMesero = cancelledLast2h.reduce<Record<string, number>>((m, o) => {
      const n = o.mesero ?? 'Desconocido'; m[n] = (m[n] ?? 0) + 1; return m
    }, {})
    const [[topName, topCount]] = Object.entries(byMesero).sort((a, b) => b[1] - a[1])
    const cancelledValue = cancelledLast2h.reduce((s, o) => s + (o.total ?? 0), 0)

    events.push({
      client_id: clientId,
      agent_id: 'operations',
      type: 'cancel_spike',
      severity: cancelRate > 0.25 ? 'critical' : 'warning',
      title: `${Math.round(cancelRate * 100)}% de órdenes canceladas en las últimas 2 horas`,
      explanation: `${cancelledLast2h.length} de ${totalLast2h} órdenes canceladas. ${topName} concentra ${topCount} de ellas.`,
      evidence: {
        cancelled: cancelledLast2h.length,
        total: totalLast2h,
        rate_pct: Math.round(cancelRate * 100),
        by_mesero: byMesero,
        cancelled_value: cancelledValue,
      },
      suggested_action: topCount >= 2
        ? `Habla con ${topName} directamente y pregunta el motivo. Si hay un problema con el POS o cocina, resuélvelo antes de que afecte más órdenes.`
        : 'Verifica si hay un problema en cocina o con el sistema que esté causando las cancelaciones.',
      confidence: 0.88,
      status: 'new',
      estimated_value: Math.round(cancelledValue),
      expires_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 3. Hora pico — carga de mesas activas ────────────────────────────────
  const PEAK_HOURS = [12, 13, 14, 20, 21]
  const currentHour = nowMX().getHours()
  if (PEAK_HOURS.includes(currentHour)) {
    const openMesas = new Set(
      orders.filter(o => o.status === 'lista' && o.mesa != null).map(o => o.mesa),
    )
    if (openMesas.size >= 10) {
      events.push({
        client_id: clientId,
        agent_id: 'operations',
        type: 'peak_load',
        severity: 'info',
        title: `Hora pico: ${openMesas.size} mesas activas ahora mismo`,
        explanation: `Son las ${currentHour}:00. ${openMesas.size} mesas tienen cuenta pendiente. Es el momento de asegurarse que el equipo está completo.`,
        evidence: { active_tables: openMesas.size, hour: currentHour },
        suggested_action: 'Confirma que todos los meseros están en piso y que cocina tiene soporte. Si hay ficha de espera, prioriza rotación.',
        confidence: 0.90,
        status: 'new',
        estimated_value: null,
        expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
      })
    }
  }

  return events
}
