import { NextRequest } from 'next/server'
import { issueShiftToken, issueApprovalToken } from '@/lib/shift-token'
import { terminalIdValido } from '@/lib/terminal-id'
import { buscarPorPin, fallbacksDeEntornoPermitidos } from '@/lib/pos-pin-authority'
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

/**
 * Contexto de la petición que `respond` necesita además del empleado.
 *
 * `aprobacion`: la pidió una pantalla de autorización (manager / min_role), no un login.
 * Desde 2026-09-24 una aprobación recibe su PROPIO token (`approvalToken`: 15 min, `jti`,
 * amarrado a la terminal) en vez del shiftToken de 8 h del gerente. Antes, teclear el PIN
 * del gerente en la terminal de un mesero le dejaba a esa terminal una sesión de gerente
 * para toda la noche.
 */
interface Contexto { terminalId?: string; aprobacion: boolean; llaves: string[]; auditar?: (r: ResultadoAuditoria) => Promise<void> }
type ResultadoAuditoria = { resultado: 'aprobado' | 'rechazado'; staff?: { id: string; name: string; role: string } }

async function respond(staff: { id: string; name: string; role: string }, clientId: string, ctx: Contexto) {
  for (const k of ctx.llaves) await pinRecord(k, true) // success clears the throttle for this source
  const tid = terminalIdValido(ctx.terminalId) ? ctx.terminalId : undefined
  let shiftToken: string | undefined
  let approvalToken: string | undefined
  // Compatibilidad: clientes con el bundle viejo usan el shiftToken como aprobación.
  // En modo estricto v2 una aprobación ya no entrega sesión.
  if (!ctx.aprobacion || process.env.POS_APROBACION_V2_ESTRICTA !== 'true') {
    try {
      shiftToken = await issueShiftToken(staff.id, clientId, staff.role, staff.name, tid)
    } catch (e) {
      // SHIFT_TOKEN_SECRET not configured — log and continue without token (degrades to legacy flow)
      console.error('[pin] issueShiftToken failed (SHIFT_TOKEN_SECRET missing?):', e)
    }
  }
  if (ctx.aprobacion) {
    try {
      approvalToken = await issueApprovalToken(staff.id, clientId, staff.role, staff.name, tid)
    } catch (e) {
      console.error('[pin] issueApprovalToken failed:', e)
    }
  }
  if (ctx.auditar) await ctx.auditar({ resultado: 'aprobado', staff })
  return Response.json({ staff, shiftToken, approvalToken })
}

/**
 * Bitácora de cada intento de APROBACIÓN de gerente (no de cada login: ése ya queda en
 * pos_sessions/asistencia). Nunca guarda el PIN. No bloquea: si la bitácora no responde en
 * 2 s la aprobación sigue — el candado de la aprobación es el PIN y el throttle, no el log.
 */
