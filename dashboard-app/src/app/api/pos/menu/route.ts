// Complete catalog downloaded by Caja after online PIN authentication.
// Existing offline-shell response fields are preserved.
import { NextResponse, NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { fetchCompletePosCatalog } from '@/lib/pos-menu-catalog'

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  try {
    const catalog = await fetchCompletePosCatalog({ clientId: auth.clientId,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    })
    return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudo preparar el catálogo completo' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
