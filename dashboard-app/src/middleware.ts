import { NextResponse, NextRequest } from 'next/server'

// CORS para el Offline Shell (Electron). La UI se sirve desde el bridge local
// http://<ip>:7717 y hace fetch cross-origin a /api/* en la nube (login, menú).
// Sin estos headers el navegador bloquea la respuesta → "Sin conexión" en el POS.
// Solo se abre para el puerto del bridge (7717) en loopback/LAN privada; el POS
// de nube es mismo-origen y no pasa por aquí.
const BRIDGE_ORIGIN =
  /^http:\/\/(127\.0\.0\.1|localhost|(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}):7717$/

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-id',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  }
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') || ''
  if (!BRIDGE_ORIGIN.test(origin)) return NextResponse.next()

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
  }
  const res = NextResponse.next()
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v)
  return res
}

export const config = {
  matcher: '/api/:path*',
}
