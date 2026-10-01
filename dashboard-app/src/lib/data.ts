import type { WansoftDaily } from './types'
import { supabase } from './supabase'
import { nowMX, fmtDateMX } from './date-mx'
import { fetchWithTimeout } from './fetch-with-timeout'
import type { DashboardOperationStatus } from './business-day'
import type { IntradayRhythm } from './intraday-rhythm'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// El dashboard inicial necesita los acumulados por día. Los JSON de detalle
// (meseros, platillos y categorías) pesan ~4 KB por día en AMALAY y antes se
// descargaban para casi mil días aunque la pantalla sólo muestra agregados.
// El día actual conserva su detalle vía `getLatestDay`; su fallback también
// sigue leyendo la fila completa más reciente.
const WANSOFT_DASHBOARD_SUMMARY_COLUMNS = [
  'fecha', 'ventas_dia', 'ventas_brutas', 'descuentos', 'devoluciones',
  'tickets_count', 'personas_restaurant', 'ticket_promedio_restaurant',
  'efectivo', 'tarjeta', 'mesas_atendidas', 'ordenes_llevar',
  'propinas_total', 'updated_at',
].join(',')

/** RLS: wansoft_daily/agent_runs are authenticated-only since rls_tighten_policies.sql.
 *  Use the logged-in session token as Bearer (anon key alone sees 0 rows).
 *  Token is cached for 30s to avoid 3s timeout on every single fetch. */
let _cachedToken: string | null = null
let _cachedTokenTime = 0
const TOKEN_CACHE_MS = 30_000

export async function getAuthToken(): Promise<string> {
  const now = Date.now()
  if (_cachedToken && (now - _cachedTokenTime) < TOKEN_CACHE_MS) return _cachedToken

  // STORAGE PRIMERO. El token de sesión vive en localStorage desde el login
  // (`sb-<ref>-auth-token`) y leerlo es SÍNCRONO y confiable. Antes esto
  // arrancaba con `supabase.auth.getSession()` en una carrera contra un timeout
  // de 3 s, y sólo usaba el storage como fallback (`session?.access_token ||
  // readSessionTokenFromStorage()`). En App Router getSession() se cuelga (falla
  // conocida, ver AGENTS.md); con la sesión ya en el storage, esa carrera no
  // aporta nada y sí abre la ventana en la que getAuthToken devolvía la anon key.
  //
  // Consecuencia observada en campo (2026-09-30, amalay): con la anon key, el
  // guard de getDashboardFromPosOrders (`token === SUPABASE_KEY → throw`) tumbaba
  // la lectura ANTES de pedir pos_orders. pos nunca se consultaba y el dashboard
  // caía a wansoft_daily, congelado en el último día de esa fuente (8-sep) aunque
  // pos_orders tenía el día en curso. Leer el storage primero cierra esa ventana.
  const stored = readSessionTokenFromStorage()
  if (stored) {
    _cachedToken = stored
    _cachedTokenTime = now
    return stored
  }

  // Sin token en el storage (primeros ms antes de que el SDK lo escriba, o sesión
  // recién refrescada): intenta el SDK con timeout. SÓLO se cachea un token REAL;
  // sin sesión se devuelve la anon key SIN cachearla, para que la siguiente
  // llamada reintente en cuanto el storage se hidrate.
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
    const sessionP = supabase.auth.getSession().then(r => r.data.session).catch(() => null)
    const session = await Promise.race([sessionP, timeout])
    const token = session?.access_token
    if (token) {
      _cachedToken = token
      _cachedTokenTime = now
      return token
    }
  } catch {
    // cae a anon abajo
  }
  return SUPABASE_KEY
}

/**
 * Fallback directo al storage del SDK. `supabase.auth.getSession()` puede
 * colgarse en App Router (falla conocida, ver AGENTS.md) y el timeout de 3 s
 * degradaba a la anon key AUNQUE la sesión existiera — con RLS eso es cero
 * filas y cada pantalla caía a su fallback en silencio (visto en campo
 * 2026-08-29: "[client-config] Sin configuración para carls-jr" con sesión
 * válida en localStorage). El token vive en `sb-<ref>-auth-token`; leerlo
 * directo no depende del SDK. Se valida expiración antes de usarlo.
 */
function readSessionTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('sb-') || !k.endsWith('-auth-token')) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { access_token?: string; expires_at?: number }
      if (!parsed?.access_token) continue
      if (parsed.expires_at && parsed.expires_at * 1000 < Date.now() + 30_000) continue
      return parsed.access_token
    }
  } catch { /* storage bloqueado o JSON corrupto */ }
  return null
}

/**
 * SINGLE SOURCE OF TRUTH for client_id resolution (client-side).
 *
 * Resolution order:
 *   1. localStorage 'fullsite_client_id' (set by AuthContext on login)
 *   2. Environment default (NEXT_PUBLIC_DEFAULT_CLIENT_ID)
 *   3. Empty string '' (fails DB queries safely — returns 0 rows)
 *
 * For a new Fullsite installation with no default client:
 *   - Set NEXT_PUBLIC_DEFAULT_CLIENT_ID='' in .env
 *   - All unauthenticated pages return empty data
 *   - AuthContext sets localStorage on login → all subsequent queries work
 *
 * For AMALAY (current single-tenant):
 *   - NEXT_PUBLIC_DEFAULT_CLIENT_ID='amalay' in .env
 *   - Backward compatible
 */
export function getActiveClientSlug(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('fullsite_client_id')
      if (stored) return stored.toLowerCase().trim()
    } catch { /* private browsing */ }
  }
  return process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID || ''
}

/**
 * Data Source Switch — controls whether dashboard reads from the POS legado or Fullsite POS.
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

/** Check if this client uses Fullsite POS as primary (not the POS legado) */
export function isFullsitePOS(): boolean {
  return getDataSource() === 'fullsite'
}

async function sbFetch(table: string, params: string = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  try {
    const token = await getAuthToken()
    const res = await fetchWithTimeout(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
      },
    }, 10_000)
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
  // If it's an object with a Result array (el sistema anterior pattern)
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

/**
 * FUENTE PRINCIPAL = POS DE FULLSITE. El histórico importado (wansoft_daily) sólo
 * cubre hasta su último día; todo lo posterior sale de pos_orders. Así un restaurante
 * cuyo conector legacy se cayó (o que ya opera en Fullsite) nunca se queda "congelado"
 * en el último día importado.
 */
