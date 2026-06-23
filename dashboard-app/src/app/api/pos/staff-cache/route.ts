// GET /api/pos/staff-cache — returns staff list with HASHED PINs for offline cache.
// PINs are hashed server-side with SHA-256 before sending to the client.
// The client hashes the entered PIN and compares locally for offline auth.

import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(pin + '_fullsite_salt')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function GET(request: Request) {
  const clientId = request.headers.get('x-client-id') || 'amalay'

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,name,role,pin`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ staff: [] })

    const staff = await res.json()
    // Hash PINs server-side — never send raw PINs to client
    const safeStaff = await Promise.all(
      staff.map(async (s: { id: string; name: string; role: string; pin: string }) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        pinHash: await hashPin(s.pin),
      }))
    )
    return NextResponse.json({ staff: safeStaff })
  } catch {
    return NextResponse.json({ staff: [] })
  }
}
