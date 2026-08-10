// BUG-019-C — POST /api/public/qr-order
// Secure token-based public order creation. Resolves tenant from the token server-side,
// reprices everything, and creates exactly one `abierta` order with no kitchen side
// effects. Idempotent by submission_id. Generic errors; token never echoed to body/logs.
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createPublicOrder, MAX_LINES, type PublicSubmission } from '@/lib/public-order'
import { PublicMenuConfigError } from '@/lib/public-menu'

const MAX_BODY = 32 * 1024 // 32KB — bound payload size
const WINDOW_MS = 60_000
const MAX_REQ = 20
const hits = new Map<string, { n: number; reset: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const e = hits.get(ip)
  if (!e || now > e.reset) { hits.set(ip, { n: 1, reset: now + WINDOW_MS }); return false }
  e.n++
  return e.n > MAX_REQ
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (rateLimited(ip)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const raw = await req.text()
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })

  let parsed: { token?: unknown; items?: unknown; submission_id?: unknown; customer_name?: unknown; personas?: unknown }
  try { parsed = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }

  const token = typeof parsed.token === 'string' ? parsed.token : ''
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404 }) // generic, no token echo
  if (!Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > MAX_LINES) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const submission: PublicSubmission = {
    submission_id: typeof parsed.submission_id === 'string' ? parsed.submission_id : '',
    items: parsed.items as PublicSubmission['items'],
    customer_name: typeof parsed.customer_name === 'string' ? parsed.customer_name : undefined,
    personas: typeof parsed.personas === 'number' ? parsed.personas : undefined,
  }

  try {
    const result = await createPublicOrder(token, submission, () => randomUUID())
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    if (err instanceof PublicMenuConfigError) return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 })
    console.error('[qr-order] create error') // no token, no payload
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
}
