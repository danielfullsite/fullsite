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
 * COMPATIBILIDAD. Se conserva con el MISMO contrato de antes —devuelve `[]` y nunca
 * lanza— porque el chat no puede fallar: seis llamadas vivas dependen de eso.
 *
 * Lo nuevo esta en `buildDailyConEstado`, que SI distingue "no hay datos" de "no
 * pude leer". Toda pantalla que le reporte numeros a una persona deberia usar esa.
 */
export async function buildDailyFromOrders(
  sbUrl: string,
  sbHeaders: Record<string, string>,
  clientId: string,
  days: number,
): Promise<Record<string, unknown>[]> {
  return (await buildDailyConEstado(sbUrl, sbHeaders, clientId, days)).dias
}

/**
 * La lectura de ventas fallo. NO es lo mismo que "no hubo ventas".
 *
 * INCIDENTE DE DISENO, encontrado el 2026-09-01 barriendo la familia del 2026-08-31:
 *
 *   orders = res.ok ? await res.json() : []
 *   if (orders.length === 0) return []
 *
 * Esta funcion alimenta el chat de IA, el coach y la voz. Con esa linea, un 401 o un
 * timeout hacian que la IA respondiera "no hubo ventas" — afirmandolo, no dudandolo.
 *
 * Es la misma clase que el dashboard que truncaba en 5,000 ordenes y acusaba
 * falsamente al POS de estar caido. Un numero equivocado dicho con seguridad es peor
 * que no tener el numero.
 */
export class LecturaDiariaFallida extends Error {
  constructor(public readonly motivo: string) {
    super(`No se pudieron leer las ventas: ${motivo}`)
    this.name = 'LecturaDiariaFallida'
  }
}

/** Resultado que SI distingue "no hay datos" de "no pude leer". */
export type EstadoDiario =
  | { determinado: true; dias: Record<string, unknown>[] }
  | { determinado: false; dias: []; motivo: string }

/**
 * Version con estado, para todo lo que le reporta numeros a una persona.
 *
 * Nunca lanza: el chat no puede fallar (regla del producto). Devuelve
 * `determinado: false` para que quien la llame diga "no pude consultar" en vez de
 * dar por bueno un cero.
 */
export async function buildDailyConEstado(
  sbUrl: string,
  sbHeaders: Record<string, string>,
  clientId: string,
  days: number,
): Promise<EstadoDiario> {
  try {
    return { determinado: true, dias: await leerDiasOLanzar(sbUrl, sbHeaders, clientId, days) }
  } catch (e) {
    const motivo = e instanceof LecturaDiariaFallida ? e.motivo : 'error inesperado'
    console.warn('[pos-daily] no se pudieron leer las ventas:', motivo)
    return { determinado: false, dias: [], motivo }
  }
}

/**
 * Agrega el pos_orders vivo de un tenant a filas diarias tipo wansoft_daily.
 * @param sbUrl     NEXT_PUBLIC_SUPABASE_URL
 * @param sbHeaders headers con apikey/Authorization (service o anon key)
 * @param clientId  slug del tenant (client_id en pos_orders)
 * @param days      ventana en días hacia atrás (14 / 90 / 365)
 * @returns filas ordenadas por fecha DESC (como wansoft_daily). [] si no hay órdenes.
 */
async function leerDiasOLanzar(
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
    + `&select=created_at,dia_venta,total,subtotal,descuento,propina,mesero,metodo_pago,personas,items`
    + `&order=created_at.desc&limit=8000`
  let orders: Record<string, unknown>[] = []
  try {
    const res = await fetch(url, { headers: sbHeaders, cache: 'no-store' })
    if (!res.ok) {
      // NO se traga como "no hubo ventas". Ver buildDailyConEstado.
      throw new LecturaDiariaFallida(`HTTP ${res.status}`)
    }
    orders = await res.json()
  } catch (e) {
    if (e instanceof LecturaDiariaFallida) throw e
    throw new LecturaDiariaFallida('sin conexion')
  }
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
    // ── DIA DE VENTA, no dia de calendario ────────────────────────────────
    //
    // Antes esto era `new Date(ts - MX_OFFSET_MS)` — un desfase fijo de UTC-6 SIN
    // corrimiento de dia de venta. Resultado: toda venta entre medianoche y las 5
    // a.m. se le atribuia al DIA SIGUIENTE. Y eso es justo el cierre de un
    // restaurante.
    //
    // Medido en produccion el 2026-09-01, ordenes agrupadas en el dia equivocado:
    //
    //   scyf-demo   38,866 de 110,789   35.1%
    //   boruca          62 de     240   25.8%
    //   lab-resto      486 de   4,402   11.0%
    //
    // Hasta un TERCIO de las ventas caian en el dia equivocado en los numeros que
    // ve la IA — el "como vamos hoy", las comparaciones dia contra dia, el coach.
    //
    // `dia_venta` lo calcula la base por tenant, con SU zona horaria y SU hora de
    // inicio (`clients.business_day_start_local`). Se lee en vez de recalcularlo:
    // una sola definicion de "que dia es" para todo el sistema.
    //
    // El respaldo conserva el comportamiento viejo para filas anteriores al backfill
    // — mal agrupadas, pero es lo que habia; no se inventa un dato que no existe.
    const fecha = typeof o.dia_venta === 'string' && o.dia_venta
      ? o.dia_venta
      : new Date(ts.getTime() - MX_OFFSET_MS).toISOString().slice(0, 10)
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
