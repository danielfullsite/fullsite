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
import { FILTRO_VENTA, leerContextoDia, type ContextoDia } from './dia-negocio'

interface PosOrder {
  id: string
  mesa: number | null
  mesero: string | null
  total: number
  status: string
  payment_status?: string | null
  created_at: string
  updated_at: string
  descuento: number
}

const SERVICE_START = 8
const SERVICE_END   = 22

/**
 * Ticket promedio del PROPIO restaurante, para estimar el valor de una mesa que no rota.
 *
 * Antes era `const AVG_TICKET_MXN = 383` — el de AMALAY, clavado — y se usaba para
 * cualquier tenant: una taqueria de $120 recibia "estimados" tres veces inflados.
 * Ahora sale de sus ventas de los ultimos 30 dias (regla unica de venta). Con menos de
 * MIN_ORDENES_TICKET no hay promedio confiable y el valor estimado queda en null — no
 * se inventa un numero.
 */
const MIN_ORDENES_TICKET = 20

async function ticketPromedioReciente(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
  ahoraMs: number,
): Promise<number | null> {
  try {
    const desde = new Date(ahoraMs - 30 * 24 * 60 * 60 * 1000).toISOString()
    const rows = await sbGet<{ total: number | null }>(
      'pos_orders',
      `client_id=eq.${encodeURIComponent(clientId)}&${FILTRO_VENTA}&created_at=gte.${desde}` +
        `&select=total&order=created_at.desc&limit=1000`,
    )
    const totales = rows.map(r => Number(r.total) || 0).filter(t => t > 0)
    if (totales.length < MIN_ORDENES_TICKET) return null
    return totales.reduce((s, t) => s + t, 0) / totales.length
  } catch {
    return null // sin dato confiable -> sin estimado, nunca un default de otro restaurante
  }
}

/**
 * Una cuenta en 'lista' con mas de este tiempo no es un cliente esperando: es una orden
 * que nadie cerro en el POS (se cobro por fuera, o se olvido). Tratarla como "mesa
 * esperando cobro" era la otra mitad del falso critico.
 */
const OLVIDADA_MIN = 180

function minutesSince(iso: string, ahoraMs: number): number {
  return (ahoraMs - new Date(iso).getTime()) / 60_000
}