function continuarConPos(historico: WansoftDaily[], pos: WansoftDaily[]): WansoftDaily[] {
  const ultimo = historico.reduce((m, d) => (d.fecha > m ? d.fecha : m), '')
  return [...historico, ...pos.filter(d => d.fecha > ultimo)].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Días hacia atrás desde hoy hasta `fecha` (el lector de POS mide desde hoy). */
function diasDesde(fecha: string): number {
  return Math.max(0, Math.ceil((Date.now() - new Date(fecha + 'T00:00:00').getTime()) / 86400000)) + 1
}

/** Resumen diario por tenant desde la vista viva ocm_daily (rápido, ~1 fila/día).
 *  Reemplaza la lectura pesada de 90 días de pos_orders CRUDO (~6k órdenes/~6 MB) que
 *  excedía el timeout y tiraba el dashboard al respaldo wansoft_daily congelado. Sólo
 *  totales por día (sin desglose de platillos/meseros). ocm_daily NO tiene location_id,
 *  así que el camino por sucursal sigue en pos_orders. */
async function getOcmDaily(clientSlug: string, days: number): Promise<WansoftDaily[]> {
  if (!clientSlug || !Number.isInteger(days) || days < 0) throw new Error('OCM_REPORT_UNAVAILABLE: invalid scope or period')
  const cutoff = nowMX()
  cutoff.setDate(cutoff.getDate() - days)
  const since = fmtDateMX(cutoff)
  let rows: Record<string, unknown>[]
  try {
    const res = await fetchWithTimeout(`/api/dashboard/ocm-daily?client_id=${encodeURIComponent(clientSlug)}&since=${since}`, { cache: 'no-store' }, 15_000)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as { days?: unknown }
    if (!Array.isArray(body.days)) throw new Error('invalid rows')
    rows = body.days as Record<string, unknown>[]
  } catch {
    throw new Error('OCM_REPORT_UNAVAILABLE: incomplete daily read')
  }
  return rows.map(parseRow)
}

export async function getRecentDays(days: number = 30, clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  // Las dos fuentes son independientes. Esperarlas en serie convertía una caída
  // acotada de la vista viva (15 s) + el respaldo histórico (10 s) en hasta 25 s
  // de "Cargando datos...". Arrancarlas juntas conserva el mismo merge y reduce
  // la espera al más lento de ambos lectores.
  let posError: unknown
  // Sin filtro de sucursal: histórico desde ocm_daily (vivo, ~1 fila/día, instantáneo).
  // Con sucursal: ocm_daily no tiene location_id, así que se queda en pos_orders.
  const posRecentRead = locationId
    ? getDashboardFromPosOrders(Math.min(days, 90), clientSlug, locationId)
    : getOcmDaily(clientSlug, Math.min(days, 90))
  const posRecentPromise = posRecentRead.catch(error => { posError = error; return [] as WansoftDaily[] })
  const historicalPromise = sbFetch('wansoft_daily', `select=${WANSOFT_DASHBOARD_SUMMARY_COLUMNS}&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.desc&limit=${days * 2}`)
  const [posRecent, data] = await Promise.all([posRecentPromise, historicalPromise])
  const historicalRows = data as Record<string, unknown>[]
  const wansoftData = dedupeByFecha(historicalRows).slice(0, days).reverse().map(parseRow)
  if (posError && !wansoftData.length) throw posError
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
  let posError: unknown
  // Sin sucursal: lectura CORTA de pos_orders (hoy+ayer, ~150 filas) -> número + detalle
  // del día, rápido. Con sucursal: ventana de 7 días como antes.
  const posData = locationId
    ? await getDashboardFromPosOrders(7, clientSlug, locationId).catch(error => { posError = error; return [] })
    : await getDashboardFromPosOrders(2, clientSlug).catch(error => { posError = error; return [] })
  if (posData.length > 0) return posData[posData.length - 1]
  // Si la lectura corta falló, el NÚMERO del día desde ocm_daily (vivo) antes que el respaldo.
  if (!locationId) {
    const ocm = await getOcmDaily(clientSlug, 2).catch(() => [])
    if (ocm.length > 0) return ocm[ocm.length - 1]
  }
  // Fallback to wansoft_daily
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.desc&limit=5`) as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  if (deduped.length > 0) return parseRow(deduped[0])
  if (posError) throw posError
  return null
}

export async function getDayData(fecha: string, clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily | null> {
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&fecha=eq.${fecha}&ventas_dia=gt.0&order=ventas_dia.desc&limit=5`) as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  if (deduped.length > 0) return parseRow(deduped[0])
  // Sin histórico importado para ese día → el POS de Fullsite.
  const pos = await getDashboardFromPosOrders(diasDesde(fecha), clientSlug, locationId).catch(() => [])
  return pos.find(d => d.fecha === fecha) ?? null
}

export async function getMonthlyData(clientSlug: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', `select=*&client_slug=eq.${clientSlug}${locationFilter(locationId)}&ventas_dia=gt.0&order=fecha.asc&limit=1000`) as Record<string, unknown>[]
  const rows = dedupeByFecha(data).map(parseRow)
  const pos = await getDashboardFromPosOrders(365, clientSlug, locationId).catch(error => {
    if (rows.length === 0) throw error
    return [] as WansoftDaily[]
  })
  return continuarConPos(rows, pos)
}

/**
 * Llama una función fs_* de Postgres con la sesión del usuario. Las fs_* que se abren
 * al navegador validan adentro que el usuario pertenezca al restaurante (fs_puede_leer).
 * Devuelve null si la llamada FALLÓ (no es lo mismo que "no hay datos").
 */
async function sbRpc(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[] | null> {
  try {
    const token = await getAuthToken()
    if (!token || token === SUPABASE_KEY) return null
    const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }, 10_000)
    if (!res.ok) return null
    const body = await res.json()
    return Array.isArray(body) ? body : null
  } catch {
    return null
  }
}

/**
 * Asistencia / horas por día desde el checador y los turnos de Fullsite (fs_asistencia).
 * Shape del legacy wansoft_labor: [{ fecha, data: [{empleado, entrada, salida, horas}] }].
 * null = la lectura falló.
 */
