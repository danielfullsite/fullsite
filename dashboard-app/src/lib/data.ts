import type { WansoftDaily } from './types'
import { supabase } from './supabase'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** RLS: wansoft_daily/agent_runs are authenticated-only since rls_tighten_policies.sql.
 *  Use the logged-in session token as Bearer (anon key alone sees 0 rows).
 *  Token is cached for 30s to avoid 3s timeout on every single fetch. */
let _cachedToken: string | null = null
let _cachedTokenTime = 0
const TOKEN_CACHE_MS = 30_000

async function getAuthToken(): Promise<string> {
  const now = Date.now()
  if (_cachedToken && (now - _cachedTokenTime) < TOKEN_CACHE_MS) return _cachedToken
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
    const sessionP = supabase.auth.getSession().then(r => r.data.session).catch(() => null)
    const session = await Promise.race([sessionP, timeout])
    _cachedToken = session?.access_token || SUPABASE_KEY
    _cachedTokenTime = now
    return _cachedToken
  } catch {
    _cachedToken = SUPABASE_KEY
    _cachedTokenTime = now
    return SUPABASE_KEY
  }
}

/** Get the current client slug from AuthContext (stored in localStorage after login). Falls back to 'amalay' for backward compat. */
export function getActiveClientSlug(): string {
  if (typeof window === 'undefined') return 'amalay'
  try {
    const stored = localStorage.getItem('fullsite_client_id')
    if (stored) return stored
  } catch { /* SSR or private browsing */ }
  return 'amalay'
}

/**
 * Data Source Switch — controls whether dashboard reads from Wansoft or Fullsite POS.
 * Stored in clients.data_source: 'wansoft' | 'fullsite' | 'supabase' (legacy = wansoft)
 * Cached in localStorage after first fetch.
 */
export type DataSource = 'wansoft' | 'fullsite'

export function getDataSource(): DataSource {
  if (typeof window === 'undefined') return 'wansoft'
  try {
    const cached = localStorage.getItem('fullsite_data_source')
    if (cached === 'fullsite') return 'fullsite'
  } catch { /* */ }
  return 'wansoft'
}

export function setDataSource(source: DataSource) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('fullsite_data_source', source)
  }
}

/** Check if this client uses Fullsite POS as primary (not Wansoft) */
export function isFullsitePOS(): boolean {
  return getDataSource() === 'fullsite'
}

async function sbFetch(table: string, params: string = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  try {
    const token = await getAuthToken()
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
      },
    })
    if (!res.ok) {
      console.error(`[Fullsite] Supabase error ${res.status} on ${table}:`, await res.text().catch(() => ''))
      return []
    }
    const data = await res.json()
    if (!Array.isArray(data)) {
      console.error(`[Fullsite] Supabase returned non-array for ${table}:`, typeof data)
      return []
    }
    return data
  } catch (err) {
    console.error(`[Fullsite] Network error fetching ${table}:`, err)
    return []
  }
}

function parseJsonbField<T>(value: unknown): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value as T[]
  const parsed = parseJsonb(value)
  if (Array.isArray(parsed)) return parsed as T[]
  // If it's an object with a Result array (Wansoft pattern)
  if (parsed && typeof parsed === 'object' && 'Result' in (parsed as Record<string, unknown>)) {
    const result = (parsed as Record<string, unknown>).Result
    if (Array.isArray(result)) return result as T[]
  }
  return []
}

function parseRow(row: Record<string, unknown>): WansoftDaily {
  // Sanitize: guarantee numbers are numbers, never null/undefined
  const num = (v: unknown) => Number(v) || 0
  return {
    fecha: (row.fecha as string) || '',
    ventas_dia: num(row.ventas_dia),
    ventas_brutas: num(row.ventas_brutas),
    descuentos: num(row.descuentos),
    devoluciones: num(row.devoluciones),
    tickets_count: num(row.tickets_count),
    personas_restaurant: num(row.personas_restaurant),
    ticket_promedio_restaurant: num(row.ticket_promedio_restaurant),
    efectivo: num(row.efectivo),
    tarjeta: num(row.tarjeta),
    mesas_atendidas: num(row.mesas_atendidas),
    ordenes_llevar: num(row.ordenes_llevar),
    propinas_total: num(row.propinas_total),
    chilaquiles_total: num(row.chilaquiles_total),
    half_half_total: num(row.half_half_total),
    meseros: parseJsonbField(row.meseros),
    platillos_top: parseJsonbField(row.platillos_top),
    ventas_por_grupo: parseJsonbField(row.ventas_por_grupo),
    pago_métodos: parseJsonbField(row.pago_metodos ?? row.pago_métodos),
    propinas_meseros: row.propinas_meseros ? parseJsonbField(row.propinas_meseros) : undefined,
    updated_at: (row.updated_at as string) || undefined,
  }
}

