// Contabilidad — Generación de pólizas contables CONTPAQi-compatible
// Reads pos_orders, pos_inventory_movements, pos_market_movements
// Generates daily accounting entries (pólizas) for Mexican restaurant

import { NextRequest } from 'next/server'
import { requireAuth, getClientId } from '@/lib/api-auth'
import { resolveBusinessDayConfig, getBusinessDayBounds, getCurrentBusinessDate, type ResolvedBusinessDayConfig } from '@/lib/business-date'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
const OPTS = { headers: HEADERS, cache: 'no-store' as const }

// Catálogo de cuentas SAT estándar para restaurantes
const CUENTAS = {
  CAJA:          '1101-001', // Caja / Efectivo
  BANCOS_TC:     '1102-001', // Bancos — Tarjeta crédito
  BANCOS_TD:     '1102-002', // Bancos — Tarjeta débito
  BANCOS_TRANS:  '1102-003', // Bancos — Transferencias
  BANCOS_APPS:   '1102-004', // Bancos — Apps delivery (Uber, Rappi)
  INVENTARIOS:   '1301-001', // Inventarios
  IVA_ACRED:     '1401-001', // IVA acreditable
  PROVEEDORES:   '2101-001', // Proveedores
  IVA_TRASL:     '2201-001', // IVA trasladado
  VENTAS:        '4101-001', // Ventas
  VENTAS_MARKET: '4101-002', // Ventas Market
  COSTO_VENTAS:  '5101-001', // Costo de ventas
  MERMA:         '5102-001', // Merma y desperdicios
  COMISIONES:    '6101-001', // Comisiones plataformas
} as const

interface Poliza {
  numero: number
  fecha: string
  tipo: 'I' | 'E' | 'D' // Ingreso, Egreso, Diario
  tipoLabel: string
  concepto: string
  movimientos: {
    cuenta: string
    cuentaNombre: string
    debe: number
    haber: number
    concepto: string
  }[]
}

interface PosOrder {
  id: string
  created_at: string
  total: number
  subtotal: number
  tax: number
  payment_method: string
  status: string
  items: { name: string; quantity: number; price: number; recipe_cost?: number }[]
  source?: string
}

interface InventoryMovement {
  id: string
  created_at: string
  type: string
  product_name: string
  quantity: number
  cost_per_unit: number
  total_cost: number
  reason?: string
}

const CUENTA_NOMBRES: Record<string, string> = {
  '1101-001': 'Caja / Efectivo',
  '1102-001': 'Bancos — Tarjeta crédito',
  '1102-002': 'Bancos — Tarjeta débito',
  '1102-003': 'Bancos — Transferencias',
  '1102-004': 'Bancos — Apps delivery',
  '1301-001': 'Inventarios',
  '1401-001': 'IVA acreditable',
  '2101-001': 'Proveedores',
  '2201-001': 'IVA trasladado',
  '4101-001': 'Ventas',
  '4101-002': 'Ventas Market',
  '5101-001': 'Costo de ventas',
  '5102-001': 'Merma y desperdicios',
  '6101-001': 'Comisiones plataformas',
}

function cuentaNombre(cuenta: string): string {
  return CUENTA_NOMBRES[cuenta] || cuenta
}

function mapPaymentToCuenta(method: string): string {
  const m = (method || '').toLowerCase()
  if (m.includes('efectivo') || m.includes('cash')) return CUENTAS.CAJA
  if (m.includes('crédito') || m.includes('credito') || m.includes('credit')) return CUENTAS.BANCOS_TC
  if (m.includes('débito') || m.includes('debito') || m.includes('debit')) return CUENTAS.BANCOS_TD
  if (m.includes('transferencia') || m.includes('transfer')) return CUENTAS.BANCOS_TRANS
  if (m.includes('uber') || m.includes('rappi') || m.includes('didi')) return CUENTAS.BANCOS_APPS
  return CUENTAS.BANCOS_TC // Default
}

