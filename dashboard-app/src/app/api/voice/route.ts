import { NextRequest } from 'next/server'

// Simple rate limiting — max 15 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
let lastCleanup = Date.now()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
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
  if (entry.count >= 15) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    if (!checkRateLimit(ip)) {
      return new Response('Demasiadas consultas. Espera un momento.', { status: 429 })
    }

    const { message, history = [] } = await request.json()

    if (!message || typeof message !== 'string') {
      return new Response('Mensaje requerido', { status: 400 })
    }

    if (!process.env.GROQ_API_KEY && !process.env.GROQ) {
      return new Response('Agrega GROQ_API_KEY para activar el agente de voz.', { status: 200 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const q = message.toLowerCase()

    // 1. Recent daily data — OPTIMIZED: 14 days default, 90 for history questions
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'febrero', 'enero', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año'].some(kw => q.includes(kw))
    const wantsDetail = ['mesero', 'quien', 'quién', 'platillo', 'grupo', 'categoria', 'categoría', 'pago', 'tarjeta', 'efectivo', 'desglose', 'detalle', 'chilaquil', 'cuantos', 'cuántos', 'vendieron', 'vendimos', 'top', 'mejor', 'peor', 'mas vendido', 'más vendido', 'coffee', 'cafe', 'café', 'pancake', 'waffle', 'bowl', 'pizza', 'smoothie', 'frappe', 'jugo'].some(kw => q.includes(kw))
    const histLimit = wantsHistory ? 90 : 14
    // Only fetch heavy JSONB columns when needed — saves ~80% tokens on simple questions
    const selectCols = wantsDetail
      ? 'fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_métodos,platillos_top'
      : 'fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta'
    const dailyRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_daily?select=${selectCols}&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    const recentDays = dailyRes.ok ? await dailyRes.json() : []

    // 2. Detect date from question
    const now = new Date()
    const mxOffset = -6 * 60 * 60 * 1000
    const mxNow = new Date(now.getTime() + mxOffset + now.getTimezoneOffset() * 60 * 1000)
    const todayStr = mxNow.toISOString().split('T')[0]
    const yesterday = new Date(mxNow.getTime() - 86400000).toISOString().split('T')[0]

    const monthMap: Record<string, string> = {
      enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
      julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
    }
    let dateFilter: { start: string; end: string } | null = null

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

    // 3. Waiter x category data — ONLY load when question is about waiters/rankings
    let waiterContext = ''
    const wantsMeseros = ['mesero', 'quien', 'quién', 'ranking', 'top', 'mejor', 'peor', 'h&h', 'half', 'bebida', 'postre', 'pan', 'toast', 'propina'].some(kw => q.includes(kw))

    if (!wantsMeseros) {
      // Skip entirely — saves ~5,000-10,000 tokens per call
    } else {
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
    const waiterRows: Array<{ fecha: string; data: unknown }> = wcRes.ok ? await wcRes.json() : []

    if (waiterRows.length === 0 && dateFilter) {
      const fallbackRes = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
        cache: 'no-store',
      })
      const fallbackRows = fallbackRes.ok ? await fallbackRes.json() : []
      if (fallbackRows.length > 0) waiterRows.push(...fallbackRows)
    }

    if (waiterRows && waiterRows.length > 0) {
      const aggGrupo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggPlatillo: Record<string, Record<string, { qty: number; total: number }>> = {}
      const aggKPIs: Record<string, { bebidas: number; alimentos: number; personas: number; tickets: number }> = {}
      const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}

      for (const row of waiterRows) {
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data

        for (const [mesero, grupos] of Object.entries((d as Record<string, unknown>).__por_mesero_grupo || {})) {
          if (!aggGrupo[mesero]) aggGrupo[mesero] = {}
          for (const [grupo, vals] of Object.entries(grupos as Record<string, { qty: number; total: number }>)) {
            if (!aggGrupo[mesero][grupo]) aggGrupo[mesero][grupo] = { qty: 0, total: 0 }
            aggGrupo[mesero][grupo].qty += vals.qty || 0
            aggGrupo[mesero][grupo].total += vals.total || 0
          }
        }

        for (const [mesero, platillos] of Object.entries((d as Record<string, unknown>).__por_mesero_platillo || {})) {
          if (!aggPlatillo[mesero]) aggPlatillo[mesero] = {}
          for (const [plat, vals] of Object.entries(platillos as Record<string, { qty: number; total: number }>)) {
            if (!aggPlatillo[mesero][plat]) aggPlatillo[mesero][plat] = { qty: 0, total: 0 }
            aggPlatillo[mesero][plat].qty += vals.qty || 0
            aggPlatillo[mesero][plat].total += vals.total || 0
          }
        }

        for (const [key, val] of Object.entries(d as Record<string, unknown>)) {
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

      try {
        const excludeNames = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones',
          'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio']

        const rankings: string[] = []
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

        const perDayLines: string[] = ['\nDESGLOSE POR DIA Y CATEGORIA:']
        for (const row of waiterRows) {
          const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
          const dayTotals: Record<string, { qty: number; total: number }> = {}
          for (const [key, val] of Object.entries(d as Record<string, unknown>)) {
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
        waiterContext = `\nDATOS DE MESEROS DEL DIA ${fechas}:\n\n${rankings.join('\n')}${perDayLines.length > 1 ? '\n' + perDayLines.join('\n') : ''}`
      } catch (err) {
        console.error('[voice] Rankings error:', err)
      }
    }
    } // end wantsMeseros

    // 4. Build daily context
    let dailyContext = 'No hay datos disponibles.'
    if (recentDays && recentDays.length > 0) {
      const lines = recentDays.map((d: Record<string, unknown>) => {
        const dowNames = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
        const dow = dowNames[new Date(d.fecha + 'T12:00:00').getDay()]
        const ventasDia = Number(d.ventas_dia) || 0

        // Base line — always included (~40 tokens per day)
        const personas = Number(d.personas_restaurant) || 0
        const ticketPromedio = personas > 0 ? Math.round(ventasDia / personas) : 0
        let line = `${d.fecha} (${dow}): Ventas $${ventasDia}, ${personas} personas, TicketPromedio $${ticketPromedio}`

        // Detail columns only included when wantsDetail is true (~100+ tokens per day saved)
        if (wantsDetail) {
          const descuentos = Number(d.descuentos) || 0
          if (descuentos > 0) line += `, Descuentos $${descuentos}`

          const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros) : [])
          if (meseros.length > 0) {
            const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
              .map((m: { nombre: string; total: number }) => `${m.nombre}:$${m.total}`).join(', ')
            line += ` | Meseros: ${topM}`
          }

          const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? JSON.parse(d.ventas_por_grupo) : [])
          if (grupos.length > 0) {
            const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
              .map((g: { nombre: string; total: number }) => `${g.nombre}:$${g.total}`).join(', ')
            line += ` | Grupos: ${topG}`
          }

          const platillos = Array.isArray(d.platillos_top) ? d.platillos_top : (typeof d.platillos_top === 'string' ? JSON.parse(d.platillos_top) : [])
          if (platillos.length > 0) {
            const topP = platillos.slice(0, 5).map((p: { nombre: string; cantidad: number; total: number }) => `${p.nombre}:${p.cantidad}pzas/$${Math.round(p.total)}`).join(', ')
            line += ` | Platillos: ${topP}`
          }

          const pagos = Array.isArray(d.pago_métodos) ? d.pago_métodos : (typeof d.pago_métodos === 'string' ? JSON.parse(d.pago_métodos) : [])
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

      // Pre-calculate aggregates so the model doesn't have to sum
      const nowV = new Date()
      const mxNowV = new Date(nowV.getTime() - 6 * 60 * 60 * 1000 + nowV.getTimezoneOffset() * 60 * 1000)
      const tmPrefix = mxNowV.toISOString().slice(0, 7)
      const sumF = (arr: Record<string, unknown>[], key: string) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0)
      const tmData = recentDays.filter((d: Record<string, unknown>) => (d.fecha as string).startsWith(tmPrefix))
      const tmV = sumF(tmData, 'ventas_dia')
      const tmP = sumF(tmData, 'personas_restaurant')
      const l7 = recentDays.slice(0, 7)
      const l7V = sumF(l7 as Record<string, unknown>[], 'ventas_dia')
      const l7P = sumF(l7 as Record<string, unknown>[], 'personas_restaurant')

      dailyContext = `RESÚMENES (usa estos, NO sumes):
MES (${tmPrefix}): Ventas $${Math.round(tmV)}, ${Math.round(tmP)} personas, TP $${tmP > 0 ? Math.round(tmV / tmP) : 0}, ${tmData.length} días
SEMANA: Ventas $${Math.round(l7V)}, ${Math.round(l7P)} personas, TP $${l7P > 0 ? Math.round(l7V / l7P) : 0}

DATOS DIARIOS (ultimos ${recentDays.length} dias).\n${lines.join('\n')}`

      // YoY comparison
      const wantsYoY = ['ano pasado', 'ano anterior', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año', 'crecimiento'].some(kw => q.includes(kw))
      if (wantsYoY && recentDays.length > 0) {
        try {
          const currentYear = todayStr.slice(0, 4)
          const prevYear = String(Number(currentYear) - 1)
          const yoyRes = await fetch(
            `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,tickets_count,personas_restaurant&ventas_dia=gt.0&fecha=gte.${prevYear}-01-01&fecha=lte.${prevYear}-12-31&order=fecha.asc&limit=500`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
          )
          if (yoyRes.ok) {
            const yoyRows = await yoyRes.json()
            if (yoyRows.length > 0) {
              const prevMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of yoyRows) {
                const m = (row.fecha as string).slice(0, 7)
                if (!prevMonthly[m]) prevMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                prevMonthly[m].ventas += row.ventas_dia || 0
                prevMonthly[m].tickets += row.tickets_count || 0
                prevMonthly[m].dias += 1
              }
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
                  yoyLines.push(`  ${monthNames[m-1]}: ${currentYear}=$${Math.round(cV)} vs ${prevYear}=$${Math.round(pV)} -> ${pct >= 0 ? '+' : ''}${pct}%`)
                }
              }
              dailyContext += yoyLines.join('\n')
            }
          }
        } catch { /* YoY optional */ }
      }
    }

    // 5. System prompt — voice-optimized
    const systemPrompt = `Eres el copiloto operativo de AMALAY Coffee & Market (San Pedro Garza Garcia, Monterrey). Consultor senior con 20 anos de experiencia en restaurantes.

MEMORIA DEL NEGOCIO:
- AMALAY Coffee & Market, San Pedro Garza Garcia, Monterrey
- Categorias principales: CHILAQUILES & ENCHILADAS, EGGS & KETO, COFFEE, TOAST & BAGELS, PANINIS, BOWLS, SMOOTHIES, PANCAKES & WAFFLES, BAKERY, DESSERTS
- Meseros activos: Omar Aguilera, Hector Rodriguez, Brayan Berlanga, Daniela Rico, Julio Cesar Hernandez, Mauricio Rodriguez, Oscar Rios, Alexis Ocampo, Aldo Ruiz, Mariana Salas, Mario Garcia
- Precio Fullsite: $4,999 MXN/mes por sucursal + $4,999 setup
- 30 agentes de IA operando 24/7
- Briefing diario a las 7 AM por Telegram
- Anti-fraude semanal los viernes
- Menu engineering los lunes
- Prediccion de cierre a las 2/4/6 PM
- Stack: Supabase + GitHub Actions + Groq + Telegram + Cloudflare Workers
- Daniel es el fundador, vende Fullsite a restaurantes en Monterrey
- 869+ dias de datos historicos, $70M+ MXN analizados, 181K+ tickets

CONTEXTO DE VOZ — ESTO ES CRITICO:
- MAXIMO 2 ORACIONES por respuesta. No mas. Es voz, no texto.
- Da el numero y ya. "Ayer vendieron 136 mil, 12% arriba del sabado pasado." FIN.
- NO des desgloses, listas, ni explicaciones largas a menos que te lo pidan.
- NO uses markdown, asteriscos, vinetas ni formato. Solo texto plano.
- Si te preguntan "como vamos" → un numero y una comparacion. Nada mas.
- Si quieren mas detalle, que pregunten. No lo des de una.

REGLA ABSOLUTA — PRECISION DE DATOS:
- SOLO di numeros que esten EXACTAMENTE en los datos que te doy abajo.
- NUNCA inventes, estimes, redondees ni calcules cantidades de platillos.
- Si te preguntan "cuantos chilaquiles vendimos el lunes" → busca la fecha exacta del lunes (MIRA EL DIA DE LA SEMANA entre parentesis), busca "CHILAQUILES" en Platillos, y di el numero EXACTO de "cantidad". Si no esta, di "no tengo el desglose de ese dia".
- Las fechas tienen el dia de la semana: "2026-05-25 (lunes)". USA ESO. No calcules dias.
- Si te preguntan "el lunes pasado" y hoy es martes 2 de junio, el lunes pasado es 2026-06-01. Busca esa fecha en los datos.
- ANTES de responder, verifica que el numero que vas a decir aparece textualmente en los datos. Si no aparece, di "no tengo ese dato exacto".
- NUNCA confundas "total" (pesos MXN) con "cantidad" (piezas). Chilaquiles:29pzas/$8354 = se vendieron 29 piezas por $8,354 pesos.

REGLAS DE BUSQUEDA:
- ANTES de decir "no tengo", revisa TODOS los bloques de datos.
- Si puedes CALCULARLO: suma, promedia, compara. HAZLO sin preguntar.
- Busca SINONIMOS: H&H = Half & Half. Pan = Toast = Bagel. Postre = Dessert.
- SOLO di "no tengo ese dato" como ULTIMO RECURSO.
- Si preguntan "hoy" y no hay datos de hoy: di "aun no hay datos de hoy, te doy el ultimo dia disponible"

EXCLUIR (no son meseros): Oscar Ricardo, Rodrigo Chavez, APLICACIONES, MESERO EVENTO, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio. (Hector Enrique SI es mesero desde 2026-06.)

FECHA DE HOY: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' })}.

${waiterContext}

${dailyContext}`

    // Groq — free, 300 tok/s, with retry on rate limit
    const { groqStream } = await import('@/lib/groq')
    const readable = await groqStream({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-6).map((h: { role: string; content: string }) => ({
          role: h.role as 'system' | 'user' | 'assistant',
          content: h.content,
        })),
        { role: 'user', content: message },
      ],
      maxTokens: 300,
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Voice API error:', error)
    return new Response('Lo siento, hubo un error al procesar tu mensaje.', { status: 500 })
  }
}
