/**
 * Handler de webhook de Telegram — aprobación de borradores de respuesta.
 *
 * Recibe callback_query de botones inline:
 * - "approve:{review_id}" → publica respuesta en Google
 * - "reject:{review_id}"  → marca como rechazada, solicita input manual
 * - "edit:{review_id}"    → solicita texto editado al usuario
 */

import type { Env } from "../index";

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // TODO Sprint 3: implementar callback_query handler

  return Response.json({ ok: true });
}
