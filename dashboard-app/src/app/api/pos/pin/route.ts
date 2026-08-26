import { NextRequest } from 'next/server'
import { issueShiftToken } from '@/lib/shift-token'
import { pinGate, pinRecord } from '@/lib/pin-throttle'

// PIN validation + shift token issuance.
// On success returns { staff, shiftToken } — the client stores shiftToken
// and sends it as Authorization: Bearer <shiftToken> on every POS request.
// This replaces the btoa(pin) PIN cache (P0-E fix) and provides server-verified
// identity for all POS API calls (P0-N fix via withPOSAuth).
//
// Brute-force protection lives in pin-throttle.ts: keyed by clientId:ip (NOT
// ip:pin), so trying many different PINs from one source shares one budget and
// trips a lockout — 10k-PIN enumeration becomes infeasible.

async function respond(staff: { id: string; name: string; role: string }, clientId: string, key: string) {
  await pinRecord(key, true) // success clears the throttle for this source
  let shiftToken: string | undefined
  try {
    shiftToken = await issueShiftToken(staff.id, clientId, staff.role, staff.name)
  } catch (e) {
    // SHIFT_TOKEN_SECRET not configured — log and continue without token (degrades to legacy flow)
    console.error('[pin] issueShiftToken failed (SHIFT_TOKEN_SECRET missing?):', e)
  }
  return Response.json({ staff, shiftToken })
}

/**
 * Restaurantes para los que un fallback de entorno esta habilitado.
 *
 * Falla CERRADO: si la variable no esta puesta, devuelve false y el fallback no
 * aplica a nadie. Acepta lista separada por comas, para una instalacion con
 * varias sucursales bajo el mismo despliegue.
 */
