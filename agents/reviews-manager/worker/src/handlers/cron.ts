/**
 * Handler de cron — sincroniza reseñas de GBP y genera borradores con Claude.
 *
 * Flujo:
 * 1. Refresh OAuth token si está expirado
 * 2. Fetch reseñas nuevas desde Google Business Profile API
 * 3. Upsert en google_reviews (Supabase)
 * 4. Para cada reseña sin respuesta: generar borrador con Claude
 * 5. Si <= 3 estrellas: alertar a Telegram con botones aprobar/rechazar
 */

import type { Env } from "../index";

export async function handleCron(env: Env): Promise<void> {
  console.log("[reviews-manager] cron start");

  // TODO Sprint 2: implementar flujo completo
  // 1. refreshGoogleToken(env)
  // 2. fetchNewReviews(env)
  // 3. upsertReviews(env, reviews)
  // 4. generateDrafts(env, pendingReviews)
  // 5. alertNegativeReviews(env, negativeReviews)

  console.log("[reviews-manager] cron end (stub)");
}
