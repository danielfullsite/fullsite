import type { WansoftDaily } from './types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sbFetch(table: string, params: string = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
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
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
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
    pago_metodos: parseJsonbField(row.pago_metodos),
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

export async function getRecentDays(days: number = 30): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', `select=*&ventas_dia=gt.0&order=fecha.desc&limit=${days * 2}`) as Record<string, unknown>[]
  const filtered = dedupeByFecha(data).slice(0, days)
  return filtered.reverse().map(parseRow)
}

export async function getLatestDay(): Promise<WansoftDaily | null> {
  // ALWAYS filter ventas_dia>0 to skip null/cierre rows
  const data = await sbFetch('wansoft_daily', 'select=*&ventas_dia=gt.0&order=fecha.desc&limit=5') as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  return deduped.length > 0 ? parseRow(deduped[0]) : null
}

export async function getDayData(fecha: string): Promise<WansoftDaily | null> {
  // Fetch all rows for date, dedup keeps highest ventas
  const data = await sbFetch('wansoft_daily', `select=*&fecha=eq.${fecha}&ventas_dia=gt.0&order=ventas_dia.desc&limit=5`) as Record<string, unknown>[]
  const deduped = dedupeByFecha(data)
  return deduped.length > 0 ? parseRow(deduped[0]) : null
}

export async function getMonthlyData(): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', 'select=*&ventas_dia=gt.0&order=fecha.asc&limit=1000') as Record<string, unknown>[]
  return dedupeByFecha(data).map(parseRow)
}

export async function getWaiterCategories(days: number = 7) {
  return sbFetch('wansoft_waiter_categories', `select=*&order=fecha.desc&limit=${days}`)
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
export async function getDateRange(from: string, to: string): Promise<WansoftDaily[]> {
  const data = await sbFetch(
    'wansoft_daily',
    `select=*&fecha=gte.${from}&fecha=lte.${to}&ventas_dia=gt.0&order=fecha.asc`
  ) as Record<string, unknown>[]
  return dedupeByFecha(data).map(parseRow)
}

// Aggregate payment methods across days
export function aggregatePayments(
  dailyData: WansoftDaily[]
): { nombre: string; total: number }[] {
  const map: Record<string, number> = {}
  for (const day of dailyData) {
    const metodos = parseJsonbField<{ nombre?: string; total?: number }>(day.pago_metodos)
    for (const m of metodos) {
      if (!m.nombre) continue
      map[m.nombre] = (map[m.nombre] || 0) + (m.total || 0)
    }
  }
  return Object.entries(map)
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
}

// ── Deep scraper tables ──────────────────────────────────────────────────

function parseJsonb(val: unknown): unknown {
  if (!val) return null
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
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
export async function getWansoftData(dataKey: string, clientId: string = 'amalay') {
  const data = await sbFetch('wansoft_data', `select=fecha,data&client_id=eq.${clientId}&data_key=eq.${dataKey}&order=fecha.desc&limit=1`) as Record<string, unknown>[]
  if (data.length === 0) return null
  return { fecha: data[0].fecha as string, data: parseJsonb(data[0].data) }
}

// Get multiple days of wansoft_data
export async function getWansoftDataRange(dataKey: string, days: number = 30, clientId: string = 'amalay') {
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
