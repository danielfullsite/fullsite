import { NextResponse, type NextRequest } from 'next/server'
import { canAccessPage, resolveRole } from '@/lib/roles'

// Páginas sin sesión — debe coincidir con publicPages de AppShell.tsx
const PUBLIC_PAGES = ['/login', '/seguridad', '/privacidad', '/terminos', '/reservar', '/factura', '/demo-live']

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PAGES.includes(pathname) ||
    pathname.startsWith('/pos') || // gate propio por PIN
    pathname.startsWith('/demo') ||
    pathname.startsWith('/menu') || // QR de mesa (cliente final)
    pathname.startsWith('/encuesta')
  )
}

// Orígenes del POS empaquetado (Capacitor) — necesitan CORS para llamar /api offline-first
const CAPACITOR_ORIGINS = ['capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost']

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

// ─── Rate limiter (anti-scraping) ────────────────────────────────────────────
const rateMap = new Map<string, { count: number; reset: number }>()
const RATE_LIMIT = 60 // requests per minute
const RATE_WINDOW = 60_000

function checkRate(ip: string, pathname: string): { ok: boolean; remaining: number } {
  // POS pages poll frequently — exempt
  if (pathname.startsWith('/pos') || pathname.startsWith('/api/pos') || pathname.startsWith('/_next')) {
    return { ok: true, remaining: RATE_LIMIT }
  }
  const now = Date.now()
  const entry = rateMap.get(ip)
  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + RATE_WINDOW })
    return { ok: true, remaining: RATE_LIMIT - 1 }
  }
  entry.count++
  if (entry.count > RATE_LIMIT) {
    // Log suspicious activity (100+ req/min)
    if (entry.count === 101) {
      const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (sbUrl && sbKey) {
        fetch(`${sbUrl}/rest/v1/agent_runs`, {
          method: 'POST',
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ agent_id: `anti-scraping`, trigger_type: 'auto', status: 'alert', output_summary: `${ip} | ${entry.count}req/min | ${pathname}`, tentacle: 'security' }),
        }).catch(() => {})
      }
    }
    return { ok: false, remaining: 0 }
  }
  return { ok: true, remaining: RATE_LIMIT - entry.count }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rate = checkRate(ip, pathname)
  if (!rate.ok) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'Retry-After': '60' } })
  }

  // CORS para /api desde la app nativa (capacitor://localhost). Same-origin no se afecta.
  if (pathname.startsWith('/api')) {
    const origin = req.headers.get('origin') || ''
    const allowed = CAPACITOR_ORIGINS.includes(origin)
    if (req.method === 'OPTIONS' && allowed) {
      return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
    }
    const res = NextResponse.next()
    if (allowed) for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v)
    return res
  }

  if (isPublic(pathname)) return NextResponse.next()

  const token = req.cookies.get('fs-at')?.value
  const loginUrl = new URL('/login', req.url)

  if (!token) return NextResponse.redirect(loginUrl)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return NextResponse.next() // mal configurado: no bloquear

  // Validar el token contra Supabase Auth (server-side, no falsificable)
  let user: { email?: string; app_metadata?: { role?: string } } | null = null
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const redirect = NextResponse.redirect(loginUrl)
      redirect.cookies.delete('fs-at')
      return redirect
    }
    user = await res.json()
  } catch {
    // Supabase caído: dejar pasar — el cliente igual no podrá leer datos sin red
    return NextResponse.next()
  }

  // Enforcement de rol por página (app_metadata.role lo setea el servidor, no el usuario)
  const role = resolveRole(user?.app_metadata?.role, user?.email)
  if (!canAccessPage(role, pathname)) {
    const fallback = canAccessPage(role, '/') ? '/' : '/pos'
    return NextResponse.redirect(new URL(fallback, req.url))
  }

  return NextResponse.next()
}

export const config = {
  // Páginas + /api (para CORS); excluir estáticos y archivos con extensión
  matcher: ['/((?!_next|favicon.ico|.*\\..*).*)'],
}
