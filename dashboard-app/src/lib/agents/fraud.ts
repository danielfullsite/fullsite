/**
 * Fraud Agent
 *
 * Detecta: cancelaciones sospechosas por mesero, concentración de descuentos,
 * descuentos individuales excesivos.
 *
 * La detección de efectivo nocturno se eliminó — generaba demasiados falsos
 * positivos en restaurantes con alta proporción de pago en efectivo.
 *
 * Inputs:  pos_orders (last 24h)
 */
import type { AgentEvent } from './types'
import { getActiveTimezone } from '@/lib/date-mx'
import { esVenta, leerPaginado } from './dia-negocio'

interface PosOrder {
  id: string
  mesa: number | null
  mesero: string | null
  total: number
  subtotal: number
  descuento: number
  status: string
  payment_status?: string | null
  created_at: string
}

const CANCEL_THRESHOLD_WARNING  = 4   // por mesero en 24h (era 3 — muy bajo)
const CANCEL_THRESHOLD_CRITICAL = 7
const DISCOUNT_PCT_THRESHOLD    = 35  // descuento > 35% del subtotal
const DISCOUNT_CONCENTRATION    = 0.72

/**
 * La HORA de un instante, en la zona del negocio -- antes 'America/Monterrey' clavado.
 *
 * El agente busca descuentos concentrados en ciertas horas. Con la zona equivocada, la
 * concentracion se mide en el horario equivocado y el patron se diluye.
 *
 * Se lee el componente local de una fecha reinterpretada, que para la hora es correcto.
 * No se use este valor para nada mas: ver `date-mx.ts:nowMX`.
 */
function hour(iso: string): number {
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: getActiveTimezone() })).getHours()
}

