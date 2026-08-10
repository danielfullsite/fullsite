// BUG-019-B — GET /api/public/menu?token=<opaque-table-token>
// Server-mediated public menu. Resolves tenant from the token server-side, reads
// only public menu fields with the service role, and fails closed with a GENERIC
// 404 for any unresolved token. The token is never echoed into the body, headers,
// or logs; errors are generic. Missing service key -> 503 (no anon fallback).
import { NextResponse } from 'next/server'
import { resolveTableByToken, getPublicMenu, PublicMenuConfigError } from '@/lib/public-menu'

// Defense-in-depth only (menu is public data; it is NOT the tenant boundary).
// In-memory IP limiter, same pattern as /api/pos/pin — no new persistence dep.
const WINDOW_MS = 60_000
const MAX_REQ = 60
const hits = new Map<string, { n: number; reset: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const e = hits.get(ip)
  if (!e || now > e.reset) { hits.set(ip, { n: 1, reset: now + WINDOW_MS }); return false }
  e.n++
  return e.n > MAX_REQ
}

// Generic, identical for every failure mode — never reveals whether a specific
// token/tenant/table exists.
function notFound() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const token = new URL(req.url).searchParams.get('token') || ''
  try {
    const table = await resolveTableByToken(token)
    if (!table) return notFound() // malformed / unknown / inactive / location-less
    const menu = await getPublicMenu(table.client_id, table.mesa)
    return NextResponse.json(menu, { status: 200 })
  } catch (err) {
    if (err instanceof PublicMenuConfigError) {
      return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 })
    }
    // Never surface the token or internal detail.
    console.error('[public-menu] read error') // no token, no payload
    return notFound()
  }
}
