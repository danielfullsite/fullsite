/**
 * Handler de webhook de Telegram — procesa clicks de Mónica en botones inline.
 *
 * callback_data format:
 *   "approve:{review_uuid}" → publica borrador en Google, marca replied
 *   "reject:{review_uuid}"  → marca ignored, actualiza mensaje
 *   "edit:{review_uuid}"    → marca flagged para edición manual (futuro: conversational edit)
 */

import type { Env } from "../index";
import {
  getReviewById,
  getOAuthToken,
  updateOAuthToken,
  updateReviewStatus,
  logAction,
  type GoogleReview,
} from "../lib/supabase";
import {
  replyToReview,
  refreshAccessToken,
} from "../lib/google-gbp";
import {
  editMessageAfterAction,
  answerCallbackQuery,
  notifyError,
  type TelegramConfig,
} from "../lib/telegram";

interface TelegramUpdate {
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const update = (await request.json()) as TelegramUpdate;

  // Only handle callback queries (button clicks)
  if (!update.callback_query?.data || !update.callback_query.message) {
    return Response.json({ ok: true });
  }

  const cb = update.callback_query;
  const [action, reviewId] = cb.data!.split(":");
  const messageId = cb.message!.message_id;
  const actorName = cb.from.first_name ?? String(cb.from.id);

  const sb = { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY };
  const tg: TelegramConfig = { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };

  if (!reviewId) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "Error: review ID missing");
    return Response.json({ ok: true });
  }

  try {
    const review = await getReviewById(sb, reviewId);
    if (!review || !review.id) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "Reseña no encontrada");
      return Response.json({ ok: true });
    }

    // After the null check, id is guaranteed to be string
    const r = review as GoogleReview & { id: string };

    switch (action) {
      case "approve":
        await handleApprove(env, sb, tg, r, messageId, actorName);
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "✅ Respuesta publicada");
        break;

      case "reject":
        await handleReject(sb, tg, r, messageId, actorName);
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "❌ Rechazada");
        break;

      case "edit":
        await handleEdit(sb, tg, r, messageId, actorName);
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "✏️ Marcada para editar");
        break;

      default:
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "Acción desconocida");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] callback error: ${msg}`);
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cb.id, "Error al procesar");
    await notifyError(tg, `Error procesando callback: ${msg}`);
  }

  return Response.json({ ok: true });
}

// --- Approve: publish to Google ---

async function handleApprove(
  env: Env,
  sb: { url: string; serviceKey: string },
  tg: TelegramConfig,
  review: GoogleReview & { id: string },
  messageId: number,
  actorName: string
): Promise<void> {
  const draft = review.ai_draft;
  if (!draft) throw new Error("No draft to publish");

  // Get fresh access token
  const token = await getOAuthToken(sb);
  if (!token) throw new Error("No OAuth token");

  let accessToken = token.access_token;
  if (new Date(token.expires_at) <= new Date()) {
    const refreshed = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      token.refresh_token
    );
    accessToken = refreshed.access_token;
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await updateOAuthToken(sb, { access_token: accessToken, expires_at: expiresAt });
  }

  const reviewName = (review.metadata as Record<string, string>)?.gbp_name;
  if (!reviewName) throw new Error("Missing gbp_name in metadata");

  await replyToReview(accessToken, reviewName, draft);

  await updateReviewStatus(sb, review.id, "replied", {
    review_reply: draft,
    review_reply_at: new Date().toISOString(),
    approved_by: actorName,
  });
  await logAction(sb, {
    review_id: review.id,
    action: "draft_approved",
    actor: actorName,
    details: { draft },
  });
  await logAction(sb, {
    review_id: review.id,
    action: "reply_published",
    actor: "system",
    details: { draft, approved_by: actorName },
  });

  const stars = "⭐".repeat(review.star_rating);
  const name = review.reviewer_name ?? "Anónimo";
  await editMessageAfterAction(tg, messageId,
    `<b>✅ Respondida</b> (aprobó ${actorName})\n${stars} — ${name}\n\n<b>Respuesta:</b>\n${draft}`
  );
}

// --- Reject: mark as ignored ---

async function handleReject(
  sb: { url: string; serviceKey: string },
  tg: TelegramConfig,
  review: GoogleReview & { id: string },
  messageId: number,
  actorName: string
): Promise<void> {
  await updateReviewStatus(sb, review.id, "ignored");
  await logAction(sb, {
    review_id: review.id,
    action: "draft_rejected",
    actor: actorName,
  });

  const stars = "⭐".repeat(review.star_rating);
  const name = review.reviewer_name ?? "Anónimo";
  await editMessageAfterAction(tg, messageId,
    `<b>❌ Rechazada</b> (${actorName})\n${stars} — ${name}\n\nNo se publicará respuesta.`
  );
}

// --- Edit: flag for manual edit ---

async function handleEdit(
  sb: { url: string; serviceKey: string },
  tg: TelegramConfig,
  review: GoogleReview & { id: string },
  messageId: number,
  actorName: string
): Promise<void> {
  await updateReviewStatus(sb, review.id, "flagged");
  await logAction(sb, {
    review_id: review.id,
    action: "flagged",
    actor: actorName,
    details: { reason: "manual_edit_requested" },
  });

  const stars = "⭐".repeat(review.star_rating);
  const name = review.reviewer_name ?? "Anónimo";
  await editMessageAfterAction(tg, messageId,
    `<b>✏️ Marcada para editar</b> (${actorName})\n${stars} — ${name}\n\nResponde manualmente desde Google Business Profile.`
  );
}
