import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { sameOriginOnly } from '@/lib/api-guard'
import type { PermSection } from '@/lib/roles'

/**
 * Permisos por empleado (PR 2 · Square/Toast). GET lista los overrides del tenant;
 * POST guarda/borra el override de un usuario.
 *
 * BLINDAJE (mismo molde que owner/users):
 *  - sameOriginOnly en mutaciones.
 *  - Solo DUEÑO gestiona permisos (otorgar accesos es del dueño).
 *  - clientId SIEMPRE del token server-side (withPOSAuth) — jamás del body.
 *  - Anti-lockout: el dueño no puede quitarse a SÍ MISMO la sección 'admin'.
 *  - El override solo RESTRINGE respecto al rol (el server valida por rol en cada
 *    endpoint); esta tabla es capa de visibilidad + defensa en profundidad.
 */
export const dynamic = 'force-dynamic'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.SUPABASE_SERVICE_KEY!
const MANAGER_ROLES = new Set(['dueño', 'admin'])
const VALID_SECTIONS: PermSection[] = ['pos', 'operacion', 'finanzas', 'inventario', 'agentes', 'cortes', 'admin']

function H() {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
}

export async function GET(req: NextRequest) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño' }, { status: 403 })

  const res = await fetch(
    `${SB_URL}/rest/v1/pos_staff_permissions?client_id=eq.${encodeURIComponent(auth.clientId)}&select=staff_id,sections,updated_at`,
    { headers: H(), cache: 'no-store' }
  )
  const rows = res.ok ? await res.json().catch(() => []) : []
  return Response.json({ permissions: rows })
}

export async function POST(req: NextRequest) {
  const cross = sameOriginOnly(req)
  if (cross) return cross
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!MANAGER_ROLES.has(auth.role)) return Response.json({ error: 'Requiere rol dueño' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    staff_id?: string
    sections?: Record<string, boolean> | null
  }
  const staffId = String(body.staff_id || '').trim()
  if (!staffId) return Response.json({ error: 'staff_id requerido' }, { status: 400 })

  // sections null/{} → borrar el override (el empleado vuelve a su rol).
  const raw = body.sections
  const clearing = !raw || Object.keys(raw).length === 0
  const sections: Record<string, boolean> = {}
  if (!clearing) {
    for (const k of VALID_SECTIONS) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) sections[k] = raw![k] === true
    }
  }

  // Anti-lockout: el dueño no puede quitarse a sí mismo el acceso a 'admin'
  // (donde vive esta pantalla). staffId de un usuario dashboard = su auth id.
  if (staffId === auth.staffId && !clearing && sections.admin === false) {
    return Response.json({ error: 'No puedes quitarte tu propio acceso de administración.' }, { status: 400 })
  }

  if (clearing) {
    const del = await fetch(
      `${SB_URL}/rest/v1/pos_staff_permissions?client_id=eq.${encodeURIComponent(auth.clientId)}&staff_id=eq.${encodeURIComponent(staffId)}`,
      { method: 'DELETE', headers: { ...H(), Prefer: 'return=minimal' } }
    )
    if (!del.ok) return Response.json({ error: 'No se pudo borrar el override' }, { status: 502 })
    return Response.json({ ok: true, cleared: true })
  }

  const up = await fetch(`${SB_URL}/rest/v1/pos_staff_permissions?on_conflict=client_id,staff_id`, {
    method: 'POST',
    headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ client_id: auth.clientId, staff_id: staffId, sections, updated_at: new Date().toISOString(), updated_by: auth.staffId }]),
  })
  if (!up.ok) {
    const detail = await up.text().catch(() => '')
    return Response.json({ error: `No se pudo guardar (${up.status})`, detail }, { status: 502 })
  }
  return Response.json({ ok: true, sections })
}
