import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · config por-tenant ────────────────────────────────────────
// Permite al super-admin VER y EDITAR los pos_settings de cualquier cliente sin
// SQL (estaciones/KDS, catálogos, etc.). Admin-gated (2FA) + service_role.
//   GET  ?clientId=amalay        → { pos_settings }
//   POST { clientId, key, value } → merge en clients.pos_settings

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'missing clientId' }, { status: 400 })
  try {
    const res = await platformServiceFetch(
      `clients?id=eq.${encodeURIComponent(clientId)}&select=id,display_name,pos_settings&limit=1`
    )
    const rows = res.ok ? await res.json() : []
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'client not found' }, { status: 404 })
    return NextResponse.json({ clientId, display_name: rows[0].display_name, pos_settings: rows[0].pos_settings || {} })
  } catch {
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  let body: { clientId?: string; key?: string; value?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { clientId, key, value } = body
  if (!clientId || !key) return NextResponse.json({ error: 'missing clientId/key' }, { status: 400 })
  // Solo llaves pos.* (evita escribir cualquier cosa arbitraria).
  if (!key.startsWith('pos.')) return NextResponse.json({ error: 'key not allowed' }, { status: 403 })
  try {
    // Merge: lee pos_settings actual y sobreescribe solo esta llave.
    const cur = await platformServiceFetch(`clients?id=eq.${encodeURIComponent(clientId)}&select=pos_settings&limit=1`)
    const rows = cur.ok ? await cur.json() : []
    const prev = (Array.isArray(rows) && rows[0]?.pos_settings) || {}
    const next = { ...prev, [key]: value }
    const res = await platformServiceFetch(`clients?id=eq.${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ pos_settings: next }),
    })
    if (!res.ok) return NextResponse.json({ error: `write failed ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true, clientId, key, value })
  } catch {
    return NextResponse.json({ error: 'write failed' }, { status: 500 })
  }
}