export async function getAsistencia(days: number = 30, clientSlug: string = getActiveClientSlug()) {
  const hoy = nowMX()
  const desde = new Date(hoy); desde.setDate(desde.getDate() - days)
  const rows = await sbRpc('fs_asistencia', { p_client_id: clientSlug, p_desde: fmtDateMX(desde), p_hasta: fmtDateMX(hoy) })
  return rows ? rows.map(r => ({ fecha: String(r.fecha), data: Array.isArray(r.labor) ? r.labor : [] })) : null
}

/**
 * Costo de ventas TEÓRICO por mes (fs_costo_de_ventas): platillos vendidos en el POS ×
 * costo de su ficha técnica. `venta_con_receta` = venta de platillos que sí tienen ficha;
 * el % de food cost se calcula sobre esa venta. null = la lectura falló.
 */
export interface CostoDeVentasMes { mes: string; venta_platillos: number; venta_con_receta: number; costo_teorico: number }
export async function getCostoDeVentas(meses: number = 12, clientSlug: string = getActiveClientSlug()): Promise<CostoDeVentasMes[] | null> {
  const hoy = nowMX()
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1)
  const rows = await sbRpc('fs_costo_de_ventas', { p_client_id: clientSlug, p_desde: fmtDateMX(desde), p_hasta: fmtDateMX(hoy) })
  return rows ? rows.map(r => ({
    mes: String(r.mes),
    venta_platillos: Number(r.venta_platillos) || 0,
    venta_con_receta: Number(r.venta_con_receta) || 0,
    costo_teorico: Number(r.costo_teorico) || 0,
  })) : null
}

/**
 * KPIs por mesero (H&H, pan, postres, 2da bebida, grupos, platillos). FULLSITE PRIMERO:
 * se calculan del POS con fs_meseros_categorias (por restaurante). La tabla legacy
 * wansoft_waiter_categories sólo se consulta si el POS no tiene datos.
 */
