import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
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

    // 1. Recent daily data (last 14 days)
    const { data: recentDays } = await supabase
      .from('wansoft_daily')
      .select('fecha, ventas_dia, ventas_brutas, descuentos, tickets_count, personas_restaurant, ticket_promedio_restaurant, efectivo, tarjeta, meseros, ventas_por_grupo, pago_metodos')
      .gt('ventas_dia', 0)
      .order('fecha', { ascending: false })
      .limit(14)

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

    // 3. Waiter × platillo data
    let waiterContext = ''
    let waiterQuery = supabase
      .from('wansoft_waiter_categories')
      .select('fecha, data')
      .order('fecha', { ascending: false })

    if (dateFilter) {
      waiterQuery = waiterQuery.gte('fecha', dateFilter.start).lte('fecha', dateFilter.end)
    } else {
      waiterQuery = waiterQuery.limit(7)
    }

    const { data: waiterRows } = await waiterQuery

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

      // Build context based on question
      if (meseroMatch) {
        // Filter search terms from question
        const skipWords = new Set(['cuantos', 'cuántos', 'cuanto', 'cuánto', 'vendio', 'vendió', 'hoy', 'ayer', 'mes', 'semana', 'cada', 'por', 'persona', 'los', 'las', 'del', 'que', 'qué'])
        const searchTerms = q.split(/\s+/).filter(w => w.length > 2 && !skipWords.has(w)).map(w => w.replace(/s$/, ''))

        const platillos = aggPlatillo[meseroMatch] || {}
        const filtered = Object.fromEntries(
          Object.entries(platillos).filter(([name]) =>
            searchTerms.some(t => name.toLowerCase().includes(t))
          )
        )

        const kpi = aggKPIs[meseroMatch]
        const kpiStr = kpi
          ? `KPIs: ${(kpi.bebidas / (kpi.personas || 1)).toFixed(2)} bebidas/persona, ${(kpi.alimentos / (kpi.personas || 1)).toFixed(2)} alimentos/persona, ${kpi.tickets} tickets, ${kpi.personas} personas`
          : ''

        const cats = aggCats[meseroMatch]
        const catsStr = cats
          ? Object.entries(cats).map(([c, v]) => `${c}: ${v.qty} pzas ($${v.total.toLocaleString()})`).join(', ')
          : ''

        const platStr = Object.keys(filtered).length > 0
          ? JSON.stringify(filtered)
          : JSON.stringify(Object.fromEntries(Object.entries(platillos).sort((a, b) => b[1].qty - a[1].qty).slice(0, 20)))

        const fechas = waiterRows.map(r => r.fecha).join(', ')
        waiterContext = `\nDATOS DE ${meseroMatch} (fechas: ${fechas}):\n${kpiStr}\nCategorias: ${catsStr}\nPlatillos: ${platStr}`
      } else {
        // All meseros KPIs
        const allKPIs = Object.entries(aggKPIs)
          .map(([m, k]) => `${m}: ${(k.bebidas / (k.personas || 1)).toFixed(2)} beb/persona, ${k.tickets} tickets, ${k.personas} personas`)
          .join('\n')
        if (allKPIs) waiterContext = `\nKPIs POR MESERO (${waiterRows.length} dias):\n${allKPIs}`
      }
    }

    // 3. Build daily context
    let dailyContext = 'No hay datos disponibles.'
    if (recentDays && recentDays.length > 0) {
      const lines = recentDays.map(d => {
        const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros) : [])
        const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((m: { nombre: string; total: number }) => `${m.nombre}:$${m.total}`).join(', ')

        const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? JSON.parse(d.ventas_por_grupo) : [])
        const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((g: { nombre: string; total: number }) => `${g.nombre}:$${g.total}`).join(', ')

        return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count || 0} tickets, ${d.personas_restaurant || 0} personas, TickProm $${Math.round(d.ticket_promedio_restaurant || 0)} | Meseros: ${topM} | Grupos: ${topG}`
      })

      dailyContext = `DATOS DIARIOS (ultimos ${recentDays.length} dias):\n${lines.join('\n')}`
    }

    // 4. System prompt
    const systemPrompt = `Eres el asistente de datos de AMALAY Coffee & Market (San Pedro Garza García, MX).

REGLA #1: Responde SOLO lo que se pregunta. Sin explicaciones extra.
REGLA #2: Usa los datos del contexto TAL CUAL. No recalcules.
REGLA #3: Formato corto. Sin markdown. Maximo 5 lineas para preguntas simples.
REGLA #4: Montos en MXN con $.
REGLA #5: EXCLUYE de rankings de meseros: Oscar Ricardo, Rodrigo Chávez, APLICACIONES, MESERO EVENTO (cajeros), Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio (Market).
REGLA #6: Para KPIs (bebidas_por_persona, etc.) usa los datos precalculados, NUNCA recalcules.
REGLA #7: Si no tienes el dato, di "No tengo ese dato" y punto.

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
      max_tokens: 1024,
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
