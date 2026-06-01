import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
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

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC
    if (!apiKey || apiKey === 'PLACEHOLDER_NEEDS_REAL_KEY') {
      return Response.json(
        { response: 'Agrega ANTHROPIC_API_KEY a .env.local para activar el chat.' },
        { status: 200 }
      )
    }

    const supabase = createServiceClient()
    const q = message.toLowerCase()

    // 1. Recent daily data (use fetch to avoid SDK issues)
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año'].some(kw => q.includes(kw))
    const histLimit = wantsHistory ? 90 : 30
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const dailyRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_métodos,platillos_top&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    const recentDays = dailyRes.ok ? await dailyRes.json() : []

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

    // 3. Waiter × platillo data (use fetch to avoid SDK hanging)
    let waiterContext = ''

    let wcParams = 'select=fecha,data&order=fecha.desc'
    if (dateFilter) {
      if (dateFilter.start === dateFilter.end) {
        wcParams += `&fecha=eq.${dateFilter.start}`
      } else {
        wcParams += `&and=(fecha.gte.${dateFilter.start},fecha.lte.${dateFilter.end})`
      }
    } else {
      wcParams += '&limit=7'
    }

    const wcRes = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?${wcParams}`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      cache: 'no-store',
    })
    const waiterRows = wcRes.ok ? await wcRes.json() : []

    // If no results for specific date, fallback to most recent
    if (waiterRows.length === 0 && dateFilter) {
      const fallbackRes = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        cache: 'no-store',
      })
      const fallbackRows = fallbackRes.ok ? await fallbackRes.json() : []
      if (fallbackRows.length > 0) waiterRows.push(...fallbackRows)
    }

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

    // 3. Build daily context
    let dailyContext = 'No hay datos disponibles.'
    if (recentDays && recentDays.length > 0) {
      const lines = recentDays.map((d: Record<string, unknown>) => {
        const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros) : [])
        const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((m: { nombre: string; total: number }) => `${m.nombre}:$${m.total}`).join(', ')

        const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? JSON.parse(d.ventas_por_grupo) : [])
        const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((g: { nombre: string; total: number }) => `${g.nombre}:$${g.total}`).join(', ')

        const platillos = Array.isArray(d.platillos_top) ? d.platillos_top : (typeof d.platillos_top === 'string' ? JSON.parse(d.platillos_top) : [])
        const topP = platillos.slice(0, 5).map((p: { nombre: string; cantidad: number; total: number }) => `${p.nombre}:${p.cantidad}pzas/$${Math.round(p.total)}`).join(', ')

        const descuentos = Number(d.descuentos) || 0

        const pagos = Array.isArray(d.pago_métodos) ? d.pago_métodos : (typeof d.pago_métodos === 'string' ? JSON.parse(d.pago_métodos) : [])
        const pagoStr = pagos.map((p: { nombre: string; total: number }) => `${p.nombre}:$${Math.round(p.total)}`).join(', ')

        return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count || 0} tickets, ${d.personas_restaurant || 0} personas, TickProm $${Math.round(Number(d.ticket_promedio_restaurant) || 0)}${descuentos > 0 ? ', Descuentos $' + descuentos : ''}${pagoStr ? ' | Pagos: ' + pagoStr : ''} | Meseros: ${topM} | Grupos: ${topG}${topP ? ' | Platillos: ' + topP : ''}`
      })

      dailyContext = `DATOS DIARIOS (últimos ${recentDays.length} días).
CADA LÍNEA TIENE: fecha, Ventas, tickets, personas, TickProm, Descuentos, Pagos (tarjeta/efectivo/transferencia), Meseros (nombre:$venta), Grupos (categoría:$venta), Platillos (nombre:cantidad:$venta).
BUSCA EN TODOS ESTOS CAMPOS antes de decir "no tengo".\n${lines.join('\n')}`

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
                currMonthly[m].ventas += row.ventas_dia || 0
                currMonthly[m].tickets += row.tickets_count || 0
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

