import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { locationBelongsToClient, validateMetadata, MetadataInvalida } from '@/lib/terminal-enrollment'

// ── Control Plane · terminales enroladas (device binding) ────────────────────
// El super-admin da de alta / baja las terminales autorizadas de un cliente.
// Con pos.require_enrolled_terminal activado, solo estas terminales pueden
// llegar al login por PIN. Admin-gated (2FA) + service_role.
//   GET    ?clientId=amalay                              → { terminals: [...] }
//   POST   { clientId, device_id, location_id, ... }      → enrola (upsert active=true)
//   PATCH  { clientId, device_id, active }                → activa/desactiva
//
// Toda alta NUEVA exige location_id de una sucursal del mismo tenant (se valida server-side
// contra client_locations). PATCH sólo cambia `active`: no puede mover tenant ni sucursal.

export const dynamic = 'force-dynamic'

const DEVICE_RE = /^[\w-]{1,64}$/
const LOCATION_RE = /^[\w-]{1,64}$/
const ROLE_RE = /^[a-z_]{1,24}$/

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'missing clientId' }, { status: 400 })
  try {
    // location_id incluido: las filas legacy lo traen NULL y deben seguir apareciendo.
    const res = await platformServiceFetch(
      `pos_terminals?client_id=eq.${encodeURIComponent(clientId)}&select=device_id,label,active,location_id,role,channel,status,enrolled_at,last_seen&order=enrolled_at.desc`
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
  let body: {
    clientId?: string; device_id?: string; label?: string
    location_id?: string; role?: string; metadata?: unknown
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { clientId, device_id, label, location_id, role } = body
  if (!clientId || !device_id) return NextResponse.json({ error: 'missing clientId/device_id' }, { status: 400 })
  if (!DEVICE_RE.test(device_id)) return NextResponse.json({ error: 'device_id inválido' }, { status: 400 })

  // Alta nueva: sucursal obligatoria y del mismo tenant (decisión 2 + 8).
  if (!location_id || !LOCATION_RE.test(location_id)) {
    return NextResponse.json({ error: 'location_id requerido para dar de alta una terminal' }, { status: 400 })
  }
  if (!(await locationBelongsToClient(clientId, location_id))) {
    return NextResponse.json({ error: 'location_id no es una sucursal activa de este tenant' }, { status: 400 })
  }
  if (role !== undefined && !ROLE_RE.test(role)) {
    return NextResponse.json({ error: 'role inválido' }, { status: 400 })
  }
  // metadata: whitelist + sin secretos + tope de tamaño (decisión 9).
  let metadata: Record<string, string | number | boolean>
  try { metadata = validateMetadata(body.metadata) }
  catch (e) {
    if (e instanceof MetadataInvalida) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  try {
    const res = await platformServiceFetch('pos_terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        client_id: clientId, device_id, location_id,
        label: label || null, role: role || null,
        metadata, active: true,
      }),
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
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const clientId = body.clientId as string | undefined
  const device_id = body.device_id as string | undefined
  const active = body.active
  if (!clientId || !device_id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'missing clientId/device_id/active' }, { status: 400 })
  }
  // PATCH sólo activa/desactiva. No puede reasignar tenant ni sucursal: intentar cambiar
  // client_id, device_id o location_id se rechaza en vez de ignorarse en silencio.
  for (const campo of ['client_id', 'new_client_id', 'location_id', 'new_device_id']) {
    if (campo in body) {
      return NextResponse.json({ error: `PATCH no puede cambiar ${campo}` }, { status: 400 })
    }
  }
  try {
    // El WHERE ancla client_id + device_id: la escritura no puede tocar otro tenant.
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
