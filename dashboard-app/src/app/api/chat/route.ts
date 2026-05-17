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

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
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

    const { message, history = [], client_id = 'amalay' } = await request.json()

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'PLACEHOLDER_NEEDS_REAL_KEY') {
      return Response.json(
        { response: 'Agrega ANTHROPIC_API_KEY a .env.local para activar el chat.' },
        { status: 200 }
      )
    }

    const supabase = createServiceClient()
    const q = message.toLowerCase()

    // 1. Recent daily data (use fetch to avoid SDK issues)
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'tendencia', 'mejorado'].some(kw => q.includes(kw))
    const histLimit = wantsHistory ? 90 : 14
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const dailyRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_metodos&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    const recentDays = dailyRes.ok ? await dailyRes.json() : []

    // 2. Detect date from question
    const now = new Date()
    const mxOffset = -6 * 60 * 60 * 1000
    const mxNow = new Date(now.getTime() + mxOffset + now.getTimezoneOffset() * 60 * 1000)
    const todayStr = mxNow.toISOString().split('T')[0]
    const yesterday = new Date(mxNow.getTime() - 86400000).toISOString().split('T')[0]

    let dateFilter: { start: string; end: string } | null = null
    if (q.includes('ayer')) dateFilter = { start: yesterday, end: yesterday }
    else if (q.includes('hoy')) dateFilter = { start: todayStr, end: todayStr }
    else if (q.includes('semana')) {
      const weekAgo = new Date(mxNow.getTime() - 7 * 86400000).toISOString().split('T')[0]
      dateFilter = { start: weekAgo, end: todayStr }
    } else if (q.includes('mes')) {
      const monthStart = todayStr.slice(0, 8) + '01'
      dateFilter = { start: monthStart, end: todayStr }
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

      console.log(`[chat] aggKPIs: ${Object.keys(aggKPIs).length} meseros, aggCats: ${Object.keys(aggCats).length} meseros, waiterRows: ${waiterRows.length}`)

      // Exclude list
      const excludeNames = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones',
        'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio', 'hector enrique']

      // Build pre-calculated rankings (plain text so AI reads them)
      const rankings: string[] = []
      const filteredMeseros: Record<string, { kpis: typeof aggKPIs[string]; cats: Record<string, { qty: number; total: number }> }> = {}

      for (const [name, kpi] of Object.entries(aggKPIs)) {
        if (excludeNames.some(ex => name.toLowerCase().includes(ex))) continue
        filteredMeseros[name] = { kpis: kpi, cats: aggCats[name] || {} }
      }

      // H&H ranking
      rankings.push('RANKING H&H POR MESERO:')
      Object.entries(filteredMeseros)
        .map(([m, d]) => ({ m, qty: d.cats['H&H']?.qty || 0, total: d.cats['H&H']?.total || 0 }))
        .sort((a, b) => b.qty - a.qty)
        .forEach(({ m, qty, total }) => rankings.push(`  ${m}: ${qty} pzas ($${Math.round(total)})`))

      // 2da Bebida ranking
      rankings.push('\nRANKING 2DA BEBIDA POR MESERO:')
      Object.entries(filteredMeseros)
        .map(([m, d]) => ({ m, qty: d.cats['2da Bebida']?.qty || 0 }))
        .sort((a, b) => b.qty - a.qty)
        .forEach(({ m, qty }) => rankings.push(`  ${m}: ${qty} pzas`))

      // Bebidas por persona
      rankings.push('\nRANKING BEBIDAS POR PERSONA:')
      Object.entries(filteredMeseros)
        .map(([m, d]) => ({ m, bp: d.kpis.personas > 0 ? +(d.kpis.bebidas / d.kpis.personas).toFixed(2) : 0 }))
        .sort((a, b) => b.bp - a.bp)
        .forEach(({ m, bp }) => rankings.push(`  ${m}: ${bp}`))

      // Pan ranking
      rankings.push('\nRANKING PAN/TOAST/BAGEL POR MESERO:')
      Object.entries(filteredMeseros)
        .map(([m, d]) => ({ m, qty: d.cats['Pan']?.qty || 0, total: d.cats['Pan']?.total || 0 }))
        .sort((a, b) => b.qty - a.qty)
        .forEach(({ m, qty, total }) => rankings.push(`  ${m}: ${qty} pzas ($${Math.round(total)})`))

      // Postres ranking
      rankings.push('\nRANKING POSTRES POR MESERO:')
      Object.entries(filteredMeseros)
        .map(([m, d]) => ({ m, qty: d.cats['Postres']?.qty || 0, total: d.cats['Postres']?.total || 0 }))
        .sort((a, b) => b.qty - a.qty)
        .filter(({ qty }) => qty > 0)
        .forEach(({ m, qty, total }) => rankings.push(`  ${m}: ${qty} pzas ($${Math.round(total)})`))

      const fechas = waiterRows.map((r: { fecha: string }) => r.fecha).join(', ')
      waiterContext = `\n${rankings.join('\n')}\n\nDatos de ${Object.keys(filteredMeseros).length} meseros (fechas: ${fechas})`
      console.log(`[chat] Rankings: ${rankings.length} lines, filteredMeseros: ${Object.keys(filteredMeseros).length}, waiterContext: ${waiterContext.length} chars`)
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

        return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count || 0} tickets, ${d.personas_restaurant || 0} personas, TickProm $${Math.round(Number(d.ticket_promedio_restaurant) || 0)} | Meseros: ${topM} | Grupos: ${topG}`
      })

      dailyContext = `DATOS DIARIOS (últimos ${recentDays.length} días):\n${lines.join('\n')}`
    }

    // 4. System prompt
    const systemPrompt = `Eres el copiloto operativo de AMALAY Coffee & Market (San Pedro Garza García, MX).

REGLA #1: Responde SOLO lo que se pregunta. Directo al dato.
REGLA #2: Usa los datos del contexto TAL CUAL. No recalcules.
REGLA #3: Formato corto. Maximo 5 lineas para preguntas simples, 20 para rankings.
REGLA #4: Montos en MXN con $ y SIN decimales.
REGLA #5: EXCLUYE SIEMPRE de rankings: Oscar Ricardo, Rodrigo Chávez, APLICACIONES, MESERO EVENTO, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio, Hector Enrique.
REGLA #6: H&H = Half & Half. Los RANKINGS PRECALCULADOS ya están filtrados — úsalos directamente.
REGLA #7: Si no tienes el dato, di "No tengo ese dato" y punto.
REGLA #8: Para historial, muestra TODOS los días disponibles.

${dailyContext}
${waiterContext}`

    const anthropic = new Anthropic({ apiKey })

    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-6).map((h: { role: string; content: string }) => ({
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

    return Response.json({ response: text })
  } catch (error) {
    console.error('Chat API error:', error)
    return Response.json(
      { response: 'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API esten configuradas en .env.local.' },
      { status: 200 }
    )
  }
}
