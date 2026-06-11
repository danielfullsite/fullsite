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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
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
  // Solo páginas: excluir API, estáticos y archivos con extensión
  matcher: ['/((?!api|_next|favicon.ico|.*\\..*).*)'],
}
