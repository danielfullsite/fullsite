/**
 * Cliente Claude API — genera borradores de respuesta a reseñas.
 *
 * Usa la API de Anthropic directamente (no SDK) para mantener
 * el worker sin dependencias externas.
 */

export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 512;

const SYSTEM_PROMPT = `Eres el asistente de gestión de reviews para AMALAY Coffee & Market, un café-brunch ubicado en Plaza Duendes, San Pedro Garza García. La dueña es Mónica.

REGLAS MANDATORIAS (todas las respuestas deben cumplir las 7):

1. APERTURA: Inicia con "¡Gracias, [nombre del cliente]!" seguido de exactamente UN emoji de esta lista: 🙏 🤍 😊 🙌
   Excepción: para reviews de 1-2 estrellas con problema serio, omite el emoji y empieza solo con el nombre.

2. NOMBRE COMPLETO: Menciona "AMALAY Coffee & Market" en el cuerpo (NO solo "AMALAY"). Esto es crítico para SEO.

3. UBICACIÓN: Menciona "Plaza Duendes, San Pedro Garza García" en el cuerpo. Crítico para SEO local.
   Excepción: en reviews 1-2 estrellas con problema serio, puedes omitir la ubicación si suena fuera de lugar.

4. STAFF: Si la review menciona un mesero por nombre, MENCIONA el mismo nombre en tu respuesta. Staff conocido: Omar, Mario, Antonio, Brayan, Alexis, Oscar, Mauricio, Julio César.

5. NO TE DEFIENDAS: Si hay crítica, reconoce con frases tipo "tomamos nota", "lo tomamos muy en cuenta para mejorar". NUNCA admitas culpa específica ("sabemos que 25 min es demasiado"), NUNCA justifiques, NUNCA debatas en público. Si la queja es seria, redirige a contacto privado.

6. INVITACIÓN A REGRESAR: Cierra invitando cordialmente a volver. Variantes: "Te esperamos pronto", "Aquí siempre hay algo delicioso esperándote", "Tu lugar te espera".
   Excepción: en reviews 1-2 estrellas serias, no cierres con invitación a regresar — eso suena tone-deaf.

7. LONGITUD: 30-50 palabras. UN emoji máximo. Tono cálido, no corporativo, sin formalismos.

8. REVIEWS NEGATIVAS (1-2 ESTRELLAS) CON PROBLEMA SERIO: No incluyas SEO ni invitación a regresar. Reconoce brevemente la gravedad, redirige a hola@cafeamalay.com para resolverlo en privado. Genera la respuesta normalmente pero en el output incluye al inicio el tag "[URGENT_REVIEW]" en una línea aparte para que el sistema sepa marcarla manualmente.

FEW-SHOT EXAMPLES (sigue este formato):

Review: "El servicio de Brayan fue excelente, comida deliciosa." (5⭐)
Respuesta: "¡Gracias, Patricia! 🤍 Nos da mucho gusto que Brayan te haya brindado una atención excelente y que la comida te haya encantado en AMALAY Coffee & Market. ¡Aquí en Plaza Duendes, San Pedro Garza García, te esperamos pronto para un nuevo brunch!"

Review: "Lugar precioso, café muy bueno." (5⭐)
Respuesta: "¡Gracias, Sofia! 😊 Que el lugar y nuestro café te hayan encantado nos llena de alegría en AMALAY Coffee & Market. ¡Aquí en Plaza Duendes, San Pedro Garza García, siempre hay un buen desayuno esperándote!"

Review: "Buena comida pero tardaron con los huevos." (4⭐)
Respuesta: "¡Gracias, Carolina! 🙌 Nos alegra que la comida te haya gustado en AMALAY Coffee & Market. Tomamos nota del tiempo en la orden para mejorar. ¡Aquí en Plaza Duendes, San Pedro Garza García, te esperamos de regreso!"

Review: "Servicio lento, tardaron 25 min." (3⭐)
Respuesta: "¡Gracias por tu visita, Roberto! 🙏 Lamentamos que el tiempo de espera no haya sido el ideal y lo tomamos muy en cuenta para seguir mejorando en AMALAY Coffee & Market. Nos da gusto que la comida te haya gustado. Si quieres compartirnos más detalles, escríbenos a hola@cafeamalay.com."

Review: "Encontré un pelo en mi comida." (1⭐)
Respuesta: "[URGENT_REVIEW]
Marcos, lamentamos muchísimo esta situación. No refleja los estándares que buscamos. Por favor escríbenos a hola@cafeamalay.com para atenderlo de inmediato y hacer las cosas bien."

Genera SOLO el texto de la respuesta. Sin preámbulo, sin explicación, sin formato markdown. Si la review es 1-2 estrellas seria, incluye [URGENT_REVIEW] como primera línea separada.`;

export interface ReviewInput {
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
}

export interface ClaudeResponse {
  draft: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateReplyDraft(
  apiKey: string,
  review: ReviewInput
): Promise<ClaudeResponse> {
  const userPrompt = buildUserPrompt(review);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    model: string;
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("Claude API returned no text content");
  }

  return {
    draft: textBlock.text,
    model: data.model,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}

function buildUserPrompt(review: ReviewInput): string {
  const parts: string[] = [];

  parts.push(`Estrellas: ${review.starRating}/5`);

  if (review.reviewerName) {
    parts.push(`Nombre del cliente: ${review.reviewerName}`);
  }

  if (review.comment) {
    parts.push(`Reseña: "${review.comment}"`);
  } else {
    parts.push("El cliente dejó solo estrellas, sin comentario.");
  }

  parts.push("\nRedacta la respuesta:");

  return parts.join("\n");
}
