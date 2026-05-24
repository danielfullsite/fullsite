/**
 * Handler de cron — sincroniza reseñas de GBP y genera borradores con Claude.
 *
 * Flujo por rating:
 *   4-5★: pending → ai_drafted → auto_approved → replied (publica en Google + notifica Telegram)
 *   1-3★: pending → ai_drafted → awaiting_approval (envía a Telegram con botones, NO publica)
 *
 * Errores: → error (retry_count++, alerta Telegram después de 3 intentos)
 */

import type { Env } from "../index";
import {
  listReviews,
  replyToReview,
  refreshAccessToken,
  parseStarRating,
  type GBPReview,
} from "../lib/google-gbp";
import { generateReplyDraft } from "../lib/groq-api";
import {
  getOAuthToken,
  updateOAuthToken,
  upsertReview,
  getPendingReviews,
  updateReviewDraft,
  updateReviewStatus,
  logAction,
  type GoogleReview,
} from "../lib/supabase";
import {
  notifyAutoPublished,
  sendApprovalRequest,
  notifyError,
} from "../lib/telegram";

const MAX_RETRIES = 3;

export async function handleCron(env: Env): Promise<void> {
  const sb = { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY };
  const tg = { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID };

  console.log("[cron] start");

  // 1. Get and refresh OAuth token
  const token = await getOAuthToken(sb);
  if (!token) {
    console.error("[cron] No OAuth token found — run /oauth/start first");
    await notifyError(tg, "No hay token OAuth configurado. Visita /oauth/start para conectar Google.");
    return;
  }

  let accessToken = token.access_token;
  const isExpired = new Date(token.expires_at) <= new Date();

  if (isExpired) {
    console.log("[cron] Refreshing expired access token");
    const refreshed = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      token.refresh_token
    );
    accessToken = refreshed.access_token;
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await updateOAuthToken(sb, { access_token: accessToken, expires_at: expiresAt });
  }

  // 2. Fetch reviews from GBP
  if (!token.account_id || !token.location_id) {
    console.error("[cron] account_id or location_id not set in oauth tokens");
    await notifyError(tg, "Falta account_id o location_id en google_oauth_tokens.");
    return;
  }

  const gbpResponse = await listReviews(accessToken, token.account_id, token.location_id);
  const gbpReviews = gbpResponse.reviews ?? [];
  console.log(`[cron] Fetched ${gbpReviews.length} reviews from GBP`);

  // 3. Upsert new reviews (skip already-replied ones from Google)
  let newCount = 0;
  for (const r of gbpReviews) {
    if (r.reviewReply) continue;
    const review = gbpToLocal(r);
    const upserted = await upsertReview(sb, review);
    if (upserted.status === "pending") newCount++;
  }
  console.log(`[cron] ${newCount} new pending reviews`);

  // 4. Process pending reviews
  const pending = await getPendingReviews(sb);

  for (const review of pending) {
    try {
      await processReview(env, sb, tg, accessToken, review);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Error processing review ${review.id}: ${msg}`);

      const retries = (review.retry_count ?? 0) + 1;
      await updateReviewStatus(sb, review.id!, "error", {
        error_message: msg,
        retry_count: retries,
      });
      await logAction(sb, {
        review_id: review.id!,
        action: "reply_failed",
        actor: "system",
        details: { error: msg, retry_count: retries },
      });

      if (retries >= MAX_RETRIES) {
        await notifyError(tg, `Reseña de ${review.reviewer_name ?? "Anónimo"} (${review.star_rating}★) falló ${retries} veces: ${msg}`);
      }
    }
  }

  console.log("[cron] done");
}

async function processReview(
  env: Env,
  sb: { url: string; serviceKey: string },
  tg: { botToken: string; chatId: string },
  accessToken: string,
  review: GoogleReview
): Promise<void> {
  // Step 1: Generate draft with Groq
  const groq = await generateReplyDraft(env.GROQ_API_KEY, {
    reviewerName: review.reviewer_name,
    starRating: review.star_rating,
    comment: review.comment,
  });

  // Strip [URGENT_REVIEW] tag for the actual reply text
  const cleanDraft = groq.draft.replace(/^\[URGENT_REVIEW\]\s*/m, "").trim();

  await updateReviewDraft(sb, review.id!, cleanDraft, groq.model);
  await logAction(sb, {
    review_id: review.id!,
    action: "ai_draft_generated",
    actor: "groq",
    details: {
      model: groq.model,
      tokens_in: groq.inputTokens,
      tokens_out: groq.outputTokens,
      had_urgent_tag: groq.draft.includes("[URGENT_REVIEW]"),
    },
  });

  // Step 2: Route by rating
  if (review.star_rating >= 4) {
    await autoPublish(sb, tg, accessToken, review, cleanDraft);
  } else {
    await sendForApproval(sb, tg, review, cleanDraft);
  }
}

// --- 4-5★: auto-publish to Google + informational Telegram notification ---

async function autoPublish(
  sb: { url: string; serviceKey: string },
  tg: { botToken: string; chatId: string },
  accessToken: string,
  review: GoogleReview,
  draft: string
): Promise<void> {
  await updateReviewStatus(sb, review.id!, "auto_approved", {
    approved_by: "auto",
  });

  const reviewName = (review.metadata as Record<string, string>)?.gbp_name;
  if (!reviewName) {
    throw new Error("Missing gbp_name in review metadata — cannot publish reply");
  }

  await replyToReview(accessToken, reviewName, draft);

  await updateReviewStatus(sb, review.id!, "replied", {
    review_reply: draft,
    review_reply_at: new Date().toISOString(),
  });
  await logAction(sb, {
    review_id: review.id!,
    action: "reply_published",
    actor: "system",
    details: { draft },
  });

  await notifyAutoPublished(tg, review, draft);
  console.log(`[cron] Auto-published reply for ${review.star_rating}★ review ${review.id}`);
}

// --- 1-3★: send to Telegram with inline buttons, wait for approval ---

async function sendForApproval(
  sb: { url: string; serviceKey: string },
  tg: { botToken: string; chatId: string },
  review: GoogleReview,
  draft: string
): Promise<void> {
  const messageId = await sendApprovalRequest(tg, review, draft);

  await updateReviewStatus(sb, review.id!, "awaiting_approval", {
    telegram_message_id: messageId,
  });
  await logAction(sb, {
    review_id: review.id!,
    action: "alert_sent",
    actor: "system",
    details: { telegram_message_id: messageId, draft },
  });

  console.log(`[cron] Sent ${review.star_rating}★ review ${review.id} for approval (msg ${messageId})`);
}

function gbpToLocal(r: GBPReview): GoogleReview {
  return {
    review_id: r.reviewId,
    reviewer_name: r.reviewer.displayName ?? null,
    reviewer_photo_url: r.reviewer.profilePhotoUrl ?? null,
    star_rating: parseStarRating(r.starRating),
    comment: r.comment ?? null,
    create_time: r.createTime,
    update_time: r.updateTime,
    metadata: { gbp_name: r.name },
  };
}
