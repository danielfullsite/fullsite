import { NextRequest } from 'next/server'
import { withPOSAuth } from '@/lib/api-auth'
import { sumarDias } from '@/lib/date-mx'
import { leerContextoDia } from '@/lib/agents/dia-negocio'
import { ventasFullsitePrimero, buildDailyFromOrders } from '@/lib/pos-daily'
import { esDuenoDelHistoricoWansoft } from '@/lib/wansoft-legacy'
import {
  contextoFuentesFallidas, contextoSinVentas, datoTexto, envolverDatos, ETIQUETAS_NO_MESERO,
  fechaLargaEnZona, historialSeguro, horaEnZona, resumenesPrecalculados, diasParaCubrirMesAnterior,
} from '@/lib/chat-context'
import { crearRpc, leerFrescura, textoFrescura } from '@/lib/chat-nativo'

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
  const auth = await withPOSAuth(request)
  if (!auth) return Response.json({ error: 'No autorizado' }, { status: 401 })
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
    // Service key server-side, igual que /api/chat: el tenant ya lo resolvió
    // withPOSAuth (server-side, nunca del cuerpo) y TODA consulta de abajo filtra por
    // él. Con la anon key las lecturas caían al endurecer RLS y el agente de voz
    // contestaba con listas vacías.
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    // Fuentes que NO se pudieron leer: se le dicen al modelo (fallo ≠ vacío).
    const fuentesFallidas: string[] = []

    const q = message.toLowerCase()

    // 1. Recent daily data — OPTIMIZED: 14 days default, 90 for history questions
    const wantsHistory = ['historial', 'historia', 'abril', 'marzo', 'febrero', 'enero', 'tendencia', 'mejorado', 'semana', 'mes', 'comparar', 'compara', 'mejor día', 'peor día', 'patrón', 'últimos', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año'].some(kw => q.includes(kw))
    // Palabras genéricas (no platillos de un restaurante en particular).
    const wantsDetail = ['mesero', 'quien', 'quién', 'platillo', 'producto', 'grupo', 'categoria', 'categoría', 'pago', 'tarjeta', 'efectivo', 'desglose', 'detalle', 'cuanto', 'cuánto', 'cuantos', 'cuántos', 'cuantas', 'cuántas', 'vend', 'top', 'mejor', 'peor', 'mas vendido', 'más vendido', 'descuento', 'propina'].some(kw => q.includes(kw))
    // 1b. DÍA DE VENTA en curso (zona + inicio de día del tenant = pos_orders.dia_venta).
    //     A las 00:30 sigue siendo el día anterior: con la fecha de calendario la voz
    //     buscaba el día nuevo y decía "sin cobertura" mientras la noche vendía.
    //     Si la lectura falla se usan los defaults del producto (configuración, no ventas).
    const sbGet = async <T,>(table: string, query: string): Promise<T[]> => {
      const r = await fetch(`${sbUrl}/rest/v1/${table}?${query}`, { headers: sbHeaders, cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }
    const { fetchClientConfig: cargarConfig } = await import('@/lib/client-config')
    const [configDelTenant, dia] = await Promise.all([cargarConfig(auth.clientId), leerContextoDia(auth.clientId, sbGet)])
    const zona = dia.tz
    const todayStr = dia.hoy
    // Por calendario, no restando 86,400,000 ms: un dia con cambio de horario dura 23
    // o 25 horas.
    const yesterday = sumarDias(todayStr, -1, zona)

    // Frescura del POS: arranca ya, en paralelo con las ventas.
    const frescuraP = leerFrescura(crearRpc(sbUrl, sbKey), auth.clientId, zona, dia.inicio)

    // Siempre cubre el mes actual y el anterior (una consulta); el detalle que va al
    // prompt se recorta abajo.
    const histLimit = wantsHistory ? 90 : Math.max(14, diasParaCubrirMesAnterior(todayStr))
    // Only fetch heavy JSONB columns when needed — saves ~80% tokens on simple questions
    const selectCols = wantsDetail
      ? 'fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta,meseros,ventas_por_grupo,pago_métodos,platillos_top'
      : 'fecha,ventas_dia,tickets_count,personas_restaurant,ticket_promedio_restaurant,efectivo,tarjeta'
    // FULLSITE PRIMERO: el POS de Fullsite manda; el histórico importado sólo cubre
    // hasta su último día. Ver ventasFullsitePrimero (lib/pos-daily.ts).
    // `determinado=false` = no se pudo leer (≠ "no hubo ventas"); `motivo` = qué fuente falló.
    const ventas = await ventasFullsitePrimero(sbUrl, sbHeaders, auth.clientId, histLimit, selectCols)
    const recentDays = ventas.dias
    if (ventas.determinado && ventas.motivo) fuentesFallidas.push(`parte de las ventas (${ventas.motivo})`)

    // 2. Detect date from question
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
        const weekAgo = sumarDias(todayStr, -7, zona)
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

    // wansoft_waiter_categories NO tiene columna de cliente: sólo puede haber un
    // restaurante dueño de esas filas, y quien las lea ve las suyas. El guardián no es
    // una bandera de producto — impide que un restaurante vea los meseros de otro.
    //
    // Se pregunta por la propiedad (clients.wansoft_subsidiary_id) y no por el nombre,
    // para que no quede atado a AMALAY. Falla cerrado: si no se puede comprobar, no se
    // lee. Ver src/lib/wansoft-legacy.ts.
    if (!wantsMeseros || !(await esDuenoDelHistoricoWansoft(auth.clientId))) {
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

    const leerCategorias = async (url: string): Promise<Array<{ fecha: string; data: unknown }> | null> => {
      try {
        const r = await fetch(url, { headers: sbHeaders, cache: 'no-store' })
        if (!r.ok) return null
        const j = await r.json()
        return Array.isArray(j) ? j : null
      } catch { return null }
    }
    const leidas = await leerCategorias(`${sbUrl}/rest/v1/wansoft_waiter_categories?${wcParams}`)
    if (leidas === null) fuentesFallidas.push('desglose de meseros')
    const waiterRows: Array<{ fecha: string; data: unknown }> = leidas || []

    // Si no hay datos de la fecha pedida se usa el último día disponible — y se DICE
    // (abajo, el encabezado lleva las fechas reales y la advertencia).
    let usaRespaldo = false
    if (leidas !== null && waiterRows.length === 0 && dateFilter) {
      const respaldo = await leerCategorias(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=1`)
      if (respaldo && respaldo.length > 0) { waiterRows.push(...respaldo); usaRespaldo = true }
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
        // Sólo etiquetas genéricas; quién es mesero lo decide pos_staff del tenant.
        const excludeNames = ETIQUETAS_NO_MESERO

        const rankings: string[] = []
        const meseroList = Object.entries(aggKPIs).filter(([name]) =>
          !excludeNames.some(ex => name.toLowerCase().includes(ex))
        )

        rankings.push('RANKING H&H POR MESERO:')
        for (const [m] of meseroList) {
          const hh = aggCats[m]?.['H&H']
          rankings.push(`  ${datoTexto(m, 60)}: ${hh ? hh.qty : 0} pzas ($${hh ? Math.round(hh.total) : 0})`)
        }

        rankings.push('\nRANKING 2DA BEBIDA POR MESERO:')
        for (const [m] of meseroList) {
          const bd = aggCats[m]?.['2da Bebida']
          rankings.push(`  ${datoTexto(m, 60)}: ${bd ? bd.qty : 0} pzas`)
        }

        rankings.push('\nRANKING BEBIDAS POR PERSONA:')
        for (const [m, k] of meseroList) {
          const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
          rankings.push(`  ${datoTexto(m, 60)}: ${bp}`)
        }

        rankings.push('\nRANKING PAN/TOAST/BAGEL POR MESERO:')
        for (const [m] of meseroList) {
          const pan = aggCats[m]?.['Pan']
          rankings.push(`  ${datoTexto(m, 60)}: ${pan ? pan.qty : 0} pzas ($${pan ? Math.round(pan.total) : 0})`)
        }

        rankings.push('\nRANKING POSTRES POR MESERO:')
        for (const [m] of meseroList) {
          const post = aggCats[m]?.['Postres']
          if (post && post.qty > 0) rankings.push(`  ${datoTexto(m, 60)}: ${post.qty} pzas ($${Math.round(post.total)})`)
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
              .map(([cat, v]) => `${datoTexto(cat, 40)}:${v.qty}pzas/$${Math.round(v.total)}`)
              .join(', ')
            perDayLines.push(`  ${row.fecha}: ${parts}`)
          }
        }

        const fechas = waiterRows.map((r) => r.fecha).join(', ')
        const aviso = usaRespaldo && dateFilter
          ? ` — OJO: NO hay desglose del ${dateFilter.start}${dateFilter.end !== dateFilter.start ? ` al ${dateFilter.end}` : ''}; esto es del último día disponible, dilo`
          : ''
        waiterContext = `\nDATOS DE MESEROS POR CATEGORÍA — fechas ${fechas}${aviso}:\n\n${rankings.join('\n')}${perDayLines.length > 1 ? '\n' + perDayLines.join('\n') : ''}`
      } catch (err) {
        console.error('[voice] Rankings error:', err)
      }
    }
    } // end wantsMeseros

    // 4. Build daily context
    // Sin filas: "no pude consultar" (fallo) o "sin cobertura" (vacío) — nunca $0.
    let dailyContext = contextoSinVentas({ determinado: ventas.determinado, motivo: ventas.motivo })
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
              .map((m: { nombre: string; total: number }) => `${datoTexto(m.nombre, 60)}:$${Math.round(Number(m.total) || 0)}`).join(', ')
            line += ` | Meseros: ${topM}`
          }

          const grupos = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? JSON.parse(d.ventas_por_grupo) : [])
          if (grupos.length > 0) {
            const topG = grupos.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
              .map((g: { nombre: string; total: number }) => `${datoTexto(g.nombre, 40)}:$${Math.round(Number(g.total) || 0)}`).join(', ')
            line += ` | Grupos: ${topG}`
          }

          const platillos = Array.isArray(d.platillos_top) ? d.platillos_top : (typeof d.platillos_top === 'string' ? JSON.parse(d.platillos_top) : [])
          if (platillos.length > 0) {
            const topP = platillos.slice(0, 5).map((p: { nombre: string; cantidad: number; total: number }) => `${datoTexto(p.nombre, 60)}:${Number(p.cantidad) || 0}pzas/$${Math.round(Number(p.total) || 0)}`).join(', ')
            line += ` | Platillos: ${topP}`
          }

          const pagos = Array.isArray(d.pago_métodos) ? d.pago_métodos : (typeof d.pago_métodos === 'string' ? JSON.parse(d.pago_métodos) : [])
          if (pagos.length > 0) {
            const pagoStr = pagos.map((p: { nombre: string; total: number }) => {
              const mxn = Math.round(p.total || 0)
              return `${datoTexto(p.nombre, 40)}:$${mxn}`
            }).join(', ')
            line += ` | Pagos: ${pagoStr}`
          }
        }

        return line
      })

      // Resúmenes YA CALCULADOS y con fechas reales (mes, últimos 7 días CON DATOS con
      // su rango, semana de calendario vs la anterior, aviso si los datos son viejos).
      // Antes "SEMANA" eran las últimas 7 filas, aunque la última fuera de hace semanas.
      const fMax = String(recentDays[0].fecha || '')
      const fMin = String(recentDays[recentDays.length - 1].fecha || '')
      const ventanaDesde = recentDays.length >= histLimit ? fMin : ventas.fuente === 'fullsite' ? sumarDias(todayStr, -histLimit, zona) : undefined
      const detalle = wantsHistory ? lines : lines.slice(0, 14)
      const fMinDet = String(recentDays[detalle.length - 1].fecha || '')
      dailyContext = `${resumenesPrecalculados(recentDays, todayStr, { ventanaDesde })}
DATOS DIARIOS (${detalle.length} días con ventas, del ${fMinDet} al ${fMax}${detalle.length < lines.length ? '; detalle sólo de los más recientes, para antes usa los RESÚMENES' : ''}).\n${detalle.join('\n')}`

      // YoY comparison
      const wantsYoY = ['ano pasado', 'ano anterior', 'año pasado', 'año anterior', 'yoy', 'vs 2025', 'vs año', 'crecimiento'].some(kw => q.includes(kw))
      if (wantsYoY && recentDays.length > 0) {
        try {
          const currentYear = todayStr.slice(0, 4)
          const prevYear = String(Number(currentYear) - 1)
          const yoyRes = await fetch(
            `${sbUrl}/rest/v1/wansoft_daily?select=fecha,ventas_dia,tickets_count,personas_restaurant&client_slug=eq.${encodeURIComponent(auth.clientId)}&ventas_dia=gt.0&fecha=gte.${prevYear}-01-01&fecha=lte.${prevYear}-12-31&order=fecha.asc&limit=500`,
            { headers: sbHeaders, cache: 'no-store' }
          )
          if (!yoyRes.ok) fuentesFallidas.push('histórico del año anterior')
          if (yoyRes.ok) {
            let yoyRows = await yoyRes.json()

            // OCM Fase 3 — misma salida que en /api/chat. Este bloque estaba
            // copiado ahi tal cual, y ninguno de los dos tenia fallback: para un
            // tenant clonado el año-contra-año no daba una respuesta mala, daba
            // una capacidad que no llegaba nunca.
            if (!Array.isArray(yoyRows) || yoyRows.length === 0) {
              const diasHastaInicioPrevio = Math.ceil(
                (Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${prevYear}-01-01T00:00:00Z`)) / 86400000
              ) + 1
              const vivas = await buildDailyFromOrders(sbUrl, sbHeaders, auth.clientId, diasHastaInicioPrevio)
              yoyRows = vivas.filter((r) => String(r.fecha ?? '').startsWith(prevYear))
            }

            if (yoyRows.length > 0) {
              const prevMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of yoyRows) {
                const m = (row.fecha as string).slice(0, 7)
                if (!prevMonthly[m]) prevMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                prevMonthly[m].ventas += Number(row.ventas_dia) || 0
                prevMonthly[m].tickets += Number(row.tickets_count) || 0
                prevMonthly[m].dias += 1
              }
              const currMonthly: Record<string, { ventas: number; tickets: number; dias: number }> = {}
              for (const row of recentDays) {
                const m = (row.fecha as string).slice(0, 7)
                if (!currMonthly[m]) currMonthly[m] = { ventas: 0, tickets: 0, dias: 0 }
                currMonthly[m].ventas += Number(row.ventas_dia) || 0
                currMonthly[m].tickets += Number(row.tickets_count) || 0
                currMonthly[m].dias += 1
              }
              const yoyLines = [`\nCOMPARATIVO AÑO ANTERIOR (${currentYear} vs ${prevYear}; ya calculado; "sin datos" = SIN COBERTURA, no $0):`]
              const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
              for (let m = 1; m <= 12; m++) {
                const mm = m.toString().padStart(2, '0')
                const curr = currMonthly[`${currentYear}-${mm}`]
                const prev = prevMonthly[`${prevYear}-${mm}`]
                if (curr || prev) {
                  const lado = (x: { ventas: number; dias: number } | undefined, anio: string) =>
                    x ? `${anio}=$${Math.round(x.ventas)} (${x.dias} dias con datos)` : `${anio}=sin datos`
                  const pct = curr && prev && prev.ventas > 0 ? Math.round(((curr.ventas - prev.ventas) / prev.ventas) * 100) : null
                  const cambio = pct === null ? 'no comparable' : `${pct >= 0 ? '+' : ''}${pct}%${curr!.dias !== prev!.dias ? ' (cobertura desigual)' : ''}`
                  yoyLines.push(`  ${monthNames[m-1]}: ${lado(curr, currentYear)} vs ${lado(prev, prevYear)} -> ${cambio}`)
                }
              }
              dailyContext += yoyLines.join('\n')
            }
          }
        } catch { /* YoY optional */ }
      }
    }

    // 5a. Meseros activos: de pos_staff DEL TENANT. Sin lista por omisión — antes había
    //     aquí nombres reales de un restaurante que se le daban a cualquier otro.
    let activeMeserosStr = '(no pude leer la lista de meseros activos)'
    try {
      const staffRes = await fetch(
        `${sbUrl}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(auth.clientId)}&active=eq.true&role=in.(mesero,cajero,barra,supervisor)&select=name&order=name.asc`,
        { headers: sbHeaders, cache: 'no-store' }
      )
      if (staffRes.ok) {
        const staffRows: { name: string }[] = await staffRes.json()
        activeMeserosStr = staffRows.length > 0
          ? staffRows.map(r => datoTexto(r.name, 60)).join(', ')
          : '(no hay meseros activos registrados en el POS)'
      } else {
        fuentesFallidas.push('lista de meseros activos')
      }
    } catch { fuentesFallidas.push('lista de meseros activos') }

    // 5b. Cobertura del POS (última venta, cuánto va hoy) — distingue "aún no hay
    //     ventas hoy" de "el POS no tiene ventas desde hace días" (≠ $0).
    const frescura = await frescuraP
    const frescuraCtx = textoFrescura(frescura, zona, todayStr)

    // 5c. Categorías del menú: de los datos de ESTE tenant, no una lista fija.
    const categorias = new Set<string>()
    for (const d of recentDays.slice(0, 14)) {
      const gs = Array.isArray(d.ventas_por_grupo) ? d.ventas_por_grupo : (typeof d.ventas_por_grupo === 'string' ? (() => { try { return JSON.parse(d.ventas_por_grupo as string) } catch { return [] } })() : [])
      for (const g of gs as { nombre?: unknown }[]) if (g?.nombre) categorias.add(datoTexto(g.nombre, 40))
    }

    // 5. System prompt — voice-optimized, parameterized by client. Sin datos de un
    //    restaurante ni de Fullsite (precio, stack, fundador): sólo el tenant.
    const voiceRestaurantName = datoTexto(configDelTenant.display_name || 'el restaurante', 80)
    const voiceRestaurantCity = datoTexto(configDelTenant.city || '', 60)

    const systemPrompt = `Eres el copiloto operativo de ${voiceRestaurantName}${voiceRestaurantCity ? ' (' + voiceRestaurantCity + ')' : ''}. Consultor senior con 20 anos de experiencia en restaurantes.

CONTEXTO DE VOZ — ESTO ES CRITICO:
- MAXIMO 2 ORACIONES por respuesta. No mas. Es voz, no texto.
- Da el numero con su fecha y ya. "El <fecha> vendieron <$X>, <cambio % del contexto> vs <periodo del contexto>." FIN.
- NO des desgloses, listas, ni explicaciones largas a menos que te lo pidan.
- NO uses markdown, asteriscos, vinetas ni formato. Solo texto plano.
- Si te preguntan "como vamos" → un numero y una comparacion que YA ESTE en los resumenes. Nada mas.
- Si quieren mas detalle, que pregunten. No lo des de una.

REGLA ABSOLUTA — PRECISION DE DATOS:
- SOLO di numeros que esten EXACTAMENTE en los datos que te doy abajo.
- NO HAGAS ARITMETICA: no sumes, restes, promedies ni saques porcentajes. Si la cifra no esta en el contexto, di "no lo tengo calculado" y da lo mas cercano que SI este, con su fecha.
- Las fechas tienen el dia de la semana: "<fecha> (lunes)". USA ESO. No calcules dias.
- ANTES de responder, verifica que el numero aparece textualmente en los datos. Si no aparece, di "no tengo ese dato exacto".
- NUNCA confundas "total" (pesos) con "cantidad" (piezas). "<PLATILLO>:<N>pzas/$<X>" = se vendieron <N> piezas por <X> pesos.
- FECHAS REALES SIEMPRE: di la fecha real de cada cifra. Si el dato es de otro dia que el que preguntaron, dilo.
- SIN COBERTURA ≠ CERO: si el contexto dice "SIN COBERTURA" o "no hay ventas registradas" para un periodo, NUNCA digas "$0" ni "no se vendio": di "no tengo ventas registradas para <periodo>; la ultima es del <fecha>".
- FALLO ≠ VACIO: si una fuente "no se pudo leer", di que no pudiste consultarla; no digas que no hay registros.
- Puedes contestar sobre cualquier fecha pasada que este en los datos, siempre diciendo la fecha.

REGLAS DE BUSQUEDA:
- ANTES de decir "no tengo", revisa TODOS los bloques de datos (resumenes, datos diarios, meseros, platillos, grupos, pagos).
- Busca sinonimos obvios (Postre = Dessert).

EXCLUIR (no son meseros): cualquier nombre que NO aparezca en "Meseros activos". APLICACIONES y MESERO EVENTO no son personas.

FECHA DE HOY: ${fechaLargaEnZona(zona)}, ${horaEnZona(zona)} (zona ${zona}). DIA DE VENTA EN CURSO ("hoy"): ${todayStr} (empieza a las ${dia.inicio.slice(0, 5)}; antes de esa hora sigue siendo el dia anterior).

${envolverDatos(`Meseros activos: ${activeMeserosStr}
${categorias.size > 0 ? `Categorias del menu (de los datos de este restaurante): ${[...categorias].slice(0, 20).join(', ')}` : ''}
${contextoFuentesFallidas(fuentesFallidas)}
${frescuraCtx}
${waiterContext}

${dailyContext}`)}`

    // Groq — free, 300 tok/s, with retry on rate limit
    const { groqStream } = await import('@/lib/groq')
    const readable = await groqStream({
      messages: [
        { role: 'system', content: systemPrompt },
        // Sólo 'user'/'assistant' del cliente: un 'system' en el cuerpo de la petición
        // es un intento de reescribir las reglas y se descarta.
        ...historialSeguro(history, 6),
        { role: 'user', content: message.slice(0, 2000) },
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
