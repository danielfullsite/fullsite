/**
 * Cliente Telegram — notificaciones y aprobación de reseñas.
 *
 * 4-5★: notificación informativa (ya publicada)
 * 1-3★: alerta con botones inline (Aprobar / Editar / Rechazar)
 */

import type { GoogleReview } from "./supabase";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface InlineButton {
  text: string;
  callback_data: string;
}

interface TelegramSendResult {
  ok: boolean;
  result?: { message_id: number };
}

// --- 4-5★: ya publicada, solo notifica ---

export async function notifyAutoPublished(
  config: TelegramConfig,
  review: GoogleReview,
  reply: string
): Promise<void> {
  const stars = "⭐".repeat(review.star_rating);
  const name = review.reviewer_name ?? "Anónimo";
  const excerpt = truncate(review.comment, 200);

  const text = [
    `<b>✅ Reseña respondida (auto)</b>`,
    `${stars} — ${name}`,
    `"${excerpt}"`,
    "",
    `<b>Respuesta publicada:</b>`,
    reply,
  ].join("\n");

  await sendMessage(config, text);
}

// --- 1-3★: requiere aprobación de Mónica ---

export async function sendApprovalRequest(
  config: TelegramConfig,
  review: GoogleReview,
  draft: string
): Promise<number | null> {
  const stars = "⭐".repeat(review.star_rating);
  const name = review.reviewer_name ?? "Anónimo";
  const excerpt = truncate(review.comment, 300);
  const isUrgent = review.star_rating <= 2;

  const header = isUrgent
    ? `🚨 Reseña ${review.star_rating}★ — requiere aprobación`
    : `⚠️ Reseña ${review.star_rating}★ — requiere aprobación`;

  const text = [
    `<b>${header}</b>`,
    `${stars} — ${name}`,
    `"${excerpt}"`,
    "",
    `<b>Borrador de respuesta:</b>`,
    draft,
    "",
    `<i>Elige una opción:</i>`,
  ].join("\n");

  const buttons: InlineButton[][] = [
    [
      { text: "✅ Aprobar", callback_data: `approve:${review.id}` },
      { text: "✏️ Editar", callback_data: `edit:${review.id}` },
      { text: "❌ Rechazar", callback_data: `reject:${review.id}` },
    ],
  ];

  return sendMessageWithButtons(config, text, buttons);
}

// --- Editar mensaje después de acción ---

export async function editMessageAfterAction(
  config: TelegramConfig,
  messageId: number,
  newText: string
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/editMessageText`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        message_id: messageId,
        text: newText,
        parse_mode: "HTML",
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error(`[telegram] editMessageText failed: ${error}`);
  }
}

// --- Answer callback query (quita el spinner del botón) ---

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await fetch(
    `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? "Procesado",
      }),
    }
  );
}

// --- Errores ---

export async function notifyError(
  config: TelegramConfig,
  message: string
): Promise<void> {
  await sendMessage(config, `<b>⚠️ Reviews Manager Error</b>\n${message}`);
}

// --- Helpers ---

async function sendMessage(
  config: TelegramConfig,
  text: string
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error(`[telegram] sendMessage failed: ${error}`);
  }
}

async function sendMessageWithButtons(
  config: TelegramConfig,
  text: string,
  buttons: InlineButton[][]
): Promise<number | null> {
  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error(`[telegram] sendMessage (buttons) failed: ${error}`);
    return null;
  }

  const data = (await res.json()) as TelegramSendResult;
  return data.result?.message_id ?? null;
}

function truncate(text: string | null, maxLen: number): string {
  if (!text) return "(sin comentario)";
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}
