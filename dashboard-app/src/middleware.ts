import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Rate limiting: simple in-memory counter per IP (resets on deploy)
const rateLimits = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 100 // requests per window
const RATE_WINDOW = 60_000 // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimits.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  entry.count++
  return entry.count <= RATE_LIMIT
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const path = request.nextUrl.pathname

  // Rate limit API routes
  if (path.startsWith('/api/')) {
    if (!checkRateLimit(ip)) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    }
  }

  // Security headers for all responses
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')

  return response
}

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)',
  ],
}
