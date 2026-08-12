import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog } from '@/lib/platform-writes'

// ── Control Plane · POST /api/platform/act-as ────────────────────────────────
// Impersonation real (act-as) del super-admin. "Entrar" a un tenant necesita que
// el admin PUEDA leer ese tenant, pero las lecturas del dashboard van con el JWT
// del usuario y RLS (BUG-019) las scopea por membresía en client_users. Así que
// aquí, vía service_role, se le da una membresía con rol marcador 'platform_actas'
// (distinguible de un dueño real) al tenant destino. Al salir, se elimina.
//
// Body: { client_id }          → entrar
//       { exit: true }         → salir de TODA impersonación (borra memberships actas)
//
// Gateado por requirePlatformAdmin. Auditado. El rol 'platform_actas' nunca se
// confunde con una membresía real y se limpia en exit.
export const dynamic = 'force-dynamic'

const CLIENT_ID_RE = /^[a-z0-9_-]{1,40}$/i
const ACTAS_ROLE = 'platform_actas'

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const { userId } = gate.ctx

  let body: { client_id?: string; exit?: boolean } = {}
  try { body = await req.json() } catch { /* body opcional */ }

  // ── Salir de la impersonación ──────────────────────────────────────────────
  if (body.exit) {
    const del = await platformServiceFetch(
      `client_users?user_id=eq.${userId}&role=eq.${ACTAS_ROLE}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
    )
    if (!del.ok) {
      const detail = await del.text().catch(() => '')
      return Response.json({ error: `No se pudo salir (${del.status})`, detail }, { status: 502 })
    }
    await auditLog(gate.ctx, { action: 'actas.exit', scope: 'global' })
    return Response.json({ ok: true, exited: true })
  }

  // ── Entrar a un tenant ─────────────────────────────────────────────────────
  const target = String(body.client_id || '').trim()
  if (!target || !CLIENT_ID_RE.test(target)) {
    return Response.json({ error: 'client_id inválido' }, { status: 400 })
  }

  // El tenant debe existir.
  const chk = await platformServiceFetch(
    `clients?id=eq.${encodeURIComponent(target)}&select=id,display_name`,
    { headers: { Accept: 'application/json' } }
  )
  const rows = chk.ok ? await chk.json().catch(() => []) : []
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'Tenant no encontrado' }, { status: 404 })
  }
  const display = rows[0].display_name || target

  // Limpia cualquier impersonación previa (solo una activa a la vez) y crea la nueva.
  await platformServiceFetch(
    `client_users?user_id=eq.${userId}&role=eq.${ACTAS_ROLE}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
  )
  const ins = await platformServiceFetch('client_users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ user_id: userId, client_id: target, role: ACTAS_ROLE }]),
  })
  if (!ins.ok) {
    const detail = await ins.text().catch(() => '')
    return Response.json({ error: `No se pudo entrar (${ins.status})`, detail }, { status: 502 })
  }

  await auditLog(gate.ctx, { action: 'actas.enter', scope: 'tenant', target_tenant: target })
  return Response.json({ ok: true, client_id: target, display_name: display })
}