function dedupeByFecha(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  // Keep the row with highest ventas_dia per fecha
  const map = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const f = row.fecha as string
    const ventas = (row.ventas_dia as number) || 0
    const existing = map.get(f)
    if (!existing || ventas > ((existing.ventas_dia as number) || 0)) {
      map.set(f, row)
    }
  }
  // Return best row per fecha, ordered by first appearance
  const seen = new Set<string>()
  const result: Record<string, unknown>[] = []
  for (const row of rows) {
    const f = row.fecha as string
    if (seen.has(f)) continue
    seen.add(f)
    result.push(map.get(f)!)
  }
  return result
}

function locationFilter(locationId?: string | null): string {
  return locationId ? `&location_id=eq.${locationId}` : ''
}

export async function getRecentDays(days: number = 30, clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  // Try pos_orders first for recent data (last 7 days) — this is the live POS data
  const posRecent = await getDashboardFromPosOrders(Math.min(days, 90), clientSlug)
  // Then get wansoft_daily for historical data
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.desc&limit=${days * 2}`) as Record<string, unknown>[]
  const wansoftData = dedupeByFecha(data).slice(0, days).reverse().map(parseRow)
  // Merge: for dates that exist in both, prefer pos_orders (live POS data)
  const posDateSet = new Set(posRecent.map(d => d.fecha))
  const merged = [
    ...wansoftData.filter(d => !posDateSet.has(d.fecha)),
    ...posRecent,
  ].sort((a, b) => a.fecha.localeCompare(b.fecha))
  if (merged.length > 0) return merged.slice(-days)
  return []
}

export async function getLatestDay(clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily | null> {
  // Try pos_orders first — live POS data takes priority
  const posData = await getDashboardFromPosOrders(7, clientSlug)
  if (posData.length > 0) return posData[posData.length - 1]
  // Fallback to wansoft_daily
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.desc&limit=5`) as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  if (deduped.length > 0) return parseRow(deduped[0])
  return null
}

export async function getDayData(fecha: string, clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily | null> {
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&fecha=eq.${fecha}&ventas_dia=gt.0&order=ventas_dia.desc&limit=5`) as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  return deduped.length > 0 ? parseRow(deduped[0]) : null
}

export async function getMonthlyData(clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.asc&limit=1000`) as Record<string, unknown>[]
  const rows = dedupeByFecha(data).map(parseRow)
  if (rows.length > 0) return rows
  // POS fallback
  return getDashboardFromPosOrders(365, clientSlug)
}

export async function getWaiterCategories(days: number = 7, clientSlug: string = getActiveClientSlug()) {
  return sbFetch('wansoft_waiter_categories', `select=*&client_slug=eq.${clientSlug}&order=fecha.desc&limit=${days}`)
}

// Aggregate mesero data across multiple days
const EXCLUDE_STAFF = [
  'mesero evento', 'aplicaciones', 'oscar ricardo', 'rodrigo chávez', 'rodrigo chavez',
  'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio',
]

