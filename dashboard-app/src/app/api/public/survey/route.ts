// BUG-019-F — GET/POST /api/public/survey. Server-mediated survey config + response.
// Removes the browser anon read/write of wansoft_data. Generic errors; 503 fail-closed.
import { NextResponse } from 'next/server'
import { validateSurveyId, validateSurveyAnswers, getSurveyConfig, submitSurveyResponse } from '@/lib/public-forms'
import { PublicMenuConfigError } from '@/lib/public-menu'

const WINDOW_MS = 60_000, MAX_REQ = 30
const hits = new Map<string, { n: number; reset: number }>()
function limited(ip: string): boolean {
  const now = Date.now(); const e = hits.get(ip)
  if (!e || now > e.reset) { hits.set(ip, { n: 1, reset: now + WINDOW_MS }); return false }
  e.n++; return e.n > MAX_REQ
}
const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

export async function GET(req: Request) {
  if (limited(ipOf(req))) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const id = validateSurveyId(new URL(req.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  try {
    const config = await getSurveyConfig(id)
    if (config == null) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ config }, { status: 200 })
  } catch (err) {
    if (err instanceof PublicMenuConfigError) return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 })
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function POST(req: Request) {
  if (limited(ipOf(req))) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const raw = await req.text()
  if (raw.length > 64 * 1024) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  let parsed: { id?: unknown; answers?: unknown }
  try { parsed = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const id = validateSurveyId(parsed.id)
  if (!id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const v = validateSurveyAnswers(parsed.answers)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  try {
    const ua = req.headers.get('user-agent') || ''
    const result = await submitSurveyResponse(id, v.answers, ua, new Date().toISOString())
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    if (err instanceof PublicMenuConfigError) return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 })
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
}
