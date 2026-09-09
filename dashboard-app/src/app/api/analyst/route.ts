/**
 * El analista — planea, consulta el contrato, y responde CITANDO de dónde salió cada cosa.
 *
 * QUÉ CAMBIA RESPECTO A /api/chat
 * El chat elige los datos por coincidencia literal de palabras (route.ts:138-142). Si la
 * pregunta no trae una de las palabras de la lista, el dato nunca se carga y el modelo
 * responde con seguridad usando media base. Aquí el modelo declara qué necesita, el código
 * lo trae, y ese plan se le devuelve al usuario como procedencia.
 *
 * Es una ruta NUEVA a propósito. `/api/chat` sigue intacto: es lo que los clientes usan hoy
 * y la regla es que el chat nunca falle. Cuando ésta demuestre ser mejor con preguntas
 * reales, se migra; mientras tanto conviven.
 *
 * EL LLM NO CALCULA
 * Los números los trae PostgREST y los agrega código. El modelo planea y redacta. Es la
 * regla 1 de docs/ai/AI-ARCHITECTURE-DIRECTION.md, y es lo que hace que la respuesta se
 * pueda auditar: cada cifra tiene una fila detrás.
 */

import { NextRequest } from 'next/server'
import { requireTenant } from '@/lib/api-auth'
import { groqChat } from '@/lib/groq'
import { validarPlan, promptDePlaneacion, extraerJSON } from '@/lib/analyst/plan'
import { ejecutarPlan, construirProcedencia } from '@/lib/analyst/execute'
import { promptDeRespuesta, resumirParaModelo } from '@/lib/analyst/answer'

export const maxDuration = 60

// Mismo techo que /api/chat: 20 por minuto por usuario.
const limites = new Map<string, { n: number; hasta: number }>()
let ultimaLimpieza = Date.now()

function dentroDelLimite(userId: string): boolean {
  const ahora = Date.now()
  if (ahora - ultimaLimpieza > 300_000) {
    for (const [k, v] of limites) if (ahora > v.hasta) limites.delete(k)
    ultimaLimpieza = ahora
  }
  const e = limites.get(userId)
  if (!e || ahora > e.hasta) {
    limites.set(userId, { n: 1, hasta: ahora + 60_000 })
    return true
  }
  if (e.n >= 20) return false
  e.n++
  return true
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const pregunta = typeof body?.message === 'string' ? body.message.trim() : ''

    // El tenant sale de la sesión, SIEMPRE. `body.client_id` se pasa sólo para que
    // requireTenant lo rechace si no corresponde — nunca para elegirlo.
    const auth = await requireTenant(request, body?.client_id)
    if (auth instanceof Response) return auth
    const clientId = auth.clientId

    if (!dentroDelLimite(auth.staffId)) {
      return Response.json({ error: 'Demasiadas consultas. Espera un momento.' }, { status: 429 })
    }
    if (!pregunta) {
      return Response.json({ error: 'Falta la pregunta' }, { status: 400 })
    }

    const zona = 'America/Monterrey'
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date())

    // ── 1. PLANEAR ──────────────────────────────────────────────────────────
    const crudo = await groqChat({
      messages: [
        { role: 'system', content: promptDePlaneacion(hoy, zona) },
        { role: 'user', content: pregunta },
      ],
      maxTokens: 800,
      temperature: 0,   // planear no es creativo
    })
    const plan = validarPlan(extraerJSON(crudo), hoy)

    if (plan.consultas.length === 0) {
      // No es un error. El planificador puede concluir con razón que el dato no existe, y
      // decirlo vale más que inventar una respuesta con lo que sí había.
      return Response.json({
        response: plan.formula
          || 'No encontré en los datos del restaurante con qué responder eso. Puedo con ventas por día y por hora, desempeño por mesero, propinas, formas de pago, tiempos de mesa y consumo teórico de ingredientes.',
        procedencia: { consultas: [], cuadre: { estado: 'no_verificado', detalle: 'no se consultó nada' } },
        descartes: plan.descartes,
        modelo: 'groq',
      })
    }

    // ── 2. EJECUTAR (código, no modelo) ─────────────────────────────────────
    const resultados = await ejecutarPlan(plan.consultas, clientId)
    const procedencia = construirProcedencia(resultados)

    // Si TODAS las lecturas fallaron, se dice. Un "no hubo ventas" cuando en realidad no se
    // pudo leer es el error que se corrigió en #305, y no se va a repetir aquí.
    if (resultados.every((r) => r.error)) {
      return Response.json({
        response: 'No pude leer los datos del restaurante en este momento. No es que no haya ventas: la lectura falló.',
        procedencia, descartes: plan.descartes, modelo: 'groq',
      }, { status: 503 })
    }

    // ── 3. REDACTAR ─────────────────────────────────────────────────────────
    const texto = await groqChat({
      messages: [
        { role: 'system', content: promptDeRespuesta(hoy) },
        { role: 'user', content: resumirParaModelo(pregunta, plan, resultados, procedencia) },
      ],
      maxTokens: 1200,
      temperature: 0.2,
    })

    return Response.json({
      response: texto,
      formula: plan.formula,
      procedencia,
      descartes: plan.descartes,
      modelo: 'groq',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error desconocido'
    const falta = msg.includes('GROQ_API_KEY') || msg.includes('API key')
    return Response.json({
      error: falta
        ? 'Analista no disponible — falta configurar la llave del modelo en el servidor.'
        : `No se pudo completar el análisis: ${msg}`,
    }, { status: falta ? 503 : 500 })
  }
}
