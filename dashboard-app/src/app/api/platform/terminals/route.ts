import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import {
  locationBelongsToClient, validateMetadata, MetadataInvalida,
  generateDeviceId, generateEnrollmentCode, hashEnrollmentCode,
} from '@/lib/terminal-enrollment'

// ── Control Plane · alta de terminales ───────────────────────────────────────
// La PLATAFORMA genera la identidad. El dispositivo nunca elige device_id, client_id ni
// location_id. Admin-gated (2FA) + service_role.
//   GET    ?clientId=amalay                       → { terminals: [...] }  (incluye legacy)
//   POST   { clientId, location_id, role?, ... }   → crea un enrolamiento: el servidor
//          genera device_id + un CÓDIGO de un solo uso, guarda sólo su hash, y devuelve el
//          código UNA vez. La terminal lo canjea en POST /api/platform/terminal-claim.
//   PATCH  { clientId, device_id, active }         → activa/desactiva (fila ya existente)
//
// device_id en el body se RECHAZA: un alta nueva no acepta un identificador aportado por el
// cliente. Las filas legacy (enroladas antes de esto) siguen leyéndose y alternándose por
// GET/PATCH — ése es su camino explícito y separado.

export const dynamic = 'force-dynamic'

const LOCATION_RE = /^[\w-]{1,64}$/
const ROLE_RE = /^[a-z_]{1,24}$/
const ENROLL_TTL_MIN = 15  // el código vive 15 minutos

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
    clientId?: string; label?: string
    location_id?: string; role?: string; metadata?: unknown
    device_id?: unknown
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const { clientId, label, location_id, role } = body

  // El dispositivo NO elige su identidad. Un device_id aportado por el cliente se rechaza,
  // no se ignora: deja claro que este endpoint no lo acepta.
  if ('device_id' in body) {
    return NextResponse.json({ error: 'device_id lo genera la plataforma; no se acepta en el alta' }, { status: 400 })
  }
  if (!clientId) return NextResponse.json({ error: 'missing clientId' }, { status: 400 })

  // Sucursal obligatoria y del mismo tenant (decisión 2 + 8).
  if (!location_id || !LOCATION_RE.test(location_id)) {
    return NextResponse.json({ error: 'location_id requerido para dar de alta una terminal' }, { status: 400 })
  }
  if (!(await locationBelongsToClient(clientId, location_id))) {
    return NextResponse.json({ error: 'location_id no es una sucursal activa de este tenant' }, { status: 400 })
  }
  if (role !== undefined && !ROLE_RE.test(role)) {
    return NextResponse.json({ error: 'role inválido' }, { status: 400 })
  }
  // metadata: whitelist + sin secretos + tope de tamaño (decisión 9). Aunque el alta ya no
  // escribe metadata directo, se valida por si viene, para no arrastrar entrada no saneada.
  try { validateMetadata(body.metadata) }
  catch (e) {
    if (e instanceof MetadataInvalida) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Identidad y código: los genera el servidor. El código en claro se devuelve una vez y
  // sólo se persiste su hash.
  const device_id = generateDeviceId()
  const code = generateEnrollmentCode()
  const codeHash = hashEnrollmentCode(code)
  const expiresAt = new Date(Date.now() + ENROLL_TTL_MIN * 60_000).toISOString()

  try {
    const res = await platformServiceFetch('pos_terminal_enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_id: clientId, location_id, role: role || null,
        label: label || null, device_id,
        code_hash: codeHash, expires_at: expiresAt,
      }),
    })
    if (!res.ok) return NextResponse.json({ error: `write failed ${res.status}` }, { status: 500 })
    // El código va en la respuesta UNA vez. device_id no es secreto (es un identificador).
    // NO se registra el código en ningún log.
    return NextResponse.json({ device_id, enrollment_code: code, expires_at: expiresAt })
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
