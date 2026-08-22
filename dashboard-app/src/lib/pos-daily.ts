// ── Contrato de dominio · OCM Fase 3 "el clon sabe toda su info" ──
//
// Fuente canónica de datos diarios para las superficies de IA (chat, coach, voice).
// Sintetiza filas con el MISMO shape que `wansoft_daily` a partir del `pos_orders`
// VIVO de un tenant. Todo cliente clonado del esqueleton (data_source=supabase, sin
// histórico legacy en wansoft_daily) obtiene análisis real —día que más vende, meseros,
// platillos, métodos de pago, tendencias— sin sembrar nada por tenant.
//
// Regla: los agentes NUNCA vuelven a acoplarse a wansoft_daily (single-tenant, amalay).
// Cuando wansoft_daily viene vacío, se llama a esta función. amalay sigue usando su
// histórico legacy; cualquier otro tenant lee su propio POS.
//
// Shape devuelto (subset de wansoft_daily que consumen chat/coach/voice):
//   fecha, ventas_dia, ventas_brutas, descuentos, tickets_count, personas_restaurant,
//   ticket_promedio_restaurant, efectivo, tarjeta, propinas_total,
//   meseros[], ventas_por_grupo[], pago_metodos[]/pago_métodos[], platillos_top[]

// Parse JSONB que PostgREST puede devolver como array o como string (doble-encoded).
function parseJsonbArr(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val !== 'string') return []
  try {
    let parsed = JSON.parse(val)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const MX_OFFSET_MS = 6 * 60 * 60 * 1000

/**
 * Agrega el pos_orders vivo de un tenant a filas diarias tipo wansoft_daily.
 * @param sbUrl     NEXT_PUBLIC_SUPABASE_URL
 * @param sbHeaders headers con apikey/Authorization (service o anon key)
 * @param clientId  slug del tenant (client_id en pos_orders)
 * @param days      ventana en días hacia atrás (14 / 90 / 365)
 * @returns filas ordenadas por fecha DESC (como wansoft_daily). [] si no hay órdenes.
 */
export async function buildDailyFromOrders(
  sbUrl: string,
  sbHeaders: Record<string, string>,
  clientId: string,
  days: number
): Promise<Record<string, unknown>[]> {
  if (!clientId) return []
  const sinceDate = new Date(Date.now() - (days + 1) * 86400000 - MX_OFFSET_MS)
    .toISOString().slice(0, 10)
  const url = `${sbUrl}/rest/v1/pos_orders?client_id=eq.${encodeURIComponent(clientId)}`
    + `&status=in.(cerrada,pagada,cobrada,entregada)&created_at=gte.${sinceDate}T00:00:00`
    + `&select=created_at,total,subtotal,descuento,propina,mesero,metodo_pago,personas,items`
    + `&order=created_at.desc&limit=8000`
  let orders: Record<string, unknown>[] = []
  try {
    const res = await fetch(url, { headers: sbHeaders, cache: 'no-store' })
    orders = res.ok ? await res.json() : []
  } catch { return [] }
  if (!Array.isArray(orders) || orders.length === 0) return []

  type Bucket = {
    ventas: number; brutas: number; descuentos: number; propinas: number
    tickets: number; personas: number
    meseros: Record<string, number>; pagos: Record<string, number>
    platillos: Record<string, { cantidad: number; total: number }>
  }
  const byDay = new Map<string, Bucket>()
  for (const o of orders) {
    const ts = new Date(o.created_at as string)
    if (isNaN(ts.getTime())) continue
    // Fecha de negocio en MX (UTC-6) para agrupar por día calendario local.
    const fecha = new Date(ts.getTime() - MX_OFFSET_MS).toISOString().slice(0, 10)
    let b = byDay.get(fecha)
    if (!b) {
      b = { ventas: 0, brutas: 0, descuentos: 0, propinas: 0, tickets: 0, personas: 0, meseros: {}, pagos: {}, platillos: {} }
      byDay.set(fecha, b)
    }
    const total = Number(o.total) || 0
    b.ventas += total
    b.brutas += Number(o.subtotal) || total
    b.descuentos += Number(o.descuento) || 0
    b.propinas += Number(o.propina) || 0
    b.tickets += 1
    b.personas += Number(o.personas) || 1
    const mesero = (o.mesero as string) || ''
    if (mesero) b.meseros[mesero] = (b.meseros[mesero] || 0) + total
    const metodo = (o.metodo_pago as string) || ''
    if (metodo) b.pagos[metodo] = (b.pagos[metodo] || 0) + total
    for (const it of parseJsonbArr(o.items) as { nombre?: string; cantidad?: number; subtotal?: number; precio?: number }[]) {
      if (!it?.nombre) continue
      const p = b.platillos[it.nombre] || { cantidad: 0, total: 0 }
      p.cantidad += Number(it.cantidad) || 0
      p.total += Number(it.subtotal) || (Number(it.precio) || 0) * (Number(it.cantidad) || 0)
      b.platillos[it.nombre] = p
    }
  }

  const toArr = (m: Record<string, number>) =>
    Object.entries(m).map(([nombre, total]) => ({ nombre, total: Math.round(total) })).sort((a, b) => b.total - a.total)
  const sumWhere = (m: Record<string, number>, re: RegExp) =>
    Object.entries(m).reduce((s, [k, v]) => s + (re.test(k) ? v : 0), 0)

  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // fecha DESC, como wansoft_daily
    .map(([fecha, b]) => {
      const pagos = toArr(b.pagos)
      return {
        fecha,
        ventas_dia: Math.round(b.ventas),
        ventas_brutas: Math.round(b.brutas),
        descuentos: Math.round(b.descuentos),
        propinas_total: Math.round(b.propinas),
        tickets_count: b.tickets,
        personas_restaurant: b.personas,
        ticket_promedio_restaurant: b.personas > 0 ? Math.round(b.ventas / b.personas) : 0,
        efectivo: Math.round(sumWhere(b.pagos, /efectivo/i)),
        tarjeta: Math.round(sumWhere(b.pagos, /tarjeta/i)),
        meseros: toArr(b.meseros),
        ventas_por_grupo: [] as { nombre: string; total: number }[],
        pago_metodos: pagos,
        'pago_métodos': pagos, // coach/voice leen la key con acento
        platillos_top: Object.entries(b.platillos)
          .map(([nombre, v]) => ({ nombre, cantidad: v.cantidad, total: Math.round(v.total) }))
          .sort((a, b) => b.total - a.total),
      }
    })
}
