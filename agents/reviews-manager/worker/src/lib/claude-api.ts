/**
 * Cliente Claude API — genera borradores de respuesta a reseñas.
 *
 * Usa la API de Anthropic directamente (no SDK) para mantener
 * el worker sin dependencias externas.
 */

export const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 512;

const SYSTEM_PROMPT = `Eres el gestor de reputación del restaurante AMALAY en Monterrey, México.
Redactas respuestas a reseñas de Google Maps que reflejen la voz auténtica del restaurante.

VOZ DE MARCA AMALAY:
- Cálida, cercana, profesional
- En español mexicano natural (no corporativo)
- Agradece siempre el tiempo del cliente
- Ante críticas: reconoce, no se defiende, ofrece solución concreta

REGLAS:
- Máximo 3 párrafos por respuesta
- Personaliza con el nombre del reviewer cuando esté disponible
- Para 1-2 estrellas: reconoce el problema, ofrece contacto directo (WhatsApp)
- Para 3 estrellas: agradece honestidad, pregunta cómo mejorar
- Para 4-5 estrellas: respuesta breve y genuina, no genérica
- Nunca prometas cosas que no dependen de ti
- Nunca inventes detalles sobre la visita del cliente
- Responde SOLO con el texto de la respuesta, sin explicaciones ni formato extra`;

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
