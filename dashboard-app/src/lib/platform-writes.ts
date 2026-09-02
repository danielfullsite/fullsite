// Control Plane · shared helpers for /api/platform/* WRITE endpoints (Fase 4).
//
// Contract: every cross-tenant write goes through requirePlatformAdmin (in platform-auth.ts)
// + service_role via platformServiceFetch, and MUST record an append-only row in
// platform_audit_log (INSERT only; UPDATE/DELETE blocked by a DB trigger).
// This module owns:
//   - a simple in-memory per-admin rate limiter (fail-safe soft limit against runaway writes)
//   - the audit-log insert helper (actor derived from the verified admin ctx, never the client)
//   - a clients-count helper for affected_count on global actions.
//
// NEVER anon for writes. All writes are service_role, server-side only, inside an
// already admin-gated route.

import type { PlatformAdminContext } from './platform-auth'
import { platformServiceFetch } from './platform-auth'

// ── In-memory rate limit ─────────────────────────────────────────────────────
// Best-effort guard: max 20 writes/min per admin (keyed by userId). This is a soft
// safety net against a compromised/looping admin session, not a security boundary
// (the real boundary is requirePlatformAdmin). In-memory is acceptable: a single
// server instance; on scale-out each instance keeps its own window.
const RATE_LIMIT = 20
const WINDOW_MS = 60_000
const _hits = new Map<string, number[]>()

/** Returns a 429 Response if the admin exceeded the write budget, else null. */
export function rateLimit(ctx: PlatformAdminContext): Response | null {
  const now = Date.now()
  const key = ctx.userId || ctx.email
  const prev = (_hits.get(key) || []).filter(t => now - t < WINDOW_MS)
  if (prev.length >= RATE_LIMIT) {
    return Response.json(
      { error: `Límite de escrituras excedido (${RATE_LIMIT}/min). Intenta de nuevo en un momento.` },
      { status: 429 }
    )
  }
  prev.push(now)
  _hits.set(key, prev)
  return null
}

// ── Audit log (append-only) ──────────────────────────────────────────────────
export interface AuditEntry {
  action: string
  scope: 'global' | 'tenant'
  target_tenant?: string | null
  detail?: unknown
  affected_count?: number | null
}

/**
 * Insert a row into platform_audit_log. Actor is taken from the verified admin ctx,
 * NEVER from the request body. Best-effort: logs (does not throw) on failure so the
 * primary write result is still returned, but the failure is surfaced in the return.
 */
export async function auditLog(ctx: PlatformAdminContext, entry: AuditEntry): Promise<boolean> {
  try {
    const res = await platformServiceFetch('platform_audit_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{
        actor_email: ctx.email,
        actor_user_id: ctx.userId,
        action: entry.action,
        scope: entry.scope,
        target_tenant: entry.target_tenant ?? null,
        // La columna es NOT NULL: un null perdía el registro completo de auditoría.
        detail: entry.detail ?? {},
        affected_count: entry.affected_count ?? null,
      }]),
    })
    if (!res.ok) {
      console.error('[platform-audit] insert failed', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (err) {
    console.error('[platform-audit] insert error', err)
    return false
  }
}

/** COUNT of clients (for affected_count on global actions). Returns 0 on failure. */
export async function clientsCount(): Promise<number> {
  try {
    const res = await platformServiceFetch('clients?select=id', {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    })
    const range = res.headers.get('content-range')
    if (range) {
      const total = range.split('/')[1]
      return total === '*' ? 0 : parseInt(total, 10)
    }
    return 0
  } catch {
    return 0
  }
}
