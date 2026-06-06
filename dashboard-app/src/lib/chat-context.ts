/**
 * Chat context-building logic extracted from api/chat/route.ts
 * for testability. These functions assemble the data context
 * that feeds INTO the LLM — they do NOT call the LLM.
 */

// --- Date parsing ---

const monthMap: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
}

export interface DateFilter {
  start: string
  end: string
}

/**
 * Parse a user question into a date filter.
 * Returns null if no date signal is found.
 */
export function parseDateFilter(q: string, todayStr: string): DateFilter | null {
  const lower = q.toLowerCase()
  const yesterday = (() => {
    const d = new Date(todayStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().split('T')[0]
  })()

  // Explicit range: "1 de mayo a 18 de mayo"
  const rangeMatch = lower.match(/(\d{1,2})\s*(?:de\s+)?(\w+)\s*(?:a|al|hasta|a\s+el)\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
  const rangeMatch2 = lower.match(/del?\s*(\d{1,2})\s*al?\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)

  if (rangeMatch) {
    const [, d1, m1, d2, m2] = rangeMatch
    const mm1 = monthMap[m1.toLowerCase()]
    const mm2 = monthMap[m2.toLowerCase()]
    if (mm1 && mm2) {
      const year = todayStr.slice(0, 4)
      return { start: `${year}-${mm1}-${d1.padStart(2, '0')}`, end: `${year}-${mm2}-${d2.padStart(2, '0')}` }
    }
  } else if (rangeMatch2) {
    const [, d1, d2, m] = rangeMatch2
    const mm = monthMap[m.toLowerCase()]
    if (mm) {
      const year = todayStr.slice(0, 4)
      return { start: `${year}-${mm}-${d1.padStart(2, '0')}`, end: `${year}-${mm}-${d2.padStart(2, '0')}` }
    }
  }

  if (lower.includes('ayer')) return { start: yesterday, end: yesterday }
  if (lower.includes('hoy')) return { start: todayStr, end: todayStr }
  if (lower.includes('semana')) {
    const d = new Date(todayStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - 7)
    return { start: d.toISOString().split('T')[0], end: todayStr }
  }
  if (/\bmes\b/.test(lower)) {
    return { start: todayStr.slice(0, 8) + '01', end: todayStr }
  }

  // Single month name
  for (const [name, num] of Object.entries(monthMap)) {
    if (lower.includes(name)) {
      const year = todayStr.slice(0, 4)
      const lastDay = new Date(Number(year), Number(num), 0).getDate()
      return { start: `${year}-${num}-01`, end: `${year}-${num}-${String(lastDay).padStart(2, '0')}` }
    }
  }

  return null
}

// --- Daily context building ---

export interface DailyRow {
  fecha: string
  ventas_dia?: number
  ventas_brutas?: number
  descuentos?: number
  tickets_count?: number
  personas_restaurant?: number
  ticket_promedio_restaurant?: number
  efectivo?: number
  tarjeta?: number
  meseros?: Array<{ nombre: string; total: number }> | string
  ventas_por_grupo?: Array<{ nombre: string; total: number }> | string
  pago_métodos?: Array<{ nombre: string; total: number }> | string
  platillos_top?: Array<{ nombre: string; cantidad?: number; total: number }> | string
}

function parseJsonArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Build the daily context string from an array of wansoft_daily rows.
 * This is the block injected into the system prompt under "DATOS DIARIOS".
 */
export function buildDailyContext(recentDays: DailyRow[]): string {
  if (!recentDays || recentDays.length === 0) {
    return 'No hay datos disponibles.'
  }

  const lines = recentDays.map((d) => {
    const meseros = parseJsonArray<{ nombre: string; total: number }>(d.meseros)
    const topM = meseros.sort((a, b) => b.total - a.total).slice(0, 5)
      .map((m) => `${m.nombre}:$${m.total}`).join(', ')

    const grupos = parseJsonArray<{ nombre: string; total: number }>(d.ventas_por_grupo)
    const topG = grupos.sort((a, b) => b.total - a.total).slice(0, 5)
      .map((g) => `${g.nombre}:$${g.total}`).join(', ')

    const platillos = parseJsonArray<{ nombre: string; cantidad?: number; total: number }>(d.platillos_top)
    const topP = platillos.slice(0, 5).map((p) => `${p.nombre}:${p.cantidad || 0}pzas/$${Math.round(p.total)}`).join(', ')

    const descuentos = Number(d.descuentos) || 0

    const pagos = parseJsonArray<{ nombre: string; total: number }>(d.pago_métodos)
    const pagoStr = pagos.map((p) => `${p.nombre}:$${Math.round(p.total)}`).join(', ')

    const tickets = Number(d.tickets_count) || 0
    const personas = Number(d.personas_restaurant) || 0
    const tpOrden = tickets > 0 ? Math.round(Number(d.ventas_dia) / tickets) : 0
    const tpPersona = personas > 0 ? Math.round(Number(d.ventas_dia) / personas) : 0
    return `${d.fecha}: Ventas $${d.ventas_dia}, ${tickets} tickets, ${personas} personas, PromOrden $${tpOrden}, PromPersona $${tpPersona}${descuentos > 0 ? ', Descuentos $' + descuentos : ''}${pagoStr ? ' | Pagos: ' + pagoStr : ''} | Meseros: ${topM} | Grupos: ${topG}${topP ? ' | Platillos: ' + topP : ''}`
  })

  return `DATOS DIARIOS (últimos ${recentDays.length} días).
CADA LÍNEA TIENE: fecha, Ventas, tickets, personas, TickProm, Descuentos, Pagos (tarjeta/efectivo/transferencia), Meseros (nombre:$venta), Grupos (categoría:$venta), Platillos (nombre:cantidad:$venta).
BUSCA EN TODOS ESTOS CAMPOS antes de decir "no tengo".\n${lines.join('\n')}`
}

// --- Waiter context building ---

export interface WaiterCategoryRow {
  fecha: string
  data: Record<string, unknown> | string
}

const EXCLUDE_NAMES = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones',
  'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio']

/**
 * Build the waiter/mesero context string from wansoft_waiter_categories rows.
 * Includes H&H rankings, 2da Bebida, Bebidas/persona, Pan, Postres, and per-day breakdown.
 */
export function buildWaiterContext(waiterRows: WaiterCategoryRow[]): string {
  if (!waiterRows || waiterRows.length === 0) {
    return ''
  }

  const aggGrupo: Record<string, Record<string, { qty: number; total: number }>> = {}
  const aggPlatillo: Record<string, Record<string, { qty: number; total: number }>> = {}
  const aggKPIs: Record<string, { bebidas: number; alimentos: number; personas: number; tickets: number }> = {}
  const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}

  for (const row of waiterRows) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data

    // Mesero x grupo
    for (const [mesero, grupos] of Object.entries(d.__por_mesero_grupo || {})) {
      if (!aggGrupo[mesero]) aggGrupo[mesero] = {}
      for (const [grupo, vals] of Object.entries(grupos as Record<string, { qty: number; total: number }>)) {
        if (!aggGrupo[mesero][grupo]) aggGrupo[mesero][grupo] = { qty: 0, total: 0 }
        aggGrupo[mesero][grupo].qty += (vals as { qty: number; total: number }).qty || 0
        aggGrupo[mesero][grupo].total += (vals as { qty: number; total: number }).total || 0
      }
    }

    // Mesero x platillo
    for (const [mesero, platillos] of Object.entries(d.__por_mesero_platillo || {})) {
      if (!aggPlatillo[mesero]) aggPlatillo[mesero] = {}
      for (const [plat, vals] of Object.entries(platillos as Record<string, { qty: number; total: number }>)) {
        if (!aggPlatillo[mesero][plat]) aggPlatillo[mesero][plat] = { qty: 0, total: 0 }
        aggPlatillo[mesero][plat].qty += (vals as { qty: number; total: number }).qty || 0
        aggPlatillo[mesero][plat].total += (vals as { qty: number; total: number }).total || 0
      }
    }

    // KPIs and categories per mesero
    for (const [key, val] of Object.entries(d)) {
      if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
      const meseroData = val as Record<string, unknown>
      if (meseroData.KPIs && typeof meseroData.KPIs === 'object') {
        const kpi = meseroData.KPIs as Record<string, number>
        if (!aggKPIs[key]) aggKPIs[key] = { bebidas: 0, alimentos: 0, personas: 0, tickets: 0 }
        aggKPIs[key].bebidas += kpi.bebidas_total || 0
        aggKPIs[key].alimentos += kpi.alimentos_total || 0
        aggKPIs[key].personas += kpi.personas || 0
        aggKPIs[key].tickets += kpi.tickets || 0
      }
      for (const [cat, catVal] of Object.entries(meseroData)) {
        if (cat === 'KPIs' || typeof catVal !== 'object' || catVal === null) continue
        const cv = catVal as Record<string, number>
        if ('qty' in cv) {
          if (!aggCats[key]) aggCats[key] = {}
          if (!aggCats[key][cat]) aggCats[key][cat] = { qty: 0, total: 0 }
          aggCats[key][cat].qty += cv.qty || 0
          aggCats[key][cat].total += cv.total || 0
        }
      }
    }
  }

  const rankings: string[] = []
  const meseroList = Object.entries(aggKPIs).filter(([name]) =>
    !EXCLUDE_NAMES.some(ex => name.toLowerCase().includes(ex))
  )

  rankings.push('RANKING H&H POR MESERO:')
  for (const [m] of meseroList) {
    const hh = aggCats[m]?.['H&H']
    rankings.push(`  ${m}: ${hh ? hh.qty : 0} pzas ($${hh ? Math.round(hh.total) : 0})`)
  }

  rankings.push('\nRANKING 2DA BEBIDA POR MESERO:')
  for (const [m] of meseroList) {
    const bd = aggCats[m]?.['2da Bebida']
    rankings.push(`  ${m}: ${bd ? bd.qty : 0} pzas`)
  }

  rankings.push('\nRANKING BEBIDAS POR PERSONA:')
  for (const [m, k] of meseroList) {
    const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
    rankings.push(`  ${m}: ${bp}`)
  }

  rankings.push('\nRANKING PAN/TOAST/BAGEL POR MESERO:')
  for (const [m] of meseroList) {
    const pan = aggCats[m]?.['Pan']
    rankings.push(`  ${m}: ${pan ? pan.qty : 0} pzas ($${pan ? Math.round(pan.total) : 0})`)
  }

  rankings.push('\nRANKING POSTRES POR MESERO:')
  for (const [m] of meseroList) {
    const post = aggCats[m]?.['Postres']
    if (post && post.qty > 0) rankings.push(`  ${m}: ${post.qty} pzas ($${Math.round(post.total)})`)
  }

  // Per-day category breakdown
  const perDayLines: string[] = ['\nDESGLOSE POR DIA Y CATEGORIA:']
  for (const row of waiterRows) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    const dayTotals: Record<string, { qty: number; total: number }> = {}
    for (const [key, val] of Object.entries(d)) {
      if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
      for (const [cat, catVal] of Object.entries(val as Record<string, unknown>)) {
        if (cat === 'KPIs' || typeof catVal !== 'object' || catVal === null) continue
        const cv = catVal as Record<string, number>
        if ('qty' in cv) {
          if (!dayTotals[cat]) dayTotals[cat] = { qty: 0, total: 0 }
          dayTotals[cat].qty += cv.qty || 0
          dayTotals[cat].total += cv.total || 0
        }
      }
    }
    if (Object.keys(dayTotals).length > 0) {
      const parts = Object.entries(dayTotals)
        .filter(([, v]) => v.qty > 0)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, v]) => `${cat}:${v.qty}pzas/$${Math.round(v.total)}`)
        .join(', ')
      perDayLines.push(`  ${row.fecha}: ${parts}`)
    }
  }

  const fechas = waiterRows.map((r) => r.fecha).join(', ')
  return `\nDATOS DE MESEROS DEL DIA ${fechas} (USAR ESTOS PARA RESPONDER SOBRE "AYER" O LA FECHA INDICADA):\n\n${rankings.join('\n')}${perDayLines.length > 1 ? '\n' + perDayLines.join('\n') : ''}`
}

/**
 * Determine whether the query needs extended history (90 days vs 30).
 */
export function needsExtendedHistory(q: string): boolean {
  const lower = q.toLowerCase()
  const exactWords = ['mes']
  const substrings = ['historial', 'historia', 'abril', 'marzo', 'tendencia', 'mejorado', 'semana',
    'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos',
    'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año']
  return substrings.some(kw => lower.includes(kw)) ||
    exactWords.some(kw => new RegExp(`\\b${kw}\\b`).test(lower))
}
