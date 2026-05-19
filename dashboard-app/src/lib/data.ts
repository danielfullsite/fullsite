import type { WansoftDaily } from './types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sbFetch(table: string, params: string = ''): Promise<unknown[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  })
  if (!res.ok) {
    console.error(`Supabase fetch error: ${res.status} ${res.statusText}`)
    return []
  }
  return res.json()
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
  return {
    ...row,
    meseros: parseJsonbField(row.meseros),
    platillos_top: parseJsonbField(row.platillos_top),
    ventas_por_grupo: parseJsonbField(row.ventas_por_grupo),
    pago_metodos: parseJsonbField(row.pago_metodos),
  } as WansoftDaily
}

export async function getRecentDays(days: number = 30): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', `select=*&order=fecha.desc&limit=${days}`) as Record<string, unknown>[]
  const filtered = data.filter(d => (d.ventas_dia as number) > 0)
  return filtered.reverse().map(parseRow)
}

export async function getLatestDay(): Promise<WansoftDaily | null> {
  const data = await sbFetch('wansoft_daily', 'select=*&order=fecha.desc&limit=5') as Record<string, unknown>[]
  const row = data.find(d => (d.ventas_dia as number) > 0)
  return row ? parseRow(row) : null
}

export async function getDayData(fecha: string): Promise<WansoftDaily | null> {
  const data = await sbFetch('wansoft_daily', `select=*&fecha=eq.${fecha}&limit=1`) as Record<string, unknown>[]
  return data.length > 0 ? parseRow(data[0]) : null
}

export async function getMonthlyData(): Promise<WansoftDaily[]> {
  const data = await sbFetch('wansoft_daily', 'select=*&order=fecha.asc&limit=1000') as Record<string, unknown>[]
  return data.map(parseRow)
}

export async function getWaiterCategories(days: number = 7) {
  return sbFetch('wansoft_waiter_categories', `select=*&order=fecha.desc&limit=${days}`)
}

// Aggregate mesero data across multiple days
const EXCLUDE_STAFF = [
  'mesero evento', 'aplicaciones', 'oscar ricardo', 'rodrigo chávez', 'rodrigo chavez',
  'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio', 'hector enrique',
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
    `select=*&fecha=gte.${from}&fecha=lte.${to}&order=fecha.asc`
  ) as Record<string, unknown>[]
  return data.filter(d => (d.ventas_dia as number) > 0).map(parseRow)
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
  const data = await sbFetch(table, `select=*&order=fecha.desc&limit=${limit}`) as Record<string, unknown>[]
  return data.map(row => ({ ...row, data: parseJsonb(row.data) }))
}

export async function getLatestDeep(table: string): Promise<{ fecha: string; data: unknown; [key: string]: unknown } | null> {
  const data = await sbFetch(table, `select=*&order=fecha.desc&limit=1`) as Record<string, unknown>[]
  if (data.length === 0) return null
  return { ...data[0], fecha: (data[0].fecha as string) || '', data: parseJsonb(data[0].data) }
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
