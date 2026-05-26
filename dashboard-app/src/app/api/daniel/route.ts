import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// Rate limiting — 15 req/min
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + 60000 })
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
      return new Response('Rate limit', { status: 429 })
    }

    const { message, history = [] } = await request.json()
    if (!message || typeof message !== 'string') {
      return new Response('Mensaje requerido', { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'PLACEHOLDER_NEEDS_REAL_KEY') {
      return new Response('Configura ANTHROPIC_API_KEY', { status: 500 })
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const q = message.toLowerCase()

    // ═══ DATA FETCHING (same as chat route) ═══

    // 1. Daily data
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'tendencia', 'semana', 'mes', 'comparar', 'año pasado', 'yoy'].some(kw => q.includes(kw))
    const histLimit = wantsHistory ? 90 : 30
    const dailyRes = await fetch(
      `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_métodos,platillos_top,propinas_total&ventas_dia=gt.0&order=fecha.desc&limit=${histLimit}`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    const recentDays = dailyRes.ok ? await dailyRes.json() : []

    // 2. Date detection
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
    const rangeMatch = q.match(/(\d{1,2})\s*(?:de\s+)?(\w+)\s*(?:a|al|hasta)\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
    const rangeMatch2 = q.match(/del?\s*(\d{1,2})\s*al?\s*(\d{1,2})\s*(?:de\s+)?(\w+)/)
    if (rangeMatch) {
      const [, d1, m1, d2, m2] = rangeMatch
      const mm1 = monthMap[m1.toLowerCase()], mm2 = monthMap[m2.toLowerCase()]
      if (mm1 && mm2) dateFilter = { start: `${todayStr.slice(0,4)}-${mm1}-${d1.padStart(2,'0')}`, end: `${todayStr.slice(0,4)}-${mm2}-${d2.padStart(2,'0')}` }
    } else if (rangeMatch2) {
      const [, d1, d2, m] = rangeMatch2
      const mm = monthMap[m.toLowerCase()]
      if (mm) dateFilter = { start: `${todayStr.slice(0,4)}-${mm}-${d1.padStart(2,'0')}`, end: `${todayStr.slice(0,4)}-${mm}-${d2.padStart(2,'0')}` }
    }
    if (!dateFilter) {
      if (q.includes('ayer')) dateFilter = { start: yesterday, end: yesterday }
      else if (q.includes('hoy')) dateFilter = { start: todayStr, end: todayStr }
      else if (q.includes('semana')) dateFilter = { start: new Date(mxNow.getTime() - 7 * 86400000).toISOString().split('T')[0], end: todayStr }
      else if (q.includes('mes')) dateFilter = { start: todayStr.slice(0, 8) + '01', end: todayStr }
      else {
        for (const [name, num] of Object.entries(monthMap)) {
          if (q.includes(name)) {
            const y = todayStr.slice(0, 4)
            const lastDay = new Date(Number(y), Number(num), 0).getDate()
            dateFilter = { start: `${y}-${num}-01`, end: `${y}-${num}-${String(lastDay).padStart(2, '0')}` }
            break
          }
        }
      }
    }

    // 3. Waiter categories
    let waiterContext = ''
    let wcParams = 'select=fecha,data&order=fecha.desc'
    if (dateFilter) {
      wcParams += dateFilter.start === dateFilter.end ? `&fecha=eq.${dateFilter.start}` : `&and=(fecha.gte.${dateFilter.start},fecha.lte.${dateFilter.end})`
    } else {
      wcParams += '&limit=7'
    }
    const wcRes = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?${wcParams}`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store',
    })
    const waiterRows = wcRes.ok ? await wcRes.json() : []
    if (waiterRows.length === 0 && dateFilter) {
      const fb = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store',
      })
      const fbRows = fb.ok ? await fb.json() : []
      if (fbRows.length > 0) waiterRows.push(...fbRows)
    }

    if (waiterRows.length > 0) {
      try {
        const excludeNames = ['oscar ricardo', 'rodrigo chávez', 'rodrigo chavez', 'aplicaciones', 'mesero evento', 'fany elizabeth', 'ericka tamara', 'frida vianney', 'jorge antonio', 'hector enrique']
        const aggKPIs: Record<string, { bebidas: number; alimentos: number; personas: number; tickets: number }> = {}
        const aggCats: Record<string, Record<string, { qty: number; total: number }>> = {}

        for (const row of waiterRows) {
          const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
          for (const [key, val] of Object.entries(d)) {
            if (key.startsWith('__') || typeof val !== 'object' || val === null) continue
            const md = val as Record<string, unknown>
            if (md.KPIs && typeof md.KPIs === 'object') {
              const kpi = md.KPIs as Record<string, number>
              if (!aggKPIs[key]) aggKPIs[key] = { bebidas: 0, alimentos: 0, personas: 0, tickets: 0 }
              aggKPIs[key].bebidas += kpi.bebidas_total || 0
              aggKPIs[key].alimentos += kpi.alimentos_total || 0
              aggKPIs[key].personas += kpi.personas || 0
              aggKPIs[key].tickets += kpi.tickets || 0
            }
            for (const [cat, catVal] of Object.entries(md)) {
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

        const meseroList = Object.entries(aggKPIs).filter(([name]) =>
          !excludeNames.some(ex => name.toLowerCase().includes(ex))
        )
        const rankings: string[] = ['RANKING POR MESERO:']
        for (const [m, k] of meseroList) {
          const hh = aggCats[m]?.['H&H']
          const pan = aggCats[m]?.['Pan']
          const post = aggCats[m]?.['Postres']
          const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
          rankings.push(`  ${m}: Beb/persona:${bp}, H&H:${hh?.qty||0}pzas, Pan:${pan?.qty||0}pzas, Postres:${post?.qty||0}pzas`)
        }
        const fechas = waiterRows.map((r: { fecha: string }) => r.fecha).join(', ')
        waiterContext = `\nDATOS MESEROS (${fechas}):\n${rankings.join('\n')}`
      } catch { /* rankings optional */ }
    }

    // 4. Daily context
    let dailyContext = 'No hay datos disponibles.'
    if (recentDays.length > 0) {
      const lines = recentDays.map((d: Record<string, unknown>) => {
        const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros) : [])
        const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((m: { nombre: string; total: number }) => `${m.nombre}:$${m.total}`).join(', ')
        const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? JSON.parse(d.ventas_por_grupo) : [])
        const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
          .map((g: { nombre: string; total: number }) => `${g.nombre}:$${g.total}`).join(', ')
        return `${d.fecha}: Ventas $${d.ventas_dia}, ${d.tickets_count||0} tickets, TP $${Math.round(Number(d.ticket_promedio_restaurant)||0)} | Meseros: ${topM} | Grupos: ${topG}`
      })
      dailyContext = `DATOS DIARIOS (${recentDays.length} dias):\n${lines.join('\n')}`
    }

    // 5. Reservaciones proximas
    let reservasContext = ''
    try {
      const resRes = await fetch(
        `${sbUrl}/rest/v1/amalay_reservaciones?select=codigo_reserva,nombre,fecha,espacio,guests,paquete,total,status&fecha=gte.${todayStr}&order=fecha.asc&limit=10`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
      )
      if (resRes.ok) {
        const reservas = await resRes.json()
        if (reservas.length > 0) {
          reservasContext = '\nRESERVACIONES PROXIMAS:\n' + reservas.map((r: Record<string, unknown>) =>
            `${r.fecha} | ${r.nombre} | ${r.guests} personas | ${r.espacio} | $${r.total} | ${r.status}`
          ).join('\n')
        }
      }
    } catch { /* optional */ }

    // ═══ SYSTEM PROMPT — DANIEL'S PERSONAL AGENT ═══
    const systemPrompt = `Eres el agente personal de Daniel Ramonfaur, fundador de Fullsite. No eres un chatbot generico. Eres su socio de confianza que sabe TODO sobre su negocio, su producto, sus clientes y sus decisiones.

QUIEN ES DANIEL:
- Daniel Ramonfaur Garcia, fundador de Fullsite (POS + IA para restaurantes)
- Basado en Monterrey / San Pedro Garza Garcia, Mexico
- Primer cliente: AMALAY Coffee & Market (duena: Monica), Plaza Duendes, San Pedro
- Estilo: "dale a todo", prefiere accion sobre planeacion, no es developer pero entiende tech
- Vende door-to-door, manda DMs por Instagram (@fullsite.ia)
- Necesita constituir Fullsite como SAS

FULLSITE — EL PRODUCTO:
- POS completo + 26 agentes de IA autonomos
- Precio: $4,999 MXN/mes por sucursal + $4,999 setup
- 60 dias de garantia, sin contrato, mes a mes
- Stack: Next.js 16 + React 19 + Supabase + GitHub Actions + Groq/Claude + Telegram + Cloudflare
- 869+ dias de datos historicos, $70M+ MXN analizados, 181K+ tickets
- 176 unit tests, 14 E2E tests

LOS 26 AGENTES:
1. Daily briefing (7am) 2. Weekly report (Lun 9am) 3. Wansoft query (24/7)
4. Orquestador (24/7) 5. Reservas pendientes (10am) 6. Wansoft staleness (8am)
7. Anomaly detector (2/4/6pm) 8. Close predictor (2/4/6pm) 9. Upselling (2/4/6pm)
10. Kitchen quality (4pm) 11. Table time (4pm) 12. Config validator (7am)
13. Menu engineering (Lun) 14. Staffing optimizer (Lun) 15. Supplier monitor (semanal)
16. Waste detector (semanal) 17. Anti-fraud (Vie) 18. Tips analyzer (Vie)
19. Climate events (diario) 20. Proactive alerts (24/7) 21. Intraday sales (continuo)
22. Menu gap analysis (mensual) 23. Hermes (diario) 24. Speed of service (4pm)
25. Inventory auto-order (9am) 26. POS daily aggregator (3pm+11pm)

PIPELINE DE VENTAS:
- 15 restaurantes prospectados: Casa Benell (Chuy Elizondo, top prospect), Reina (Marco Guerrero), Half & Half (Regina Lozano), Lazaro & Diego (Grupo Costeno) + 11 mas
- Proyecciones: 3 clients = $14,997/mes, 10 = $49,990/mes, 20 = $99,980/mes

AMALAY — EL RESTAURANTE:
- AMALAY Coffee & Market, San Pedro Garza Garcia, Monterrey
- Categorias: Chilaquiles, Eggs & Keto, Coffee, Toast & Bagels, Paninis, Bowls, Smoothies, Pancakes & Waffles, Bakery, Desserts
- Meseros activos: Omar Aguilera, Hector Rodriguez, Brayan Berlanga, Daniela Rico, Julio Cesar Hernandez, Mauricio Rodriguez, Oscar Rios, Alexis Ocampo
- Excluir de rankings: Oscar Ricardo, Rodrigo Chavez, Aplicaciones, Mesero Evento, Fany Elizabeth, Ericka Tamara, Frida Vianney, Jorge Antonio, Hector Enrique

LO QUE SE CONSTRUYO HOY (2026-05-26):
- Landing site completo: 24 paginas HTML con diseño fullsite.mx
- 4 articulos de blog SEO
- Schema markup, sitemap, robots.txt
- WhatsApp flotante en todas las paginas
- Exit-intent popup en homepage
- Paginas de nosotros, integraciones, privacidad, terminos
- Voice agent (este que estas usando)
- Comparativa vs Toast, Wansoft, Soft Restaurant

PENDIENTES:
- Constituir Fullsite como SAS
- Google Cloud OAuth para tentaculo de resenas
- Meta Business + WhatsApp Business API
- Landing premium $50K+ con GSAP/Lenis
- Delete fullsite-sage.vercel.app (viejo deploy)
- CI E2E fix (Playwright browsers en GH Actions)

REGLAS DE VOZ:
- Responde CONCISO. 2-4 oraciones max. Esto es una conversacion hablada.
- Dato pedido = dato dado. Sin rodeos.
- Si preguntan datos de AMALAY, USA los datos reales de abajo.
- No uses markdown, asteriscos ni formato. Solo texto plano natural.
- Tutea a Daniel. Habla como socio de confianza, no como asistente.
- Si no sabes algo, di "no se" en 3 palabras, no en un parrafo.
- Puedes dar opiniones y recomendaciones — eres un socio, no un bot.
- Si Daniel pregunta algo de negocio/estrategia, responde con lo que harias tu.

FECHA: ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Mexico_City' })}

${waiterContext}

${dailyContext}

${reservasContext}`

    // ═══ STREAMING RESPONSE ═══
    const anthropic = new Anthropic({ apiKey })

    const msgs: Anthropic.MessageParam[] = [
      ...history.slice(-10).map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: msgs,
    })

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && 'delta' in event && event.delta.type === 'text_delta') {
              controller.enqueue(new TextEncoder().encode(event.delta.text))
            }
          }
          controller.close()
        } catch (err) {
          controller.error(err)
        }
      },
    })

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked' },
    })
  } catch (error) {
    console.error('Daniel agent error:', error)
    return new Response('Error interno', { status: 500 })
  }
}