export async function runFraudAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const now = Date.now()
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  // Antes: `limit=500` SIN `order` → 500 filas cualesquiera de las últimas 24h. En un día
  // con más órdenes, "cancelaciones por mesero" se medía sobre una muestra arbitraria.
  // Ahora se pagina en orden estable y, si aun así se llega al tope, se DICE.
  const { filas: orders, truncado } = await leerPaginado<PosOrder>(
    sbGet,
    'pos_orders',
    `client_id=eq.${encodeURIComponent(clientId)}&created_at=gte.${cutoff}` +
      `&select=id,mesa,mesero,total,subtotal,descuento,status,payment_status,created_at&order=created_at.desc,id.desc`,
  )

  if (orders.length === 0) return events

  if (truncado) {
    events.push({
      client_id: clientId,
      agent_id: 'fraud',
      type: 'fraud_lectura_incompleta',
      severity: 'info',
      title: `Anti-fraude analizó sólo las ${orders.length.toLocaleString('es-MX')} órdenes más recientes de 24 h`,
      explanation: 'El volumen de las últimas 24 horas superó el tope de lectura. Los conteos por mesero de abajo son un piso, no el total: puede haber más cancelaciones o descuentos de los que se reportan.',
      evidence: { ordenes_leidas: orders.length, desde: cutoff },
      suggested_action: 'Para una revisión completa, usa el reporte de cancelaciones y descuentos del día en el POS.',
      confidence: 1,
      status: 'new',
      estimated_value: null,
      expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    })
  }

  const conMesero = (o: PosOrder) => !!(o.mesero ?? '').trim()
  const cancelled   = orders.filter(o => o.status === 'cancelada')
  // Regla única de venta: 'lista' es una cuenta sin cobrar, no una venta con descuento aplicado.
  const closed      = orders.filter(esVenta)
  const withDiscount = closed.filter(o => (o.descuento || 0) > 0)

  // ── 0. Calidad de datos: movimientos sin mesero ──────────────────────────
  // Antes se agrupaban bajo una "persona" llamada "Desconocido", que podía salir como
  // sospechoso de concentración. No es una persona: es un hueco en el dato. Se reporta
  // aparte y NO participa en las alertas de concentración.
  const cancelSinMesero = cancelled.filter(o => !conMesero(o))
  const descSinMesero = withDiscount.filter(o => !conMesero(o))
  if (cancelSinMesero.length >= CANCEL_THRESHOLD_WARNING || descSinMesero.length >= 4) {
    const montoDesc = descSinMesero.reduce((s, o) => s + (o.descuento || 0), 0)
    events.push({
      client_id: clientId,
      agent_id: 'fraud',
      type: 'mesero_faltante',
      severity: 'info',
      title: `${cancelSinMesero.length} cancelaciones y ${descSinMesero.length} descuentos sin mesero registrado (24 h)`,
      explanation: 'Estas órdenes no tienen mesero asignado, así que no se pueden atribuir a nadie ni entran en las alertas de concentración. Si son muchas, el control anti-fraude pierde visibilidad.',
      evidence: {
        sujeto: 'sin_mesero',
        cancelaciones: cancelSinMesero.length,
        descuentos: descSinMesero.length,
        monto_descuentos: Math.round(montoDesc),
        orders: [...cancelSinMesero, ...descSinMesero].slice(0, 20).map(o => ({ id: o.id, mesa: o.mesa, status: o.status, total: o.total })),
      },
      suggested_action: 'Revisa por qué el POS permite cancelar o descontar sin mesero (terminal compartida, usuario genérico) y exige mesero en esas operaciones.',
      confidence: 1,
      status: 'new',
      estimated_value: null,
      expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 1. Concentración de cancelaciones por mesero ─────────────────────────
  if (cancelled.length >= CANCEL_THRESHOLD_WARNING) {
    const byMesero = cancelled.filter(conMesero).reduce<Record<string, PosOrder[]>>((m, o) => {
      const n = o.mesero!.trim(); m[n] = [...(m[n] ?? []), o]; return m
    }, {})

    const suspects = Object.entries(byMesero)
      .filter(([, ords]) => ords.length >= CANCEL_THRESHOLD_WARNING)
      .sort((a, b) => b[1].length - a[1].length)

    for (const [mesero, meseroOrders] of suspects) {
      const count = meseroOrders.length
      const totalValue = meseroOrders.reduce((s, o) => s + (o.total || 0), 0)
      const lateNight = meseroOrders.filter(o => hour(o.created_at) >= 21 || hour(o.created_at) < 7)
      const severity = count >= CANCEL_THRESHOLD_CRITICAL ? 'critical' : 'warning'

      events.push({
        client_id: clientId,
        agent_id: 'fraud',
        type: 'cancel_concentration',
        severity,
        title: `${mesero}: ${count} cancelaciones en 24 horas${lateNight.length > 0 ? ' (incluye fuera de horario)' : ''}`,
        explanation: `${mesero} realizó ${count} cancelaciones en las últimas 24 horas por $${totalValue.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN en total.${lateNight.length > 0 ? ` ${lateNight.length} ocurrieron después de las 9pm.` : ''} El umbral normal es <${CANCEL_THRESHOLD_WARNING} cancelaciones por turno.`,
        evidence: {
          mesero,
          cancel_count: count,
          total_value: totalValue,
          late_night_count: lateNight.length,
          orders: meseroOrders.map(o => ({ id: o.id, mesa: o.mesa, total: o.total, hour: hour(o.created_at) })),
        },
        suggested_action: count >= CANCEL_THRESHOLD_CRITICAL
          ? `Revisa el video de cámara para las órdenes canceladas de ${mesero} en las últimas 24h. Habla con él hoy mismo — no mañana.`
          : `Pídele a ${mesero} que te explique cada cancelación. Si la causa es técnica (POS), documéntala. Si no tiene explicación, escala.`,
        confidence: Math.min(0.52 + count * 0.06, 0.92),
        status: 'new',
        estimated_value: Math.round(totalValue),
        expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 2. Concentración de descuentos ───────────────────────────────────────
  if (withDiscount.length >= 4) {
    const totalDiscounts = withDiscount.reduce((s, o) => s + (o.descuento || 0), 0)
    const byMesero = withDiscount.filter(conMesero).reduce<Record<string, { count: number; amount: number }>>((m, o) => {
      const n = o.mesero!.trim()
      m[n] = { count: (m[n]?.count ?? 0) + 1, amount: (m[n]?.amount ?? 0) + (o.descuento || 0) }
      return m
    }, {})

    const topDiscounter = Object.entries(byMesero).sort((a, b) => b[1].amount - a[1].amount)[0]

    if (topDiscounter && totalDiscounts > 0 && topDiscounter[1].amount / totalDiscounts > DISCOUNT_CONCENTRATION) {
      const [mesero, data] = topDiscounter
      const pct = Math.round((data.amount / totalDiscounts) * 100)
      events.push({
        client_id: clientId,
        agent_id: 'fraud',
        type: 'discount_concentration',
        severity: 'warning',
        title: `${mesero} aplicó el ${pct}% de todos los descuentos del día`,
        explanation: `${mesero} aplicó $${data.amount.toLocaleString('es-MX', { maximumFractionDigits: 0 })} en descuentos (${data.count} órdenes). El total del restaurante hoy: $${totalDiscounts.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN en descuentos.`,
        evidence: {
          mesero,
          mesero_discount: data.amount,
          mesero_count: data.count,
          total_discounts: totalDiscounts,
          concentration_pct: pct,
          all_meseros: byMesero,
        },
        suggested_action: `Revisa en el POS las órdenes con descuento de ${mesero} de hoy. Verifica que cada una tiene una razón registrada o fue autorizada por ti.`,
        confidence: 0.80,
        status: 'new',
        estimated_value: Math.round(data.amount),
        expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      })
    }

    // Descuentos individuales muy altos
    const largeDiscounts = withDiscount.filter(o => {
      const sub = o.subtotal || o.total
      return sub > 200 && ((o.descuento || 0) / sub) * 100 > DISCOUNT_PCT_THRESHOLD
    })
    if (largeDiscounts.length >= 2) {
      const totalLarge = largeDiscounts.reduce((s, o) => s + (o.descuento || 0), 0)
      events.push({
        client_id: clientId,
        agent_id: 'fraud',
        type: 'large_discounts',
        severity: 'warning',
        title: `${largeDiscounts.length} órdenes con descuento mayor al ${DISCOUNT_PCT_THRESHOLD}% del subtotal`,
        explanation: `Descuentos inusualmente altos: ${largeDiscounts.map(o => `${(o.mesero ?? '').trim() || 'sin mesero'} mesa ${o.mesa ?? '?'} ($${(o.descuento || 0).toFixed(0)})`).slice(0, 3).join(', ')}.`,
        evidence: {
          orders: largeDiscounts.map(o => ({
            id: o.id,
            mesero: o.mesero,
            mesa: o.mesa,
            descuento: o.descuento,
            subtotal: o.subtotal,
            pct: Math.round(((o.descuento || 0) / (o.subtotal || 1)) * 100),
          })),
          count: largeDiscounts.length,
          total: totalLarge,
        },
        suggested_action: 'Abre el POS y revisa cada una de estas órdenes. Si no las autorizaste tú, toma acción hoy.',
        confidence: 0.78,
        status: 'new',
        estimated_value: Math.round(totalLarge),
        expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  return events
}
