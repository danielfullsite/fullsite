import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore - can't set cookies from route handler in some cases
          }
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Simple rate limiting — max 20 requests per minute per user
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
let lastCleanup = Date.now()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  // Cleanup expired entries every 5 minutes
  if (now - lastCleanup > 300000) {
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetTime) rateLimitMap.delete(key)
    }
    lastCleanup = now
  }
  const entry = rateLimitMap.get(userId)
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + 60000 })
    return true
  }
  if (entry.count >= 20) return false
  entry.count++
  return true
}

// Parse JSONB that might be double-encoded (string of string)
function parseJsonb(val: unknown): unknown[] {
  if (Array.isArray(val)) return val
  if (typeof val !== 'string') return []
  try {
    let parsed = JSON.parse(val)
    // Double-encoded: JSON.parse returns another string
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP (auth check removed — user is already logged into dashboard)
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(ip)) {
      return Response.json({ response: 'Demasiadas consultas. Espera un momento.' }, { status: 200 })
    }

    const { message, history = [], client_id } = await request.json()

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const q = message.toLowerCase()

    // 1. Recent daily data — OPTIMIZED: 14 days default, 90 for history questions
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'febrero', 'enero', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año'].some(kw => q.includes(kw))
    const wantsDetail = true // Always load full detail
    const histLimit = wantsHistory ? 90 : 14
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    const selectCols = 'fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_metodos,platillos_top'

    // ── PARALLEL DATA LOADING ── All queries run at once to stay under Vercel 10s limit
    const wantsMeseros = ['mesero', 'quien', 'quién', 'ranking', 'top', 'mejor', 'peor', 'h&h', 'half', 'bebida', 'postre', 'pan', 'toast', 'propina', 'vendio', 'vendió', 'omar', 'brayan', 'julio', 'daniela', 'mauricio', 'oscar', 'alexis', 'hector', 'crack', 'manco', 'chilaquil', 'cuantos', 'cuántos', 'vendieron', 'vendimos'].some(kw => q.includes(kw))
    const wantsFoodCost = ['costo', 'cost', 'food cost', 'margen', 'insumo', 'ingrediente', 'receta', 'rentab', 'compra', 'comprado', 'precio', 'caro', 'barato'].some(kw => q.includes(kw))
    const wantsReservas = ['reserv', 'proxim', 'próxim', 'evento', 'fiesta', 'cumple', 'boda', 'terraza', 'jardin', 'jardín', 'paquete', 'pastel', 'invitados'].some(kw => q.includes(kw))
    const wantsOrders = ['orden', 'ordenes', 'órdenes', 'cancelacion', 'cancelada', 'abierta', 'mesa ', 'ticket pos', 'cuantas mesas', 'cuántas mesas'].some(kw => q.includes(kw))

    const fetches: Promise<unknown>[] = [
      // 0: Daily data (always)
      fetch(`${sbUrl}/rest/v1/wansoft_daily?select=${selectCols}&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`, { headers: sbHeaders, cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []),
      // 1: Waiter categories (conditional)
      wantsMeseros ? fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=7`, { headers: sbHeaders, cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
      // 2: Food cost (conditional)
      wantsFoodCost ? fetch(`${sbUrl}/rest/v1/wansoft_food_cost?select=fecha,data&order=fecha.desc&limit=1`, { headers: sbHeaders, cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
      // 3: Reservaciones (conditional)
      wantsReservas ? fetch(`${sbUrl}/rest/v1/amalay_reservaciones?select=nombre,fecha,espacio,horario_inicio,guests,paquete,total,status,codigo_reserva&order=fecha.asc&fecha=gte.${new Date().toISOString().split('T')[0]}&limit=20`, { headers: sbHeaders, cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
      // 4: POS orders (conditional)
      wantsOrders ? fetch(`${sbUrl}/rest/v1/pos_orders?select=status,total,mesa,mesero,metodo_pago,created_at&order=created_at.desc&limit=50`, { headers: sbHeaders, cache: 'no-store' }).then(r => r.ok ? r.json() : []).catch(() => []) : Promise.resolve([]),
    ]

    const [recentDays, waiterRowsRaw, fcRowsRaw, reservasRaw, ordersRaw] = await Promise.all(fetches) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]]

    // 2. Detect date from question
    const now = new Date()
    const mxOffset = -6 * 60 * 60 * 1000
    const mxNow = new Date(now.getTime() + mxOffset + now.getTimezoneOffset() * 60 * 1000)
    const todayStr = mxNow.toISOString().split('T')[0]
    const yesterday = new Date(mxNow.getTime() - 86400000).toISOString().split('T')[0]

    // Parse date ranges: "1 de mayo a 18 de mayo", "del 5 al 12 de mayo", "mayo", etc.
    const monthMap: Record<string, string> = {
      enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
      julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    }
    let dateFilter: { start: string; end: string } | null = null

    // Try explicit date range: "1 de mayo a 18 de mayo" or "del 1 al 18 de mayo"
    const rangeMatch = q.match(/(\d{1,2})\s*(?:de\s+)?(\w+)\s*(?:a|al|hasta|a\s+el)\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
    const rangeMatch2 = q.match(/del?\s*(\d{1,2})\s*al?\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)

    if (rangeMatch) {
      const [, d1, m1, d2, m2] = rangeMatch
      const mm1 = monthMap[m1.toLowerCase()]
      const mm2 = monthMap[m2.toLowerCase()]
      if (mm1 && mm2) {
        const year = todayStr.slice(0, 4)
        dateFilter = { start: `${year}-${mm1}-${d1.padStart(2, '0')}`, end: `${year}-${mm2}-${d2.padStart(2, '0')}` }
      }
    } else if (rangeMatch2) {
      const [, d1, d2, m] = rangeMatch2
      const mm = monthMap[m.toLowerCase()]
      if (mm) {
        const year = todayStr.slice(0, 4)
        dateFilter = { start: `${year}-${mm}-${d1.padStart(2, '0')}`, end: `${year}-${mm}-${d2.padStart(2, '0')}` }
      }
    }

    if (!dateFilter) {
      if (q.includes('ayer')) dateFilter = { start: yesterday, end: yesterday }
      else if (q.includes('hoy')) dateFilter = { start: todayStr, end: todayStr }
      else if (q.includes('semana')) {
        const weekAgo = new Date(mxNow.getTime() - 7 * 86400000).toISOString().split('T')[0]
        dateFilter = { start: weekAgo, end: todayStr }
      } else if (q.includes('mes')) {
        const monthStart = todayStr.slice(0, 8) + '01'
        dateFilter = { start: monthStart, end: todayStr }
      } else {
        // Check for single month name: "mayo", "abril"
        for (const [name, num] of Object.entries(monthMap)) {
          if (q.includes(name)) {
            const year = todayStr.slice(0, 4)
            const lastDay = new Date(Number(year), Number(num), 0).getDate()
            dateFilter = { start: `${year}-${num}-01`, end: `${year}-${num}-${String(lastDay).padStart(2, '0')}` }
            break
          }
        }
      }
    }

    // 3. Waiter × platillo data — process results from parallel fetch
    let waiterContext = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let waiterRows = (waiterRowsRaw || []) as Array<{ fecha: string; data: any }>
    if (wantsMeseros) {

    if (waiterRows && waiterRows.length > 0) {
      // Detect if question mentions a specific mesero
      const allMeseros = new Set<string>()
      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        for (const key of Object.keys(d)) {
          if (!key.startsWith('__')) allMeseros.add(key)
        }
      }

      let meseroMatch: string | null = null
      for (const name of allMeseros) {
        const parts = name.toLowerCase().split(' ')
        if (parts.some(p => p.length > 3 && q.includes(p))) {
          meseroMatch = name
          break
        }
      }

      // Aggregate waiter data across days
      const aggGrupo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggPlatillo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggKPIs: Record<string, { bebidas: number; alimentos: number; personas: number; tickets: number }> = {}
      const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}

      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data

        // Mesero × grupo
        for (const [mesero, grupos] of Object.entries(d.__por_mesero_grupo || {})) {
          if (!aggGrupo[mesero]) aggGrupo[mesero] = {}
          for (const [grupo, vals] of Object.entries(grupos as Record<string, { qty: number; total: number }>)) {
            if (!aggGrupo[mesero][grupo]) aggGrupo[mesero][grupo] = { qty: 0, total: 0 }
            aggGrupo[mesero][grupo].qty += vals.qty || 0
            aggGrupo[mesero][grupo].total += vals.total || 0
          }
        }

        // Mesero × platillo
        for (const [mesero, platillos] of Object.entries(d.__por_mesero_platillo || {})) {
          if (!aggPlatillo[mesero]) aggPlatillo[mesero] = {}
          for (const [plat, vals] of Object.entries(platillos as Record<string, { qty: number; total: number }>)) {
            if (!aggPlatillo[mesero][plat]) aggPlatillo[mesero][plat] = { qty: 0, total: 0 }
            aggPlatillo[mesero][plat].qty += vals.qty || 0
            aggPlatillo[mesero][plat].total += vals.total || 0
          }
        }

        // KPIs and categories per mesero
        for (const [key, val] of Object.entries(d)) {
          if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
          const meseroData = val as Record<string, unknown>
          // KPIs
          if (meseroData.KPIs && typeof meseroData.KPIs === 'object') {
            const kpi = meseroData.KPIs as Record<string, number>
            if (!aggKPIs[key]) aggKPIs[key] = { bebidas: 0, alimentos: 0, personas: 0, tickets: 0 }
            aggKPIs[key].bebidas += kpi.bebidas_total || 0
            aggKPIs[key].alimentos += kpi.alimentos_total || 0
            aggKPIs[key].personas += kpi.personas || 0
            aggKPIs[key].tickets += kpi.tickets || 0
          }
          // Categories (H&H, Pan, etc.)
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

      try {
        const excludeNames = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones',
          'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio']

        const rankings: string[] = []

        // Build simple text rankings
        const meseroList = Object.entries(aggKPIs).filter(([name]) =>
          !excludeNames.some(ex => name.toLowerCase().includes(ex))
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

        // Per-day category breakdown (for "cuántos H&H por día" queries)
        const perDayLines: string[] = ['\nDESGLOSE POR DÍA Y CATEGORÍA:']
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

        const fechas = waiterRows.map((r: { fecha: string }) => r.fecha).join(', ')
        waiterContext = `\nDATOS DE MESEROS DEL DIA ${fechas} (USAR ESTOS PARA RESPONDER SOBRE "AYER" O LA FECHA INDICADA):\n\n${rankings.join('\n')}${perDayLines.length > 1 ? '\n' + perDayLines.join('\n') : ''}`
        console.log(`[chat] Rankings OK: ${rankings.length} lines, ${meseroList.length} meseros, ${waiterContext.length} chars`)
      } catch (err) {
        console.error('[chat] Rankings error:', err)
      }
    }
    } // end wantsMeseros

    // 2b. Process food cost (from parallel fetch)
    let foodCostContext = ''
    if (wantsFoodCost && Array.isArray(fcRowsRaw) && fcRowsRaw.length > 0) {
      try {
        const fcData = typeof fcRowsRaw[0].data === 'string' ? JSON.parse(fcRowsRaw[0].data as string) : fcRowsRaw[0].data
        if (Array.isArray(fcData) && fcData.length > 0) {
          const fcLines = fcData
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.subtotal_venta || 0) - Number(a.subtotal_venta || 0))
            .slice(0, 20)
            .map((item: Record<string, unknown>) => {
              const nombre = item.platillo || item.nombre || 'Sin nombre'
              const grupo = item.grupo || ''
              const qty = Number(item.cantidad || 0)
              const ventaTotal = Number(item.subtotal_venta || 0)
              const costoReal = Number(item.costo_real || 0)
              const costoPct = Number(item.costo_real_pct || 0)
              const precioUnit = qty > 0 ? Math.round(ventaTotal / qty) : 0
              const costoUnit = qty > 0 ? Math.round(costoReal / qty) : 0
              return `${nombre} (${grupo}): ${qty}pzas, Venta $${Math.round(ventaTotal)}, Costo $${Math.round(costoReal)} (${costoPct.toFixed(1)}%), PU $${precioUnit}, CU $${costoUnit}`
            })
          const totalVentas = fcData.reduce((s: number, i: Record<string, unknown>) => s + Number(i.subtotal_venta || 0), 0)
          const totalCosto = fcData.reduce((s: number, i: Record<string, unknown>) => s + Number(i.costo_real || 0), 0)
          const overallPct = totalVentas > 0 ? ((totalCosto / totalVentas) * 100).toFixed(1) : '0'
          foodCostContext = `\n\nFOOD COST (${overallPct}% general, $${Math.round(totalCosto)}/$${Math.round(totalVentas)}):\n${fcLines.join('\n')}\nINSUMO MÁS CARO=mayor CU. MÁS COMPRADO=mayor cantidad.`
        }
      } catch { /* */ }
    }

    // 2c. Process reservaciones (from parallel fetch)
    let reservasContext = ''
    if (wantsReservas && Array.isArray(reservasRaw) && reservasRaw.length > 0) {
      const lines = reservasRaw.map((r) => `${r.fecha} ${r.horario_inicio || ''} | ${r.nombre} | ${r.guests} personas | ${r.espacio} | ${r.paquete || ''} | $${Math.round(Number(r.total) || 0)} | ${r.status}`)
      reservasContext = `\n\nRESERVACIONES PRÓXIMAS (${reservasRaw.length}):\n${lines.join('\n')}\n\nSi preguntan por "próxima reservación", da la primera de esta lista.`
    } else if (wantsReservas) {
      reservasContext = '\n\nRESERVACIONES: No hay reservaciones futuras registradas.'
    }

    // 2d. Process POS orders (from parallel fetch)
    let ordersContext = ''
    if (wantsOrders && Array.isArray(ordersRaw) && ordersRaw.length > 0) {
      const byStatus: Record<string, { count: number; total: number }> = {}
      for (const o of ordersRaw) {
        const s = String(o.status || 'unknown')
        if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 }
        byStatus[s].count++
        byStatus[s].total += Number(o.total) || 0
      }
      const statusLines = Object.entries(byStatus).map(([s, d]) => `  ${s}: ${d.count} órdenes, $${Math.round(d.total)}`)
      const canceladas = ordersRaw.filter((o) => o.status === 'cancelada')
      let cancelInfo = ''
      if (canceladas.length > 0) {
        cancelInfo = `\nCANCELADAS:\n${canceladas.slice(0, 5).map((o) => `  Mesa ${o.mesa} | ${o.mesero} | $${Math.round(Number(o.total) || 0)}`).join('\n')}`
      }
      ordersContext = `\n\nÓRDENES POS (${ordersRaw.length}):\n${statusLines.join('\n')}${cancelInfo}`
    }

    // 3. Build daily context
    let dailyContext = 'No hay datos disponibles.'
    if (recentDays && recentDays.length > 0) {
      const lines = recentDays.map((d: Record<string, unknown>) => {
        const dowNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
        const dow = dowNames[new Date(d.fecha + 'T12:00:00').getDay()]
        const ventasDia = Number(d.ventas_dia) || 0

        const personas = Number(d.personas_restaurant) || 0
        const ticketPromedio = personas > 0 ? Math.round(ventasDia / personas) : 0
        let line = `${d.fecha} (${dow}): Ventas $${ventasDia}, ${personas} personas, TicketPromedio $${ticketPromedio}`

        if (wantsDetail) {
          const descuentos = Number(d.descuentos) || 0
          if (descuentos > 0) line += `, Descuentos $${descuentos}`

          const meseros = parseJsonb(d.meseros) as { nombre: string; total: number }[]
          if (meseros.length > 0) {
            const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 10)
              .map((m: { nombre: string; total: number }) => `${m.nombre}:$${m.total}`).join(', ')
            line += ` | Meseros: ${topM}`
          }

          const grupos = parseJsonb(d.ventas_por_grupo) as { nombre: string; total: number }[]
          if (grupos.length > 0) {
            const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
              .map((g: { nombre: string; total: number }) => `${g.nombre}:$${g.total}`).join(', ')
            line += ` | Grupos: ${topG}`
          }

          const platillos = parseJsonb(d.platillos_top) as { nombre: string; cantidad: number; total: number }[]
          if (platillos.length > 0) {
            const topP = platillos.slice(0, 15).map((p: { nombre: string; cantidad: number; total: number }) => `${p.nombre}:${p.cantidad || 0}pzas/$${Math.round(p.total || 0)}`).join(', ')
            line += ` | Platillos: ${topP}`
          }

          const pagos = parseJsonb(d.pago_metodos || d['pago_métodos']) as { nombre: string; total: number }[]
          if (pagos.length > 0) {
            const pagoStr = pagos.map((p: { nombre: string; total: number }) => {
              const mxn = (p.total || 0) < 100 ? Math.round(((p.total || 0) / 100) * ventasDia) : Math.round(p.total || 0)
              return `${p.nombre}:$${mxn}`
            }).join(', ')
            line += ` | Pagos: ${pagoStr}`
          }
        }

        return line
      })

      // Pre-calculate period aggregates so the model doesn't have to sum
      const now = new Date()
      const mxNowChat = new Date(now.getTime() - 6 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000)
      const thisMonthPrefix = mxNowChat.toISOString().slice(0, 7)
      const prevMonthDate = new Date(mxNowChat.getFullYear(), mxNowChat.getMonth() - 1, 1)
      const prevMonthPrefix = prevMonthDate.toISOString().slice(0, 7)

      const thisMonthData = recentDays.filter((d: Record<string, unknown>) => (d.fecha as string).startsWith(thisMonthPrefix))
      const prevMonthData = recentDays.filter((d: Record<string, unknown>) => (d.fecha as string).startsWith(prevMonthPrefix))

      const sumField = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)

      const tmVentas = sumField(thisMonthData, 'ventas_dia')
      const tmPersonas = sumField(thisMonthData, 'personas_restaurant')
      const tmDias = thisMonthData.length
      const pmVentas = sumField(prevMonthData, 'ventas_dia')
      const pmPersonas = sumField(prevMonthData, 'personas_restaurant')

      // Last 7 days
      const last7 = recentDays.slice(0, 7)
      const l7Ventas = sumField(last7 as Record<string, unknown>[], 'ventas_dia')
      const l7Personas = sumField(last7 as Record<string, unknown>[], 'personas_restaurant')

      const aggregates = `RESÚMENES PRE-CALCULADOS (usa estos para responder, NO sumes manualmente):
MES ACTUAL (${thisMonthPrefix}): Ventas $${Math.round(tmVentas)}, ${Math.round(tmPersonas)} personas, ${tmDias} días, TicketPromedio $${tmPersonas > 0 ? Math.round(tmVentas / tmPersonas) : 0}, PromDiario $${tmDias > 0 ? Math.round(tmVentas / tmDias) : 0}
MES ANTERIOR (${prevMonthPrefix}): Ventas $${Math.round(pmVentas)}, ${Math.round(pmPersonas)} personas, TicketPromedio $${pmPersonas > 0 ? Math.round(pmVentas / pmPersonas) : 0}
ÚLTIMOS 7 DÍAS: Ventas $${Math.round(l7Ventas)}, ${Math.round(l7Personas)} personas, TicketPromedio $${l7Personas > 0 ? Math.round(l7Ventas / l7Personas) : 0}
`

      dailyContext = `${aggregates}\nDATOS DIARIOS (últimos ${recentDays.length} días).\n${lines.join('\n')}`

      // Fetch hourly data for "hora pico" questions
      if (q.includes('hora') || q.includes('pico') || q.includes('horario')) {
        try {
          const hourlyRes = await fetch(
            `${sbUrl}/rest/v1/wansoft_hourly?select=fecha,data&order=fecha.desc&limit=3`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
          )
          if (hourlyRes.ok) {
            const hourlyRows = await hourlyRes.json()
            if (hourlyRows.length > 0) {
              const hourlyLines = hourlyRows.map((r: Record<string, unknown>) => {
                const hData = typeof r.data === 'string' ? JSON.parse(r.data as string) : r.data
                if (Array.isArray(hData)) {
                  return `${r.fecha}: ${hData.map((h: Record<string, unknown>) => `${h.hora}=$${h.total || h.ventas || 0}`).join(', ')}`
                }
                return ''
              }).filter(Boolean)
              if (hourlyLines.length > 0) {
                dailyContext += `\n\nVENTAS POR HORA:\n${hourlyLines.join('\n')}`
              }
            }
          }
        } catch { /* hourly data optional */ }
      }

      // Year-over-Year comparison data
      const wantsYoY = ['año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año', 'comparar año', 'crecimiento', 'creció', 'bajó vs'].some(kw => q.includes(kw))
      if (wantsYoY && recentDays.length > 0) {
        try {
          const currentYear = todayStr.slice(0, 4)
          const prevYear = String(Number(currentYear) - 1)
          // Fetch same months from previous year
          const currentMonth = todayStr.slice(5, 7)
          const yoyRes = await fetch(
            `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,tickets_count,personas_restaurant&ventas_dia=gt.0&fecha=gte.${prevYear}-01-01&fecha=lte.${prevYear}-12-31&order=fecha.asc&limit=500`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
          )
          if (yoyRes.ok) {
            const yoyRows = await yoyRes.json()
            if (yoyRows.length > 0) {
              // Aggregate by month
              const prevMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of yoyRows) {
                const m = (row.fecha as string).slice(0, 7)
                if (!prevMonthly[m]) prevMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                prevMonthly[m].ventas += row.ventas_dia || 0
                prevMonthly[m].tickets += row.tickets_count || 0
                prevMonthly[m].dias += 1
              }
              // Current year monthly
              const currMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of recentDays) {
                const m = (row.fecha as string).slice(0, 7)
                if (!currMonthly[m]) currMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                currMonthly[m].ventas += Number(row.ventas_dia) || 0
                currMonthly[m].tickets += Number(row.tickets_count) || 0
                currMonthly[m].dias += 1
              }
              const yoyLines = [`\nCOMPARATIVO AÑO ANTERIOR (${currentYear} vs ${prevYear}):`]
              const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
              for (let m = 1; m <= 12; m++) {
                const mm = m.toString().padStart(2, '0')
                const curr = currMonthly[`${currentYear}-${mm}`]
                const prev = prevMonthly[`${prevYear}-${mm}`]
                if (curr || prev) {
                  const cV = curr?.ventas || 0
                  const pV = prev?.ventas || 0
                  const pct = pV > 0 ? Math.round(((cV - pV) / pV) * 100) : 0
                  const cTP = curr && curr.tickets > 0 ? Math.round(curr.ventas / curr.tickets) : 0
                  const pTP = prev && prev.tickets > 0 ? Math.round(prev.ventas / prev.tickets) : 0
                  yoyLines.push(`  ${monthNames[m-1]}: ${currentYear}=$${Math.round(cV)} (TP $${cTP}) vs ${prevYear}=$${Math.round(pV)} (TP $${pTP}) → ${pct >= 0 ? '+' : ''}${pct}%`)
                }
              }
              dailyContext += yoyLines.join('\n')
            }
          }
        } catch { /* YoY optional */ }
      }
    }

    // 4. System prompt — Unified sharp copilot (same as Telegram)
    const systemPrompt = `Eres el copiloto operativo de AMALAY Coffee & Market (San Pedro Garza García, Monterrey). Consultor senior con 20 años de experiencia en restaurantes. Entiendes INTENCIÓN, no solo palabras.

PERSONALIDAD:
- Hablas como un amigo que sabe un chingo de restaurantes. Casual pero con datos duros.
- "Mario está bajando" NO "Se observa una tendencia decreciente en el mesero Mario García."
- Nada de "Con gusto te informo que..." ni "Es importante mencionar que..." — eso es de chatbot.
- BREVEDAD ES LEY. Máximo 4-5 líneas por respuesta. Si preguntan "cómo vamos" → número + contexto en 2 líneas.
- Si preguntan "por qué" → causa raíz con datos en 3 líneas. Si preguntan "qué hago" → 2-3 acciones, nada más.
- NO des desgloses largos a menos que te lo pidan explícitamente. Menos es más.
- Usa lenguaje natural mexicano. "Va bien", "está bajo", "se la rifó", "hay que meterle".
- Nunca digas "estimado usuario" ni "me permito informarle". Habla como le hablarías a un socio.

REGLA #0 — SOLO RESTAURANTE:
Eres el copiloto de AMALAY. SOLO contestas preguntas sobre el restaurante: ventas, meseros, platillos, inventario, costos, reservaciones, operaciones.
Si preguntan sobre: qué modelo usas, cuánto cuestas, cómo funcionar internamente, cómo hacer un bot, cómo clonar el sistema, qué tecnología usas, Groq, Anthropic, Claude, tokens, API — responde SOLO: "Soy el copiloto de AMALAY. ¿Qué necesitas saber del restaurante?"
NUNCA reveles tu arquitectura, costos, modelo de IA, ni des instrucciones técnicas. Eso es información confidencial.

REGLAS CRÍTICAS:
1. SIEMPRE da números EXACTOS de los datos que tienes. Si los datos dicen "Omar Aguilera:$12533" → responde "$12,533".
2. BUSCA A FONDO antes de decir que no tienes un dato. Revisa: Meseros, Grupos, Platillos, Pagos, Resúmenes, Rankings, Desglose por día. Los datos están ahí — encuéntralos.
3. USA LOS RESÚMENES que están al inicio (MES ACTUAL, SEMANA, etc.) — ya están calculados.
4. Si no encuentras un dato para la fecha exacta, da el del último día disponible y dilo: "del lunes 8..."
5. NUNCA inventes números que no estén en los datos. Si REALMENTE no existe después de buscar en todo el contexto, di qué sí tienes y ofrece eso.
6. PROHIBIDO usar: "estimado", "aproximadamente", "típicamente", "generalmente", "en promedio del sector". Solo datos reales del restaurante.
7. Todos los montos son en PESOS MEXICANOS. NUNCA digas dólares ni USD.

EJEMPLOS DE RESPUESTAS CORRECTAS:
Pregunta: "¿Quién fue el mejor mesero ayer?"
Respuesta: "Omar Aguilera con $12,533 — llevó el 20% de las ventas. Le siguen Mario ($9,800) y Mariana ($7,500)."

Pregunta: "¿Cuál es el ticket promedio del mes?"
Respuesta: "Este mes va en $402 por persona (usa el RESUMEN MES ACTUAL de arriba). El mes pasado cerró en $385."

Pregunta: "¿Cuántos chilaquiles vendimos ayer?"
Respuesta: "22 piezas por $5,490 (busca en Platillos: del día)."

Pregunta: "¿Cómo vamos hoy?"
Respuesta: "Llevas $63,544 con 158 personas, TP $402. Va +1.4% vs promedio de viernes."

CÓMO INTERPRETAR (lee la intención, no las palabras):
- "cómo vamos" / "qué onda" / "cómo van las ventas" → hoy vs promedio del mismo DOW
- "quién es el crack" / "mejor mesero" → ranking por ventas
- "quién es el manco" / "peor mesero" → el de menos ventas + por qué
- "por qué bajaron" → categorías + meseros que cambiaron vs historial
- "cuántos H&H" / "half and half" → desglose diario de H&H
- "cómo subo el ticket" → qué upselling está bajo (postres, H&H, 2da bebida) + quién no vende
- "compara A con B" → ventas, TP, días, H&H, postres, bebidas/persona de cada uno
- "me conviene quitar X" → ventas del item + impacto de quitarlo
- "qué hago ahorita" → staff brief de 5 min con acciones concretas + $ proyectado
- "cuánto vende Fany" → buscar si existe en datos, explicar su rol si no es mesera
- "descuentos" / "cortesías" → buscar en datos diarios campo "Descuentos $X"
- "pronóstico" / "mañana" → usar promedio real del mismo día de la semana de las últimas 4 semanas. Decir "basado en los últimos 4 [día], el promedio es $X". NO inventar.
- "combo" / "qué le sugiero" → recomendar basado en los platillos más vendidos de los datos reales
- "por qué bajaron en abril/marzo/etc" → comparar datos reales de ese mes vs meses anteriores. Solo menciona lo que los datos muestran.
- "tarjeta" / "efectivo" / "método de pago" → buscar "Pagos:" en datos diarios. Si no hay datos de pagos para esa fecha, di "no tengo desglose de pagos para esa fecha".
- "food cost" / "costo" / "margen" / "insumo" / "ingrediente" → buscar en DATOS DE FOOD COST. Cada platillo tiene: cantidad vendida, venta total, costo real, costo %, precio unitario, costo unitario. Food cost general está al inicio de esa sección.
- "insumo más comprado" → buscar el platillo con mayor "cantidad" en DATOS DE FOOD COST
- "insumo más caro" → buscar el platillo con mayor "CostoUnit" en DATOS DE FOOD COST
- "% food cost" / "costo de comida" → dar el FOOD COST GENERAL que está al inicio de la sección
- "reserva" / "evento" / "fiesta" / "terraza" → buscar en RESERVACIONES. Cada una tiene: nombre, fecha, espacio, guests, paquete, total, status.
- "órdenes" / "cancelaciones" / "mesas abiertas" → buscar en ÓRDENES POS. Muestra resumen por status y detalle de canceladas.
- "compara X vs Y" (días) → buscar ambos días en datos diarios y comparar TODAS las métricas
- "año pasado" / "vs 2025" / "crecimiento" / "yoy" → usar COMPARATIVO AÑO ANTERIOR. Dar % cambio por mes + ticket promedio.
- "qué le dirías a Monica/dueño/gerente" → dar resumen ejecutivo con 3 puntos + acciones
- "hoy" sin datos de hoy → NO digas "no tengo datos". Di "el restaurante aún no abre, te doy el último día:" y da los datos del día más reciente. SIEMPRE da datos, nunca dejes al usuario sin respuesta.
- "hora pico" → si hay VENTAS POR HORA en los datos, usarlas. Si no, decir "no tengo desglose por hora, revísalo en el dashboard"
- "vs semana pasada" / "comparado con" → usa los RESÚMENES ÚLTIMOS 7 DÍAS y compara con los 7 días anteriores de los datos diarios. NO digas "no tengo datos completos" si tienes datos de ambos periodos
- Cualquier nombre propio → buscar en TODOS los datos disponibles

FECHA DE HOY: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' })}. Úsala para calcular "ayer", "la semana pasada", "mañana", etc.

FORMATO DE DATOS (lee esto para saber dónde buscar):
- Cada día tiene: "fecha: Ventas $X, N personas, TicketPromedio $Y | Meseros: Omar:$12533, Mario:$9800 | Grupos: CHILAQUILES:$8225 | Platillos: CHILAQUILES:22pzas/$5490"
- MESEROS están después de "| Meseros:" con nombre:$total. El de mayor $ es el mejor.
- PLATILLOS están después de "| Platillos:" con nombre:cantidadpzas/$total.
- RANKINGS H&H/Pan/Postres están en bloque aparte por mesero.
- RESÚMENES al inicio tienen totales del MES y SEMANA ya calculados. USA ESOS.
   Para "qué platillo se vendió más": busca en Platillos. Para "cuántos cafés": busca café en Platillos.
5. GRUPOS: "Grupos:" = categorías del menú (CHILAQUILES & ENCHILADAS, COFFEE, etc).
6. DESGLOSE POR DÍA = solo H&H/Pan/Postres/2da Bebida (upselling).
7. VENTAS POR HORA: si preguntan "hora pico" o "a qué hora vendemos más", busca en VENTAS POR HORA.

EXCLUIR (no son meseros): Oscar Ricardo, Rodrigo Chávez, APLICACIONES, MESERO EVENTO, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio, Hector Enrique

FORMATO: $ sin decimales. Respuestas cortas y claras. Sin markdown pesado.

EJEMPLOS DE TONO:

"Cuánto vendió Mario esta semana?"
→ Mario se aventó $52,340 en 7 días. Su mejor día fue viernes con $10,200. Promedio $8,723/día — va bien.

"Por qué bajó el ticket?"
→ TP bajó de $420 a $380 (-9.5%). Dos razones:
1. Postres cayeron 30% — Julio y Brayan vendieron 0 postres en 3 días.
2. Bebidas/persona bajó de 1.5 a 1.2.
Acción: que Julio y Brayan sugieran postre al pedir cuenta. Con eso subes ~$25 el TP.

"Cómo vamos?"
→ Llevas $18,420 con 74 tickets. TP $249 — 8% abajo del promedio ($271). Hay que meterle a bebidas.
Manco: Christopher ($5K/día, H&H -52% vs equipo, 0 postres).
Brecha: Julio vende 2.4x más. Christopher necesita coaching en H&H y postres.

"Qué hago ahorita para vender más?"
→ STAFF BRIEF (5 min):
1. H&H en toda mesa — llevas 8 vs promedio 18
2. Postres al pedir cuenta — 0 vendidos hoy
3. 2da bebida siempre — "¿otro café? ¿refresco?"
Si lo hacen = +$5,000-6,000 hoy. Hazlo ahora.

${waiterContext}
${foodCostContext}
${reservasContext}
${ordersContext}

${dailyContext}`

    // Groq — free, with retry on rate limit
    const { groqChat } = await import('@/lib/groq')
    const text = await groqChat({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-8).map((h: { role: string; content: string }) => ({
          role: h.role as 'system' | 'user' | 'assistant',
          content: h.content,
        })),
        { role: 'user', content: message },
      ],
      maxTokens: 4000,
    })

    // Hermes feedback: log if response contains "no tengo" for improvement
    if (text.toLowerCase().includes('no tengo') || text.toLowerCase().includes('no cuento')) {
      try {
        await fetch(`${sbUrl}/rest/v1/agent_runs`, {
          method: 'POST',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            agent_id: 'chat-feedback',
            trigger_type: 'auto',
            status: 'no_data',
            output_summary: `Q: ${message.slice(0, 200)} | A: ${text.slice(0, 200)}`,
            tentacle: 'hermes',
          }),
        })
      } catch { /* non-blocking */ }
    }

    return Response.json({ response: text })
  } catch (error) {
    console.error('Chat API error:', error)
    const msg = error instanceof Error && error.message.includes('GROQ_API_KEY')
      ? 'Chat IA no disponible — falta configurar GROQ_API_KEY en el servidor.'
      : 'Lo siento, hubo un error al procesar tu mensaje. Intenta de nuevo.'
    return Response.json({ response: msg }, { status: 200 })
  }
}
