import { timingSafeEqual } from 'crypto'

// BLINDAJE B1 (P1-9): antes era `password === correct` (compare no constante) sin
// throttle → fuerza bruta del password admin compartido. Ahora: comparación en
// tiempo constante + lockout por IP (best-effort per-instance; la versión durable
// va en B6).

const attempts = new Map<string, { n: number; until: number }>()
const MAX = 5
const LOCK_MS = 5 * 60 * 1000

function throttled(ip: string): boolean {
  const r = attempts.get(ip)
  return !!r && r.until > Date.now()
}
function markFail(ip: string) {
  const r = attempts.get(ip) || { n: 0, until: 0 }
  r.n += 1
  if (r.n >= MAX) { r.until = Date.now() + LOCK_MS; r.n = 0 }
  attempts.set(ip, r)
}
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (throttled(ip)) return Response.json({ error: 'Demasiados intentos, espera unos minutos' }, { status: 429 })

  const { password } = await request.json().catch(() => ({}))
  const correct = process.env.INTERNAL_ADMIN_PASSWORD
  if (!correct) return Response.json({ error: 'Not configured' }, { status: 500 })

  if (typeof password === 'string' && safeEqual(password, correct)) {
    attempts.delete(ip)
    return Response.json({ ok: true })
  }
  markFail(ip)
  return Response.json({ error: 'Wrong password' }, { status: 401 })
}