export async function getWaiterCategories(days: number = 7, clientSlug: string = getActiveClientSlug()) {
  const hoy = nowMX()
  const desde = new Date(hoy); desde.setDate(desde.getDate() - days)
  const pos = await sbRpc('fs_meseros_categorias', { p_client_id: clientSlug, p_desde: fmtDateMX(desde), p_hasta: fmtDateMX(hoy) })
  if (pos && pos.length > 0) return pos
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
  // Si el histórico ya cubre hasta `to`, no hace falta el POS.
  const ultimo = rows.reduce((m, d) => (d.fecha > m ? d.fecha : m), '')
  if (rows.length > 0 && ultimo >= to) return rows
  // POS reader takes a lookback from today, not the requested interval length.
  // A historical week must not accidentally read only the last seven days.
  const posData = await getDashboardFromPosOrders(diasDesde(from), clientSlug, locationId).catch(error => {
    if (rows.length === 0) throw error
    return [] as WansoftDaily[]
  })
  return continuarConPos(rows, posData.filter(d => d.fecha >= from && d.fecha <= to))
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
      // m.total is an MXN amount
      const mxn = (m.total || 0)
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

// Tablas de agentes con datos de negocio: SIEMPRE aisladas por tenant.
// agent_results/agent_insights llevan client_id (insights con $, ventas, etc.).
// agent_runs NO se incluye aquí: es telemetría operativa (qué agente corrió) sin
// client_id → filtrarla vaciaría el widget de estado. Se auto-inyecta el cliente
// activo salvo que el caller ya pase client_id.
const TENANT_SCOPED_TABLES = new Set(['agent_results', 'agent_insights'])

export async function getDeepTable(table: string, limit: number = 30, filter: string = '') {
  // filter: extra PostgREST query, e.g. 'client_id=eq.amalay' (tenant scoping).
  if (TENANT_SCOPED_TABLES.has(table) && !filter.includes('client_id')) {
    const cid = getActiveClientSlug()
    // Sin cliente activo → no devolver nada (fail-closed, nunca datos de otro tenant).
    filter = `client_id=eq.${encodeURIComponent(cid || '__none__')}${filter ? `&${filter}` : ''}`
  }
  const f = filter ? `&${filter}` : ''
  // Try created_at first (agent_runs, etc.), then updated_at, then no order
  let data: Record<string, unknown>[] = []
  for (const col of ['created_at', 'updated_at']) {
    data = await sbFetch(table, `select=*&order=${col}.desc&limit=${limit}${f}`) as Record<string, unknown>[]
    if (data.length > 0) break
  }
  if (data.length === 0) {
    data = await sbFetch(table, `select=*&limit=${limit}${f}`) as Record<string, unknown>[]
  }
  console.log(`[getDeepTable] ${table}: ${data.length} rows`)
  return data.map(row => ({ ...row, data: parseJsonb(row.data) }))
}

export async function getLatestDeep(table: string): Promise<{ fecha: string; data: unknown; [key: string]: unknown } | null> {
  // Las tablas wansoft_* pertenecen al conector legacy. Un tenant que opera con
  // Fullsite POS no debe caer a esos datos cuando su módulo aún no tiene historia:
  // además de ser engañoso, podía mostrar el último registro de otro restaurante.
  if (table.startsWith('wansoft_') && isFullsitePOS()) return null
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

// ── POS legado Data (35 data types) ────────────────────────────────────

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
  // agent_runs es telemetría operativa (sin client_id) — no lleva datos de negocio.
  const rows = await sbFetch('agent_runs', 'select=agent_id,status,output_summary,trigger_type,created_at&order=created_at.desc&limit=100')
  const map = new Map<string, AgentRun>()
  for (const row of rows as AgentRun[]) {
    if (!map.has(row.agent_id)) {
      map.set(row.agent_id, row)
    }
  }
  return Array.from(map.values())
}

// ── POS Orders fallback (for clients without the POS legado) ─────────────────

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

interface PosDashboardOrder {
  id: string; parent_order_id?: string | null; caja_stream_id?: string | null
  payment_status?: string | null; dia_venta: string; mesa: number; mesero: string; personas: number
  total: number; subtotal: number; iva: number; descuento: number; propina: number
  metodo_pago?: string | null; pagos?: unknown; items?: unknown; status: string; created_at: string
  caja_financial_snapshot?: { payments?: Array<{ payment_id: string; status: string; amount_cents: number; method: string; provider?: string }> }
}
type DashboardPayment = { metodo?: string; monto: number; estado?: string; status?: string }
type DashboardItem = { nombre?: string; precio?: number; cantidad?: number; cancelled?: boolean }
function reportArray<T>(value: unknown): T[] {
  if (value == null) return []
  try {
    const rows: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(rows)) throw new Error('not an array')
    return rows as T[]
  } catch { throw new Error('POS_REPORT_UNAVAILABLE: invalid financial detail') }
}


/** Settled sales by the database's materialized business day (folio migration
 * 20260901180000). Kitchen completion never establishes payment. Legacy split
 * parents marked dividida are not sales; explicit children replace legacy
 * parents, while Caja represents accounts inside its single financial order.
 * This is not a collections ledger: partial accepted payments are not sales.
 * A failed/incomplete read must reject, never return a plausible zero report.
 * Keyset pages avoid server row caps and offset shifts; this is a live cloud
 * projection, not a transactionally frozen X/Z or synchronization receipt. */
