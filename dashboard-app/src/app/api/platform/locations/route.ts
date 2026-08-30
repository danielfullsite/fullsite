import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// Sucursales de un cliente, para poblar el selector al provisionar o enrolar terminales.
// Admin-gated (2FA) + service_role. Read-only.
//   GET /api/platform/locations?clientId=amalay → { locations: [{id,name,active}] }

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  const clientId = req.nextUrl.searchParams.get('clientId') || ''
  if (!CLIENT_RE.test(clientId)) return Response.json({ error: 'clientId inválido' }, { status: 400 })

  try {
    const res = await platformServiceFetch(
      `client_locations?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,name,active&order=name`,
      { headers: { Accept: 'application/json' } }
    )
    const locations = res.ok ? await res.json() : []
    return Response.json({ locations: Array.isArray(locations) ? locations : [] })
  } catch {
    return Response.json({ error: 'read failed' }, { status: 500 })
  }
}
