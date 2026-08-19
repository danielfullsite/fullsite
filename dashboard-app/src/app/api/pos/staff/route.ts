import { NextRequest } from 'next/server'
import { verifyShiftToken } from '@/lib/shift-token'
import { generatePin10, isValidPin } from '@/lib/pos-pin'

// ─── Alta y gestión de staff del POS ─────────────────────────────────────────
// Los usuarios del POS se crean AQUÍ (en el POS), no en el dashboard.
// El PIN de 10 dígitos lo GENERA el sistema (aleatorio) — nadie lo elige ni lo
// memoriza; la huella es el acceso diario. Ver docs/product/DESIGN-HUELLAS-PIN.md.
//
// Todas las operaciones requieren un shift token de rol gerente+ (admin-gated).
// El client_id se toma del TOKEN (que ata al tenant), nunca del body — un gerente
// no puede crear staff en otro restaurante.

const ROLE_HIERARCHY: Record<string, number> = { mesero: 1, cajero: 2, barra: 2, capitan: 3, gerente: 4, admin: 5 }
const CREATABLE_ROLES = new Set(['mesero', 'cajero', 'barra', 'capitan', 'gerente'])

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
}

/** Verifica el shift token y exige rol gerente+. Devuelve el payload o null. */
async function requireManager(request: NextRequest) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return null
  const payload = await verifyShiftToken(token)
  if (!payload) return null
  if ((ROLE_HIERARCHY[payload.rol] || 0) < 4) return null // gerente+
  return payload
}

/** Set de PINs ya usados por el tenant (para evitar colisiones al generar). */
async function existingPins(clientId: string): Promise<Set<string>> {
  const { url, headers } = sb()
  const res = await fetch(
    `${url}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(clientId)}&select=pin`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return new Set()
  const rows = (await res.json()) as { pin: string }[]
  return new Set(rows.map(r => r.pin))
}

// ── POST — crear un empleado con PIN de 10 díg generado ──────────────────────
export async function POST(request: NextRequest) {
  try {
    const mgr = await requireManager(request)
    if (!mgr) return Response.json({ error: 'No autorizado (se requiere gerente+)' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'mesero'
    if (name.length < 2 || name.length > 60) return Response.json({ error: 'Nombre inválido' }, { status: 400 })
    if (!CREATABLE_ROLES.has(role)) return Response.json({ error: 'Rol inválido' }, { status: 400 })

    const clientId = mgr.cid
    const { url, headers } = sb()
    const used = await existingPins(clientId)

    // insertar con reintento por si choca el UNIQUE(pin, client_id)
    for (let attempt = 0; attempt < 5; attempt++) {
      const pin = generatePin10(used)
      const id = crypto.randomUUID()
      const res = await fetch(`${url}/rest/v1/pos_staff`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ id, client_id: clientId, name, pin, role, role_display: role, active: true }),
      })
      if (res.ok) {
        const rows = await res.json()
        const s = Array.isArray(rows) ? rows[0] : rows
        // el PIN se devuelve UNA sola vez (para enrolar/respaldo); no se vuelve a mostrar
        return Response.json({ staff: { id: s.id, name: s.name, role: s.role, active: s.active }, pin })
      }
      const txt = await res.text()
      if (res.status === 409 || /duplicate|unique/i.test(txt)) { used.add(pin); continue } // colisión → reintenta
      return Response.json({ error: 'No se pudo crear el empleado' }, { status: 502 })
    }
    return Response.json({ error: 'No se pudo generar un PIN único, reintenta' }, { status: 503 })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ── GET — listar staff del tenant (SIN exponer el PIN) ───────────────────────
export async function GET(request: NextRequest) {
  try {
    const mgr = await requireManager(request)
    if (!mgr) return Response.json({ error: 'No autorizado' }, { status: 401 })
    const { url, headers } = sb()
    const res = await fetch(
      `${url}/rest/v1/pos_staff?client_id=eq.${encodeURIComponent(mgr.cid)}&select=id,name,role,active,created_at&order=name.asc`,
      { headers, cache: 'no-store' }
    )
    const staff = res.ok ? await res.json() : []
    return Response.json({ staff }) // nunca incluye pin
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ── PATCH — desactivar / reactivar / regenerar PIN ───────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const mgr = await requireManager(request)
    if (!mgr) return Response.json({ error: 'No autorizado' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const staffId = typeof body.staff_id === 'string' ? body.staff_id : ''
    if (!staffId) return Response.json({ error: 'staff_id requerido' }, { status: 400 })

    const { url, headers } = sb()
    const scope = `id=eq.${encodeURIComponent(staffId)}&client_id=eq.${encodeURIComponent(mgr.cid)}`
    const patch: Record<string, unknown> = {}
    let newPin: string | undefined

    if (typeof body.active === 'boolean') patch.active = body.active
    if (body.regenerate_pin === true) {
      newPin = generatePin10(await existingPins(mgr.cid))
      patch.pin = newPin
    }
    if (typeof body.pin === 'string') {
      if (!isValidPin(body.pin)) return Response.json({ error: 'PIN inválido (4-10 díg)' }, { status: 400 })
      patch.pin = body.pin; newPin = body.pin
    }
    if (Object.keys(patch).length === 0) return Response.json({ error: 'Nada que actualizar' }, { status: 400 })

    const res = await fetch(`${url}/rest/v1/pos_staff?${scope}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return Response.json({ error: 'No se pudo actualizar' }, { status: 502 })
    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) return Response.json({ error: 'Empleado no encontrado' }, { status: 404 })
    const s = rows[0]
    return Response.json({ staff: { id: s.id, name: s.name, role: s.role, active: s.active }, ...(newPin ? { pin: newPin } : {}) })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
