// BUG-019-G — POST /api/public/reservation. Server-mediated AMALAY reservation.
// Removes the browser anon INSERT into `reservaciones`; client_id + status are server-set.
import { NextResponse } from 'next/server'
import { createReservation, type ReservationInput } from '@/lib/public-forms'
import { PublicMenuConfigError } from '@/lib/public-menu'

const WINDOW_MS = 60_000, MAX_REQ = 15
const hits = new Map<string, { n: number; reset: number }>()
function limited(ip: string): boolean {
  const now = Date.now(); const e = hits.get(ip)
  if (!e || now > e.reset) { hits.set(ip, { n: 1, reset: now + WINDOW_MS }); return false }
  e.n++; return e.n > MAX_REQ
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const raw = await req.text()
  if (raw.length > 16 * 1024) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  let input: ReservationInput
  try { input = JSON.parse(raw) as ReservationInput } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  try {
    const result = await createReservation(input)
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    if (err instanceof PublicMenuConfigError) return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 })
    console.error('[reservation] create error')
    return NextResponse.json({ error: 'save_failed' }, { status: 502 })
  }
}
