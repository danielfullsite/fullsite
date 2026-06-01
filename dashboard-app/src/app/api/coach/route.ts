import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  try {
    const { client_id } = await request.json().catch(() => ({} as { client_id?: string }))

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC
    if (!apiKey || apiKey === 'PLACEHOLDER_NEEDS_REAL_KEY') {
      return Response.json({ insights: [] }, { status: 200 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

    // Fetch 90 days of daily data
    const dailyRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,meseros,ventas_por_grupo,propinas_total,pago_métodos&ventas_dia=gt.0&order=fecha.desc&limit=90`,
      { headers, cache: 'no-store' }
    )
    const days = dailyRes.ok ? await dailyRes.json() : []

    if (days.length < 2) {
      return Response.json({ insights: [] })
    }

    // Fetch waiter categories (last 7 days)
    const wcRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=7`,
      { headers, cache: 'no-store' }
    )
    const waiterRows = wcRes.ok ? await wcRes.json() : []

    // Build waiter rankings text
    let waiterText = ''
    if (waiterRows.length > 0) {
      const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggKPIs: Record<string, { bebidas: number; personas: number }> = {}

      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
        for (const [key, val] of Object.entries(d)) {
          if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
          const meseroData = val as Record<string, unknown>
          if (meseroData.KPIs && typeof meseroData.KPIs === 'object') {
            const kpi = meseroData.KPIs as Record<string, number>
            if (!aggKPIs[key]) aggKPIs[key] = { bebidas: 0, personas: 0 }
            aggKPIs[key].bebidas += kpi.bebidas_total || 0
            aggKPIs[key].personas += kpi.personas || 0
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

      const excludeNames = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones',
        'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio']

      const meseroList = Object.keys(aggKPIs).filter(name =>
        !excludeNames.some(ex => name.toLowerCase().includes(ex))
      )

      const lines: string[] = ['RANKINGS ÚLTIMOS 7 DÍAS:']
      lines.push('H&H por mesero:')
      for (const m of meseroList) {
        const hh = aggCats[m]?.['H&H']
        lines.push(`  ${m}: ${hh ? hh.qty : 0} pzas ($${hh ? Math.round(hh.total) : 0})`)
      }
      lines.push('Postres por mesero:')
      for (const m of meseroList) {
        const p = aggCats[m]?.['Postres']
        if (p && p.qty > 0) lines.push(`  ${m}: ${p.qty} pzas ($${Math.round(p.total)})`)
      }
      lines.push('Bebidas/persona por mesero:')
      for (const m of meseroList) {
        const k = aggKPIs[m]
        const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
        lines.push(`  ${m}: ${bp}`)
      }
      waiterText = lines.join('\n')
    }

    // Build daily summary for AI
    const dailySummary = days.slice(0, 30).map((d: Record<string, unknown>) => {
      const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros as string) : [])
      const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
        .map((m: { nombre: string; total: number }) => `${m.nombre}:$${Math.round(m.total)}`).join(', ')
      return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count || 0} tickets, ${d.personas_restaurant || 0} personas, TP $${Math.round(Number(d.ticket_promedio_restaurant) || 0)}, Propinas $${Math.round(Number(d.propinas_total) || 0)} | Meseros: ${topM}`
    }).join('\n')

    // Compute same-DOW averages for today
    const today = days[0]
    const todayDate = new Date(today.fecha + 'T12:00:00')
    const todayDOW = todayDate.getDay()
    const sameDOW = days.filter((d: Record<string, unknown>) => {
      const dt = new Date((d.fecha as string) + 'T12:00:00')
      return dt.getDay() === todayDOW && d.fecha !== today.fecha
    }).slice(0, 4)

    const avgVentas = sameDOW.length > 0 ? sameDOW.reduce((s: number, d: Record<string, unknown>) => s + Number(d.ventas_dia), 0) / sameDOW.length : 0
    const avgTP = sameDOW.length > 0 ? sameDOW.reduce((s: number, d: Record<string, unknown>) => s + Number(d.ticket_promedio_restaurant || 0), 0) / sameDOW.length : 0
    const avgTickets = sameDOW.length > 0 ? sameDOW.reduce((s: number, d: Record<string, unknown>) => s + Number(d.tickets_count || 0), 0) / sameDOW.length : 0

    // Week totals
    const thisWeek = days.slice(0, 7)
    const prevWeek = days.slice(7, 14)
    const sumField = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, d) => s + Number(d[key] || 0), 0)
    const weekVentas = sumField(thisWeek, 'ventas_dia')
    const prevWeekVentas = sumField(prevWeek, 'ventas_dia')
    const weekTP = sumField(thisWeek, 'personas_restaurant') > 0
      ? weekVentas / sumField(thisWeek, 'personas_restaurant') : 0
    const prevWeekTP = sumField(prevWeek, 'personas_restaurant') > 0
      ? prevWeekVentas / sumField(prevWeek, 'personas_restaurant') : 0

    const now = new Date()
    const mxOffset = -6 * 60 * 60 * 1000
    const mxNow = new Date(now.getTime() + mxOffset + now.getTimezoneOffset() * 60 * 1000)
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

    const systemPrompt = `Eres el COACH OPERATIVO de AMALAY Coffee & Market. Tu trabajo es observar los datos del restaurante y dar consejos accionables al dueño. NO eres un chatbot — eres un socio que piensa 24/7 en cómo mejorar el negocio.

TU PERSONALIDAD:
- Directo, sin rodeos. Como un socio que te dice las cosas de frente.
- Positivo cuando hay logros: "Brayan mejoró 15% — lo que le dijiste funcionó."
- Firme cuando algo va mal: "El aguacate se te está yendo. $1,200 más que la semana pasada."
- Siempre termina con una ACCIÓN CONCRETA que el dueño puede hacer HOY.

GENERA EXACTAMENTE 3 INSIGHTS en formato JSON array. Cada insight debe tener:
- "type": "daily" | "weekly" | "alert"
- "title": título corto (max 60 chars)
- "body": 2-3 oraciones con dato concreto + acción sugerida
- "priority": "high" | "medium" | "low"
- "metric": número clave del insight (ej: "-18%", "$1,200", "3 días")

CONTEXTO HOY (${dayNames[mxNow.getDay()]} ${today.fecha}):
- Ventas hoy: $${today.ventas_dia} (promedio ${dayNames[todayDOW]}: $${Math.round(avgVentas)}, ${avgVentas > 0 ? ((Number(today.ventas_dia) / avgVentas - 1) * 100).toFixed(0) + '%' : 'sin data'})
- Tickets hoy: ${today.tickets_count} (promedio: ${Math.round(avgTickets)})
- TP hoy: $${Math.round(Number(today.ticket_promedio_restaurant) || 0)} (promedio: $${Math.round(avgTP)})
- Ventas semana: $${Math.round(weekVentas)} (semana pasada: $${Math.round(prevWeekVentas)}, ${prevWeekVentas > 0 ? ((weekVentas / prevWeekVentas - 1) * 100).toFixed(0) + '%' : ''})
- TP semana: $${Math.round(weekTP)} (semana pasada: $${Math.round(prevWeekTP)})

${waiterText}

DATOS DIARIOS (30 días):
${dailySummary}

REGLAS:
- EXCLUYE de rankings: Oscar Ricardo, Rodrigo Chávez, APLICACIONES, MESERO EVENTO, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio, Hector Enrique
- Montos en MXN con $ sin decimales
- No inventes datos. Si no hay suficiente data para un insight, usa lo que tengas.
- El insight "daily" debe ser algo que el dueño pueda actuar HOY.
- El insight "weekly" debe ser una tendencia o patrón de la semana.
- El insight "alert" debe ser algo que necesita atención (puede ser positivo o negativo).

Responde SOLO con el JSON array, sin markdown ni texto adicional.`

    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Dame los 3 insights más importantes para hoy.' }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'

    // Parse JSON from response
    let insights = []
    try {
      // Try to extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        insights = JSON.parse(jsonMatch[0])
      }
    } catch (e) {
      console.error('[coach] Failed to parse insights:', e, text)
    }

    return Response.json({
      insights,
      today: {
        fecha: today.fecha,
        ventas: Number(today.ventas_dia),
        tickets: Number(today.tickets_count || 0),
        tp: Math.round(Number(today.ticket_promedio_restaurant || 0)),
        avgVentas: Math.round(avgVentas),
        avgTP: Math.round(avgTP),
        weekVentas: Math.round(weekVentas),
        prevWeekVentas: Math.round(prevWeekVentas),
      },
    })
  } catch (error) {
    console.error('Coach API error:', error)
    return Response.json({ insights: [], error: 'Error generating insights' }, { status: 200 })
  }
}
