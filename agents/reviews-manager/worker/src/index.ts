/**
 * Reviews Manager — Cloudflare Worker
 *
 * Gestión automatizada de reseñas de Google Business Profile para AMALAY.
 * - Cron: sincroniza reseñas nuevas desde GBP cada 2h
 * - GET  /oauth/start:    inicia flujo OAuth con Google
 * - GET  /oauth/callback: recibe tokens de Google
 * - POST /webhook/telegram: recibe aprobación/rechazo de borradores
 */

import { handleCron } from "./handlers/cron";
import { handleOAuthStart, handleOAuthCallback } from "./handlers/oauth";
import { handleTelegramWebhook } from "./handlers/telegram";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GROQ_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ status: "ok", worker: "reviews-manager" });
    }

    // OAuth flow
    if (request.method === "GET" && url.pathname === "/oauth/start") {
      return handleOAuthStart(request, env);
    }
    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    // Telegram webhook — aprobación de borradores
    if (request.method === "POST" && url.pathname === "/webhook/telegram") {
      return handleTelegramWebhook(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },
};