export async function getDashboardFromPosOrders(days: number = 30, clientId: string = getActiveClientSlug(), locationId?: string | null): Promise<WansoftDaily[]> {
  if (!clientId || !Number.isInteger(days) || days < 0) throw new Error('POS_REPORT_UNAVAILABLE: invalid scope or period')
  const cutoff = nowMX()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = fmtDateMX(cutoff)
  // Lectura server-side vía /api/dashboard/pos-daily (service_role). Antes esto
  // leía pos_orders DIRECTO desde el navegador con el token de sesión de Supabase,
  // que en el arranque de App Router no está listo a tiempo (getSession() se
  // cuelga, falla conocida). La lectura tronaba y el dashboard caía en silencio a
  // wansoft_daily, muerto desde 2026-09-08 — mostrando datos de hace semanas como
  // si fueran de hoy. Del lado servidor la credencial siempre está (sin carrera de
  // token), y el aislamiento por restaurante lo garantiza requireTenant con la
  // sesión, no un header del cliente. La cookie de sesión same-origin viaja sola,
  // así que aquí no se toca ningún token de Supabase.
  const params = new URLSearchParams({ client_id: clientId, since: cutoffStr })
  if (locationId) params.set('location_id', locationId)
  let all: PosDashboardOrder[]
  try {
    const response = await fetchWithTimeout(`/api/dashboard/pos-daily?${params}`, { cache: 'no-store' }, 15_000)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json() as { orders?: unknown }
    if (!Array.isArray(body.orders)) throw new Error('invalid rows')
    all = body.orders as PosDashboardOrder[]
  } catch {
    throw new Error('POS_REPORT_UNAVAILABLE: incomplete order read')
  }
  const parentsWithChildren = new Set(all.map(o => o.parent_order_id).filter(Boolean))
  const cajaParents = new Set(all.filter(o => o.caja_stream_id).map(o => o.id))
  const orders = all.filter(o => {
    if (['cancelada', 'void', 'dividida'].includes(o.status)) return false
    if (o.parent_order_id && cajaParents.has(o.parent_order_id)) return false
    if (!o.caja_stream_id && parentsWithChildren.has(o.id)) return false
    return o.payment_status === 'pagada' || (!o.payment_status && !o.caja_stream_id && o.status === 'cerrada')
  })
  for (const o of orders) {
    if (typeof o.total !== 'number' || !Number.isFinite(o.total) || o.total < 0) throw new Error('POS_REPORT_UNAVAILABLE: invalid sale amount')
  }
  if (orders.length === 0) return []

  // Group by date
  const byDate = new Map<string, typeof orders>()
  for (const o of orders) {
    const fecha = o.dia_venta
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
      let pagos: DashboardPayment[]
      if (o.caja_financial_snapshot?.payments) {
        pagos = o.caja_financial_snapshot.payments.filter(p => p.status === 'accepted').map(p => {
          if (!Number.isSafeInteger(p.amount_cents) || p.amount_cents < 0) throw new Error('POS_REPORT_UNAVAILABLE: invalid accepted payment')
          return { metodo: p.method === 'external' ? `external:${p.provider || 'unknown'}` : p.method, monto: p.amount_cents / 100 }
        })
      } else {
        const recorded = reportArray<DashboardPayment>(o.pagos)
        pagos = recorded.filter(p =>
          (!p.estado && !p.status) || p.estado === 'aceptado' || p.status === 'accepted')
        // A legacy explicit method is evidence; absent methods and absent Caja
        // payments cannot be fabricated as cash (or silently classified as card).
        if (!recorded.length && !o.caja_stream_id && o.metodo_pago) pagos = [{ metodo: o.metodo_pago, monto: o.total }]
      }
      for (const p of pagos) {
        if (typeof p.monto !== 'number' || !Number.isFinite(p.monto) || p.monto < 0) throw new Error('POS_REPORT_UNAVAILABLE: invalid payment amount')
        const name = p.metodo || 'Sin identificar'
        const m = name.toLowerCase()
        pagoMap.set(name, (pagoMap.get(name) || 0) + p.monto)
        if (/^(efectivo|cash)$/.test(m)) efectivo += p.monto
        else if (/tarjeta|card|credito|crédito|debito|débito/.test(m) && !m.startsWith('external:')) tarjeta += p.monto
      }
    }
    const pagoMetodos = Array.from(pagoMap.entries())
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)

    // Top platillos from items + group by category
    const itemMap = new Map<string, { total: number; cantidad: number }>()
    const grupoMap = new Map<string, number>()
    for (const o of dayOrders) {
      {
        for (const item of reportArray<DashboardItem>(o.items)) {
          if (!item.nombre || item.cancelled) continue
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
      meseros,
      platillos_top: platillosTop,
      ventas_por_grupo: ventasPorGrupo,
      pago_métodos: pagoMetodos,
      propinas_meseros: propinasMeseros,
      updated_at: new Date().toISOString(),
    })
  }
  return result.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

// ─── Dashboard «Turno» ──────────────────────────────────────────────────────
// Las dos consultas que alimentan la barra de turno y la lista de atención.
// Van aquí y no en un archivo aparte para reusar sbFetch: mismo token, mismo
// timeout de 10s, mismo manejo de error (devolver [] en vez de reventar la
// pantalla completa).

