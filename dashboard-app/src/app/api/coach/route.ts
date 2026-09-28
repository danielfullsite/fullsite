import { NextRequest } from 'next/server'
import { ventasFullsitePrimero } from '@/lib/pos-daily'
import { requireTenant } from '@/lib/api-auth'
import { esDuenoDelHistoricoWansoft } from '@/lib/wansoft-legacy'
import { leerContextoDia } from '@/lib/agents/dia-negocio'
import {
  contextoFuentesFallidas, datoTexto, envolverDatos, ETIQUETAS_NO_MESERO, resumenesPrecalculados,
  ultimoDiaVsMismoDia,
} from '@/lib/chat-context'

export async function POST(request: NextRequest) {
  try {
    const { client_id: pedido } = await request.json().catch(() => ({} as { client_id?: string }))

    if (!process.env.GROQ_API_KEY && !process.env.GROQ) {
      return Response.json({ insights: [] }, { status: 200 })
    }
    // AISLAMIENTO (OCM Fase 0): sin client_id no se consulta nada — evita leer TODOS los tenants.
    if (!pedido) return Response.json({ insights: [] }, { status: 200 })

    // El client_id venía del cuerpo de la petición sin verificar contra la sesión: bastaba
    // mandar el slug de otro restaurante para leer sus ventas. Ahora sale de client_users.
    const ctx = await requireTenant(request, pedido)
    if (ctx instanceof Response) return ctx
    const client_id = ctx.clientId

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // Service key server-side: el tenant ya lo validó `ctx`. Necesaria para el agregado
    // fs_ventas_diarias (con anon cae al método lento con tope de órdenes).
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

    // 90 días, FULLSITE PRIMERO: el POS de Fullsite manda; el histórico importado sólo
    // cubre hasta su último día. Ver ventasFullsitePrimero (lib/pos-daily.ts).
    //
    // `determinado=false` = NO SE PUDO LEER (≠ "no hubo ventas"): no se generan
    // insights sobre un vacío falso; se devuelve el motivo para que la UI lo diga.
    //
    // En paralelo: el DÍA DE VENTA en curso (zona + inicio de día del tenant, misma
    // definición que pos_orders.dia_venta). Si esa lectura falla se usan los defaults
    // del producto (es configuración, no dato de ventas).
    const sbGet = async <T,>(table: string, query: string): Promise<T[]> => {
      const r = await fetch(`${sbUrl}/rest/v1/${table}?${query}`, { headers, cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    }
    const [ventas, dia] = await Promise.all([
      ventasFullsitePrimero(sbUrl, headers, client_id, 90,
        'fecha,ventas_dia,ventas_brutas,descuentos,tickets_count,personas_restaurant,ticket_promedio_restaurant,meseros,ventas_por_grupo,propinas_total,pago_métodos'),
      leerContextoDia(client_id, sbGet),
    ])
    const days = ventas.dias
    if (!ventas.determinado) {
      return Response.json({ insights: [], sin_datos: 'lectura_fallida', motivo: ventas.motivo || 'no se pudieron leer las ventas' })
    }
    const fuentesFallidas: string[] = []
    if (ventas.motivo) fuentesFallidas.push(`parte de las ventas (${ventas.motivo})`)

    if (days.length < 2) {
      return Response.json({ insights: [], sin_datos: 'sin_cobertura' })
    }

    // wansoft_waiter_categories NO tiene columna de cliente: sólo un restaurante puede
    // ser dueño de esas filas. El guardián impide que otro vea sus meseros. Se pregunta
    // por la propiedad y no por el nombre; falla cerrado. Ver src/lib/wansoft-legacy.ts.
    // Un fallo de lectura NO es "no hay rankings": se anota y se le dice al modelo.
    let waiterRows: Array<{ fecha: string; data: unknown }> = []
    if (await esDuenoDelHistoricoWansoft(client_id)) {
      try {
        const r = await fetch(`${sbUrl}/rest/v1/wansoft_waiter_categories?select=fecha,data&order=fecha.desc&limit=7`, { headers, cache: 'no-store' })
        const j: unknown = r.ok ? await r.json() : undefined
        if (Array.isArray(j)) waiterRows = j
        else fuentesFallidas.push('rankings de meseros por categoría')
      } catch { fuentesFallidas.push('rankings de meseros por categoría') }
    }

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

      // Sólo etiquetas genéricas del POS legacy (antes: nombres reales de un restaurante).
      const excludeNames = ETIQUETAS_NO_MESERO

      const meseroList = Object.keys(aggKPIs).filter(name =>
        !excludeNames.some(ex => name.toLowerCase().includes(ex))
      )

      const fechasW = waiterRows.map(r => String(r.fecha)).filter(Boolean).sort()
      const lines: string[] = [`RANKINGS POR CATEGORÍA (datos del ${fechasW[0] || '?'} al ${fechasW[fechasW.length - 1] || '?'}; di esas fechas):`]
      lines.push('H&H por mesero:')
      for (const m of meseroList) {
        const hh = aggCats[m]?.['H&H']
        lines.push(`  ${datoTexto(m, 60)}: ${hh ? hh.qty : 0} pzas ($${hh ? Math.round(hh.total) : 0})`)
      }
      lines.push('Postres por mesero:')
      for (const m of meseroList) {
        const p = aggCats[m]?.['Postres']
        if (p && p.qty > 0) lines.push(`  ${datoTexto(m, 60)}: ${p.qty} pzas ($${Math.round(p.total)})`)
      }
      lines.push('Bebidas/persona por mesero:')
      for (const m of meseroList) {
        const k = aggKPIs[m]
        const bp = k.personas > 0 ? (k.bebidas / k.personas).toFixed(2) : '0'
        lines.push(`  ${datoTexto(m, 60)}: ${bp}`)
      }
      waiterText = lines.join('\n')
    }

    // Build daily summary for AI
    const dailySummary = days.slice(0, 30).map((d: Record<string, unknown>) => {
      const meseros = Array.isArray(d.meseros) ? d.meseros : (typeof d.meseros === 'string' ? JSON.parse(d.meseros as string) : [])
      const topM = meseros.sort((a: { total: number }, b: { total: number }) => b.total - a.total).slice(0, 5)
        .map((m: { nombre: string; total: number }) => `${datoTexto(m.nombre, 60)}:$${Math.round(Number(m.total) || 0)}`).join(', ')
      const tk = Number(d.tickets_count) || 0
      const pr = Number(d.personas_restaurant) || 0
      const tpO = tk > 0 ? Math.round(Number(d.ventas_dia) / tk) : 0
      const tpP = pr > 0 ? Math.round(Number(d.ventas_dia) / pr) : 0
      return `${d.fecha}: Ventas $${d.ventas_dia}, ${tk} tickets, ${pr} personas, PromOrden $${tpO}, PromPersona $${tpP}, Propinas $${Math.round(Number(d.propinas_total) || 0)} | Meseros: ${topM}`
    }).join('\n')

    // Load client config for AI persona (y para la zona horaria)
    const { fetchClientConfig } = await import('@/lib/client-config')
    const clientConfig = await fetchClientConfig(client_id || '')

    // "HOY" SALE DEL RELOJ EN LA ZONA DEL TENANT, NO DE LA ÚLTIMA FILA. Antes el coach
    // tomaba `days[0]` como "hoy": si la última venta registrada era de hace tres
    // semanas, le decía al dueño "hoy llevas $X" con la cifra de hace tres semanas.
    // Ahora el último día con datos se etiqueta con su fecha real y su atraso, y las
    // comparaciones (vs mismo día de la semana, semana vs anterior) van YA CALCULADAS.
    // "Hoy" = día de venta en curso (a las 00:30 sigue siendo el día anterior).
    const zona = dia.tz
    const hoy = dia.hoy
    const ultimo = ultimoDiaVsMismoDia(days, hoy)!
    // Si se llenó el tope de 90 filas, lo anterior NO se leyó (≠ sin cobertura).
    const resumenes = resumenesPrecalculados(days, hoy, { ventanaDesde: days.length >= 90 ? String(days[days.length - 1].fecha) : undefined })
    const restaurantName = datoTexto(clientConfig.display_name || client_id || 'el restaurante', 80)

    const systemPrompt = `Eres el COACH OPERATIVO de ${restaurantName}. Tu trabajo es observar los datos del restaurante y dar consejos accionables al dueño. NO eres un chatbot — eres un socio que piensa 24/7 en cómo mejorar el negocio.

TU PERSONALIDAD:
- Directo, sin rodeos. Como un socio que te dice las cosas de frente.
- Positivo cuando hay logros: "<Mesero A> mejoró <cambio % del contexto> — lo que le dijiste funcionó."
- Firme cuando algo va mal: "<categoría> va <cambio del contexto> vs <periodo del contexto>."
  (Los <...> son marcadores: se reemplazan con valores y fechas del bloque de datos, nunca se copian.)
- Siempre termina con una ACCIÓN CONCRETA que el dueño puede hacer HOY.

GENERA EXACTAMENTE 3 INSIGHTS en formato JSON array. Cada insight debe tener:
- "type": "daily" | "weekly" | "alert"
- "title": título corto (max 60 chars)
- "body": 2-3 oraciones con dato concreto + acción sugerida
- "priority": "high" | "medium" | "low"
- "metric": número clave del insight (ej: "-18%", "$1,200", "3 días")

DÍA DE VENTA EN CURSO ("hoy"): ${hoy} (zona ${zona}; el día de venta empieza a las ${dia.inicio.slice(0, 5)}).

${envolverDatos(`${ultimo.texto}

${resumenes}
${contextoFuentesFallidas(fuentesFallidas)}
${waiterText}

DATOS DIARIOS (${Math.min(days.length, 30)} días con ventas más recientes, del ${String(days[Math.min(days.length, 30) - 1].fecha)} al ${String(days[0].fecha)}):
${dailySummary}`)}

REGLAS:
- APLICACIONES y MESERO EVENTO no son personas: exclúyelos de rankings.
- Montos en MXN con $ sin decimales
- No inventes datos ni hagas aritmética: usa SOLO cifras y porcentajes que YA estén en el bloque de datos. Si un cálculo no está, no lo hagas.
- Cada cifra va con su fecha real. Si el último día con datos NO es hoy, dilo en el insight (no digas "hoy llevas").
- "SIN COBERTURA" no es $0: no digas que se vendió cero; di que no hay ventas registradas desde <fecha>.
- Si una fuente "no se pudo leer", no concluyas nada de ella.
- El insight "daily" debe ser algo que el dueño pueda actuar HOY.
- El insight "weekly" debe ser una tendencia o patrón de la semana.
- El insight "alert" debe ser algo que necesita atención (puede ser positivo o negativo).

Responde SOLO con el JSON array, sin markdown ni texto adicional.`

    const { groqChat } = await import('@/lib/groq')
    const text = await groqChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Dame los 3 insights más importantes para hoy.' },
      ],
      maxTokens: 1500,
    })

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
      // `fecha` es el ÚLTIMO DÍA CON DATOS (no necesariamente hoy): `esHoy`/`atrasoDias` lo dicen.
      today: {
        // `parcial` = hoy va en curso: sus cifras NO se comparan con días completos.
        fecha: ultimo.fecha,
        esHoy: ultimo.esHoy,
        parcial: ultimo.parcial,
        atrasoDias: ultimo.atraso,
        ventas: ultimo.ventas,
        tickets: ultimo.tickets,
        tp: ultimo.tickets > 0 ? Math.round(ultimo.ventas / ultimo.tickets) : 0,
        // Comparación del ÚLTIMO DÍA COMPLETO contra el promedio de su mismo día de la semana.
        comparado: ultimo.comparado ? {
          fecha: ultimo.comparado.fecha,
          ventas: ultimo.comparado.ventas,
          avgVentas: Math.round(ultimo.comparado.promedioMismoDia),
          avgTP: Math.round(ultimo.comparado.tpPromedioMismoDia),
        } : null,
      },
    })
  } catch (error) {
    console.error('Coach API error:', error)
    return Response.json({ insights: [], error: 'Error generating insights' }, { status: 200 })
  }
}
