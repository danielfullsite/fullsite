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
//       { revoke_user_id }     → revocar la impersonación de otro admin (auditado)
//       { revoke_all: true }   → revocar TODAS las impersonaciones (auditado)
//
// Gateado por requirePlatformAdmin. Auditado. El rol 'platform_actas' nunca se
// confunde con una membresía real y se limpia en exit.
export const dynamic = 'force-dynamic'

const CLIENT_ID_RE = /^[a-z0-9_-]{1,40}$/i
const ACTAS_ROLE = 'platform_actas'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Caducidad: la membresía act-as vale ACTAS_TTL_MINUTES (default 60) desde su
// created_at; la aplica withPOSAuth (src/lib/api-auth.ts). Volver a "entrar"
// borra la fila anterior e inserta una nueva, o sea que renueva la ventana.

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const { userId } = gate.ctx

  let body: { client_id?: string; exit?: boolean; revoke_user_id?: string; revoke_all?: boolean } = {}
  try { body = await req.json() } catch { /* body opcional */ }

  // ── Revocar la impersonación de OTRO admin (F-05, contención 2026-09-23) ────
  // { revoke_user_id: <uuid> } → borra las membresías act-as de ese usuario.
  // { revoke_all: true }       → borra TODAS las membresías act-as vigentes.
  // Auditado con el actor que revoca y el/los tenant(s) afectados. La revocación
  // se aplica aunque la auditoría falle (quitar acceso nunca se bloquea), pero la
  // respuesta lo dice (`audited:false`).
  if (body.revoke_all === true || body.revoke_user_id !== undefined) {
    let filtro = `role=eq.${ACTAS_ROLE}`
    if (body.revoke_all !== true) {
      const target = String(body.revoke_user_id || '').trim()
      if (!UUID_RE.test(target)) return Response.json({ error: 'revoke_user_id inválido' }, { status: 400 })
      filtro = `user_id=eq.${target}&${filtro}`
    }
    const del = await platformServiceFetch(`client_users?${filtro}`, {
      method: 'DELETE', headers: { Prefer: 'return=representation', Accept: 'application/json' },
    })
    if (!del.ok) {
      const detail = await del.text().catch(() => '')
      return Response.json({ error: `No se pudo revocar (${del.status})`, detail }, { status: 502 })
    }
    const gone = await del.json().catch(() => []) as { user_id?: string; client_id?: string }[]
    const revocadas = Array.isArray(gone) ? gone.map(r => ({ user_id: r.user_id, client_id: r.client_id })) : []
    const tenants = Array.from(new Set(revocadas.map(r => r.client_id).filter(Boolean))) as string[]
    const audited = await auditLog(gate.ctx, {
      action: 'actas.revoke',
      scope: tenants.length === 1 ? 'tenant' : 'global',
      target_tenant: tenants.length === 1 ? tenants[0] : null,
      detail: { revoke_all: body.revoke_all === true, revoke_user_id: body.revoke_user_id ?? null, revocadas },
      affected_count: revocadas.length,
    })
    return Response.json({ ok: true, revocadas: revocadas.length, audited })
  }

  // ── Salir de la impersonación ──────────────────────────────────────────────
  if (body.exit) {
    const del = await platformServiceFetch(
      `client_users?user_id=eq.${userId}&role=eq.${ACTAS_ROLE}`,
      { method: 'DELETE', headers: { Prefer: 'return=representation', Accept: 'application/json' } }
    )
    if (!del.ok) {
      const detail = await del.text().catch(() => '')
      return Response.json({ error: `No se pudo salir (${del.status})`, detail }, { status: 502 })
    }
    // La auditoría guarda el tenant del que se sale (antes quedaba sin tenant).
    const gone = await del.json().catch(() => []) as { client_id?: string }[]
    const tenants = Array.isArray(gone) ? Array.from(new Set(gone.map(r => r.client_id).filter(Boolean))) as string[] : []
    await auditLog(gate.ctx, {
      action: 'actas.exit',
      scope: tenants.length === 1 ? 'tenant' : 'global',
      target_tenant: tenants.length === 1 ? tenants[0] : null,
      detail: { tenants },
    })
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

  // Limpia cualquier impersonación previa (solo una activa a la vez).
  await platformServiceFetch(
    `client_users?user_id=eq.${userId}&role=eq.${ACTAS_ROLE}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
  )

  // Si el admin YA es miembro real del tenant (ej. dueño de todos los tenants),
  // NO crear una membresía de impersonación: ya puede leer vía RLS, y una fila
  // extra sólo ensucia la resolución de "home". Sólo se inserta para admins que
  // no son miembros del tenant destino.
  const memChk = await platformServiceFetch(
    `client_users?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(target)}&role=neq.${ACTAS_ROLE}&select=id&limit=1`,
    { headers: { Accept: 'application/json' } }
  )
  const memRows = memChk.ok ? await memChk.json().catch(() => []) : []
  const alreadyMember = Array.isArray(memRows) && memRows.length > 0

  // H4 (revisión PR5): entrar (o renovar la ventana al re-entrar) SIN rastro no se
  // permite. La auditoría va ANTES de crear la membresía: si falla → 503 y no se
  // crea nada (la impersonación previa ya se limpió arriba: falla cerrado). Si la
  // inserción falla después, el registro queda como intento de entrada.
  const audited = await auditLog(gate.ctx, { action: 'actas.enter', scope: 'tenant', target_tenant: target, detail: { renovacion_o_entrada: true, ya_miembro: alreadyMember } })
  if (!audited) {
    return Response.json({ error: 'No se pudo auditar la entrada; no se entró al tenant' }, { status: 503 })
  }

  if (!alreadyMember) {
    const ins = await platformServiceFetch('client_users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{ user_id: userId, client_id: target, role: ACTAS_ROLE }]),
    })
    if (!ins.ok) {
      const detail = await ins.text().catch(() => '')
      return Response.json({ error: `No se pudo entrar (${ins.status})`, detail }, { status: 502 })
    }
  }

  return Response.json({ ok: true, client_id: target, display_name: display })
}
