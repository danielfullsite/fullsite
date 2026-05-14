import { supabase } from './supabase'
import type { WansoftDaily } from './types'

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
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .gt('ventas_dia', 0)
    .order('fecha', { ascending: false })
    .limit(days)

  if (error) {
    console.error('Error fetching wansoft_daily:', error)
    return []
  }

  return (data || []).reverse().map(parseRow)
}

export async function getLatestDay(): Promise<WansoftDaily | null> {
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .gt('ventas_dia', 0)
    .order('fecha', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    console.error('Error fetching latest day:', error)
    return null
  }

  return data ? parseRow(data) : null
}

export async function getDayData(fecha: string): Promise<WansoftDaily | null> {
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .eq('fecha', fecha)
    .single()

  if (error) {
    console.error('Error fetching day data:', error)
    return null
  }

  return data ? parseRow(data) : null
}

export async function getMonthlyData(): Promise<WansoftDaily[]> {
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .order('fecha', { ascending: true })

  if (error) {
    console.error('Error fetching monthly data:', error)
    return []
  }

  return (data || []).map(parseRow)
}

export async function getWaiterCategories(days: number = 7) {
  const { data, error } = await supabase
    .from('wansoft_waiter_categories')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(days)

  if (error) {
    console.error('Error fetching waiter categories:', error)
    return []
  }

  return data || []
}

// Aggregate mesero data across multiple days
export function aggregateMeseros(
  dailyData: WansoftDaily[]
): { nombre: string; total: number; dias: number; promedio: number }[] {
  const map: Record<string, { total: number; dias: Set<string> }> = {}

  for (const day of dailyData) {
    const meseros = parseJsonbField<{ nombre?: string; total?: number }>(day.meseros)
    if (meseros.length === 0) continue
    for (const m of meseros) {
      if (!m.nombre || m.nombre === 'MESERO EVENTO') continue
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