function mapPaymentLabel(method: string): string {
  const m = (method || '').toLowerCase()
  if (m.includes('efectivo') || m.includes('cash')) return 'Efectivo'
  if (m.includes('crédito') || m.includes('credito') || m.includes('credit')) return 'Tarjeta crédito'
  if (m.includes('débito') || m.includes('debito') || m.includes('debit')) return 'Tarjeta débito'
  if (m.includes('transferencia') || m.includes('transfer')) return 'Transferencia'
  if (m.includes('uber')) return 'Uber Eats'
  if (m.includes('rappi')) return 'Rappi'
  if (m.includes('didi')) return 'DiDi Food'
  return method || 'Otro'
}

// Also fetch from wansoft_daily as fallback
async function fetchWansoftDaily(fecha: string) {
  const res = await fetch(
    `${SB_URL}/rest/v1/wansoft_daily?fecha=eq.${fecha}&select=*&limit=1`,
    OPTS
  )
  return res.ok ? (await res.json())[0] || null : null
}

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  const clientId = getClientId(request)
  try {
    const { searchParams } = new URL(request.url)
    const formato = searchParams.get('formato') || 'json' // json | xml | csv
    const mes = searchParams.get('mes') // YYYY-MM for monthly summary

    // W1-C: la póliza es un documento por DÍA OPERATIVO — config del tenant
    // (timezone + business_day_start_local), no fecha calendario UTC ni
    // T00:00:00 naive. Bounds semiabiertos [start, end): el lte.T23:59:59
    // anterior dejaba un hueco de un segundo y cortaba el día en UTC.
    const cid = encodeURIComponent(clientId)
    const clientRowRes = await fetch(
      `${SB_URL}/rest/v1/clients?id=eq.${cid}&select=rfc,timezone,business_day_start_local&limit=1`, OPTS
    )
    const clientRow = clientRowRes.ok ? ((await clientRowRes.json())[0] ?? {}) : {}
    const clientRfc: string = clientRow.rfc ?? ''
    const bdCfg = resolveBusinessDayConfig({
      id: clientId,
      timezone: clientRow.timezone || 'America/Mexico_City',
      business_day_start_local: clientRow.business_day_start_local ?? null,
    })

    const fecha = searchParams.get('fecha') || getCurrentBusinessDate(bdCfg)

    // If requesting monthly summary
    if (mes) {
      return await getResumenMensual(mes, formato, clientId, bdCfg)
    }

    const { utcStart, utcEnd } = getBusinessDayBounds(fecha, bdCfg.timeZone, bdCfg.boundary)
    const rangeFilter = `created_at=gte.${encodeURIComponent(utcStart)}&created_at=lt.${encodeURIComponent(utcEnd)}`

    const [ordersRes, movementsRes, marketRes, wansoftDay] = await Promise.all([
      fetch(
        `${SB_URL}/rest/v1/pos_orders?client_id=eq.${cid}&${rangeFilter}&status=neq.cancelled&select=id,created_at,total,subtotal,tax,payment_method,status,items,source&order=created_at.asc&limit=500`,
        OPTS
      ),
      fetch(
        `${SB_URL}/rest/v1/pos_inventory_movements?client_id=eq.${cid}&${rangeFilter}&select=id,created_at,type,product_name,quantity,cost_per_unit,total_cost,reason&order=created_at.asc&limit=500`,
        OPTS
      ),
      fetch(
        `${SB_URL}/rest/v1/pos_market_movements?client_id=eq.${cid}&${rangeFilter}&select=id,created_at,type,product_name,quantity,cost_per_unit,total_cost,reason&order=created_at.asc&limit=500`,
        OPTS
      ),
      fetchWansoftDaily(fecha),
    ])

    const orders: PosOrder[] = ordersRes.ok ? await ordersRes.json() : []
    const movements: InventoryMovement[] = movementsRes.ok ? await movementsRes.json() : []
    const marketMovements: InventoryMovement[] = marketRes.ok ? await marketRes.json() : []

    const polizas: Poliza[] = []
    let numPoliza = 1

    // ───────────────────────────────────────────────
    // PÓLIZA 1: VENTAS DEL DÍA (por método de pago)
    // ───────────────────────────────────────────────
    if (orders.length > 0 || (wansoftDay && wansoftDay.ventas_dia > 0)) {
      // Group by payment method
      const byPayment = new Map<string, number>()
      let totalVentas = 0
      let totalIVA = 0

      if (orders.length > 0) {
        for (const order of orders) {
          const method = order.payment_method || 'efectivo'
          byPayment.set(method, (byPayment.get(method) || 0) + (order.total || 0))
          totalVentas += (order.subtotal || order.total || 0)
          totalIVA += (order.tax || 0)
        }
        // If no tax calculated, estimate 16% IVA
        if (totalIVA === 0 && totalVentas > 0) {
          totalIVA = totalVentas - (totalVentas / 1.16)
          totalVentas = totalVentas / 1.16
        }
      } else if (wansoftDay) {
        // Fallback to wansoft_daily
        const pagos = wansoftDay.pago_metodos || []
        for (const p of pagos) {
          byPayment.set(p.nombre, p.total)
        }
        totalVentas = (wansoftDay.ventas_dia || 0) / 1.16
        totalIVA = (wansoftDay.ventas_dia || 0) - totalVentas
      }

      const movimientos: Poliza['movimientos'] = []

      // DEBE: Each payment method (asset increases)
      byPayment.forEach((total, method) => {
        const cuenta = mapPaymentToCuenta(method)
        movimientos.push({
          cuenta,
          cuentaNombre: cuentaNombre(cuenta),
          debe: round2(total),
          haber: 0,
          concepto: `Cobro ${mapPaymentLabel(method)}`,
        })
      })

      // HABER: Ventas (revenue)
      movimientos.push({
        cuenta: CUENTAS.VENTAS,
        cuentaNombre: cuentaNombre(CUENTAS.VENTAS),
        debe: 0,
        haber: round2(totalVentas),
        concepto: 'Ventas del día',
      })

      // HABER: IVA trasladado
      if (totalIVA > 0) {
        movimientos.push({
          cuenta: CUENTAS.IVA_TRASL,
          cuentaNombre: cuentaNombre(CUENTAS.IVA_TRASL),
          debe: 0,
          haber: round2(totalIVA),
          concepto: 'IVA trasladado 16%',
        })
      }

      polizas.push({
        numero: numPoliza++,
        fecha,
        tipo: 'I',
        tipoLabel: 'Ingreso',
        concepto: `Ventas del día ${fecha}`,
        movimientos,
      })
    }

    // ───────────────────────────────────────────────
    // PÓLIZA 2: COSTO DE VENTAS (COGS)
    // ───────────────────────────────────────────────
    // W1-E: el COGS histórico sale EXCLUSIVAMENTE de pos_cost_events — el
    // reconocimiento inmutable sellado en el momento canónico del consumo
    // (r1_reconcile_item), con receta pinneada y costo weighted-average de
    // ESE instante. Nunca se recalcula con precios/recetas actuales, nunca
    // se usa items[].recipe_cost (campo de navegador, no confiable) y nunca
    // se fabrica un 35% estimado como si fuera real. Cobertura explícita:
    // eventos UNKNOWN/PARTIAL se reportan — un margen parcial se marca parcial.
    let cogsCoverage: { events: number; full: number; partial: number; unknown: number; reversal: number } = {
      events: 0, full: 0, partial: 0, unknown: 0, reversal: 0,
    }
    {
      let totalCOGS = 0

      const costEventsRes = await fetch(
        `${SB_URL}/rest/v1/pos_cost_events?client_id=eq.${cid}&${rangeFilter}&select=total_cost,cost_coverage&limit=10000`,
        OPTS
      )
      if (costEventsRes.ok) {
        const events: { total_cost: number | null; cost_coverage: string }[] = await costEventsRes.json()
        for (const ev of events) {
          cogsCoverage.events++
          if (ev.cost_coverage === 'FULL') cogsCoverage.full++
          else if (ev.cost_coverage === 'PARTIAL') cogsCoverage.partial++
          else if (ev.cost_coverage === 'UNKNOWN') cogsCoverage.unknown++
          else if (ev.cost_coverage === 'REVERSAL') cogsCoverage.reversal++
          if (ev.total_cost != null) totalCOGS += Number(ev.total_cost)
        }
      }

      if (totalCOGS > 0) {
        polizas.push({
          numero: numPoliza++,
          fecha,
          tipo: 'D',
          tipoLabel: 'Diario',
          concepto: `Costo de ventas ${fecha}`,
          movimientos: [
            {
              cuenta: CUENTAS.COSTO_VENTAS,
              cuentaNombre: cuentaNombre(CUENTAS.COSTO_VENTAS),
              debe: round2(totalCOGS),
              haber: 0,
              concepto: 'Costo de mercancía vendida',
            },
            {
              cuenta: CUENTAS.INVENTARIOS,
              cuentaNombre: cuentaNombre(CUENTAS.INVENTARIOS),
              debe: 0,
              haber: round2(totalCOGS),
              concepto: 'Salida de inventario por ventas',
            },
          ],
        })
      }
    }

    // ───────────────────────────────────────────────
    // PÓLIZA 3: MOVIMIENTOS DE INVENTARIO
    // ───────────────────────────────────────────────
    const allMovements = [...movements, ...marketMovements]
    if (allMovements.length > 0) {
      const entradas = allMovements.filter(m => m.type === 'entrada' || m.type === 'purchase')
      const merma = allMovements.filter(m => m.type === 'merma' || m.type === 'waste' || m.type === 'adjustment')
      const devoluciones = allMovements.filter(m => m.type === 'devolucion' || m.type === 'return')

      // Entradas de inventario (compras)
      const totalEntradas = entradas.reduce((s, m) => s + Math.abs(m.total_cost || (m.quantity * m.cost_per_unit) || 0), 0)
      if (totalEntradas > 0) {
        const subtotal = round2(totalEntradas / 1.16)
        const iva = round2(totalEntradas - subtotal)
        polizas.push({
          numero: numPoliza++,
          fecha,
          tipo: 'D',
          tipoLabel: 'Diario',
          concepto: `Entradas de inventario ${fecha}`,
          movimientos: [
            {
              cuenta: CUENTAS.INVENTARIOS,
              cuentaNombre: cuentaNombre(CUENTAS.INVENTARIOS),
              debe: subtotal,
              haber: 0,
              concepto: `${entradas.length} entradas de mercancía`,
            },
            ...(iva > 0 ? [{
              cuenta: CUENTAS.IVA_ACRED,
              cuentaNombre: cuentaNombre(CUENTAS.IVA_ACRED),
              debe: iva,
              haber: 0,
              concepto: 'IVA acreditable compras',
            }] : []),
            {
              cuenta: CUENTAS.PROVEEDORES,
              cuentaNombre: cuentaNombre(CUENTAS.PROVEEDORES),
              debe: 0,
              haber: round2(totalEntradas),
              concepto: 'Cuentas por pagar proveedores',
            },
          ],
        })
      }

      // Merma
      const totalMerma = merma.reduce((s, m) => s + Math.abs(m.total_cost || (m.quantity * m.cost_per_unit) || 0), 0)
      if (totalMerma > 0) {
        polizas.push({
          numero: numPoliza++,
          fecha,
          tipo: 'D',
          tipoLabel: 'Diario',
          concepto: `Merma y ajustes ${fecha}`,
          movimientos: [
            {
              cuenta: CUENTAS.MERMA,
              cuentaNombre: cuentaNombre(CUENTAS.MERMA),
              debe: round2(totalMerma),
              haber: 0,
              concepto: `${merma.length} ajustes por merma/desperdicio`,
            },
            {
              cuenta: CUENTAS.INVENTARIOS,
              cuentaNombre: cuentaNombre(CUENTAS.INVENTARIOS),
              debe: 0,
              haber: round2(totalMerma),
              concepto: 'Baja de inventario por merma',
            },
          ],
        })
      }

      // Devoluciones a proveedor
      const totalDevol = devoluciones.reduce((s, m) => s + Math.abs(m.total_cost || (m.quantity * m.cost_per_unit) || 0), 0)
      if (totalDevol > 0) {
        polizas.push({
          numero: numPoliza++,
          fecha,
          tipo: 'D',
          tipoLabel: 'Diario',
          concepto: `Devoluciones a proveedor ${fecha}`,
          movimientos: [
            {
              cuenta: CUENTAS.PROVEEDORES,
              cuentaNombre: cuentaNombre(CUENTAS.PROVEEDORES),
              debe: round2(totalDevol),
              haber: 0,
              concepto: 'Cancelación cuenta por pagar',
            },
            {
              cuenta: CUENTAS.INVENTARIOS,
              cuentaNombre: cuentaNombre(CUENTAS.INVENTARIOS),
              debe: 0,
              haber: round2(totalDevol),
              concepto: 'Baja de inventario por devolución',
            },
          ],
        })
      }
    }

    // Validate: every póliza must balance (sum debe = sum haber)
    for (const p of polizas) {
      const totalDebe = p.movimientos.reduce((s, m) => s + m.debe, 0)
      const totalHaber = p.movimientos.reduce((s, m) => s + m.haber, 0)
      // Fix rounding by adjusting the largest entry
      const diff = round2(totalDebe - totalHaber)
      if (Math.abs(diff) > 0.001 && p.movimientos.length > 0) {
        if (diff > 0) {
          // Need more haber
          const maxHaber = p.movimientos.reduce((max, m) => m.haber > max.haber ? m : max, p.movimientos[0])
          maxHaber.haber = round2(maxHaber.haber + diff)
        } else {
          // Need more debe
          const maxDebe = p.movimientos.reduce((max, m) => m.debe > max.debe ? m : max, p.movimientos[0])
          maxDebe.debe = round2(maxDebe.debe - diff)
        }
      }
    }

    // Totals
    const totalDebe = polizas.reduce((s, p) => s + p.movimientos.reduce((s2, m) => s2 + m.debe, 0), 0)
    const totalHaber = polizas.reduce((s, p) => s + p.movimientos.reduce((s2, m) => s2 + m.haber, 0), 0)

    const result = {
      fecha,
      polizas,
      resumen: {
        totalPolizas: polizas.length,
        totalDebe: round2(totalDebe),
        totalHaber: round2(totalHaber),
        balanceado: Math.abs(totalDebe - totalHaber) < 0.01,
        ordenesPOS: orders.length,
        movimientosInventario: allMovements.length,
        // W1-E: procedencia y cobertura del COGS — si hay eventos UNKNOWN o
        // PARTIAL, el margen del día es PARCIAL y se declara como tal.
        cogsSource: 'pos_cost_events',
        cogsCoverage: cogsCoverage,
        cogsParcial: cogsCoverage.unknown > 0 || cogsCoverage.partial > 0,
      },
    }

    if (formato === 'xml') {
      return new Response(generateXML(result, clientRfc), {
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': `attachment; filename="polizas_${fecha}.xml"`,
        },
      })
    }

    if (formato === 'csv') {
      return new Response(generateCSV(result), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="polizas_${fecha}.csv"`,
        },
      })
    }

    return Response.json(result)
  } catch (error) {
    console.error('[contabilidad/polizas] Error:', error)
    return Response.json({ error: 'Error generando pólizas', polizas: [], resumen: {} }, { status: 500 })
  }
}

// ─── Monthly summary ─────────────────────────────

async function getResumenMensual(mes: string, formato: string, clientId: string, bdCfg: ResolvedBusinessDayConfig) {
  const startDate = `${mes}-01`
  const endDate = getLastDayOfMonth(mes)
  const cid = encodeURIComponent(clientId)

  // W1-C: el mes operativo = [bounds(primer día).start, bounds(último día).end)
  // en UTC. wansoft_daily.fecha ya es business-date-aligned (cierre de Wansoft),
  // así que ese filtro sigue por fecha.
  const monthStart = getBusinessDayBounds(startDate, bdCfg.timeZone, bdCfg.boundary).utcStart
  const monthEnd = getBusinessDayBounds(endDate, bdCfg.timeZone, bdCfg.boundary).utcEnd
  const rangeFilter = `created_at=gte.${encodeURIComponent(monthStart)}&created_at=lt.${encodeURIComponent(monthEnd)}`

  const [ordersRes, wansoftRes, movRes] = await Promise.all([
    fetch(
      `${SB_URL}/rest/v1/pos_orders?client_id=eq.${cid}&${rangeFilter}&status=neq.cancelled&select=total,subtotal,tax,payment_method,items&limit=5000`,
      OPTS
    ),
    fetch(
      `${SB_URL}/rest/v1/wansoft_daily?fecha=gte.${startDate}&fecha=lte.${endDate}&select=fecha,ventas_dia,ventas_brutas,descuentos,pago_metodos&order=fecha.asc`,
      OPTS
    ),
    fetch(
      `${SB_URL}/rest/v1/pos_inventory_movements?client_id=eq.${cid}&${rangeFilter}&select=type,total_cost,quantity,cost_per_unit&limit=5000`,
      OPTS
    ),
  ])

  const orders: PosOrder[] = ordersRes.ok ? await ordersRes.json() : []
  const wansoftDays = wansoftRes.ok ? await wansoftRes.json() : []
  const movements: InventoryMovement[] = movRes.ok ? await movRes.json() : []

  // Calculate from POS orders or Wansoft
  let ventasBrutas = 0
  let ventasNetas = 0
  let totalIVA = 0
  let costoVentas = 0
  const byPayment = new Map<string, number>()

  // W1-E: el COGS mensual sale de pos_cost_events (reconocimiento inmutable),
  // nunca de items[].recipe_cost (navegador) ni de un 35% presentado como real.
  let costEventCount = 0
  let costUnknownCount = 0
  {
    const ceRes = await fetch(
      `${SB_URL}/rest/v1/pos_cost_events?client_id=eq.${cid}&${rangeFilter}&select=total_cost,cost_coverage&limit=50000`,
      OPTS
    )
    if (ceRes.ok) {
      const events: { total_cost: number | null; cost_coverage: string }[] = await ceRes.json()
      for (const ev of events) {
        costEventCount++
        if (ev.cost_coverage === 'UNKNOWN' || ev.cost_coverage === 'PARTIAL') costUnknownCount++
        if (ev.total_cost != null) costoVentas += Number(ev.total_cost)
      }
    }
  }

  if (orders.length > 0) {
    for (const o of orders) {
      ventasBrutas += (o.total || 0)
      ventasNetas += (o.subtotal || o.total || 0)
      totalIVA += (o.tax || 0)
      const method = mapPaymentLabel(o.payment_method || 'efectivo')
      byPayment.set(method, (byPayment.get(method) || 0) + (o.total || 0))
    }
    if (totalIVA === 0) {
      totalIVA = ventasBrutas - (ventasBrutas / 1.16)
      ventasNetas = ventasBrutas / 1.16
    }
  } else {
    for (const day of wansoftDays) {
      ventasBrutas += (day.ventas_brutas || day.ventas_dia || 0)
      ventasNetas += (day.ventas_dia || 0)
      for (const p of (day.pago_metodos || [])) {
        byPayment.set(p.nombre, (byPayment.get(p.nombre) || 0) + p.total)
      }
    }
    totalIVA = ventasNetas - (ventasNetas / 1.16)
    ventasNetas = ventasNetas / 1.16
  }

  const totalEntradas = movements
    .filter(m => m.type === 'entrada' || m.type === 'purchase')
    .reduce((s, m) => s + Math.abs(m.total_cost || (m.quantity * m.cost_per_unit) || 0), 0)

  const totalMerma = movements
    .filter(m => m.type === 'merma' || m.type === 'waste' || m.type === 'adjustment')
    .reduce((s, m) => s + Math.abs(m.total_cost || (m.quantity * m.cost_per_unit) || 0), 0)

  // W1-E: el margen solo se calcula donde la cobertura lo permite; si hay
  // eventos sin costo conocido (o cero eventos con ventas), es PARCIAL.
  const cogsParcial = costUnknownCount > 0 || (costEventCount === 0 && ventasNetas > 0)
  const margenBruto = ventasNetas - costoVentas
  const margenPct = ventasNetas > 0 ? (margenBruto / ventasNetas) * 100 : 0

  const resumen = {
    mes,
    ventasBrutas: round2(ventasBrutas),
    ventasNetas: round2(ventasNetas),
    ivaTrasladadoMes: round2(totalIVA),
    costoVentas: round2(costoVentas),
    cogsSource: 'pos_cost_events',
    cogsEventos: costEventCount,
    cogsParcial,
    margenBruto: round2(margenBruto),
    margenPct: round2(margenPct),
    entradasInventario: round2(totalEntradas),
    merma: round2(totalMerma),
    desglosePagos: Object.fromEntries(byPayment),
    diasConDatos: orders.length > 0 ? new Set(orders.map(o => o.created_at?.slice(0, 10))).size : wansoftDays.length,
  }

  return Response.json(resumen)
}

// ─── XML (CONTPAQi Polizas format) ───────────────

function generateXML(data: { fecha: string; polizas: Poliza[] }, rfc: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Polizas Version="1.3" TipoSolicitud="AF" NumOrden="1" Anio="${data.fecha.slice(0, 4)}" Mes="${data.fecha.slice(5, 7)}" RFC="${rfc}">`,
  ]

  for (const p of data.polizas) {
    lines.push(`  <Poliza NumUnIdenPol="${p.numero}" Fecha="${p.fecha}" Concepto="${escapeXml(p.concepto)}">`)
    for (const m of p.movimientos) {
      lines.push(
        `    <Transaccion NumCta="${m.cuenta}" Concepto="${escapeXml(m.concepto)}" Debe="${m.debe.toFixed(2)}" Haber="${m.haber.toFixed(2)}" />`
      )
    }
    lines.push('  </Poliza>')
  }

  lines.push('</Polizas>')
  return lines.join('\n')
}

// ─── CSV ─────────────────────────────────────────

function generateCSV(data: { fecha: string; polizas: Poliza[] }): string {
  const rows = ['Poliza,Fecha,Tipo,Concepto,Cuenta,CuentaNombre,Debe,Haber']
  for (const p of data.polizas) {
    for (const m of p.movimientos) {
      rows.push(
        `${p.numero},${p.fecha},${p.tipoLabel},"${m.concepto}",${m.cuenta},"${m.cuentaNombre}",${m.debe.toFixed(2)},${m.haber.toFixed(2)}`
      )
    }
  }
  return rows.join('\n')
}

// ─── Helpers ─────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getLastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${ym}-${String(last).padStart(2, '0')}`
}
