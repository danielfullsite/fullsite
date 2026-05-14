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
        { response: 'El servicio de chat no esta configurado. Agrega ANTHROPIC_API_KEY a .env.local para activarlo.' },
        { status: 200 }
      )
    }

    // Fetch recent data for context
    const supabase = createServiceClient()
    const { data: recentDays } = await supabase
      .from('wansoft_daily')
      .select('fecha, ventas_dia, ventas_brutas, tickets_count, personas_restaurant, ticket_promedio_restaurant, meseros, ventas_por_grupo')
      .order('fecha', { ascending: false })
      .limit(7)

    // Build context summary
    let dataContext = 'No hay datos disponibles.'
    if (recentDays && recentDays.length > 0) {
      const latest = recentDays[0]
      const summaryLines = recentDays.map((d) => {
        return `- ${d.fecha}: Ventas $${d.ventas_dia?.toLocaleString()}, ${d.tickets_count} tickets, ${d.personas_restaurant} personas, Ticket prom. $${d.ticket_promedio_restaurant}`
      })

      const latestMeseros = latest.meseros
        ? (Array.isArray(latest.meseros) ? latest.meseros : [])
            .sort((a: { total: number }, b: { total: number }) => b.total - a.total)
            .slice(0, 5)
            .map((m: { nombre: string; total: number }) => `  - ${m.nombre}: $${m.total?.toLocaleString()}`)
            .join('\n')
        : 'Sin datos de meseros'

      const latestGrupos = latest.ventas_por_grupo
        ? (Array.isArray(latest.ventas_por_grupo) ? latest.ventas_por_grupo : [])
            .sort((a: { total: number }, b: { total: number }) => b.total - a.total)
            .slice(0, 8)
            .map((g: { nombre: string; total: number }) => `  - ${g.nombre}: $${g.total?.toLocaleString()}`)
            .join('\n')
        : 'Sin datos de grupos'

      dataContext = `Datos de AMALAY Coffee & Market (Monterrey, MX):

Ultimos 7 dias:
${summaryLines.join('\n')}

Top meseros (${latest.fecha}):
${latestMeseros}

Top categorias (${latest.fecha}):
${latestGrupos}`
    }

    const anthropic = new Anthropic({ apiKey })

    const systemPrompt = `Eres el asistente IA de Fullsite para el restaurante AMALAY Coffee & Market en Monterrey, Mexico.
Tienes acceso a datos reales del restaurante.
Responde siempre en espanol.
Se conciso pero util. Usa datos especificos cuando los tengas.
Si te preguntan algo que no esta en los datos, dilo honestamente.
Montos en pesos mexicanos (MXN) con formato $X,XXX.
No uses emojis a menos que te lo pidan.

${dataContext}`

    const messages: Anthropic.MessageParam[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-20250414',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })

    const text =
      response.content[0].type === 'text' ? response.content[0].text : ''

    return Response.json({ response: text })
  } catch (error) {
    console.error('Chat API error:', error)
    return Response.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
