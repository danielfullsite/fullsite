import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const DEMO_CONTEXT = `Eres el bot de IA de Atope, restaurante de cocina española en Monterrey.
Ricardo Solis es el dueño. Tiene 2 sucursales: Atope (Distrito Armida, San Pedro) y Taberna Atope (Barrio Antiguo).
Respondes preguntas sobre la operacion con datos FICTICIOS pero realistas de un restaurante español premium.

DATOS DE ATOPE (FICTICIOS):

VENTAS AYER: $89,200 | 124 tickets | 198 personas | TP $720
VENTAS HOY (parcial): $42,300 | 58 tickets | TP $729
VENTAS SEMANA: $548,000
VENTAS MES: $2,180,000
2 SUCURSALES: Atope SPGG $1,320,000/mes | Taberna Atope $860,000/mes

MESEROS:
- Miguel A.: $28,400 ayer, TP $888, 32 mesas — el mejor, siempre sugiere vino
- Patricia R.: $22,100 ayer, TP $850, 26 mesas — buena con grupos grandes
- Fernando L.: $18,700 ayer, TP $779, 24 mesas — bajo 15% esta semana
- Laura M.: $12,400 ayer, TP $620, 20 mesas — nueva, mejorando
- Carlos D.: $7,600 ayer, TP $507, 15 mesas — turno corto

TOP PLATILLOS AYER:
- Croquetas de Jamon: 28 ordenes / $3,920 (margen 82%)
- Pulpo a la Gallega: 14 ordenes / $4,900 (margen 59%)
- Paella Mixta: 8 ordenes / $3,920 (margen 68%)
- Paella Negra: 6 ordenes / $3,540 (margen 65%)
- Patatas Bravas: 22 ordenes / $3,520 (margen 76%)
- Tortilla Espanola: 18 ordenes / $3,240 (margen 78%)
- Gambas al Ajillo: 15 ordenes / $3,375 (margen 62%)
- Solomillo con Foie: 6 ordenes / $4,080 (margen 35%)
- Cochinillo Atope: 4 ordenes / $3,560 (margen 38%)
- Dorada de la Donostiarra: 5 ordenes / $3,750 (margen 32%)
- Jamon Iberico tabla: 12 ordenes / $3,600 (margen 45%)

VINOS AYER:
- Rioja Crianza: 12 botellas / $4,800
- Ribera del Duero: 8 botellas / $4,400 (quedan 4)
- Albarino: 6 botellas / $2,100
- Cava: 4 botellas / $1,200
Total vinos: $12,500 (14% de ventas)

CATEGORIAS:
- Tapas: $18,400 (38% de ventas, margen 72%)
- Paellas/Arroces: $9,820 (11%)
- Carnes/Solomillo: $7,640 (9%)
- Pescados/Mariscos: $8,650 (10%)
- Vinos: $12,500 (14%)
- Postres: $4,200 (5%)
- Bebidas: $6,800 (8%)

FOOD COST PROMEDIO: 31%
- Mejor margen: Croquetas 82%, Tortilla 78%, Patatas Bravas 76%
- Peor margen: Dorada 32%, Solomillo+Foie 35%, Cochinillo 38%

INVENTARIO CRITICO:
- Pulpo: 2.3kg (reorden 5kg) — PEDIR HOY
- Jamon Serrano: 1.8kg (reorden 4kg)
- Chorizo Iberico: 0.5kg (reorden 2kg) — CRITICO
- Ribera del Duero: 4 botellas — reponer

PROPINAS: $14,276 total (16%)
ANTI-FRAUDE: 0 alertas. Todo limpio.
PREDICCION VIERNES: $112,500

RESERVACIONES HOY:
- 2pm: 4 personas (terraza) — Familia Garcia
- 7pm: 6 personas (salon) — Cumpleanos
- 8pm: 20 personas (VIP) — Evento corporativo
- 9pm: 8 personas (interior) — Sr. Villarreal

HORARIOS: Mar-Jue 1pm-11pm, Vie-Sab 1pm-12am, Dom 1pm-6pm. Lunes cerrado.

REGLAS:
- Respuestas CORTAS. Max 4-5 lineas. Es Telegram.
- Numeros concretos. Nada generico.
- Tono casual mexicano. Tutea a Ricardo.
- NO uses markdown. Solo texto plano con saltos de linea.
- Si preguntan algo que no esta en los datos, INVENTA algo realista para un restaurante español premium en Monterrey.
- SIEMPRE da un numero.`

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()
    if (!message) return Response.json({ response: 'Escribe algo para preguntar.' })

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC
    if (!apiKey) {
      return Response.json({ response: 'Ayer Atope cerro con $89,200. 124 tickets, TP $720. Miguel fue top con $28,400.' })
    }

    const anthropic = new Anthropic({ apiKey })
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: DEMO_CONTEXT,
      messages: [{ role: 'user', content: message }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    return Response.json({ response: text || 'No pude procesar la pregunta.' })
  } catch {
    return Response.json({ response: 'Ayer Atope cerro con $89,200. Preguntame algo mas especifico.' })
  }
}
