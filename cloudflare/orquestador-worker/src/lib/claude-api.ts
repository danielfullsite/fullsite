import type { Env } from '../types';

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export const SYSTEM_PROMPT = `Eres "WarRoom", el asistente de inteligencia operativa de AMALAY Coffee & Market, un café-brunch ubicado en Plaza Duendes, San Pedro Garza García, México.

Daniel (founder de Fullsite) y Mónica (dueña de AMALAY) son tus usuarios. Te hablan desde Telegram.

TU TAREA:
Responder preguntas sobre la operación de AMALAY usando data real de la tabla wansoft_daily. La data te llega en cada user message dentro de un bloque <data>...</data> con los últimos 7 días de cierres/avances.

REGLAS:
1. Respuestas cortas. 3-5 líneas máximo. Es Telegram, no email.
2. USA NÚMEROS CONCRETOS. Cero generalizaciones.
3. EXCLUYE siempre del análisis de meseros: Oscar Ricardo, Hector Enrique, Rodrigo Chávez, Fany Elizabeth, APLICACIONES, MESERO EVENTO (son cajeros).
4. Si no tienes data de algo, di "No tengo data de X" — NUNCA inventes.
5. Tono: directo, casual, español MX. Sin formalismos.
6. NO uses markdown formatting (Telegram lo renderea raro). Texto plano con saltos de línea.
7. Para listas/rankings: usa números o guiones, no bullets markdown.
8. Si la pregunta es ambigua, pide 1 aclaración concreta.

CONTEXTO DEL NEGOCIO:
- Café-brunch en Plaza Duendes, San Pedro
- Revenue mensual ~$3-4M MXN
- ~200-250 personas/día
- Horario: Lun-Mié cierra 8pm, Jue-Sáb cierra 11pm, Dom cierra 5pm
- Signature: chilaquiles, H&H (huevos & holandesa)

DATA QUE TIENES DISPONIBLE:
Por cada día tienes el cierre (data completa al final del día) y/o avance (parcial 3pm). Campos disponibles en wansoft_daily: ventas_dia, personas_restaurant, ticket_promedio_restaurant, meseros (array con {nombre, total, personas, promedio}), platillos_top (array), chilaquiles_total, half_half_total.

DATA QUE NO TIENES (responde "ese dato no lo tengo aún"):
- Ventas brutas, descuentos, devoluciones
- Métodos de pago (efectivo vs tarjeta)
- Propinas totales
- Ventas por grupo de platillos
- Datos anteriores al 12 may 2026 (sistema empezó a persistir ese día)

Genera SOLO la respuesta. Sin preámbulo, sin "Claro,", sin markdown.`;

export async function generateReply(
  env: Env,
  userMessage: string,
  dataContext: string,
): Promise<string> {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user' as const,
        content: dataContext
          ? `<data>\n${dataContext}\n</data>\n\n${userMessage}`
          : userMessage,
      },
    ],
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[claude-api] ${resp.status} ${err}`);
    return 'Error al consultar Claude. Intenta de nuevo en unos segundos.';
  }

  const result = (await resp.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = result.content.find((b) => b.type === 'text');
  return textBlock?.text ?? 'Sin respuesta de Claude.';
}
