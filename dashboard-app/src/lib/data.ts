import { supabase } from './supabase'
import type { WansoftDaily } from './types'

export async function getRecentDays(days: number = 30): Promise<WansoftDaily[]> {
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(days)

  if (error) {
    console.error('Error fetching wansoft_daily:', error)
    return []
  }

  return (data || []).reverse() as WansoftDaily[]
}

export async function getLatestDay(): Promise<WansoftDaily | null> {
  const { data, error } = await supabase
    .from('wansoft_daily')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    console.error('Error fetching latest day:', error)
    return null
  }

  return data as WansoftDaily
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

  return data as WansoftDaily
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

  return (data || []) as WansoftDaily[]
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
    if (!day.meseros) continue
    const meseros = Array.isArray(day.meseros) ? day.meseros : []
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
    if (!day.ventas_por_grupo) continue
    const grupos = Array.isArray(day.ventas_por_grupo) ? day.ventas_por_grupo : []
    for (const g of grupos) {
      if (!g.nombre) continue
      map[g.nombre] = (map[g.nombre] || 0) + (g.total || 0)
    }
  }

  return Object.entries(map)
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
}
