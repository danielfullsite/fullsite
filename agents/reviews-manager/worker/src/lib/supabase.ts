/**
 * Cliente Supabase REST — CRUD para google_reviews y review_actions_log.
 *
 * Usa fetch directo contra la REST API de Supabase (PostgREST).
 * No usa SDK para mantener el worker sin dependencias.
 */

interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

const DEFAULT_CLIENT_SLUG = "amalay";

// --- google_reviews ---

export type ReviewStatus =
  | "pending"
  | "ai_drafted"
  | "awaiting_approval"
  | "auto_approved"
  | "replied"
  | "flagged"
  | "ignored"
  | "error";

export interface GoogleReview {
  id?: string;
  client_slug?: string;
  review_id: string;
  reviewer_name: string | null;
  reviewer_photo_url?: string | null;
  star_rating: number;
  comment: string | null;
  review_reply?: string | null;
  review_reply_at?: string | null;
  create_time: string;
  update_time?: string | null;
  status?: ReviewStatus;
  ai_draft?: string | null;
  ai_draft_at?: string | null;
  generation_model?: string | null;
  approved_by?: string | null;
  telegram_message_id?: number | null;
  error_message?: string | null;
  retry_count?: number;
  metadata?: Record<string, unknown>;
}

export async function upsertReview(
  config: SupabaseConfig,
  review: GoogleReview
): Promise<GoogleReview> {
  const payload = { client_slug: DEFAULT_CLIENT_SLUG, ...review };
  const res = await sbFetch(config, "/rest/v1/google_reviews", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as GoogleReview[];
  return data[0];
}

export async function getPendingReviews(
  config: SupabaseConfig,
  clientSlug = DEFAULT_CLIENT_SLUG
): Promise<GoogleReview[]> {
  const res = await sbFetch(
    config,
    `/rest/v1/google_reviews?client_slug=eq.${clientSlug}&status=eq.pending&order=create_time.desc&limit=20`
  );
  return (await res.json()) as GoogleReview[];
}

export async function updateReviewDraft(
  config: SupabaseConfig,
  reviewId: string,
  draft: string,
  model: string
): Promise<void> {
  await sbFetch(config, `/rest/v1/google_reviews?id=eq.${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ai_draft: draft,
      ai_draft_at: new Date().toISOString(),
      generation_model: model,
      status: "ai_drafted",
    }),
  });
}

export async function updateReviewStatus(
  config: SupabaseConfig,
  reviewId: string,
  status: ReviewStatus,
  extra?: Partial<GoogleReview>
): Promise<void> {
  await sbFetch(config, `/rest/v1/google_reviews?id=eq.${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...extra }),
  });
}

// --- review_actions_log ---

export interface ReviewAction {
  review_id: string;
  action: string;
  actor?: string;
  details?: Record<string, unknown>;
}

export async function logAction(
  config: SupabaseConfig,
  action: ReviewAction
): Promise<void> {
  await sbFetch(config, "/rest/v1/review_actions_log", {
    method: "POST",
    body: JSON.stringify(action),
  });
}

// --- google_oauth_tokens ---

export interface OAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  account_id?: string;
  location_id?: string;
}

export async function getOAuthToken(
  config: SupabaseConfig,
  clientSlug = DEFAULT_CLIENT_SLUG
): Promise<OAuthToken | null> {
  const res = await sbFetch(
    config,
    `/rest/v1/google_oauth_tokens?client_slug=eq.${clientSlug}&provider=eq.google_gbp&limit=1`
  );
  const data = (await res.json()) as OAuthToken[];
  return data[0] ?? null;
}

export async function updateOAuthToken(
  config: SupabaseConfig,
  token: Partial<OAuthToken>,
  clientSlug = DEFAULT_CLIENT_SLUG
): Promise<void> {
  await sbFetch(
    config,
    `/rest/v1/google_oauth_tokens?client_slug=eq.${clientSlug}&provider=eq.google_gbp`,
    {
      method: "PATCH",
      body: JSON.stringify(token),
    }
  );
}

// --- fetch helper ---

async function sbFetch(
  config: SupabaseConfig,
  path: string,
  init?: RequestInit & { headers?: Record<string, string> }
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    ...init?.headers,
  };

  const res = await fetch(`${config.url}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
  }

  return res;
}
