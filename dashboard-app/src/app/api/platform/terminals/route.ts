import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'

// ── Control Plane · terminales enroladas (device binding) ────────────────────
// El super-admin da de alta / baja las terminales autorizadas de un cliente.
// Con pos.require_enrolled_terminal activado, solo estas terminales pueden
// llegar al login por PIN. Admin-gated (2FA) + service_role.
//   GET    ?clientId=amalay                     → { terminals: [...] }
//   POST   { clientId, device_id, label }        → enrola (upsert active=true)
//   PATCH  { clientId, device_id, active }        → activa/desactiva

export const dynamic = 'force-dynamic'

const DEVICE_RE = /^[\w-]{1,64}$/

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'missing clientId' }, { status: 400 })
  try {
    const res = await platformServiceFetch(
      `pos_terminals?client_id=eq.${encodeURIComponent(clientId)}&select=device_id,label,active,enrolled_at,last_seen&order=enrolled_at.desc`
    )
    const terminals = res.ok ? await res.json() : []
    return NextResponse.json({ terminals: Array.isArray(terminals) ? terminals : [] })
  } catch {
    return NextResponse.json({ error: 'read failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  let body: { clientId?: string; device_id?: string; label?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { clientId, device_id, label } = body
  if (!clientId || !device_id) return NextResponse.json({ error: 'missing clientId/device_id' }, { status: 400 })
  if (!DEVICE_RE.test(device_id)) return NextResponse.json({ error: 'device_id inválido' }, { status: 400 })
  try {
    const res = await platformServiceFetch('pos_terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ client_id: clientId, device_id, label: label || null, active: true }),
    })
    if (!res.ok) return NextResponse.json({ error: `write failed ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'write failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  let body: { clientId?: string; device_id?: string; active?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { clientId, device_id, active } = body
  if (!clientId || !device_id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'missing clientId/device_id/active' }, { status: 400 })
  }
  try {
    const res = await platformServiceFetch(
      `pos_terminals?client_id=eq.${encodeURIComponent(clientId)}&device_id=eq.${encodeURIComponent(device_id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ active }),
      }
    )
    if (!res.ok) return NextResponse.json({ error: `write failed ${res.status}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'write failed' }, { status: 500 })
  }
}
