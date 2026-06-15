// GET /api/pos/staff-cache — returns all staff PINs for offline cache pre-population.
// Uses service key (server-side only) so PINs never travel through the browser network tab.
// The client stores them hashed in localStorage for offline PIN verification.

import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function GET(request: Request) {
  const clientId = request.headers.get('x-client-id') || 'amalay'

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,name,role,pin`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ staff: [] })

    const staff = await res.json()
    return NextResponse.json({ staff })
  } catch {
    return NextResponse.json({ staff: [] })
  }
}