function envTenantAllows(varName: string, clientId: string): boolean {
  const declarados = (process.env[varName] ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  if (declarados.length === 0) return false
  return declarados.includes(clientId)
}

const fallbackAllowedFor = (clientId: string) => envTenantAllows('POS_FALLBACK_CLIENT_ID', clientId)
const managerPinsAllowedFor = (clientId: string) => envTenantAllows('MANAGER_PINS_CLIENT_ID', clientId)

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const { pin, client_id, manager, fingerprint_id, min_role, device_id } = await request.json()
    if (typeof client_id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(client_id)) {
      return Response.json({ error: 'client_id requerido' }, { status: 400 })
    }
    const clientId = client_id
    // Brute-force gate — one budget per (tenant, source), NOT per PIN, so
    // enumerating many PINs from one source trips the lockout.
    const throttleKey = `${clientId}:${ip}`
    const gate = await pinGate(throttleKey)
    if (!gate.allowed) {
      return Response.json(
        { error: 'Terminal bloqueada por intentos fallidos. Espera unos minutos.' },
        { status: 429, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : undefined }
      )
    }
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    // BUG-019: pos_staff is now tenant-scoped RLS with NO anon access, so the PIN
    // lookup must run server-side with the service_role key (bypasses RLS). The
    // clientId is still enforced explicitly in the query filter below, and the
    // issued shift token binds the operator to this tenant. Never expose this key
    // to the client.
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` }

    // Device binding — si el tenant lo exige, la terminal debe estar enrolada
    // ANTES de aceptar el PIN. Así un navegador desconocido ni llega al login.
    // Opt-in por tenant (pos.require_enrolled_terminal); por defecto no aplica.
    try {
      const cfgRes = await fetch(
        `${sbUrl}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=pos_settings&limit=1`,
        { headers: sbHeaders, cache: 'no-store' }
      )
      const cfgRows = cfgRes.ok ? await cfgRes.json() : []
      const requireEnrolled = cfgRows?.[0]?.pos_settings?.['pos.require_enrolled_terminal'] === true
      if (requireEnrolled) {
        const dev = typeof device_id === 'string' ? device_id : ''
        let enrolled = false
        if (dev && /^[\w-]{1,64}$/.test(dev)) {
          const tRes = await fetch(
            `${sbUrl}/rest/v1/pos_terminals?client_id=eq.${encodeURIComponent(clientId)}&device_id=eq.${encodeURIComponent(dev)}&active=eq.true&select=device_id&limit=1`,
            { headers: sbHeaders, cache: 'no-store' }
          )
          if (tRes.ok) {
            const tRows = await tRes.json()
            enrolled = Array.isArray(tRows) && tRows.length > 0
          }
        }
        if (!enrolled) {
          return Response.json(
            { error: 'Terminal no autorizada', code: 'terminal_not_enrolled', device_id: dev },
            { status: 403 }
          )
        }
      }
    } catch {
      // Fallo de infra al verificar enrolamiento: no bloquear el login (fail-open
      // en la verificación de device; el PIN + throttle + RLS siguen aplicando).
    }

    // Fingerprint (WebAuthn) login — look up by staff ID, validate active status + tenant
    if (fingerprint_id && typeof fingerprint_id === 'string') {
      const fpRes = await fetch(
        `${sbUrl}/rest/v1/pos_staff?id=eq.${encodeURIComponent(fingerprint_id)}&active=eq.true&client_id=eq.${encodeURIComponent(clientId)}&select=id,name,role&limit=1`,
        { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
      )
      if (fpRes.ok) {
        const rows = await fpRes.json()
        if (Array.isArray(rows) && rows.length > 0) {
          return respond({ id: rows[0].id, name: rows[0].name, role: rows[0].role }, clientId, throttleKey)
        }
      }
      await pinRecord(throttleKey, false)
      return Response.json({ error: 'Empleado no encontrado o desactivado' }, { status: 401 })
    }

    // Transitional compatibility: existing staff may still have 4–8 digit
    // PINs while each person is migrated to a unique 10-digit emergency PIN.
    if (typeof pin !== 'string' || !/^\d{4,10}$/.test(pin)) {
      return Response.json({ error: 'PIN inválido' }, { status: 400 })
    }

    // Role hierarchy filter
    const ROLE_HIERARCHY: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }
    const effectiveMinRole = min_role || (manager === true ? 'gerente' : null)
    let roleFilter = ''
    if (effectiveMinRole && ROLE_HIERARCHY[effectiveMinRole]) {
      const minLevel = ROLE_HIERARCHY[effectiveMinRole]
      const allowedRoles = Object.entries(ROLE_HIERARCHY)
        .filter(([, level]) => level >= minLevel)
        .map(([role]) => role)
      roleFilter = `&role=in.(${allowedRoles.join(',')})`
    }

    const res = await fetch(
      `${sbUrl}/rest/v1/pos_staff?pin=eq.${encodeURIComponent(pin)}&active=eq.true&client_id=eq.${encodeURIComponent(clientId)}${roleFilter}&select=id,name,role&limit=1`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows) && rows.length > 0) {
        return respond({ id: rows[0].id, name: rows[0].name, role: rows[0].role }, clientId, throttleKey)
      }
    }

    // ── Fallbacks de emergencia por variable de entorno ─────────────────────
    //
    // Existen para no dejar a un restaurante sin acceso si pos_staff falla.
    // Pero un PIN de entorno NO pertenece a ningun restaurante, y hasta el
    // 2026-08-26 no se comparaba contra ninguno: quien conociera
    // POS_FALLBACK_PIN entraba como admin de CUALQUIER tenant y se llevaba un
    // shift token firmado. MANAGER_PINS tenia el mismo agujero, dando gerente.
    //
    // Ahora cada fallback declara A QUE restaurante pertenece y falla CERRADO:
    // sin su variable de tenant no aplica a nadie. Un despliegue nuevo nace sin
    // llave maestra, en vez de nacer con una.
    if (fallbackAllowedFor(clientId)) {
      const fallback = (process.env.POS_FALLBACK_PIN ?? '').trim()
      if (fallback && pin === fallback) {
        return respond({ id: 'admin', name: 'Admin', role: 'admin' }, clientId, throttleKey)
      }
    }

    // MANAGER_PINS — formato "pin:Nombre,pin:Nombre"
    if (manager === true && managerPinsAllowedFor(clientId)) {
      const raw = process.env.MANAGER_PINS || ''
      for (const entry of raw.split(',')) {
        const [p, name] = entry.split(':')
        if (p && name && p.trim() === pin) {
          return respond({ id: 'manager', name: name.trim(), role: 'gerente' }, clientId, throttleKey)
        }
      }
    }

    await pinRecord(throttleKey, false)
    return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
