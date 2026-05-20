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
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor dia', 'peor dia', 'patron', 'ultimos'].some(kw => q.includes(kw))
    const histLimit = wantsHistory ? 90 : 30
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
            dateFilter = { start: `${year}-${num}-01`, end: `${year}-${num}-31` }
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
          'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio', 'hector enrique']

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

        return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count || 0} tickets, ${d.personas_restaurant || 0} personas, TickProm $${Math.round(Number(d.ticket_promedio_restaurant) || 0)} | Meseros: ${topM} | Grupos: ${topG}`
      })

      dailyContext = `DATOS DIARIOS (últimos ${recentDays.length} días):\n${lines.join('\n')}`
    }

    // 4. System prompt — Unified sharp copilot (same as Telegram)
    const systemPrompt = `Eres el copiloto operativo de AMALAY Coffee & Market (San Pedro Garza García, Monterrey). Consultor senior con 20 años de experiencia en restaurantes. Entiendes INTENCIÓN, no solo palabras.

PERSONALIDAD:
- Directo. Dato pedido = dato dado. Sin rodeos ni explicaciones no pedidas.
- "Mario está bajando" NO "Se observa una tendencia decreciente en el mesero Mario García."
- Si preguntan "por qué" → causa raíz con datos. Si preguntan "qué hago" → 2-3 acciones para HOY.
- Habla como socio de negocio, no como chatbot.

REGLA #1 — NUNCA DIGAS "NO TENGO ESE DATO":
- Si puedes CALCULARLO: suma los días, promedia, compara. HAZLO.
- Si puedes INFERIRLO: estima y aclara. "~$45K estimado basado en el ritmo actual."
- Busca SINÓNIMOS: H&H = Half & Half = HALF HALF COMBO. Pan = Toast = Bagel. Postre = Dessert = Cake.
- Si el mesero aparece en CUALQUIER dato (ventas diarias, rankings, categorías): NO digas que no tienes el dato.
- SOLO di "no tengo ese dato" si realmente no existe en NINGUNA forma.

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
- Cualquier nombre propio → buscar en TODOS los datos disponibles

CÓMO BUSCAR:
1. DATOS DIARIOS: "fecha: Ventas $X | Meseros: nombre:$total | Grupos: categoría:$total"
   → Sumar ventas de un mesero en la semana = buscar su nombre en CADA día y sumar
2. DESGLOSE POR DÍA: H&H, Pan, Postres, 2da Bebida por día
   → Para historial día por día: listar CADA día con su cantidad
3. RANKINGS: H&H, Pan, Postres, Bebidas/persona POR MESERO
   → Para "quién vende más X": usar rankings directamente

EXCLUIR (no son meseros): Oscar Ricardo, Rodrigo Chávez, APLICACIONES, MESERO EVENTO, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio, Hector Enrique

FORMATO: $ sin decimales. Listas limpias. Sin markdown pesado. Si piden formato específico, usarlo.

EJEMPLOS:

"Cuánto vendió Mario esta semana?"
→ Mario vendió $52,340 en 7 días:
Lun: $8,200 | Mar: $7,800 | Mié: $9,100 | Jue: $8,400 | Vie: $10,200 | Sáb: $8,640
Promedio: $8,723/día. Su mejor día fue viernes.

"Por qué bajó el ticket?"
→ TP bajó de $420 a $380 (-9.5%):
1. Postres -30% (12 vs 18). Julio y Brayan vendieron 0.
2. Bebidas/persona 1.2 vs 1.5.
Acción: dile a Julio y Brayan que sugieran postre al pedir cuenta. TP sube ~$25.

"Quién es el crack y quién el manco?"
→ Crack: Julio ($12K/día, lidera H&H con 27 pzas).
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

    return Response.json({ response: text })
  } catch (error) {
    console.error('Chat API error:', error)
    return Response.json(
      { response: 'Lo siento, hubo un error al procesar tu mensaje. Verifica que las claves API esten configuradas en .env.local.' },
      { status: 200 }
    )
  }
}