function auditorDeAprobacion(sbUrl: string, sbKey: string, clientId: string, terminalId: string | undefined, minRole: string) {
  return async (r: ResultadoAuditoria) => {
    try {
      await fetch(`${sbUrl}/rest/v1/pos_audit_log`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          client_id: clientId,
          action: 'aprobacion_pin',
          actor: r.staff?.name || 'desconocido',
          approved_by: r.resultado === 'aprobado' ? r.staff?.id ?? null : null,
          details: { resultado: r.resultado, terminal_id: terminalId ?? null, min_role: minRole, rol: r.staff?.role ?? null },
        }),
        signal: AbortSignal.timeout(2000),
      })
    } catch { /* bitácora best-effort */ }
  }
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
    const { pin, client_id, manager, fingerprint_id, min_role, device_id, aprobacion } = await request.json()
    if (typeof client_id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(client_id)) {
      return Response.json({ error: 'client_id requerido' }, { status: 400 })
    }
    const clientId = client_id
    // Brute-force gate — one budget per (tenant, source), NOT per PIN, so
    // enumerating many PINs from one source trips the lockout.
    const throttleKey = `${clientId}:${ip}`
    // Terminal declarada. Se valida el formato, no la posesión: amarra los tokens a la
    // terminal que se dijo ser (una aprobación no viaja a otra terminal), y le da a las
    // aprobaciones su propio presupuesto de intentos por terminal.
    const terminalId = terminalIdValido(device_id) ? device_id : undefined
    // `aprobacion: true` sin rol: la pide la Caja (actor-authority.js), que revisa el rol mínimo
    // ella misma. Si aquí se filtrara por rol, el 401 de «no alcanza» le borraría a la Caja la
    // credencial de un empleado válido. Los consumidores del token revisan el rol igual.
    const esAprobacion = manager === true || aprobacion === true || (min_role !== undefined && min_role !== null)
    const llaves = [throttleKey]
    if (esAprobacion) llaves.push(`aprob:${clientId}:${terminalId ?? 'sin-terminal'}`)
    let gate = { allowed: true } as Awaited<ReturnType<typeof pinGate>>
    for (const k of llaves) {
      const g = await pinGate(k)
      if (!g.allowed) { gate = g; break }
    }
    if (!gate.allowed) {
      return Response.json(
        { error: 'Terminal bloqueada por intentos fallidos. Espera unos minutos.' },
        { status: 429, headers: gate.retryAfter ? { 'Retry-After': String(gate.retryAfter) } : undefined }
      )
    }

    /**
     * UN ID NO ES UNA HUELLA — F-01 (P0), auditoría 2026-09-23.
     *
     * Hasta aquí existía una rama que emitía shiftToken a partir de `fingerprint_id`: el
     * UUID del empleado que el lector local decía haber reconocido. El servidor nunca
     * verificó ninguna firma, así que el id era una afirmación del cliente — y los UUID
     * viven en `pos_fingerprint_staff` / `pos_staff_cache` de cualquier terminal y en
     * GET /api/pos/staff. Conocer el de un gerente bastaba para un token de gerente sin
     * huella y sin PIN. El arreglo del 2026-08-31 cerró la escalada de rol; la
     * suplantación seguía abierta.
     *
     * Contención: si llega `fingerprint_id` (con o sin PIN) se rechaza con 401
     * `biometria_no_verificada` y no se consulta a nadie. No se "degrada" a validar el
     * PIN que venga al lado: el cliente viejo mandaba `pin: '___fingerprint___'` y un
     * cliente mezclado no es un cliente honesto.
     *
     * NO cuenta en el throttle (revisión adversarial N-1). La llave es (restaurante, IP)
     * y todas las terminales comparten IP pública: 8 toques de huella en terminales sin
     * F5 bloqueaban el PIN del gerente para todo el restaurante. Esta respuesta no
     * consulta nada y es idéntica para cualquier id, así que no hay nada que adivinar.
     *
     * La biometría vuelve SOLO con verificación en servidor: llave pública WebAuthn
     * guardada por empleado (alta hecha con sesión de gerente), challenge de un solo uso
     * emitido por este servidor y consumido al verificar la assertion (firma, rpId,
     * origin, contador, userVerification). Nunca más aceptar un id como prueba.
     */
    if (fingerprint_id !== undefined && fingerprint_id !== null) {
      return Response.json(
        { error: 'La huella no está disponible por seguridad; entra con tu PIN', code: 'biometria_no_verificada' },
        { status: 401 }
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
      if (!cfgRes.ok) return Response.json({ error: 'No se pudo verificar la política de acceso', code: 'authority_unavailable' }, { status: 503 })
      const cfgRows = await cfgRes.json()
      if (!Array.isArray(cfgRows) || cfgRows.length !== 1) return Response.json({ error: 'No se pudo confirmar la instalación', code: 'authority_unavailable' }, { status: 503 })
      const requireEnrolled = cfgRows?.[0]?.pos_settings?.['pos.require_enrolled_terminal'] === true
      if (requireEnrolled) {
        const dev = typeof device_id === 'string' ? device_id : ''
        let enrolled = false
        if (dev && /^[\w-]{1,64}$/.test(dev)) {
          const tRes = await fetch(
            `${sbUrl}/rest/v1/pos_terminals?client_id=eq.${encodeURIComponent(clientId)}&device_id=eq.${encodeURIComponent(dev)}&active=eq.true&select=device_id&limit=1`,
            { headers: sbHeaders, cache: 'no-store' }
          )
          if (!tRes.ok) return Response.json({ error: 'No se pudo verificar la terminal', code: 'authority_unavailable' }, { status: 503 })
          const tRows = await tRes.json()
          if (!Array.isArray(tRows)) return Response.json({ error: 'Registro de terminales ilegible', code: 'authority_unavailable' }, { status: 503 })
          enrolled = tRows.length > 0
        }
        if (!enrolled) {
          return Response.json(
            { error: 'Terminal no autorizada', code: 'terminal_not_enrolled', device_id: dev },
            { status: 403 }
          )
        }
      }
    } catch {
      // A transport failure is neither permission nor employee revocation.
      // Prepared users can use Caja's bounded verifier while this authority is
      // unavailable; a new terminal cannot self-enroll through an outage.
      return Response.json({ error: 'No se pudo verificar el acceso', code: 'authority_unavailable' }, { status: 503 })
    }

    // Role hierarchy filter
    const ROLE_HIERARCHY: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }
    const effectiveMinRole = min_role || (manager === true ? 'gerente' : null)
    // Un rol mínimo que no reconocemos NO es "sin filtro": antes caía de largo y
    // cualquier PIN activo pasaba por aprobación de un rol inventado. Falla cerrado,
    // sin contar intento (no es un PIN adivinado, es una petición mal formada).
    // `Object.hasOwn`, no `ROLE_HIERARCHY[x]`: 'constructor' o '__proto__' son "verdaderos"
    // por herencia y no son roles.
    if (effectiveMinRole && !(typeof effectiveMinRole === 'string' && Object.hasOwn(ROLE_HIERARCHY, effectiveMinRole))) {
      return Response.json({ error: 'Rol requerido no válido', code: 'rol_no_valido' }, { status: 401 })
    }
    let roleFilter = ''
    if (effectiveMinRole) {
      const minLevel = ROLE_HIERARCHY[effectiveMinRole]
      const allowedRoles = Object.entries(ROLE_HIERARCHY)
        .filter(([, level]) => level >= minLevel)
        .map(([role]) => role)
      roleFilter = `&role=in.(${allowedRoles.join(',')})`
    }

    // La rama de huella (`fingerprint_id` → pos_staff?id=eq.…) se quitó el 2026-09-23:
    // ver "UN ID NO ES UNA HUELLA" arriba. Su historia (escalada de rol cerrada el
    // 2026-08-31, suplantación que seguía abierta) está en huella-escalada-de-rol.test.ts.

    // Transitional compatibility: existing staff may still have 4–8 digit
    // PINs while each person is migrated to a unique 10-digit emergency PIN.
    if (typeof pin !== 'string' || !/^\d{4,10}$/.test(pin)) {
      return Response.json({ error: 'PIN inválido' }, { status: 400 })
    }

    const ctx: Contexto = {
      terminalId, aprobacion: esAprobacion, llaves,
      auditar: esAprobacion ? auditorDeAprobacion(sbUrl, sbKey, clientId, terminalId, String(effectiveMinRole ?? 'caja')) : undefined,
    }

    // F4: la búsqueda vive en pos-pin-authority.ts (POS_PIN_AUTHORITY=plain|hash). En hash
    // nunca se consulta `pin`; sin pimienta o con el backfill incompleto → 503, no 401.
    const busqueda = await buscarPorPin<{ id: string; name: string; role: string }>({
      sbUrl, sbKey, clientId, pin, filtro: `&active=eq.true${roleFilter}`, select: 'id,name,role',
    })
    if (busqueda.tipo === 'encontrado') {
      const f = busqueda.fila
      return respond({ id: f.id, name: f.name, role: f.role }, clientId, ctx)
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
    // PINs de emergencia en CLARO en una variable: sólo mientras la autoridad sea `plain`.
    if (fallbacksDeEntornoPermitidos() && fallbackAllowedFor(clientId)) {
      const fallback = (process.env.POS_FALLBACK_PIN ?? '').trim()
      if (fallback && pin === fallback) {
        return respond({ id: 'admin', name: 'Admin', role: 'admin' }, clientId, ctx)
      }
    }

    // MANAGER_PINS — formato "pin:Nombre,pin:Nombre"
    if (fallbacksDeEntornoPermitidos() && manager === true && managerPinsAllowedFor(clientId)) {
      const raw = process.env.MANAGER_PINS || ''
      for (const entry of raw.split(',')) {
        const [p, name] = entry.split(':')
        if (p && name && p.trim() === pin) {
          return respond({ id: 'manager', name: name.trim(), role: 'gerente' }, clientId, ctx)
        }
      }
    }

    if (busqueda.tipo === 'no-disponible') return Response.json({ error: 'No se pudo verificar al empleado', code: 'authority_unavailable' }, { status: 503 })
    for (const k of llaves) await pinRecord(k, false)
    if (ctx.auditar) await ctx.auditar({ resultado: 'rechazado' })
    return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
  } catch {
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
