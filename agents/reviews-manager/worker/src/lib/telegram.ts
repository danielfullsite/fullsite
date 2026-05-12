/**
 * Cliente Telegram — envía alertas de reseñas con botones inline.
 */

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface InlineButton {
  text: string;
  callback_data: string;
}

export async function sendReviewAlert(
  config: TelegramConfig,
  reviewId: string,
  reviewerName: string | null,
  starRating: number,
  comment: string | null,
  aiDraft: string
): Promise<void> {
  const stars = "\u2B50".repeat(starRating);
  const name = reviewerName ?? "Anónimo";
  const excerpt = comment
    ? comment.length > 200
      ? comment.slice(0, 200) + "..."
      : comment
    : "(sin comentario)";

  const text = [
    `Nueva reseña ${stars} — ${name}`,
    `"${excerpt}"`,
    "",
    "Respuesta sugerida:",
    aiDraft,
  ].join("\n");

  const buttons: InlineButton[][] = [
    [
      { text: "Aprobar", callback_data: `approve:${reviewId}` },
      { text: "Rechazar", callback_data: `reject:${reviewId}` },
      { text: "Editar", callback_data: `edit:${reviewId}` },
    ],
  ];

  await sendMessage(config, text, buttons);
}

export async function sendMessage(
  config: TelegramConfig,
  text: string,
  inlineKeyboard?: InlineButton[][]
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
  };

  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error(`[telegram] sendMessage failed: ${error}`);
  }
}
