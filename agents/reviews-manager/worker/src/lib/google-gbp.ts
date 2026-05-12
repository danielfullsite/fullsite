/**
 * Cliente Google Business Profile API — fetch y reply de reseñas.
 *
 * Docs: https://developers.google.com/my-business/reference/rest
 */

const GBP_BASE = "https://mybusiness.googleapis.com/v4";

interface GBPReview {
  name: string;          // accounts/*/locations/*/reviews/*
  reviewId: string;
  reviewer: {
    displayName?: string;
    profilePhotoUrl?: string;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

interface GBPListResponse {
  reviews: GBPReview[];
  nextPageToken?: string;
  totalReviewCount?: number;
  averageRating?: number;
}

const STAR_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function parseStarRating(rating: string): number {
  return STAR_MAP[rating] ?? 0;
}

export async function listReviews(
  accessToken: string,
  accountId: string,
  locationId: string,
  pageSize = 50,
  pageToken?: string
): Promise<GBPListResponse> {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.set("pageToken", pageToken);

  const url = `${GBP_BASE}/accounts/${accountId}/locations/${locationId}/reviews?${params}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GBP listReviews failed (${res.status}): ${error}`);
  }

  return (await res.json()) as GBPListResponse;
}

export async function replyToReview(
  accessToken: string,
  reviewName: string,
  comment: string
): Promise<void> {
  const url = `${GBP_BASE}/${reviewName}/reply`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comment }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GBP replyToReview failed (${res.status}): ${error}`);
  }
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google OAuth refresh failed (${res.status}): ${error}`);
  }

  return (await res.json()) as { access_token: string; expires_in: number };
}

export type { GBPReview, GBPListResponse };
