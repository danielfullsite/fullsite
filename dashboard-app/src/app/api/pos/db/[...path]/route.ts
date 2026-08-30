// Proxy Supabase autenticado para el Offline Shell.
//
// Por qué: desde la red del restaurante Cloudflare bloquea clientes no-navegador
// y ~30 tablas del POS están RLS-locked a anon. El Offline Shell (Electron) no
// puede leer/escribir Supabase directo. Este proxy corre en Vercel (que sí
// alcanza Supabase), autoriza con el shift token del POS (withPOSAuth) y **fuerza
// el client_id del token en cada request** → aislamiento por tenant garantizado
// aunque el proxy use service key. El interceptor de fetch del cliente reescribe
// ${SUPABASE_URL}/rest/v1/* → /api/pos/db/rest/v1/* con el shift token.
//
// Seguridad:
//  - Solo /rest/v1/pos_* (tablas del POS). **Los RPC se rechazan** — ver abajo.
//  - GET/PATCH/DELETE: inyecta client_id=eq.<tokenClientId> (PostgREST hace AND) →
//    una fila de otro tenant nunca matchea, aunque filtren por id.
//  - POST: fuerza client_id=<tokenClientId> en cada fila del body.
//
// POR QUÉ LOS RPC SE RECHAZAN
//
// Hasta el 2026-08-27 este proxy dejaba pasar `/rest/v1/rpc/*` sin ninguna de las
// protecciones de abajo, con esta justificación escrita aquí mismo:
//
//   "los RPC r1_* se autoprotegen por tenant server-side"
//
// **Es cierto a medias, y la mitad falsa es la que importa.** Los `r1_*` sí abren con
// `IF NOT private.can_write_client(p_client_id) THEN … FORBIDDEN_CLIENT`. Pero la
// primera rama de ese guardián es:
//
//   if v_role = 'service_role' then return true; end if;
//
// Este proxy llama con `SUPABASE_SERVICE_KEY`. **El guardián se desarma solo.**
//
// Demostrado contra producción, no razonado — misma llamada, mismo tenant ajeno:
//
//   claims.role = 'service_role'   → r1_save_order(...) → { ok: true, revision: 1 }
//   claims.role = 'authenticated'  → r1_save_order(...) → { ok: false, FORBIDDEN_CLIENT }
//
// O sea: cualquiera con un shift token —cualquier empleado de cualquier restaurante que
// sepa un PIN del POS— podía escribir en otro restaurante mandando `p_client_id` ajeno.
// Sin gate de rol en esa rama, un mesero bastaba. Y alcanzaba también a las funciones
// destructivas (`r1_cleanup_*`), que asumen que sólo `service_role` las invoca.
//
// Se rechaza en vez de filtrarse con un allowlist porque un allowlist es una lista que
// hay que mantener correcta para siempre — y este defecto nació exactamente de eso: una
// regla que era cierta a medias y que nadie volvió a comprobar. Nadie usa esta rama: el
// interceptor del cliente excluye `/rest/v1/rpc/` (supabase-fetch-patch.ts) y no hay un
// solo llamador en el repo ni en el Offline Shell. Los RPC ya tienen sus puertas propias
// —`/api/pos/save-order` y compañía— que resuelven el tenant desde el token firmado y
// nunca lo aceptan del cliente.

import { NextRequest, NextResponse } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { ALLOW, MANAGER_ONLY_WRITE, isManager, redactResponse, tableOf } from '@/lib/pos-db-policy'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function forbidden(msg: string) {
  return NextResponse.json({ error: msg }, { status: 403 })
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  const clientId = auth.clientId

  const { path } = await ctx.params
  const rel = (path || []).join('/')
  if (!rel.startsWith('rest/v1/')) return forbidden('solo /rest/v1/*')
  const resource = rel.slice('rest/v1/'.length)

  // ── Los RPC no pasan ──────────────────────────────────────────────────
  // Va ANTES que todo lo demás a propósito. Cuando la condición era `!isRpc`
  // repartida por el archivo, cada protección nueva que alguien agregaba nacía ya
  // saltada para los RPC — pasó seis veces seguidas. Un solo `return` temprano no
  // se puede olvidar de aplicar.
  //
  // Se registra el intento para que, si algún Offline Shell viejo ya instalado sí
  // usaba esta rama, aparezca con nombre y tenant en vez de fallar en silencio. Va
  // a consola y no a `pos_audit_log`: escribir en la base por cada petición
  // rechazada convertiría este rechazo en un amplificador para saturarla.
  if (resource.startsWith('rpc/')) {
    console.warn('[pos-db-proxy] RPC rechazado', {
      rpc: resource.slice('rpc/'.length).split('?')[0],
      tenant: clientId,
      rol: auth.role,
      metodo: req.method,
    })
    return forbidden('este proxy no expone RPC — usa la ruta de API correspondiente')
  }

  if (!resource.startsWith('pos_')) return forbidden('solo tablas pos_*')

  // ── Autorización por tabla ────────────────────────────────────────────
  // Hasta hoy aquí no había nada: bastaba que la tabla empezara con `pos_`.
  // Como este proxy usa service_role (se salta RLS), un shift token de mesero
  // podía leer el PIN del gerente y reescribírselo. El aislamiento por tenant
  // sí existía; el de rol no.
  const table = tableOf(resource)
  if (!ALLOW.has(table)) return forbidden(`tabla no permitida: ${table}`)
  if (req.method !== 'GET' && req.method !== 'HEAD' && MANAGER_ONLY_WRITE.has(table) && !isManager(auth.role)) {
    return forbidden('se requiere rol de gerente')
  }

  // Query params del request original + forzar client_id salvo en inserts.
  const params = new URLSearchParams(req.nextUrl.search)
  if (req.method !== 'POST') {
    params.set('client_id', `eq.${clientId}`)
  }
  const qs = params.toString()
  const target = `${SUPABASE_URL}/rest/v1/${resource}${qs ? `?${qs}` : ''}`

  // Body: en POST a tablas pos_, forzar client_id del token en cada fila.
  let body: string | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await req.text().catch(() => '')
    if (raw && req.method === 'POST') {
      try {
        const parsed = JSON.parse(raw)
        const withCid = Array.isArray(parsed)
          ? parsed.map((r) => ({ ...r, client_id: clientId }))
          : { ...parsed, client_id: clientId }
        body = JSON.stringify(withCid)
      } catch {
        body = raw
      }
    } else {
      body = raw || undefined
    }
  }

  // Headers que respeta PostgREST del request original (Prefer, Range, Content-Type).
  const fwd: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }
  const prefer = req.headers.get('prefer'); if (prefer) fwd['Prefer'] = prefer
  const range = req.headers.get('range'); if (range) fwd['Range'] = range

  try {
    const r = await fetch(target, { method: req.method, headers: fwd, body })
    const raw2 = await r.text()
    const ct = r.headers.get('content-type')
    // El PIN nunca sale por aquí, sin importar qué pidió el `select`.
    const text = redactResponse(table, raw2, ct)
    const res = new NextResponse(text, { status: r.status })
    if (ct) res.headers.set('content-type', ct)
    const cr = r.headers.get('content-range'); if (cr) res.headers.set('content-range', cr)
    return res
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