REGLA #1 — PROHIBIDO DECIR "NO TENGO ESE DATO":
- ANTES de decir "no tengo", revisa TODOS los bloques de datos: Meseros, Grupos, Platillos, Pagos, Descuentos, Rankings, Desglose.
- Si puedes CALCULARLO: suma, promedia, compara. HAZLO sin preguntar.
- Si puedes INFERIRLO: estima y di "~estimado basado en..." No pidas permiso para estimar.
- Si puedes APROXIMARLO del sector: "los cafés manejan ~13% food cost" es mejor que "no tengo ese dato".
- Busca SINÓNIMOS: H&H = Half & Half = HALF HALF COMBO. Pan = Toast = Bagel. Postre = Dessert. Tarjeta = crédito = débito.
- "Pagos:" en los datos diarios tiene tarjeta/efectivo/transferencia. BÚSCALOS.
- Si el dato NO existe para una fecha específica, busca la fecha más cercana y di "del [fecha]: ..."
- Si preguntan "hoy" y no hay datos de hoy: di "aún no hay datos de hoy (el sync corre cada 30 min). Del último día disponible: ..."
- SOLO di "no tengo ese dato" como ÚLTIMO RECURSO después de buscar en TODOS los bloques.

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
- "pronóstico" / "mañana" → proyectar basado en historial del mismo DOW + tendencia
- "combo" / "qué le sugiero" → recomendar basado en los platillos más vendidos + margen
- "por qué bajaron en abril/marzo/etc" → considerar factores externos: Semana Santa (abril), vacaciones (julio-agosto), Buen Fin (noviembre), temporada de calor (mayo-sep en MTY), competencia nueva, cierres viales. Si no hay dato exacto, menciona los factores más probables del sector.
- "tarjeta" / "efectivo" / "método de pago" → buscar "Pagos:" en datos diarios. Si no hay datos de pagos para esa fecha, ESTIMA: "En restaurantes como AMALAY típicamente 55-65% tarjeta, 30-35% efectivo, 5-10% transferencia/apps." NO digas "no tengo".
- "food cost" / "costo" / "margen" → estimar: café ~15% food cost, chilaquiles ~25%, postres ~30%. Si no hay dato exacto, dar estimado del sector.
- "compara X vs Y" (días) → buscar ambos días en datos diarios y comparar TODAS las métricas
- "año pasado" / "vs 2025" / "crecimiento" / "yoy" → usar COMPARATIVO AÑO ANTERIOR. Dar % cambio por mes + ticket promedio.
- "qué le dirías a Monica/dueño/gerente" → dar resumen ejecutivo con 3 puntos + acciones
- "hoy" sin datos de hoy → decir "el restaurante aún no abre o no hay datos de hoy, te doy el último día disponible"
- Cualquier nombre propio → buscar en TODOS los datos disponibles

FECHA DE HOY: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' })}. Úsala para calcular "ayer", "la semana pasada", "mañana", etc.

CÓMO BUSCAR:
1. DATOS DIARIOS: "fecha: Ventas $X | Meseros: nombre:$total | Grupos: categoría:$total"
   → MESEROS: cada día lista TODOS los meseros con su venta. Busca el nombre y SUMA.
   → GRUPOS: cada día lista TODAS las categorías (CHILAQUILES & ENCHILADAS, COFFEE, etc). Busca ahí.
   → Para "mejor mesero de ayer": busca la fecha de ayer y mira qué mesero tiene más $.
2. DESGLOSE POR DÍA: H&H, Pan, Postres, 2da Bebida por día (del waiter_categories)
   → Estas son SOLO las categorías de upselling, NO todas las categorías del menú.
   → Chilaquiles NO aparecen aquí — búscalos en "Grupos:" de los datos diarios.
3. RANKINGS: H&H, Pan, Postres, Bebidas/persona POR MESERO
   → Para "quién vende más X": usar rankings directamente
4. PLATILLOS: "Platillos:" en datos diarios = top platillos INDIVIDUALES con cantidad y monto.
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

${dailyContext}`

    const anthropic = new Anthropic({ apiKey })

    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-8).map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: systemPrompt,
      messages,
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

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
    return Response.json(
      { response: 'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API esten configuradas en .env.local.' },
      { status: 200 }
    )
  }
}