export async function runOperationsAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
  ctxDado?: ContextoDia,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const ctx = ctxDado ?? await leerContextoDia(clientId, sbGet)
  const now = ctx.ahoraMs
  if (!(ctx.horaLocal >= SERVICE_START && ctx.horaLocal < SERVICE_END)) return events

  // Inicio REAL del dia de venta (ver dia-negocio.ts). Antes: `nowMX().setHours(0)
  // .toISOString()`, que en Mexico cae a las 18:00 de AYER y metia las cuentas viejas.
  const todayCutoff = ctx.inicioHoyISO
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

  const orders = await sbGet<PosOrder>(
    'pos_orders',
    `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${todayCutoff}&select=id,mesa,mesero,total,status,payment_status,created_at,updated_at,descuento&order=created_at.desc&limit=1000`,
  )

  if (orders.length === 0) return events

  // ── 1. Mesas esperando cobro (usa updated_at — cuando cambió a "lista") ──
  // updated_at refleja cuándo el mesero marcó la orden como lista para cobrar,
  // no cuándo se abrió la mesa. Este es el tiempo real de espera del cliente.
  const WAIT_THRESHOLD_MIN = 20   // minutos esperando la cuenta
  const MIN_TICKET_MXN     = 150  // ignorar órdenes pequeñas (cafés, bebidas rápidas)

  // Una cuenta en 'lista' ya pagada (payment_status='pagada') no espera a nadie.
  const pendientes = orders.filter(o =>
    o.status === 'lista' &&
    o.payment_status !== 'pagada' &&
    (o.total ?? 0) >= MIN_TICKET_MXN,
  )
  const listaOrders = pendientes.filter(o => {
    const m = minutesSince(o.updated_at, now)
    return m > WAIT_THRESHOLD_MIN && m <= OLVIDADA_MIN
  })
  const olvidadas = pendientes.filter(o => minutesSince(o.updated_at, now) > OLVIDADA_MIN)

  if (listaOrders.length > 0) {
    const longest = Math.round(Math.max(...listaOrders.map(o => minutesSince(o.updated_at, now))))
    const tables = listaOrders.map(o => o.mesa ?? '?').join(', ')
    const topMesero = listaOrders[0].mesero ?? 'el mesero'
    // Valor estimado: cada mesa que tarda en salir retrasa la siguiente vuelta.
    // Estimamos 50% de probabilidad de que llegue otro grupo a esa mesa.
    const ticketProm = await ticketPromedioReciente(clientId, sbGet, now)
    const estimatedValue = ticketProm != null ? Math.round(listaOrders.length * ticketProm * 0.5) : null

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
          wait_min: Math.round(minutesSince(o.updated_at, now)),
          total: o.total,
          mesero: o.mesero,
        })),
        longest_min: longest,
        count: listaOrders.length,
        dia_venta: ctx.hoy,
        ticket_promedio_30d: ticketProm != null ? Math.round(ticketProm) : null,
      },
      suggested_action: `Ve ahora con ${topMesero} y asegúrate de que lleve la cuenta a la${listaOrders.length > 1 ? 's' : ''} mesa${listaOrders.length > 1 ? 's' : ''} ${tables}. Máximo 5 minutos.`,
      confidence: 0.93,
      status: 'new',
      estimated_value: estimatedValue,
      expires_at: new Date(now + 45 * 60 * 1000).toISOString(),
    })
  }

  // ── 1b. Cuentas en 'lista' que nadie cerro (> OLVIDADA_MIN) ────────────────
  // No es un cliente esperando — es higiene de datos. Se dice como info: una alerta
  // critica sobre una mesa que ya se fue entrena a ignorar las criticas.
  if (olvidadas.length > 0) {
    events.push({
      client_id: clientId,
      agent_id: 'operations',
      type: 'orden_sin_cerrar',
      severity: 'info',
      title: `${olvidadas.length} ${olvidadas.length === 1 ? 'cuenta lleva' : 'cuentas llevan'} más de ${OLVIDADA_MIN / 60} h en "lista" sin cerrarse`,
      explanation: `Mesas ${olvidadas.map(o => o.mesa ?? '?').join(', ')}: marcadas para cobro hace más de ${OLVIDADA_MIN / 60} horas. Probablemente ya se cobraron o el cliente se fue y la cuenta quedó abierta en el POS. Mientras sigan así, las ventas del día y los reportes no las cuentan.`,
      evidence: {
        orders: olvidadas.map(o => ({ id: o.id, mesa: o.mesa, mesero: o.mesero, total: o.total, horas: Math.round(minutesSince(o.updated_at, now) / 6) / 10 })),
        count: olvidadas.length,
        dia_venta: ctx.hoy,
      },
      suggested_action: 'Revisa esas cuentas en el POS: ciérralas con su método de pago real o cancélalas con motivo.',
      confidence: 0.85,
      status: 'new',
      estimated_value: null,
      expires_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 2. Pico de cancelaciones en las últimas 2 horas ───────────────────────
  const recentOrders = orders.filter(o => o.created_at >= twoHoursAgo)
  const cancelledLast2h = recentOrders.filter(o => o.status === 'cancelada')
  const totalLast2h = recentOrders.length
  const cancelRate = totalLast2h > 5 ? cancelledLast2h.length / totalLast2h : 0

  if (cancelRate > 0.18 && cancelledLast2h.length >= 3) {
    // Sin mesero NO es una persona llamada "Desconocido": se cuenta aparte.
    const byMesero = cancelledLast2h.reduce<Record<string, number>>((m, o) => {
      const n = (o.mesero ?? '').trim(); if (n) m[n] = (m[n] ?? 0) + 1; return m
    }, {})
    const sinMesero = cancelledLast2h.filter(o => !(o.mesero ?? '').trim()).length
    const [topName, topCount] = Object.entries(byMesero).sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
    const cancelledValue = cancelledLast2h.reduce((s, o) => s + (o.total ?? 0), 0)

    events.push({
      client_id: clientId,
      agent_id: 'operations',
      type: 'cancel_spike',
      severity: cancelRate > 0.25 ? 'critical' : 'warning',
      title: `${Math.round(cancelRate * 100)}% de órdenes canceladas en las últimas 2 horas`,
      explanation: `${cancelledLast2h.length} de ${totalLast2h} órdenes canceladas.${topCount >= 2 ? ` ${topName} concentra ${topCount} de ellas.` : ''}${sinMesero > 0 ? ` ${sinMesero} sin mesero registrado.` : ''}`,
      evidence: {
        cancelled: cancelledLast2h.length,
        total: totalLast2h,
        rate_pct: Math.round(cancelRate * 100),
        by_mesero: byMesero,
        sin_mesero: sinMesero,
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
  const currentHour = ctx.horaLocal
  if (PEAK_HOURS.includes(currentHour)) {
    const openMesas = new Set(
      orders.filter(o => o.status === 'lista' && o.payment_status !== 'pagada' && o.mesa != null).map(o => o.mesa),
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