import type { EventoAgente } from '@/lib/atencion'

/**
 * Detecciones de los agentes para el tenant activo.
 *
 * NO se filtra por status en la consulta. El panel de plataforma filtraba por
 * `status=eq.open` y reportaba 0 detecciones habiendo 12, porque el único valor
 * que los agentes escriben es 'new'. Filtrar por una lista blanca de estados es
 * frágil: se filtra por lo que YA NO importa (resuelto, descartado) en
 * `desdeEventos`, que es una lista negra y falla del lado seguro.
 */
export async function getDeteccionesAgentes(
  clientSlug: string = getActiveClientSlug(),
): Promise<EventoAgente[]> {
  const rows = await sbFetch(
    'agent_events',
    `select=id,severity,title,explanation,suggested_action,estimated_value,confidence,status,created_at,expires_at,type` +
      `&client_id=eq.${encodeURIComponent(clientSlug)}&order=created_at.desc&limit=40`,
  )
  return rows as EventoAgente[]
}

export interface TurnoAbierto {
  id: string
  numero: number | null
  abiertoPor: string | null
  abiertoAt: string | null
  fondoInicial: number | null
}

/** Estado operativo emitido por el servidor: día de negocio + turno abierto. */
export async function getDashboardOperationStatus(
  clientSlug: string = getActiveClientSlug(),
): Promise<DashboardOperationStatus> {
  if (!clientSlug) throw new Error('DASHBOARD_OPERATION_STATUS_UNAVAILABLE: missing client')
  try {
    const res = await fetchWithTimeout(
      `/api/dashboard/operation-status?client_id=${encodeURIComponent(clientSlug)}`,
      { cache: 'no-store' },
      10_000,
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as DashboardOperationStatus
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) throw new Error('invalid business date')
    if (body.turnoAbierto !== null && typeof body.turnoAbierto?.id !== 'string') throw new Error('invalid open turn')
    return body
  } catch {
    throw new Error('DASHBOARD_OPERATION_STATUS_UNAVAILABLE')
  }
}

/** Ritmo real al corte servidor; null cuando no hay muestra o la lectura falla. */
export async function getDashboardIntradayRhythm(
  clientSlug: string = getActiveClientSlug(),
): Promise<IntradayRhythm | null> {
  if (!clientSlug) return null
  try {
    const res = await fetchWithTimeout(
      `/api/dashboard/intraday-rhythm?client_id=${encodeURIComponent(clientSlug)}`,
      { cache: 'no-store' },
      10_000,
    )
    if (!res.ok) return null
    const body = await res.json() as { ritmo?: IntradayRhythm | null }
    if (!body.ritmo || !/^\d{4}-\d{2}-\d{2}$/.test(body.ritmo.businessDate)) return null
    return body.ritmo
  } catch {
    return null
  }
}

/**
 * El turno abierto, si lo hay.
 *
 * Devuelve null cuando no hay ninguno — que es el caso de AMALAY hoy: 17 turnos
 * históricos, cero vivos. La barra usa ese null para decir "sin turno abierto"
 * en vez de pintar ceros.
 */
export async function getTurnoAbierto(
  clientSlug: string = getActiveClientSlug(),
): Promise<TurnoAbierto | null> {
  const rows = (await sbFetch(
    'pos_turnos',
    `select=id,opened_by,opened_at,fondo_inicial&client_id=eq.${encodeURIComponent(clientSlug)}` +
      `&closed_at=is.null&order=opened_at.desc&limit=1`,
  )) as Record<string, unknown>[]
  const t = rows[0]
  if (!t) return null
  return {
    id: String(t.id),
    // El número de turno no existe como columna; se deriva del id sólo si es
    // numérico. Si no, se muestra un guion en vez de inventar un consecutivo.
    numero: /^\d+$/.test(String(t.id)) ? Number(t.id) : null,
    abiertoPor: (t.opened_by as string) || null,
    abiertoAt: (t.opened_at as string) || null,
    fondoInicial: typeof t.fondo_inicial === 'number' ? t.fondo_inicial : null,
  }
}
