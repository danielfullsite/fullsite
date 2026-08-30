import { NextRequest, NextResponse } from 'next/server'
import { platformServiceFetch } from '@/lib/platform-auth'
import { hashEnrollmentCode } from '@/lib/terminal-enrollment'

// ── Canje del código de enrolamiento (device-facing) ─────────────────────────
// La terminal intercambia su código de un solo uso por la IDENTIDAD que le asignó la
// plataforma. No hay 2FA de admin: la autorización ES el código. El código nunca lo eligió
// el dispositivo, y la identidad (device_id, client_id, location_id) tampoco.
//
//   POST { code } → { device_id, client_id, location_id, role, label }
//
// Falla CERRADO ante código inválido, vencido o ya usado, con un mensaje genérico (no revela
// si el código existía, si venció o si ya se usó). El código en claro nunca se registra.

export const dynamic = 'force-dynamic'

// Respuesta única para todo fracaso: no filtra en qué etapa falló.
const RECHAZO = NextResponse.json({ error: 'código inválido o vencido' }, { status: 400 })

export async function POST(req: NextRequest) {
  let body: { code?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  // Rango de longitud del código que emitimos (base64url de 24 bytes ≈ 32 chars). Acota el
  // trabajo sin revelar nada.
  if (code.length < 16 || code.length > 128) return RECHAZO

  const codeHash = hashEnrollmentCode(code)
  const nowIso = new Date().toISOString()

  try {
    // Canje ATÓMICO y de un solo uso: sólo sella claimed_at si sigue NULL y no venció. Un
    // segundo intento con el mismo código no matchea (ya tiene claimed_at) → RECHAZO. La
    // condición de expiración va en el mismo UPDATE, así que un código vencido tampoco pasa.
    const res = await platformServiceFetch(
      `pos_terminal_enrollments?code_hash=eq.${encodeURIComponent(codeHash)}` +
        `&claimed_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ claimed_at: nowIso }),
      }
    )
    if (!res.ok) return RECHAZO
    const rows = await res.json().catch(() => [])
    if (!Array.isArray(rows) || rows.length !== 1) return RECHAZO

    const e = rows[0] as {
      client_id: string; location_id: string; role: string | null
      label: string | null; device_id: string
    }

    // Materializa la terminal con la identidad ASIGNADA. Idempotente: merge-duplicates sobre
    // (client_id, device_id) evita duplicar si el canje se materializa dos veces.
    const up = await platformServiceFetch('pos_terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        client_id: e.client_id, device_id: e.device_id, location_id: e.location_id,
        role: e.role, label: e.label, active: true,
      }),
    })
    if (!up.ok) return NextResponse.json({ error: 'no se pudo materializar la terminal' }, { status: 500 })

    // Sólo la identidad asignada. Nunca el code_hash ni el código.
    return NextResponse.json({
      device_id: e.device_id, client_id: e.client_id,
      location_id: e.location_id, role: e.role, label: e.label,
    })
  } catch {
    return RECHAZO
  }
}