export function aggregateMeseros(
  dailyData: WansoftDaily[]
): { nombre: string; total: number; dias: number; promedio: number }[] {
  const map: Record<string, { total: number; dias: Set<string> }> = {}

  for (const day of dailyData) {
    const meseros = parseJsonbField<{ nombre?: string; total?: number }>(day.meseros)
    if (meseros.length === 0) continue
    for (const m of meseros) {
      if (!m.nombre) continue
      if (EXCLUDE_STAFF.some(ex => m.nombre!.toLowerCase().includes(ex))) continue
      if (!map[m.nombre]) {
        map[m.nombre] = { total: 0, dias: new Set() }
      }
      map[m.nombre].total += m.total || 0
      map[m.nombre].dias.add(day.fecha)
    }
  }

  return Object.entries(map)
    .map(([nombre, data]) => ({
      nombre,
      total: data.total,
      dias: data.dias.size,
      promedio: data.dias.size > 0 ? Math.round(data.total / data.dias.size) : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

// Get data for a date range
export async function getDateRange(from: string, to: string, clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  const data = await sbFetch(
    'wansoft_daily',
    `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&fecha=gte.${from}&fecha=lte.${to}&ventas_dia=gt.0&order=fecha.asc`
  ) as Record<string, unknown>[]
  const rows = dedupeByFecha(data).map(parseRow)
  if (rows.length > 0) return rows
  // POS fallback: calculate days in range, fetch, then filter
  const fromDate = new Date(from + 'T00:00:00')
  const toDate = new Date(to + 'T23:59:59')
  const days = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const posData = await getDashboardFromPosOrders(days, clientSlug)
  return posData.filter(d => d.fecha >= from && d.fecha <= to)
}

// Aggregate payment methods across days
export function aggregatePayments(
  dailyData: WansoftDaily[]
): { nombre: string; total: number }[] {
  const map: Record<string, number> = {}
  for (const day of dailyData) {
    const métodos = parseJsonbField<{ nombre?: string; total?: number }>(day.pago_métodos)
    const ventasDia = day.ventas_dia || 0
    for (const m of métodos) {
      if (!m.nombre) continue
      // m.total is a PERCENTAGE (e.g. 42.0 = 42%), convert to MXN
      const mxn = (m.total || 0) < 100 ? ((m.total || 0) / 100) * ventasDia : (m.total || 0)
      map[m.nombre] = (map[m.nombre] || 0) + mxn
    }
  }
  return Object.entries(map)
    .map(([nombre, total]) => ({ nombre, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total)
}

// ── Deep scraper tables ──────────────────────────────────────────────────

function parseJsonb(val: unknown): unknown {
  if (!val) return null
  if (typeof val !== 'string') return val
  let current: unknown = val
  // Keep parsing until it's no longer a string (handles triple+ escaping)
  for (let i = 0; i < 5; i++) {
    if (typeof current !== 'string') break
    try { current = JSON.parse(current) } catch { break }
  }
  return current
}

export async function getDeepTable(table: string, limit: number = 30) {
  // Try ordering by fecha first, fall back to updated_at
  let data = await sbFetch(table, `select=*&order=updated_at.desc&limit=${limit}`) as Record<string, unknown>[]
  if (data.length === 0) {
    // Try without ordering in case column doesn't exist
    data = await sbFetch(table, `select=*&limit=${limit}`) as Record<string, unknown>[]
  }
  console.log(`[getDeepTable] ${table}: ${data.length} rows`)
  return data.map(row => ({ ...row, data: parseJsonb(row.data) }))
}

export async function getLatestDeep(table: string): Promise<{ fecha: string; data: unknown; [key: string]: unknown } | null> {
  // Try fecha first, fall back to updated_at, then periodo
  for (const orderCol of ['fecha', 'updated_at', 'periodo']) {
    const data = await sbFetch(table, `select=*&order=${orderCol}.desc&limit=1`) as Record<string, unknown>[]
    if (data.length > 0) {
      return { ...data[0], fecha: (data[0].fecha as string) || (data[0].periodo as string) || '', data: parseJsonb(data[0].data) }
    }
  }
  return null
}

// Get data from wansoft_data generic table
export async function getWansoftData(dataKey: string, clientId: string = getActiveClientSlug()) {
  const data = await sbFetch('wansoft_data', `select=fecha,data&client_id=eq.${clientId}&data_key=eq.${dataKey}&order=fecha.desc&limit=1`) as Record<string, unknown>[]
  if (data.length === 0) return null
  return { fecha: data[0].fecha as string, data: parseJsonb(data[0].data) }
}

// Get multiple days of wansoft_data
export async function getWansoftDataRange(dataKey: string, days: number = 30, clientId: string = getActiveClientSlug()) {
  const data = await sbFetch('wansoft_data', `select=fecha,data&client_id=eq.${clientId}&data_key=eq.${dataKey}&order=fecha.desc&limit=${days}`) as Record<string, unknown>[]
  return data.map(row => ({ fecha: row.fecha as string, data: parseJsonb(row.data) }))
}

// Aggregate platillos from ventas_por_grupo
export function aggregateGrupos(
  dailyData: WansoftDaily[]
): { nombre: string; total: number }[] {
  const map: Record<string, number> = {}

  for (const day of dailyData) {
    const grupos = parseJsonbField<{ nombre?: string; total?: number }>(day.ventas_por_grupo)
    if (grupos.length === 0) continue
    for (const g of grupos) {
      if (!g.nombre) continue
      map[g.nombre] = (map[g.nombre] || 0) + (g.total || 0)
    }
  }

  return Object.entries(map)
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
}

// ── Wansoft Data (35 data types) ────────────────────────────────────

export async function getWansoftDataLatest(dataKey: string, clientId: string = getActiveClientSlug()) {
  const data = await sbFetch('wansoft_data', `select=fecha,data&client_id=eq.${clientId}&data_key=eq.${dataKey}&order=fecha.desc&limit=1`) as Record<string, unknown>[]
  if (data.length === 0) return null
  return { fecha: data[0].fecha as string, data: parseJsonb(data[0].data) }
}

// ── Google Reviews ──────────────────────────────────────────────────

export async function getGoogleReviews(clientSlug: string = getActiveClientSlug()) {
  return sbFetch('google_reviews', `select=*&client_slug=eq.${clientSlug}&order=create_time.desc&limit=100`)
}

export interface AgentRun {
  agent_id: string
  status: string
  output_summary: string
  trigger_type: string
  created_at: string
}

export async function getLatestAgentRuns(): Promise<AgentRun[]> {
  const rows = await sbFetch('agent_runs', 'select=agent_id,status,output_summary,trigger_type,created_at&order=created_at.desc&limit=100')
  const map = new Map<string, AgentRun>()
  for (const row of rows as AgentRun[]) {
    if (!map.has(row.agent_id)) {
      map.set(row.agent_id, row)
    }
  }
  return Array.from(map.values())
}

// ── POS Orders fallback (for clients without Wansoft) ─────────────────

/** Aggregate pos_orders into WansoftDaily-compatible format for dashboard pages.
 *  Used when wansoft_daily has no data for a client (new clients using only Fullsite POS). */
// Classify item into a menu group by name keywords (for ventas_por_grupo)
function classifyItemGroup(lower: string): string {
  if (/chilaquil|enchilada/.test(lower)) return 'CHILAQUILES & ENCHILADAS'
  if (/huevo|egg|omelette|keto/.test(lower)) return 'EGGS & KETO'
  if (/cafe|café|latte|cappuccino|americano|espresso|mocca|matcha/.test(lower)) return 'COFFEE'
  if (/toast|bagel/.test(lower)) return 'TOAST & BAGELS'
  if (/panini/.test(lower)) return 'PANINIS'
  if (/bowl/.test(lower)) return 'BOWLS'
  if (/smoothie/.test(lower)) return 'SMOOTHIES'
  if (/frappe|frapé/.test(lower)) return 'FRAPPES'
  if (/jugo|juice/.test(lower)) return 'JUGOS'
  if (/limonada|fresco|agua|horchata/.test(lower)) return 'FRESH DRINKS'
  if (/pancake|waffle|hotcake/.test(lower)) return 'PANCAKES & WAFFLES'
  if (/croissant/.test(lower)) return 'CROISSANTS BREAKFAST'
  if (/cerveza|heineken|corona|modelo|pacif|victoria|bohemia|stella|tecate|indio|dos equis|michelada/.test(lower)) return 'CERVEZA'
  if (/vino|wine|sangria/.test(lower)) return 'VINOS'
  if (/whisky|tequila|mezcal|vodka|gin|ron |margarita|mojito|carajillo|baileys|kahlua/.test(lower)) return 'BEBIDAS OH'
  if (/soda|coca|sprite|fanta|topo/.test(lower)) return 'SODAS'
  if (/te |té |tisana|chai/.test(lower)) return 'TEA & TISANAS'
  if (/ensalada|salad/.test(lower)) return 'EVERYDAY SPECIALS'
  if (/pizza|pasta/.test(lower)) return 'PIZZAS & PASTAS'
  if (/ceviche/.test(lower)) return 'CEVICHE'
  if (/helado|ice cream|nieve/.test(lower)) return 'ICE CREAM'
  if (/pastel|cheesecake|brownie|galleta|tiramis|postre|dessert/.test(lower)) return 'DESSERTS'
  if (/concha|cuerno|rol de canela|bakery/.test(lower)) return 'BAKERY'
  return 'OTROS'
}

export async function getDashboardFromPosOrders(days: number = 30, clientId: string = getActiveClientSlug()): Promise<WansoftDaily[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const orders = await sbFetch('pos_orders',
    `select=mesa,mesero,personas,total,subtotal,iva,descuento,propina,metodo_pago,pagos,items,status,created_at&client_id=eq.${clientId}&status=eq.cerrada&created_at=gte.${cutoffStr}T00:00:00&order=created_at.asc&limit=5000`
  ) as { mesa: number; mesero: string; personas: number; total: number; subtotal: number; iva: number; descuento: number; propina: number; metodo_pago: string; pagos: { metodo: string; monto: number }[] | null; items: { nombre: string; precio: number; cantidad: number }[] | null; status: string; created_at: string }[]

  if (orders.length === 0) return []

  // Group by date
  const byDate = new Map<string, typeof orders>()
  for (const o of orders) {
    const fecha = o.created_at.slice(0, 10)
    if (!byDate.has(fecha)) byDate.set(fecha, [])
    byDate.get(fecha)!.push(o)
  }

  const result: WansoftDaily[] = []
  for (const [fecha, dayOrders] of Array.from(byDate.entries())) {
    const ventas = dayOrders.reduce((s, o) => s + (o.total || 0), 0)
    const descuentos = dayOrders.reduce((s, o) => s + (o.descuento || 0), 0)
    const personas = dayOrders.reduce((s, o) => s + (o.personas || 0), 0)
    const tp = dayOrders.length > 0 ? Math.round(ventas / dayOrders.length) : 0

    // Meseros
    const meseroMap = new Map<string, number>()
    for (const o of dayOrders) {
      if (o.mesero) meseroMap.set(o.mesero, (meseroMap.get(o.mesero) || 0) + o.total)
    }
    const meseros = Array.from(meseroMap.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Payment methods + efectivo/tarjeta split
    const pagoMap = new Map<string, number>()
    let efectivo = 0, tarjeta = 0, propinasTotal = 0
    for (const o of dayOrders) {
      propinasTotal += o.propina || 0
      const pagos = Array.isArray(o.pagos) && o.pagos.length > 0
        ? o.pagos
        : [{ metodo: o.metodo_pago || 'Efectivo', monto: o.total }]
      for (const p of pagos) {
        const m = (p.metodo || '').toLowerCase()
        pagoMap.set(p.metodo || 'Efectivo', (pagoMap.get(p.metodo || 'Efectivo') || 0) + (p.monto || 0))
        if (/efectivo|cash/.test(m)) efectivo += p.monto || 0
        else tarjeta += p.monto || 0
      }
    }
    const pagoMetodos = Array.from(pagoMap.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Top platillos from items + group by category
    const itemMap = new Map<string, { total: number; cantidad: number }>()
    const grupoMap = new Map<string, number>()
    let chilaquilesTotal = 0, halfHalfTotal = 0
    for (const o of dayOrders) {
      if (Array.isArray(o.items)) {
        for (const item of o.items) {
          if (!item.nombre) continue
          const itemTotal = (item.precio || 0) * (item.cantidad || 1)
          const qty = item.cantidad || 1
          const existing = itemMap.get(item.nombre)
          if (existing) {
            existing.total += itemTotal
            existing.cantidad += qty
          } else {
            itemMap.set(item.nombre, { total: itemTotal, cantidad: qty })
          }

          // Classify into grupo by item name keywords
          const lower = item.nombre.toLowerCase()
          const grupo = classifyItemGroup(lower)
          grupoMap.set(grupo, (grupoMap.get(grupo) || 0) + itemTotal)

          // Special KPIs
          if (lower.includes('chilaquil') || lower.includes('enchilada')) chilaquilesTotal += itemTotal
          if (lower.includes('half') || lower.includes('h&h') || lower.includes('mitad')) halfHalfTotal += itemTotal
        }
      }
    }
    const platillosTop = Array.from(itemMap.entries())
      .map(([nombre, v]) => ({ nombre, total: v.total, cantidad: v.cantidad }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
    const ventasPorGrupo = Array.from(grupoMap.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Propinas per mesero
    const propinasMeseroMap = new Map<string, number>()
    for (const o of dayOrders) {
      if (o.mesero && (o.propina || 0) > 0) {
        propinasMeseroMap.set(o.mesero, (propinasMeseroMap.get(o.mesero) || 0) + o.propina)
      }
    }
    const propinasMeseros = Array.from(propinasMeseroMap.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Count para llevar (mesa 0 = para llevar/domicilio)
    const ordenesLlevar = dayOrders.filter(o => o.mesa === 0 || o.mesa >= 900).length

    result.push({
      fecha,
      ventas_brutas: ventas + descuentos,
      ventas_dia: ventas,
      descuentos,
      devoluciones: 0,
      efectivo,
      tarjeta,
      tickets_count: dayOrders.length,
      mesas_atendidas: new Set(dayOrders.filter(o => o.mesa > 0 && o.mesa < 900).map(o => o.mesa)).size,
      ordenes_llevar: ordenesLlevar,
      personas_restaurant: personas,
      ticket_promedio_restaurant: tp,
      propinas_total: propinasTotal,
      chilaquiles_total: chilaquilesTotal,
      half_half_total: halfHalfTotal,
      meseros,
      platillos_top: platillosTop,
      ventas_por_grupo: ventasPorGrupo,
      pago_métodos: pagoMetodos,
      propinas_meseros: propinasMeseros,
      updated_at: new Date().toISOString(),
    })
  }
  return result
}
