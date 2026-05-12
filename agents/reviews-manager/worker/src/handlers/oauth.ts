/**
 * Handler OAuth — flujo de autorización Google Business Profile.
 *
 * GET /oauth/start    → redirige a Google consent screen
 * GET /oauth/callback → recibe code, intercambia por tokens, guarda en Supabase
 *
 * Flujo one-time: se usa solo para obtener el refresh_token inicial.
 * Después el cron renueva el access_token automáticamente.
 */

import type { Env } from "../index";
import { updateOAuthToken } from "../lib/supabase";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "https://www.googleapis.com/auth/business.manage";

export function handleOAuthStart(request: Request, env: Env): Response {
  const workerUrl = new URL(request.url);
  const redirectUri = `${workerUrl.origin}/oauth/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });

  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

export async function handleOAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.json(
      { error: "OAuth denied", detail: error },
      { status: 400 }
    );
  }

  if (!code) {
    return Response.json(
      { error: "Missing authorization code" },
      { status: 400 }
    );
  }

  const redirectUri = `${url.origin}/oauth/callback`;

  // Intercambiar code por tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error(`[oauth] Token exchange failed: ${body}`);
    return Response.json(
      { error: "Token exchange failed", status: tokenRes.status },
      { status: 502 }
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  if (!tokens.refresh_token) {
    return Response.json(
      {
        error: "No refresh_token received",
        hint: "Revoke access at https://myaccount.google.com/permissions and retry with prompt=consent",
      },
      { status: 400 }
    );
  }

  // Guardar en Supabase
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await updateOAuthToken(
    { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY },
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    }
  );

  console.log("[oauth] Tokens saved to Supabase");

  return Response.json({
    ok: true,
    message: "OAuth complete — tokens saved. You can close this tab.",
    expires_at: expiresAt,
  });
}
